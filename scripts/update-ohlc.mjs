#!/usr/bin/env node
/**
 * Daily candles for the stock chart on the results pages: dist/ohlc/<symbol>.json (recent sessions)
 * and dist/ohlc/history/<symbol>.json (earlier, from 2010; see ohlc-files.mjs),
 * kept on TradingView's basis (history adjusted for every capital action, not for cash dividends).
 *
 * After each official session the session's candle comes from the TradingView scanner (the same
 * open/high/low/volume TradingView shows) with the Saudi Exchange's official close (data.json).
 * The scanner also returns the previous session: when its close differs from the stored one by a
 * whole-bar factor, a capital action took effect today and earlier history is rescaled by it.
 * Sessions an update missed are filled from Yahoo; a stock without a file starts from Yahoo.
 * The full history is rebuilt from the exchange's adjusted closes by scripts/backfill-ohlc.mjs.
 *
 * Runs once per official session: it skips while dist/ohlc/index.json already covers data.json's
 * official date (use --force to run again).
 * Usage: node scripts/update-ohlc.mjs [--force] [--symbols 3003,2222] [--out <dir>]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseYahoo, parseYahooDividends, nextDividends, rescaleDividends, cleanBars, validOhlc, isFakeBar, fileBars, candleFile, scanBars, addSession, SCAN_COLUMNS, HISTORY_START, SOURCE } from './ohlc-merge.mjs';
import { readCandles, writeCandles } from './ohlc-files.mjs';

const DIST = new URL('../dist/', import.meta.url);
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const dirUrl = path => new URL(`file://${path.startsWith('/') ? '' : process.cwd() + '/'}${path.replace(/\/?$/, '/')}`);
const DIR = arg('--out') ? dirUrl(arg('--out')) : new URL('ohlc/', DIST);
const FALLBACK_SOURCE = 'Yahoo Finance · آخر إغلاق من تداول السعودية';
const force = process.argv.includes('--force'), only = arg('--symbols') ? new Set(arg('--symbols').split(',')) : null;
const readJson = async url => { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const data = JSON.parse(await readFile(new URL('data.json', DIST), 'utf8'));
const officialDate = data.priceSource?.officialDate || null;
const index = await readJson(new URL('index.json', DIR));
if (!force && !only && officialDate && index?.officialDate === officialDate) {
  console.log(`Candles already cover the official close of ${officialDate}; nothing to do.`);
  process.exit(0);
}
const stocks = data.sectors.flatMap(sector => sector.stocks).filter(stock => !only || only.has(stock.symbol));
const officialOf = stock => {
  const last = stock.lastOfficialClose;
  if (last && Number.isFinite(last.price) && /^\d{4}-\d{2}-\d{2}$/.test(last.date || '')) return { date: last.date, price: last.price };
  if (stock.priceStatus === 'official_close' && Number.isFinite(stock.price)) return { date: stock.priceDate, price: stock.price };
  return null;
};

async function getJson(url, init = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1500 * attempt);
    } finally { clearTimeout(timer); }
  }
}
// Yahoo answers 429 to Node with a full Chrome user agent (it does not match Node's TLS fingerprint) but serves a plain one.
const yahooJson = (symbol, range) => getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?${range === 'all' ? `period1=${Date.parse(`${HISTORY_START}T00:00:00Z`) / 1000}&period2=${Math.floor(Date.now() / 1000)}` : `range=${range}`}&interval=1d&events=div`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
const yahoo = (symbol, range) => yahooJson(symbol, range).then(parseYahoo);

async function scanner(symbols) {
  const rows = new Map();
  for (let i = 0; i < symbols.length; i += 100) {
    const json = await getJson('https://scanner.tradingview.com/ksa/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: { tickers: symbols.slice(i, i + 100).map(s => `TADAWUL:${s}`), query: { types: [] } }, columns: SCAN_COLUMNS }) });
    for (const row of json?.data ?? []) rows.set(String(row.s).split(':')[1], scanBars(row));
  }
  return rows;
}

await mkdir(DIR, { recursive: true });
let sessions = new Map();
try { sessions = await scanner(stocks.map(s => s.symbol)); } catch (error) { console.warn(`TradingView scanner unavailable (${error.message}); using Yahoo for every stock.`); }

const failed = [], adjusted = [];
let written = 0, fetched = 0;
const queue = [...stocks];
async function worker() {
  while (queue.length) {
    const stock = queue.shift(), file = new URL(`${stock.symbol}.json`, DIR), official = officialOf(stock);
    try {
      const before = await readCandles(DIR, stock.symbol), session = sessions.get(stock.symbol);
      // Stored history (files from before the rebuild may still hold Yahoo's flat no-volume bars), or Yahoo for a new stock.
      let bars = before && validOhlc(before) ? fileBars(before).filter(b => Array.isArray(before.est) || !isFakeBar(b)) : null;
      let source = before?.source === SOURCE ? SOURCE : FALLBACK_SOURCE, est = before?.est || [], dv = nextDividends(before);
      if (!bars) bars = cleanBars((await yahoo(stock.symbol, 'all')).filter(b => !isFakeBar(b)), { official }).bars;
      let through = before?.officialThrough ?? null;
      if (session?.today && official) {
        const last = bars.at(-1)?.d ?? '';
        // Sessions this update missed: the stored history stops before TradingView's previous session.
        // Recent Yahoo bars: dividends declared since the last run (the chart's ADJ option), and sessions this update missed.
        let recent = null; try { recent = await yahooJson(stock.symbol, '3mo'); } catch { /* dividends wait for the next run */ }
        if (recent) dv = nextDividends(before, parseYahooDividends(recent));
        const fill = recent && session.prev && last < session.prev.d && !bars.some(b => b.d === session.prev.d) ? parseYahoo(recent) : [];
        const result = addSession(bars, session, official, { fill });
        if (result.added) {
          bars = result.bars; through = official.date;
          est = est.filter(d => d !== session.today.d && d !== session.prev?.d); // now real TradingView candles
          if (result.factor) dv.div = rescaleDividends(dv.div, session.prev.d, result.factor);
          if (result.factor) adjusted.push({ symbol: stock.symbol, date: session.prev.d, factor: Math.round(result.factor * 1e6) / 1e6 });
        }
      }
      if (!before && bars.at(-1)?.d === official?.date) through = official.date;
      const { div, ...divFields } = dv;
      const next = { ...candleFile(stock.symbol, source, through, bars, est, div), ...divFields };
      if (!validOhlc(next)) throw new Error('too few valid bars');
      fetched += 1;
      written += await writeCandles(DIR, next);
    } catch (error) { failed.push(`${stock.symbol} (${error.message})`); }
    await sleep(50);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

if (!only) await writeFile(new URL('index.json', DIR), JSON.stringify({ ...(index || {}), officialDate, updatedAt: new Date().toISOString(), source: SOURCE, symbols: fetched, failed, adjustedToday: adjusted }, null, 1) + '\n');
console.log(`Candles: ${written} files written, ${fetched}/${stocks.length} kept, ${sessions.size} sessions from TradingView.`);
if (adjusted.length) console.log(`Capital actions applied today: ${adjusted.map(a => `${a.symbol} ×${a.factor}`).join(', ')}`);
if (failed.length) console.warn(`Kept the existing file for: ${failed.join(', ')}`);
// A source outage must not block the price update; only fail when nothing at all came back.
if (stocks.length && failed.length === stocks.length) process.exit(1);

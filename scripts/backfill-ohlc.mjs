#!/usr/bin/env node
/**
 * Rebuild five years of daily candles per stock on TradingView's basis (dist/ohlc/<symbol>.json).
 *
 *  - Sessions and every close: the Saudi Exchange's own adjusted closes (company page chart,
 *    "adjusted for all corporate actions" — the same basis TradingView uses: bonus shares, splits,
 *    capital reductions and rights issues, not cash dividends).
 *  - Open/high/low/volume: Yahoo daily bars, rescaled to the exchange's basis. Sessions Yahoo never
 *    received come from Yahoo's 60-minute bars (about two years back) and are marked estimated;
 *    older ones get a candle from the previous close to the official close, also marked estimated.
 *  - Days a stock did not trade (suspensions) are left out, as on TradingView.
 *
 * saudiexchange.sa sits behind Akamai: run it where CURL_IMPERSONATE_BIN is set (GitHub Actions,
 * .github/workflows/backfill-ohlc.yml). With --official-dir it reads saved <symbol>.json responses.
 * Usage: node scripts/backfill-ohlc.mjs [--symbols 2222,1213] [--out <dir>] [--official-dir <dir>]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { parseYahoo, hourlyDays, parseOfficialCloses, rebuildBars, candleFile, validOhlc, fileBars, round2Price, SOURCE } from './ohlc-merge.mjs';

const execFile = promisify(execFileCb);
const DIST = new URL('../dist/', import.meta.url);
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const dirUrl = path => new URL(`file://${path.startsWith('/') ? '' : process.cwd() + '/'}${path.replace(/\/?$/, '/')}`);
const DIR = arg('--out') ? dirUrl(arg('--out')) : new URL('ohlc/', DIST);
const OFFICIAL_DIR = arg('--official-dir') ? dirUrl(arg('--official-dir')) : null;
const only = arg('--symbols') ? new Set(arg('--symbols').split(',')) : null;
const IMPERSONATE = process.env.CURL_IMPERSONATE_BIN || null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const officialUrl = symbol => `https://www.saudiexchange.sa/tadawul.eportal.charts.v2/ChartGenerator?chart-type=SQL_CI_CV_COM&chart-parameter=${symbol}&methodType=parsingMethod`;

async function getText(url, { headers = {}, impersonate = false } = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (impersonate && IMPERSONATE) {
        // No custom headers: Akamai matches the header set against the impersonated Chrome fingerprint.
        const { stdout } = await execFile(IMPERSONATE, [url, '--silent', '--fail', '--max-time', '60', '--compressed'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 90000 });
        return stdout;
      }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } finally { clearTimeout(timer); }
    } catch (error) { last = error; await sleep(2000 * attempt); }
  }
  throw new Error(String(last?.message || last).split('\n')[0]);
}
const yahooJson = async (symbol, query) => JSON.parse(await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?${query}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }));
async function officialCloses(symbol) {
  const text = OFFICIAL_DIR ? await readFile(new URL(`${symbol}.json`, OFFICIAL_DIR), 'utf8') : await getText(officialUrl(symbol), { impersonate: true, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  return parseOfficialCloses(JSON.parse(text));
}

const data = JSON.parse(await readFile(new URL('data.json', DIST), 'utf8'));
const officialDate = data.priceSource?.officialDate || null;
const stocks = data.sectors.flatMap(sector => sector.stocks).filter(stock => !only || only.has(stock.symbol));
await mkdir(DIR, { recursive: true });

const report = { rebuilt: 0, failed: [], estimated: 0, flags: [] };
const queue = [...stocks];
async function worker() {
  while (queue.length) {
    const stock = queue.shift();
    try {
      let official = await officialCloses(stock.symbol);
      const last = stock.lastOfficialClose;
      // The latest official close in data.json is final; nothing after it is kept.
      if (last?.date) {
        official = official.filter(x => x.d <= last.date);
        if (official.at(-1)?.d === last.date) official.at(-1).c = round2Price(last.price);
      }
      const daily = new Map(parseYahoo(await yahooJson(stock.symbol, 'range=6y&interval=1d')).map(b => [b.d, b]));
      let hourly = new Map();
      try { hourly = hourlyDays(await yahooJson(stock.symbol, 'range=730d&interval=60m')); } catch { /* estimated candles then use the closes only */ }
      const rebuilt = rebuildBars({ official, daily, hourly });
      // Sessions the daily update stored from TradingView stay as they are while their close still
      // matches (a later capital action changes every earlier close, and then the rebuild wins).
      let before = null; try { before = JSON.parse(await readFile(new URL(`${stock.symbol}.json`, DIR), 'utf8')); } catch { /* new */ }
      const kept = new Map(before?.source === SOURCE && validOhlc(before) ? fileBars(before).filter(b => !(before.est || []).includes(b.d)).map(b => [b.d, b]) : []);
      const est = new Set(rebuilt.est);
      const bars = rebuilt.bars.map(b => { const k = kept.get(b.d); if (k && Math.abs(k.c - b.c) < 0.005) { est.delete(b.d); return k; } return b; });
      const file = candleFile(stock.symbol, SOURCE, official.at(-1)?.d ?? null, bars, [...est]);
      if (!validOhlc(file)) throw new Error('too few valid bars');
      await writeFile(new URL(`${stock.symbol}.json`, DIR), JSON.stringify(file) + '\n');
      report.rebuilt += 1; report.estimated += file.est.length;
      if (file.flags.length) report.flags.push(`${stock.symbol}: ${file.flags.map(f => `${f.date} ${f.change}%`).join(', ')}`);
    } catch (error) { report.failed.push(`${stock.symbol} (${error.message})`); }
    await sleep(250);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));

if (!only) {
  const indexUrl = new URL('index.json', DIR);
  let index = {}; try { index = JSON.parse(await readFile(indexUrl, 'utf8')); } catch { /* new */ }
  await writeFile(indexUrl, JSON.stringify({ ...index, officialDate, rebuiltAt: new Date().toISOString(), source: SOURCE, symbols: report.rebuilt, failed: report.failed, estimatedSessions: report.estimated, unexplainedJumps: report.flags }, null, 1) + '\n');
}
console.log(`Rebuilt ${report.rebuilt}/${stocks.length} stocks; ${report.estimated} estimated sessions.`);
if (report.flags.length) console.warn(`Moves beyond the daily limit that no capital action explains:\n  ${report.flags.join('\n  ')}`);
if (report.failed.length) console.warn(`Not rebuilt (existing file kept): ${report.failed.join(', ')}`);
if (stocks.length && !report.rebuilt) process.exit(1);

#!/usr/bin/env node
/**
 * Daily candles for the stock chart on the results pages: dist/ohlc/<symbol>.json (five years).
 * Source: Yahoo Finance daily bars (free, no key; fetched here because browsers are blocked by CORS).
 * Each stock's last official Saudi Exchange close (data.json) is final for its day, nothing after it
 * is kept, bad prints are removed and unadjusted capital actions are flagged (scripts/ohlc-merge.mjs).
 * If the source fails for a stock its existing file is kept.
 * Runs once per official session: it skips while dist/ohlc/index.json already covers data.json's
 * official date (use --force to refetch).
 * Usage: node scripts/update-ohlc.mjs [--force] [--symbols 3003,2222]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseYahoo, cleanBars, ohlcFile, validOhlc, YEARS } from './ohlc-merge.mjs';

const DIST = new URL('../dist/', import.meta.url), DIR = new URL('ohlc/', DIST);
const SOURCE = 'Yahoo Finance · آخر إغلاق من تداول السعودية';
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
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

async function fetchYahoo(symbol) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      // Yahoo answers 429 to Node with a full Chrome user agent (it does not match Node's TLS fingerprint) but serves a plain one.
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?range=${YEARS}y&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseYahoo(await response.json());
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1500 * attempt);
    } finally { clearTimeout(timer); }
  }
}

await mkdir(DIR, { recursive: true });
const failed = [];
let written = 0, fetched = 0;
const queue = [...stocks];
async function worker() {
  while (queue.length) {
    const stock = queue.shift(), file = new URL(`${stock.symbol}.json`, DIR), official = officialOf(stock);
    try {
      const next = ohlcFile(stock.symbol, SOURCE, official, cleanBars(await fetchYahoo(stock.symbol), { official }));
      if (!validOhlc(next)) throw new Error('too few valid bars');
      fetched += 1;
      const text = JSON.stringify(next) + '\n', before = await readJson(file);
      if (!before || JSON.stringify(before) + '\n' !== text) { await writeFile(file, text); written += 1; }
    } catch (error) { failed.push(`${stock.symbol} (${error.message})`); }
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

if (!only) await writeFile(new URL('index.json', DIR), JSON.stringify({ officialDate, updatedAt: new Date().toISOString(), source: SOURCE, symbols: fetched, failed }, null, 1) + '\n');
console.log(`Candles: ${written} files written, ${fetched}/${stocks.length} fetched.`);
if (failed.length) console.warn(`Kept the existing file for: ${failed.join(', ')}`);
// A source outage must not block the price update; only fail when nothing at all came back.
if (stocks.length && failed.length === stocks.length) process.exit(1);

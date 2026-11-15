#!/usr/bin/env node
/**
 * Daily closes for the mini chart on the results pages: dist/history/<symbol>.json.
 * The past year comes from Yahoo Finance (free, no key; fetched here because browsers
 * are blocked by CORS). Each stock's last official Saudi Exchange close in data.json
 * overrides the source for that day, and nothing after it is kept.
 * Runs once per official session: it skips when dist/history/index.json already
 * covers data.json's official date (use --force to refetch).
 * Usage: node scripts/update-history.mjs [--force] [--symbols 3003,2222]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseYahooChart, mergeHistory, validHistory } from './history-merge.mjs';

const DIST = new URL('../dist/', import.meta.url);
const DIR = new URL('history/', DIST);
// Yahoo answers 429 to Node with a full Chrome user agent (it does not match Node's TLS fingerprint) but serves a plain one.
const USER_AGENT = 'Mozilla/5.0';
const SOURCE = 'Yahoo Finance (إغلاقات يومية) · آخر إغلاق من تداول السعودية';
const force = process.argv.includes('--force');
const only = process.argv.includes('--symbols') ? new Set(process.argv[process.argv.indexOf('--symbols') + 1].split(',')) : null;
const readJson = async url => { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const data = JSON.parse(await readFile(new URL('data.json', DIST), 'utf8'));
const officialDate = data.priceSource?.officialDate || null;
const index = await readJson(new URL('index.json', DIR));
if (!force && !only && officialDate && index?.officialDate === officialDate) {
  console.log(`History already covers the official close of ${officialDate}; nothing to do.`);
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
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?range=1y&interval=1d`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal });
      if (response.status === 404) return null; // not listed on Yahoo
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseYahooChart(await response.json());
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1500 * attempt);
    } finally { clearTimeout(timer); }
  }
}

await mkdir(DIR, { recursive: true });
const failed = [], corrected = [];
let written = 0, queue = [...stocks];
async function worker() {
  while (queue.length) {
    const stock = queue.shift(), symbol = stock.symbol, file = new URL(`${symbol}.json`, DIR);
    const existing = await readJson(file);
    let fetched = null;
    try { fetched = await fetchYahoo(symbol); } catch (error) { failed.push(`${symbol} (${error.message})`); }
    if (fetched === null && !failed.some(item => item.startsWith(symbol))) failed.push(`${symbol} (not on source)`);
    const merged = mergeHistory({ fetched, existing, official: officialOf(stock) });
    if (merged.corrected) corrected.push(`${symbol} ${merged.corrected.date}: ${merged.corrected.from} → ${merged.corrected.to}`);
    const next = { symbol, currency: 'SAR', interval: '1d', source: SOURCE, officialThrough: officialOf(stock)?.date ?? null, dates: merged.dates, close: merged.close };
    if (!validHistory(next)) continue;
    const text = JSON.stringify(next);
    if (text !== JSON.stringify(existing)) { await writeFile(file, text + '\n'); written += 1; }
    await sleep(120);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

if (!only) await writeFile(new URL('index.json', DIR), JSON.stringify({ officialDate, updatedAt: new Date().toISOString(), source: SOURCE, symbols: stocks.length - failed.length, failed }, null, 1) + '\n');
console.log(`History: ${written} files written, ${stocks.length - failed.length}/${stocks.length} fetched.`);
if (corrected.length) console.log(`Official close replaced the source on ${corrected.length} stocks:\n  ${corrected.join('\n  ')}`);
if (failed.length) console.warn(`Not fetched (existing file kept, official close added): ${failed.join(', ')}`);
// A source outage must not block the price update; only fail when nothing at all came back.
if (stocks.length && failed.length === stocks.length) process.exit(1);

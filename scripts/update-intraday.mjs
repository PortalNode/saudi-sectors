#!/usr/bin/env node
/**
 * Intraday prices for the small chart on the results pages: dist/intraday/<symbol>.json.
 * Each file holds the last five trading sessions in 5-minute bars (Yahoo Finance, Saudi listing),
 * so the chart can show a day or five days hour by hour. The daily candles stay in dist/ohlc/.
 *
 * Usage: node scripts/update-intraday.mjs [--out <dir>] [--symbols 2222,1010]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DIST = new URL('../dist/', import.meta.url);
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const dirUrl = path => new URL(`file://${path.startsWith('/') ? '' : process.cwd() + '/'}${path.replace(/\/?$/, '/')}`);
const DIR = arg('--out') ? dirUrl(arg('--out')) : new URL('intraday/', DIST);
const only = arg('--symbols') ? new Set(arg('--symbols').split(',')) : null;
const SOURCE = 'Yahoo Finance · شموع 5 دقائق';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Yahoo answers 429 to Node with a full Chrome user agent; a plain browser one is served.
async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1500 * attempt);
    } finally { clearTimeout(timer); }
  }
}

// Keeps only bars with a real close; timestamps stay in seconds (Unix time), prices in riyals.
export function parseIntraday(json) {
  const result = json?.chart?.result?.[0];
  if (!result || result.meta?.currency !== 'SAR') throw new Error('no SAR intraday result');
  const quote = result.indicators?.quote?.[0] || {};
  const t = [], c = [], v = [];
  (result.timestamp || []).forEach((time, i) => {
    const close = quote.close?.[i];
    if (!Number.isFinite(close) || close <= 0) return;
    t.push(time); c.push(Math.round(close * 100) / 100); v.push(Number.isFinite(quote.volume?.[i]) ? quote.volume[i] : 0);
  });
  return { t, c, v };
}

const data = JSON.parse(await readFile(new URL('data.json', DIST), 'utf8'));
const stocks = data.sectors.flatMap(sector => sector.stocks).filter(stock => !only || only.has(String(stock.symbol)));
await mkdir(DIR, { recursive: true });

const failed = [];
let written = 0;
const queue = [...stocks];
async function worker() {
  while (queue.length) {
    const symbol = String(queue.shift().symbol);
    try {
      const json = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?range=5d&interval=5m`);
      const bars = parseIntraday(json);
      if (bars.t.length < 2) throw new Error('too few bars');
      const file = { symbol, source: SOURCE, timezone: 'Asia/Riyadh', updatedAt: new Date().toISOString(), ...bars };
      await writeFile(new URL(`${symbol}.json`, DIR), JSON.stringify(file) + '\n');
      written += 1;
    } catch (error) { failed.push(`${symbol} (${error.message})`); }
    await sleep(100);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`Intraday: ${written}/${stocks.length} files written.`);
if (failed.length) console.warn(`Kept the existing file for: ${failed.join(', ')}`);
// A source outage must not block the price update; only fail when nothing at all came back.
if (stocks.length && failed.length === stocks.length) process.exit(1);

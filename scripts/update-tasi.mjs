#!/usr/bin/env node
/**
 * Daily candles for the Saudi market index (TASI): dist/ohlc/TASI.json (recent sessions) and
 * dist/ohlc/history/TASI.json (everything since 2010-01-01), read by the chart like any stock's file.
 *
 * Every run takes the whole daily history from TradingView's chart socket (one request, about 4,200
 * candles), keeps the sessions up to the Saudi Exchange's official close in data.json, and refuses to
 * write unless the candles are a believable TASI history that still holds every stored session and
 * ends on the exchange's own index close. A failure keeps the previous files.
 *
 * Runs once per official session: it skips while the stored file already ends on data.json's official
 * date (use --force to run again).
 * Usage: node scripts/update-tasi.mjs [--force] [--out <dir>]
 */
import { readFile } from 'node:fs/promises';
import { fetchTasiBars, checkTasiBars, tasiFile, TASI_SYMBOL } from './tasi-candles.mjs';
import { readCandles, writeCandles } from './ohlc-files.mjs';

const DIST = new URL('../dist/', import.meta.url);
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const dirUrl = path => new URL(`file://${path.startsWith('/') ? '' : process.cwd() + '/'}${path.replace(/\/?$/, '/')}`);
const DIR = arg('--out') ? dirUrl(arg('--out')) : new URL('ohlc/', DIST);
const force = process.argv.includes('--force');

const data = JSON.parse(await readFile(new URL('data.json', DIST), 'utf8'));
const officialDate = data.priceSource?.officialDate || null;
const stored = await readCandles(DIR, TASI_SYMBOL);
if (!force && officialDate && stored?.officialThrough === officialDate && stored.d.at(-1) === officialDate) {
  console.log(`TASI candles already cover the official close of ${officialDate}; nothing to do.`);
  process.exit(0);
}

const { bars: fetched, dropped } = await fetchTasiBars();
// Only sessions the exchange has closed: TradingView's bar for a session still running is not a close.
const bars = officialDate ? fetched.filter(bar => bar.d <= officialDate) : fetched;
checkTasiBars(bars, { previous: stored });

// The exchange's own index close (data.json, dd.mm.yyyy) must equal the last candle's close.
const summary = data.marketSummary || {};
const summaryDate = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(summary.date || '');
const last = bars.at(-1);
if (summary.mode === 'close' && summaryDate && `${summaryDate[3]}-${summaryDate[2]}-${summaryDate[1]}` === last.d && Number.isFinite(summary.value) && Math.abs(summary.value - last.c) > 0.05) {
  throw new Error(`last candle ${last.d} closes at ${last.c}, the exchange's index close is ${summary.value}`);
}

const official = officialDate && last.d === officialDate ? officialDate : null;
const written = await writeCandles(DIR, tasiFile(bars, official));
console.log(`TASI: ${bars.length} candles ${bars[0].d} → ${last.d}${dropped ? `, ${dropped} invalid rows dropped` : ''}; ${written} files written${official ? '' : '; official close not in the candles yet'}.`);

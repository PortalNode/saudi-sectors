#!/usr/bin/env node
// Backfill 52-week range values and their source/check time, without refreshing prices, YTD, market
// summary, shares, or Argaam data. Run without --write to preview. Stop other
// writers to data.json before using --write; the unchanged-file check below is
// an extra guard, not a cross-process lock.
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyWeek52Range } from './week52-range.mjs';

const args = process.argv.slice(2);
const validArgs = args.every(arg => arg === '--write' || arg.startsWith('--file='));
if (!validArgs || args.filter(arg => arg.startsWith('--file=')).length > 1) {
  throw new Error('Usage: node scripts/backfill-week52-only.mjs [--write] [--file=/path/to/data.json]');
}
const fileArg = args.find(arg => arg.startsWith('--file='));
const path = fileArg ? fileArg.slice('--file='.length) : fileURLToPath(new URL('../dist/data.json', import.meta.url));
if (!path) throw new Error('Missing --file path');
const original = await readFile(path, 'utf8');
const data = JSON.parse(original);
const stocks = data.sectors.flatMap(sector => sector.stocks);
const candidates = new Map();
let failedBatches = 0;

for (let index = 0; index < stocks.length; index += 100) {
  const batch = stocks.slice(index, index + 100);
  const requested = new Set(batch.map(stock => `TADAWUL:${stock.symbol}`));
  try {
    const response = await fetch('https://scanner.tradingview.com/ksa/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        symbols: { tickers: [...requested], query: { types: [] } },
        columns: ['close', 'currency', 'price_52_week_low', 'price_52_week_high'],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    for (const row of payload?.data || []) {
      if (!requested.has(row.s)) continue;
      const [close, currency, low, high] = row.d || [];
      if (currency === 'SAR') candidates.set(row.s.slice('TADAWUL:'.length), [{ low, high, referencePrice: close, source: 'TradingView', checkedAt: new Date().toISOString() }]);
    }
  } catch (error) {
    failedBatches++;
    console.error(`TradingView batch failed (${batch.length} symbols): ${error.message}`);
  }
  if (index + 100 < stocks.length) await new Promise(resolve => setTimeout(resolve, 250));
}

const counts = { updated: 0, retained: 0, incompatible: 0, unavailable: 0 };
for (const stock of stocks) counts[applyWeek52Range(stock, candidates.get(String(stock.symbol)) || [])]++;
console.log(`Snapshot asOf=${data.asOf ?? 'unknown'}; ${stocks.length} stocks; ${JSON.stringify(counts)}; failed batches=${failedBatches}`);
console.log('Only values compatible with both the saved price and TradingView price are accepted.');
if (!args.includes('--write')) {
  console.log('Dry run: file unchanged. Stop other writers and pass --write to apply.');
} else if (!counts.updated) {
  throw new Error('No provider ranges passed validation; refusing to write.');
} else {
  // Avoid overwriting changes made while the network requests were in progress.
  // A concurrent writer can still race between this check and rename, so the
  // caller must also ensure other writers are stopped.
  if (await readFile(path, 'utf8') !== original) throw new Error('Data changed during fetch; refusing to overwrite it.');
  const temporary = `${path}.week52-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data), { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  console.log('Wrote only 52-week fields and source/check metadata; all other parsed values were preserved.');
}

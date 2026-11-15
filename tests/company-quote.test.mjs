import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseYahooChart, mergeHistory, validHistory, KEEP_DAYS } from '../scripts/history-merge.mjs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');

test('Yahoo bars become Riyadh dates; empty bars and other currencies are rejected', () => {
  // 2026-11-15 07:00 UTC = 10:00 Riyadh; 2026-11-15 22:30 UTC is already the 16th in Riyadh.
  const chart = { chart: { result: [{ meta: { currency: 'SAR', gmtoffset: 10800 }, timestamp: [Date.parse('2026-11-15T07:00:00Z') / 1000, Date.parse('2026-11-15T22:30:00Z') / 1000, 0], indicators: { quote: [{ close: [9.949999809, 10.01, null] }] } }] } };
  assert.deepEqual(parseYahooChart(chart), [{ date: '2026-11-15', close: 9.95 }, { date: '2026-11-16', close: 10.01 }]);
  chart.chart.result[0].meta.currency = 'USD';
  assert.throws(() => parseYahooChart(chart), /currency/);
});

test('the official close overrides its day, nothing after it is kept, and an outage keeps the old file', () => {
  const fetched = [{ date: '2026-11-11', close: 10 }, { date: '2026-11-12', close: 10.1 }, { date: '2026-11-15', close: 9.9 }, { date: '2026-11-16', close: 9.7 }];
  const merged = mergeHistory({ fetched, official: { date: '2026-11-15', price: 9.95 } });
  assert.deepEqual(merged.dates, ['2026-11-11', '2026-11-12', '2026-11-15']);
  assert.deepEqual(merged.close, [10, 10.1, 9.95]);
  assert.deepEqual(merged.corrected, { date: '2026-11-15', from: 9.9, to: 9.95 });
  // Source down: the existing file stays and today's official close is appended.
  const kept = mergeHistory({ fetched: null, existing: { dates: merged.dates, close: merged.close }, official: { date: '2026-11-16', price: 9.8 } });
  assert.deepEqual(kept.dates.at(-1), '2026-11-16');
  assert.deepEqual(kept.close, [10, 10.1, 9.95, 9.8]);
  assert.equal(kept.corrected, null);
});

test('history keeps about a year', () => {
  const fetched = [{ date: '2024-01-01', close: 5 }, { date: '2025-11-10', close: 6 }, { date: '2026-11-15', close: 7 }];
  const merged = mergeHistory({ fetched });
  assert.deepEqual(merged.dates, ['2025-11-10', '2026-11-15']);
  assert.ok(KEEP_DAYS >= 366);
});

test('every results page shows the stock card under the company profile', () => {
  const pages = readdirSync(dist).filter(name => name.endsWith('.html') && !['index.html', 'comparison.html'].includes(name));
  assert.ok(pages.length >= 31);
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /company-quote\.css\?v=quote-20261115/, page);
    assert.match(html, /company-profile\.js\?v=[^"]+" defer><\/script>\s*<script src="company-quote\.js\?v=quote-20261115" defer><\/script>/, page);
  }
  const script = read('company-quote.js');
  // Same EPS rule as the home page: recurring, then reported, then the price file.
  assert.match(script, /recurring \?\? reported \?\? num\(stock\.eps\)/);
  assert.match(script, /eps > 0 && price > 0 \? price \/ eps : null/);
});

test('every history file is valid and ends on its stock\'s official close', () => {
  const data = JSON.parse(read('data.json'));
  const stocks = new Map(data.sectors.flatMap(sector => sector.stocks).map(stock => [stock.symbol, stock]));
  const dir = new URL('history/', dist);
  assert.ok(existsSync(dir), 'dist/history exists');
  const files = readdirSync(dir).filter(name => /^\d{4}\.json$/.test(name));
  assert.ok(files.length >= stocks.size * 0.9, `history for most stocks (${files.length}/${stocks.size})`);
  for (const name of files) {
    const file = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    assert.ok(validHistory(file), name);
    const stock = stocks.get(file.symbol);
    assert.ok(stock, `${name}: symbol in data.json`);
    if (file.officialThrough) assert.ok(file.dates.at(-1) <= file.officialThrough, `${name}: nothing after the official close`);
    const official = stock.lastOfficialClose;
    if (official?.date === file.dates.at(-1)) assert.equal(file.close.at(-1), Math.round(official.price * 100) / 100, `${name}: last close is the official close`);
  }
});

test('the price workflow refreshes the history and commits it with the prices', () => {
  const workflow = readFileSync(new URL('../.github/workflows/update-prices.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: node scripts\/update-history\.mjs \|\| echo/);
  assert.match(workflow, /git add dist\/data\.json dist\/history/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCandles } from '../scripts/ohlc-files.mjs';
import { frame, message, unframe, seriesRows, cleanTasiBars, checkTasiBars, tasiFile, validBar } from '../scripts/tasi-candles.mjs';
import { isSafeSvg } from '../scripts/fetch-logos.mjs';
import vm from 'node:vm';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const utc = iso => Date.parse(`${iso}T00:00:00Z`) / 1000;
const row = (iso, o, h, l, c, v = 1000) => [utc(iso), o, h, l, c, v];

test('socket frames carry their length and several frames in one message are split', () => {
  assert.equal(frame({ a: 1 }), '~m~7~m~{"a":1}');
  assert.equal(message('set_auth_token', ['x']), '~m~32~m~{"m":"set_auth_token","p":["x"]}');
  assert.deepEqual(unframe(`${frame('~h~1')}${frame({ m: 'du' })}`), ['~h~1', '{"m":"du"}']);
  assert.deepEqual(unframe('not a frame'), []);
});

test('only timescale_update and du messages yield candle rows', () => {
  const payload = m => ({ m, p: ['cs', { sds_1: { s: [{ i: 0, v: [1, 2, 3, 4, 5, 6] }] } }] });
  assert.deepEqual(seriesRows(payload('timescale_update')), [[1, 2, 3, 4, 5, 6]]);
  assert.deepEqual(seriesRows(payload('du')), [[1, 2, 3, 4, 5, 6]]);
  assert.deepEqual(seriesRows(payload('series_completed')), []);
  assert.deepEqual(seriesRows(null), []);
});

test('rows become one rounded candle per session from 2010, ascending, never guessed', () => {
  const { bars, dropped } = cleanTasiBars([
    row('2010-01-04', 6140.123, 6150.456, 6100, 6120.999),
    row('2009-12-31', 6000, 6010, 5990, 6005),           // before the history starts
    row('2010-01-03', 6120, 6130, 6110, 6125),
    row('2010-01-03', 6120, 6131, 6110, 6126),           // repeated session: the latest row wins
    row('2010-01-05', 6100, 6090, 6080, 6095),           // high below the open: invalid
    row('2010-01-06', 0, 0, 0, 0)                        // no price: invalid
  ]);
  assert.deepEqual(bars.map(b => b.d), ['2010-01-03', '2010-01-04']);
  assert.deepEqual(bars[0], { d: '2010-01-03', o: 6120, h: 6131, l: 6110, c: 6126, v: 1000 });
  assert.deepEqual(bars[1], { d: '2010-01-04', o: 6140.12, h: 6150.46, l: 6100, c: 6121, v: 1000 });
  assert.equal(dropped, 2);
  assert.equal(validBar({ o: 1, h: 2, l: 1, c: 2, v: 0 }), true);
  assert.equal(validBar({ o: 1, h: 1, l: 1, c: 2, v: 0 }), false);
});

test('a short, gapped, reordered or shrunken history is refused', () => {
  const days = Array.from({ length: 3200 }, (_, i) => new Date(Date.parse('2010-01-03T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
  const make = list => list.map((d, i) => ({ d, o: 7000 + i % 5, h: 7010 + i % 5, l: 6990 + i % 5, c: 7000 + i % 5, v: 1 }));
  assert.equal(checkTasiBars(make(days)), true);
  assert.throws(() => checkTasiBars(make(days.slice(0, 100))), /only 100 candles/);
  assert.throws(() => checkTasiBars(make(days.slice(40))), /history starts/);
  assert.throws(() => checkTasiBars(make([...days.slice(0, 500), ...days.slice(530)])), /gap/);
  assert.throws(() => checkTasiBars(make([...days.slice(0, 5), days[3], ...days.slice(6)])), /out of order/);
  const stored = { d: [days[10], days[11]] };
  assert.throws(() => checkTasiBars(make(days.filter(d => d !== days[11])), { previous: stored }), /stored sessions missing/);
  const jump = make(days); jump[2000] = { ...jump[2000], c: 9000, h: 9000 };
  assert.throws(() => checkTasiBars(jump), /implausible/);
});

test('the chart file has the columns every stock file has', () => {
  const file = tasiFile([{ d: '2010-01-03', o: 1, h: 2, l: 1, c: 2, v: 5 }, { d: '2010-01-04', o: 2, h: 3, l: 2, c: 3, v: 6 }], '2010-01-04');
  assert.equal(file.symbol, 'TASI');
  assert.equal(file.officialThrough, '2010-01-04');
  assert.deepEqual(file.d, ['2010-01-03', '2010-01-04']);
  assert.deepEqual(file.c, [2, 3]);
  assert.deepEqual(file.div, []);
});

test('the stored TASI file holds every session since 2010 and ends on the exchange close', async () => {
  const file = await readCandles(new URL('ohlc/', dist), 'TASI');
  assert.equal(file.symbol, 'TASI');
  assert.ok(file.d[0] <= '2010-01-15', `starts ${file.d[0]}`);
  assert.ok(file.d.length > 4000, `${file.d.length} candles`);
  assert.equal(checkTasiBars(file.d.map((d, i) => ({ d, o: file.o[i], h: file.h[i], l: file.l[i], c: file.c[i], v: file.v[i] }))), true);
  // 2010 year-end close, and the close the site shows for the latest session
  assert.equal(file.c[file.d.indexOf('2010-12-29')], 6620.75);
  const site = JSON.parse(read('data.json')), summary = site.marketSummary;
  const [dd, mm, yyyy] = String(summary.date).split('.');
  const at = file.d.indexOf(`${yyyy}-${mm}-${dd}`);
  if (summary.mode === 'close' && at >= 0) assert.ok(Math.abs(file.c[at] - summary.value) <= 0.05, `${file.c[at]} vs ${summary.value}`);
});

test('TASI has a TradingView logo, listed in the manifest', () => {
  assert.ok(isSafeSvg(read('logos/TASI.svg')));
  assert.ok(JSON.parse(read('logos/manifest.json')).symbols.includes('TASI'));
});

test('the chart search lists the index and the technical analysis page opens it', () => {
  const chart = read('company-chart.js'), page = read('technical-analysis.js');
  assert.match(chart, /symbol: 'TASI'/);
  assert.match(chart, /\[INDEX_ENTRY, \.\.\.d\.sectors/);
  assert.match(page, /INDEX\.symbol/);
  assert.match(read('../.github/workflows/update-prices.yml'), /node scripts\/update-tasi\.mjs \|\| echo/);
});

test('typing TASI, tasi, تاسي or the index name finds the index, and stock searches still work', () => {
  const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {} }, Intl, Math, JSON, Date, Number, Set, Map, Promise, console, structuredClone };
  vm.runInNewContext(read('company-chart.js'), ctx);
  const { searchStocks } = ctx.window.CompanyChart.calc, index = ctx.window.CompanyChart.indexEntry;
  const list = [index, { symbol: '2222', name: 'أرامكو السعودية', sector: 'x' }, { symbol: '1120', name: 'الراجحي', sector: 'x' }];
  for (const q of ['TASI', 'tasi', 'Tas', 'تاسي', 'مؤشر']) assert.equal(searchStocks(list, q)[0].symbol, 'TASI', q);
  assert.deepEqual(searchStocks(list, '2222').map(x => x.symbol), ['2222']);
  assert.deepEqual(searchStocks(list, 'الراجحي').map(x => x.symbol), ['1120']);
  assert.equal(searchStocks(list, '').length, 3);
});

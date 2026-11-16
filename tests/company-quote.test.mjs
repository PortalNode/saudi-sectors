import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { parseYahoo, cleanBars, ohlcFile, validOhlc, YEARS } from '../scripts/ohlc-merge.mjs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const bar = (d, c, extra = {}) => ({ d, o: c, h: c, l: c, c, v: 100, ...extra });

// The chart's calculations, loaded as the page loads them.
const context = { window: {}, localStorage: { getItem: () => null, setItem() {} }, Intl, Math, JSON, Date, Number, Set, Map, Promise, console, structuredClone };
vm.runInNewContext(read('company-chart.js'), context);
const calc = context.window.CompanyChart.calc;

test('Yahoo bars become Riyadh dates; empty bars and other currencies are rejected', () => {
  const t = (iso) => Date.parse(iso) / 1000;
  const chart = { chart: { result: [{ meta: { currency: 'SAR', gmtoffset: 10800 }, timestamp: [t('2026-11-15T07:00:00Z'), t('2026-11-15T22:30:00Z'), t('2026-11-17T07:00:00Z')],
    indicators: { quote: [{ open: [10, 10.1, null], high: [10.2, 10.3, 1], low: [9.9, 10, 1], close: [10.05, 10.2, 1], volume: [5, null, 1] }] } }] } };
  assert.deepEqual(parseYahoo(chart), [{ d: '2026-11-15', o: 10, h: 10.2, l: 9.9, c: 10.05, v: 5 }, { d: '2026-11-16', o: 10.1, h: 10.3, l: 10, c: 10.2, v: 0 }]);
  chart.chart.result[0].meta.currency = 'USD';
  assert.throws(() => parseYahoo(chart), /currency/);
});

test('the official close is final for its day and nothing after it is kept', () => {
  const { bars } = cleanBars([bar('2026-11-12', 10), bar('2026-11-15', 9.9, { h: 9.92 }), bar('2026-11-16', 9.7)], { official: { date: '2026-11-15', price: 9.95 } });
  assert.deepEqual(bars.map(b => b.d), ['2026-11-12', '2026-11-15']);
  assert.equal(bars.at(-1).c, 9.95);
  assert.equal(bars.at(-1).h, 9.95, 'the high widens to include the official close');
});

test('bad prints that revert are dropped; jumps that stay are flagged; history keeps five years', () => {
  const input = [bar('2020-01-01', 1), bar('2026-08-20', 64), bar('2026-08-23', 64.2), bar('2026-08-24', 18.3), bar('2026-08-25', 19.4), bar('2026-08-26', 65.7), bar('2026-08-27', 66), bar('2026-08-30', 20), bar('2026-08-31', 21)];
  const { bars, dropped, flags } = cleanBars(input);
  assert.deepEqual(dropped, ['2026-08-24', '2026-08-25']);
  assert.ok(!bars.some(b => b.d === '2020-01-01'), `only ${YEARS} years are kept`);
  assert.deepEqual(flags.map(f => f.date), ['2026-08-30'], 'a jump that does not revert is flagged, not dropped');
  const file = ohlcFile('6050', 'x', null, { bars, dropped, flags });
  assert.ok(validOhlc(file));
  assert.ok(!validOhlc({ ...file, h: file.h.map(() => 0.01) }), 'a high below the close is invalid');
});

test('indicators follow TradingView\'s definitions', () => {
  assert.deepEqual([...calc.sma([1, 2, 3, 4, 5], 3)], [null, null, 2, 3, 4]);
  assert.deepEqual([...calc.ema([1, 2, 3, 4, 5], 3)], [null, null, 2, 3, 4], 'EMA seeds with the simple average');
  assert.deepEqual([...calc.rsi([1, 2, 1, 2], 2)], [null, null, 50, 75], 'Wilder smoothing');
  const bb = calc.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2).at(-1);
  assert.deepEqual({ mid: bb.mid, up: bb.up, low: bb.low }, { mid: 5, up: 9, low: 1 }, 'population standard deviation');
  const flat = calc.macd(Array(40).fill(10)).at(-1);
  assert.deepEqual({ macd: flat.macd, signal: flat.signal, hist: flat.hist }, { macd: 0, signal: 0, hist: 0 });
});

test('ADJ adjusts earlier prices for cash dividends as TradingView does', () => {
  const daily = [
    { time: '2026-08-02', open: 44, high: 44.5, low: 43.8, close: 44 },
    { time: '2026-08-04', open: 43.5, high: 43.9, low: 43.2, close: 43.6 },
    { time: '2026-11-02', open: 40, high: 40.2, low: 39.7, close: 40 },
    { time: '2026-11-03', open: 39.5, high: 39.8, low: 39.3, close: 39.6 }
  ];
  const adjusted = calc.adjustDividends(daily, [['2026-08-04', 0.55], ['2026-11-03', 0.55]]);
  const f1 = 1 - 0.55 / 44, f2 = 1 - 0.55 / 40;
  assert.equal(adjusted[0].close.toFixed(4), (44 * f1 * f2).toFixed(4), 'both dividends apply before the first ex-date');
  assert.equal(adjusted[2].close.toFixed(4), (40 * f2).toFixed(4));
  assert.equal(adjusted[3].close, 39.6, 'prices from the last ex-date on are unchanged');
  assert.deepEqual(calc.adjustDividends(daily, []).map(b => b.close), daily.map(b => b.close), 'no dividends, nothing changes');
  // stc (7010): the stored candles adjusted with Yahoo's dividends give TradingView's ADJ chart.
  const file = JSON.parse(read('ohlc/7010.json'));
  if (Array.isArray(file.div) && file.div.length) {
    const bars = file.d.map((time, i) => ({ time, open: file.o[i], high: file.h[i], low: file.l[i], close: file.c[i] }));
    const aug = calc.adjustDividends(bars, file.div).find(b => b.time === '2026-08-26');
    if (aug) assert.ok(Math.abs(aug.high - 44.19) < 0.05, `August peak ${aug.high}`);
  }
});

test('Fibonacci levels run from 100% at the first point to 0% at the second, with TradingView-style defaults', () => {
  const plain = value => JSON.parse(JSON.stringify(value));
  const defaults = plain(calc.FIB_DEFAULT);
  assert.deepEqual(defaults.levels.filter(l => l.on).map(l => l.value), [-2.618, -0.618, -0.27, 0, 0.382, 0.5, 0.618, 0.764, 1, 1.272, 1.618, 2, 2.272, 2.414, 2.618, 3.618]);
  assert.deepEqual({ trend: defaults.trend, background: defaults.background, labels: defaults.labels, extend: defaults.extend, levelsAs: defaults.levelsAs }, { trend: true, background: false, labels: 'right', extend: 'none', levelsAs: 'percent' });
  const levels = plain(calc.fibLevels(8, 13));
  assert.equal(levels.find(l => l.ratio === 0).price, 13);
  assert.equal(levels.find(l => l.ratio === 1).price, 8);
  assert.equal(levels.find(l => l.ratio === 0.5).price, 10.5);
  assert.ok(Math.abs(levels.find(l => l.ratio === 1.618).price - 4.91) < 1e-9, 'extensions go beyond the first point');
  assert.ok(Math.abs(levels.find(l => l.ratio === -0.618).price - 16.09) < 1e-9, 'negative levels go beyond the second point');
  const reversed = plain(calc.fibLevels(8, 13, { ...defaults, reverse: true }));
  assert.equal(reversed.find(l => l.ratio === 0).price, 8);
  const custom = plain(calc.fibLevels(8, 13, { ...defaults, levels: [{ value: 0.5, color: '#000000', on: true }, { value: 0.25, color: '#000000', on: false }] }));
  assert.deepEqual(custom.map(l => l.ratio), [0.5]);
});

test('the magnet snaps to the nearest open/high/low/close: always when strong, only when close when weak', () => {
  const toY = price => 1000 - price * 10; // 10 pixels per riyal
  const bar = [50, 52, 48, 51]; // open, high, low, close
  assert.equal(calc.nearestPrice(bar, toY, toY(51.7), 'strong'), 52);
  assert.equal(calc.nearestPrice(bar, toY, toY(48.6), 'strong'), 48);
  assert.equal(calc.nearestPrice(bar, toY, toY(51.2), 'weak'), 51, 'within 14px');
  assert.equal(calc.nearestPrice(bar, toY, toY(53.6), 'weak'), null, '16px away: no snap');
  assert.equal(calc.nearestPrice(bar, toY, toY(51.7), 'off'), null);
});

test('placed drawings can be selected, moved, reshaped and deleted, and the magnet also guides the first point', () => {
  const chart = read('company-chart.js');
  assert.match(chart, /function hitTest\(x, y\)/);
  assert.match(chart, /box\.addEventListener\('pointerdown', event => \{\s*if \(state\.tool \|\| event\.button !== 0/, 'a capture-phase handler grabs drawings before the chart pans');
  assert.match(chart, /\}, true\);/);
  assert.match(chart, /data-delete disabled/);
  assert.match(chart, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/);
  assert.match(chart, /CrosshairMode\.MagnetOHLC/, 'the crosshair snaps with the strong magnet');
  assert.match(chart, /hover\.snapped \? colors\.gold/, 'the snapped point is drawn');
  assert.match(chart, /const point = pointFrom\(event\);\s*hover = point;/, 'it follows the cursor before the first click');
});

test('drawing points can go past the last candle: trading days in daily, weeks and months otherwise', () => {
  // 2026-11-15 is a Sunday; Friday and Saturday are not trading days.
  assert.equal(calc.addPeriods('2026-11-15', 1, 'd'), '2026-11-16');
  assert.equal(calc.addPeriods('2026-11-19', 1, 'd'), '2026-11-22', 'Thursday → Sunday');
  assert.equal(calc.addPeriods('2026-11-15', 10, 'd'), '2026-11-29');
  assert.equal(calc.periodsBetween('2026-11-15', '2026-11-29', 'd'), 10);
  assert.equal(calc.addPeriods('2026-11-15', 3, 'w'), '2026-12-06');
  assert.equal(calc.periodsBetween('2026-11-15', '2026-12-06', 'w'), 3);
  assert.equal(calc.addPeriods('2026-11-01', 2, 'm'), '2027-01-01');
  assert.equal(calc.periodsBetween('2026-11-01', '2027-01-01', 'm'), 2);
  assert.equal(calc.periodsBetween('2026-11-15', '2026-11-10', 'd'), 0);
});

test('the price range shows the change and its percentage from the first point', () => {
  assert.equal(calc.rangeLabel(46.12, 61.25), '+15.13 (+32.81%)');
  assert.equal(calc.rangeLabel(61.25, 46.12), '−15.13 (−24.70%)');
  assert.equal(calc.rangeLabel(10, 10), '0.00 (0.00%)');
});

test('weekly candles run Sunday to Thursday and monthly by calendar month', () => {
  const daily = [['2026-11-12', 10, 11, 9, 10.5], ['2026-11-15', 10.5, 12, 10, 11], ['2026-11-16', 11, 11.5, 8, 9]].map(([time, open, high, low, close]) => ({ time, open, high, low, close, volume: 1 }));
  const weeks = calc.group(daily, 'w');
  // The page code runs in its own realm: compare plain copies.
  assert.deepEqual(JSON.parse(JSON.stringify(weeks.map(w => [w.time, w.end, w.open, w.high, w.low, w.close, w.volume]))), [['2026-11-12', '2026-11-12', 10, 11, 9, 10.5, 1], ['2026-11-15', '2026-11-16', 10.5, 12, 8, 9, 2]]);
  assert.equal(calc.group(daily, 'm').length, 1);
});

test('every results page loads the stock card and its chart, with the library kept on the site', () => {
  const pages = readdirSync(dist).filter(name => name.endsWith('.html') && !['index.html', 'comparison.html'].includes(name));
  assert.ok(pages.length >= 31);
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /company-quote\.css\?v=chart-20261116d/, page);
    assert.match(html, /company-profile\.js\?v=[^"]+" defer><\/script>\s*<script src="company-chart\.js\?v=chart-20261116d" defer><\/script>\s*<script src="company-quote\.js\?v=chart-20261116d" defer><\/script>/, page);
  }
  const chart = read('company-chart.js');
  assert.match(chart, /const LIB = 'vendor\/lightweight-charts-5\.2\.1\.js'/);
  assert.match(read('vendor/lightweight-charts-5.2.1.js').slice(0, 300), /Lightweight Charts™ v5\.2\.1[\s\S]*Apache License 2\.0/);
  assert.match(read('vendor/lightweight-charts-LICENSE.txt'), /Apache License/);
  const quote = read('company-quote.js');
  assert.match(quote, /recurring \?\? reported \?\? num\(stock\.eps\)/, 'same EPS rule as the home page');
  assert.match(quote, /eps > 0 && price > 0 \? price \/ eps : null/);
  assert.doesNotMatch(quote, /history\//);
});

test('every candle file is valid and ends on its stock\'s official close', () => {
  const data = JSON.parse(read('data.json'));
  const stocks = new Map(data.sectors.flatMap(sector => sector.stocks).map(stock => [stock.symbol, stock]));
  const dir = new URL('ohlc/', dist);
  assert.ok(existsSync(dir));
  const files = readdirSync(dir).filter(name => /^\d{4}\.json$/.test(name));
  assert.ok(files.length >= stocks.size * 0.9, `candles for most stocks (${files.length}/${stocks.size})`);
  for (const name of files) {
    const file = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    assert.ok(validOhlc(file), name);
    const stock = stocks.get(file.symbol);
    assert.ok(stock, `${name}: symbol in data.json`);
    if (file.officialThrough) assert.ok(file.d.at(-1) <= file.officialThrough, `${name}: nothing after the official close`);
    const official = stock.lastOfficialClose;
    if (official?.date === file.d.at(-1)) assert.equal(file.c.at(-1), Math.round(official.price * 100) / 100, `${name}: last close is the official close`);
  }
});

test('the price workflow refreshes the candles and commits them with the prices', () => {
  const workflow = readFileSync(new URL('../.github/workflows/update-prices.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: node scripts\/update-ohlc\.mjs \|\| echo/);
  assert.match(workflow, /git add -A dist\/data\.json dist\/ohlc/);
  assert.doesNotMatch(workflow, /update-history/);
});

test('the chart symbol search finds any stock on the site by name or symbol and links to its sector page', () => {
  const list = [
    { symbol: '4009', name: 'السعودي الألماني الصحية', sector: 'الرعاية الصحية', page: 'health.html' },
    { symbol: '1180', name: 'الأهلي', sector: 'البنوك', page: 'banks.html' },
    { symbol: '2222', name: 'أرامكو السعودية', sector: 'النفط و الغاز', page: 'oilgas.html' }
  ];
  const symbols = query => [...calc.searchStocks(list, query)].map(x => x.symbol);
  assert.deepEqual(symbols(''), ['4009', '1180', '2222'], 'an empty search lists every stock');
  assert.deepEqual(symbols('2222'), ['2222']);
  assert.deepEqual(symbols('ارامكو'), ['2222'], 'hamza forms match plain alef');
  assert.deepEqual(symbols('السعوديه'), ['2222'], 'taa marbuta matches haa');
  assert.equal(symbols('1')[0], '1180');
  assert.equal(calc.norm('الصحيّة'), 'الصحيه');
  const pages = new Set(Object.values(calc.SECTOR_PAGES));
  assert.equal(pages.size, 31, 'every results page has a sector');
  for (const page of pages) assert.ok(existsSync(new URL(`../dist/${page}`, import.meta.url)), page);
});

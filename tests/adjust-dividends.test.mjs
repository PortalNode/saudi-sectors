import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dividendFactors, adjustCandles } from '../scripts/adjust-dividends.mjs';

const dist = new URL('../dist/', import.meta.url);
const context = { window: {}, localStorage: { getItem: () => null, setItem() {} }, Intl, Math, JSON, Date, Number, Set, Map, Promise, console, structuredClone };
vm.runInNewContext(readFileSync(new URL('company-chart.js', dist), 'utf8'), context);
const calc = context.window.CompanyChart.calc;

const d = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'];
const c = [100, 102, 101, 99, 100, 101], o = c.map(x => x - 1), h = c.map(x => x + 2), l = c.map(x => x - 2);
const dividends = [['2026-01-04', 2], ['2026-01-06', 1], ['2026-01-20', 5], ['2025-12-01', 3]];

test('the scanner adjusts candles exactly like the chart (ADJ): same factors, same adjusted prices', () => {
  const bars = d.map((time, i) => ({ time, open: o[i], high: h[i], low: l[i], close: c[i], volume: 1 }));
  const chart = calc.adjustDividends(bars, dividends);
  const mine = adjustCandles({ d, o, h, l, c }, dividends);
  assert.deepEqual(mine.c, chart.map(b => b.close));
  assert.deepEqual(mine.h, chart.map(b => b.high));
  assert.deepEqual(mine.l, chart.map(b => b.low));
  assert.deepEqual(mine.o, chart.map(b => b.open));
  assert.deepEqual(dividendFactors(d, c, dividends), JSON.parse(JSON.stringify(calc.dividendFactors(bars, dividends))));
});

test('only bars before an ex-dividend date change; the latest bar and future/unknown dividends never do', () => {
  const f = dividendFactors(d, c, dividends);
  assert.equal(f[5], 1);                                   // the newest bar is the official price
  assert.ok(f[0] < f[3] && f[3] < 1 && f[4] === f[3]);    // two dividends compound on the oldest bars
  assert.ok(Math.abs(f[3] - (1 - 1 / c[4])) < 1e-12);       // 1 SAR on 2026-01-06 against the prior close 100
  assert.deepEqual(dividendFactors(d, c, [['2026-01-20', 5]]), d.map(() => 1)); // a dividend after the last candle changes nothing
  assert.deepEqual(dividendFactors(d, c, [['2026-01-01', 5]]), d.map(() => 1)); // on the first bar: nothing before it
  assert.deepEqual(dividendFactors(d, c, [['2026-01-04', 500]]), d.map(() => 1)); // larger than the price: ignored
});

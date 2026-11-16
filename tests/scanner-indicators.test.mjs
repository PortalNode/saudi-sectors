import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as ind from '../dist/scanner/indicators.mjs';

const dist = new URL('../dist/', import.meta.url);
const context = { window: {}, localStorage: { getItem: () => null, setItem() {} }, Intl, Math, JSON, Date, Number, Set, Map, Promise, console, structuredClone };
vm.runInNewContext(readFileSync(new URL('company-chart.js', dist), 'utf8'), context);
const calc = context.window.CompanyChart.calc;
const plain = x => JSON.parse(JSON.stringify(x));

// A deterministic pseudo-random walk, so the tests need no data files.
function walk(n, seed = 7) {
  let s = seed, price = 20; const o = [], h = [], l = [], c = [], v = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    const open = price, close = Math.max(1, price * (1 + (rnd() - 0.5) * 0.04));
    o.push(open); c.push(close); h.push(Math.max(open, close) * (1 + rnd() * 0.01)); l.push(Math.min(open, close) * (1 - rnd() * 0.01)); v.push(1e5 + rnd() * 1e6);
    price = close;
  }
  return { o, h, l, c, v };
}
const d = walk(400);

test('SMA, EMA, RSI and MACD match the chart\'s own calculations', () => {
  assert.deepEqual(ind.sma(d.c, 20), plain(calc.sma(d.c, 20)));
  assert.deepEqual(ind.ema(d.c, 20), plain(calc.ema(d.c, 20)));
  assert.deepEqual(ind.rsi(d.c, 14), plain(calc.rsi(d.c, 14)));
  assert.deepEqual(ind.macd(d.c), plain(calc.macd(d.c)));
});

test('every indicator at bar i depends only on bars 0..i (no look-ahead)', () => {
  const cut = 250;
  const part = { h: d.h.slice(0, cut + 1), l: d.l.slice(0, cut + 1), c: d.c.slice(0, cut + 1) };
  const same = (full, head) => assert.deepEqual(plain(full).slice(0, cut + 1), plain(head));
  same(ind.sma(d.c, 50), ind.sma(part.c, 50));
  same(ind.ema(d.c, 20), ind.ema(part.c, 20));
  same(ind.rsi(d.c), ind.rsi(part.c));
  same(ind.macd(d.c), ind.macd(part.c));
  same(ind.roc(d.c, 20), ind.roc(part.c, 20));
  same(ind.atr(d.h, d.l, d.c), ind.atr(part.h, part.l, part.c));
  same(ind.adx(d.h, d.l, d.c).adx, ind.adx(part.h, part.l, part.c).adx);
  same(ind.bollinger(d.c), ind.bollinger(part.c));
  same(ind.priorHighest(d.c, 55), ind.priorHighest(part.c, 55));
  same(ind.priorLowest(d.c, 20), ind.priorLowest(part.c, 20));
  same(ind.percentRank(d.c, 60), ind.percentRank(part.c, 60));
});

test('ATR of constant-range bars equals the range, and the first value appears at bar n', () => {
  const high = Array.from({ length: 30 }, (_, i) => 12 + i), low = high.map(x => x - 2), close = high.map(x => x - 1);
  const a = ind.atr(high, low, close, 14);
  assert.equal(a[12], null);
  // high - low = 2, but |high - prevClose| = 2 as well, so the true range is 2 throughout.
  assert.ok(a.slice(13).every(x => Math.abs(x - 2) < 1e-9));
});

test('ADX is high with +DI above -DI in a clean uptrend, and low in a flat zigzag', () => {
  const up = Array.from({ length: 80 }, (_, i) => 10 + i * 0.5);
  const t = ind.adx(up.map(x => x + 0.2), up.map(x => x - 0.2), up, 14);
  assert.ok(t.adx.at(-1) > 90, `adx ${t.adx.at(-1)}`);
  assert.ok(t.plusDI.at(-1) > t.minusDI.at(-1));
  const zz = Array.from({ length: 120 }, (_, i) => 10 + (i % 2 ? 0.3 : 0));
  const f = ind.adx(zz.map(x => x + 0.1), zz.map(x => x - 0.1), zz, 14);
  assert.ok(f.adx.at(-1) < 15, `adx ${f.adx.at(-1)}`);
});

test('breakout levels exclude the current bar', () => {
  assert.deepEqual(ind.priorHighest([1, 5, 3, 9, 4], 2), [null, null, 5, 5, 9]);
  assert.deepEqual(ind.priorLowest([4, 2, 3, 1, 5], 2), [null, null, 2, 2, 1]);
});

test('ROC and percent rank are right on small examples', () => {
  const r = ind.roc([10, 11, 12, 15], 2);
  assert.deepEqual(r.slice(0, 2), [null, null]);
  assert.ok(Math.abs(r[2] - 20) < 1e-9 && Math.abs(r[3] - 100 * (15 / 11 - 1)) < 1e-9);
  const p = ind.percentRank([1, 2, 3, 2.5], 3);
  assert.deepEqual(p.slice(0, 3), [null, null, null]);
  assert.ok(Math.abs(p[3] - 200 / 3) < 1e-9);
});

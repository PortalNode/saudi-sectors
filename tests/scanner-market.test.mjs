import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../scripts/backtest/market.mjs';

const stock = (symbol, closes, { est = [], flag = [], shares = 1000 } = {}) => ({
  symbol, sector: 'x', shares, d: closes.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`), c: closes,
  o: closes, h: closes, l: closes, v: closes.map(() => 100), est: closes.map((_, i) => est.includes(i)), flag: closes.map((_, i) => flag.includes(i)),
});

test('a session estimated for the whole market still moves the index (closes are official)', () => {
  const a = stock('a', [10, 11, 12.1, 13.31], { est: [1, 2] }), b = stock('b', [20, 22, 24.2, 26.62], { est: [1, 2] });
  const idx = buildIndex([a, b], { cap: 1 });
  assert.ok(Math.abs(idx.level.at(-1) - 133.1) < 1e-9, `level ${idx.level.at(-1)}`);
});

test('a flagged jump is left out of the day it happens, not smeared into the index', () => {
  const a = stock('a', [10, 10, 30, 30], { flag: [2] }), b = stock('b', [10, 10, 10, 10]);
  const idx = buildIndex([a, b], { cap: 1 });
  assert.equal(idx.level.at(-1), 100);
});

test('no weight exceeds the cap', () => {
  const big = stock('big', [10, 11], { shares: 1e6 }), small = Array.from({ length: 30 }, (_, k) => stock(`s${k}`, [10, 10], { shares: 1 }));
  // big rises 10%; with a 5% cap its weight is about 5%, so the index moves about +0.5%, not +10%
  const idx = buildIndex([big, ...small], { cap: 0.05 });
  assert.ok(idx.level[1] > 100.4 && idx.level[1] < 100.6, `level ${idx.level[1]}`);
});

test('the index on day t uses only data up to day t', () => {
  const a = stock('a', [10, 11, 12, 13, 14, 15]), b = stock('b', [5, 5.5, 5, 6, 6, 7]);
  const full = buildIndex([a, b], { cap: 1 });
  const head = s => ({ ...s, d: s.d.slice(0, 4), c: s.c.slice(0, 4), est: s.est.slice(0, 4), flag: s.flag.slice(0, 4) });
  assert.deepEqual(full.level.slice(0, 4), buildIndex([head(a), head(b)], { cap: 1 }).level);
});

test('capWeights keeps every weight at or under the cap and the total at 1', async () => {
  const { capWeights } = await import('../scripts/backtest/market.mjs');
  const w = capWeights([0.6, 0.2, 0.1, 0.05, 0.03, 0.02], 0.25);
  assert.ok(w.every(x => x <= 0.25 + 1e-12), JSON.stringify(w));
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.deepEqual(capWeights([0.9, 0.1], 0.2).map(x => +x.toFixed(6)), [0.5, 0.5], 'an infeasible cap falls back to equal weights');
});

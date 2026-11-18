import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterStocks, sortStocks, watchDiff, toggleWatch, loadWatch, saveWatch, DEFAULT_FILTERS, fmtValue, escapeHtml, KEY_IDS } from '../dist/scanner/scanner-logic.mjs';

const stocks = {
  A: { name: 'أ', sector: 'البنوك', score: 6, bits: '111111', avgVal20: 50e6, volRatio: 2, dividendYield: 4 },
  B: { name: 'ب', sector: 'التجزئة', score: 5, bits: '101111', avgVal20: 2e6, volRatio: 0.5, dividendYield: null },
  C: { name: 'ج', sector: 'البنوك', score: 4, bits: '101101', avgVal20: 9e6, volRatio: 1.2, dividendYield: 1 },
};

test('default filter keeps only 5 or 6 keys; the minimum is adjustable', () => {
  const f = x => filterStocks(stocks, { ...DEFAULT_FILTERS, ...x }).map(s => s.symbol).sort();
  assert.deepEqual(f({}), ['A', 'B']);
  assert.deepEqual(f({ minScore: 6 }), ['A']);
  assert.deepEqual(f({ minScore: 4 }), ['A', 'B', 'C']);
  assert.deepEqual(f({ minScore: 4, sector: 'البنوك' }), ['A', 'C']);
  assert.deepEqual(f({ minScore: 4, minValue: 5e6 }), ['A', 'C']);
  assert.deepEqual(f({ query: 'تجزئة' }), ['B']);
  assert.deepEqual(f({ query: 'zzz' }), []);
});

test('sorting: by score then liquidity, by liquidity, by dividend (missing last)', () => {
  const all = filterStocks(stocks, { ...DEFAULT_FILTERS, minScore: 0 });
  assert.deepEqual(sortStocks(all, 'score').map(s => s.symbol), ['A', 'B', 'C']);
  assert.deepEqual(sortStocks(all, 'liquidity').map(s => s.symbol), ['A', 'C', 'B']);
  assert.deepEqual(sortStocks(all, 'dividend').map(s => s.symbol), ['A', 'C', 'B']);
});

test('watch diff compares the six keys now with those at save time', () => {
  assert.equal(watchDiff({ bits: '111111' }, stocks.A).state, 'same');
  const lost = watchDiff({ bits: '111111' }, stocks.B);
  assert.equal(lost.state, 'removed'); assert.deepEqual(lost.lost, [KEY_IDS[1]]);
  const gained = watchDiff({ bits: '101101' }, stocks.B);
  assert.equal(gained.state, 'added'); assert.deepEqual(gained.gained, [KEY_IDS[4]]);
  assert.equal(watchDiff({ bits: '110000' }, { bits: '011000' }).state, 'changed');
  assert.equal(watchDiff({ bits: '111111' }, undefined).state, 'none');
  assert.equal(watchDiff({ strategies: ['breakout'] }, stocks.A).state, 'same'); // a list saved by the old scanner is not compared
});

test('watch list is stored per stock with its score and keys, and toggles off', () => {
  let w = toggleWatch({}, 'A', stocks.A, '2026-11-17', 't');
  assert.deepEqual(w.A, { savedAt: 't', dataDate: '2026-11-17', score: 6, bits: '111111' });
  w = toggleWatch(w, 'A', stocks.A, '2026-11-17', 't');
  assert.deepEqual(w, {});
  const mem = new Map(); const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(saveWatch(storage, { A: 1 }), true);
  assert.deepEqual(loadWatch(storage), { A: 1 });
  assert.deepEqual(loadWatch({ getItem: () => '[1]' }), {});
  assert.equal(saveWatch({ setItem() { throw new Error('x'); } }, {}), false);
});

test('formats and escaping', () => {
  assert.equal(fmtValue(2.5e9), '2.5 مليار');
  assert.equal(fmtValue(5e6), '5 مليون');
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('published signals.json has the shape the page reads', () => {
  const j = JSON.parse(readFileSync(new URL('../dist/scanner/signals.json', import.meta.url), 'utf8'));
  assert.ok(j.meta && j.keys && j.stocks);
  assert.deepEqual(Object.keys(j.keys), KEY_IDS);
  for (const s of Object.values(j.stocks)) {
    assert.equal(s.bits.length, 6);
    assert.equal(s.score, s.bits.split('').reduce((a, b) => a + +b, 0));
    assert.deepEqual(Object.keys(s.keys), KEY_IDS);
  }
});

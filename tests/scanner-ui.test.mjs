import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterStocks, sortStocks, watchDiff, toggleWatch, loadWatch, saveWatch, DEFAULT_FILTERS, fmtValue, escapeHtml, KEY_IDS, sinceFor, sessionsText, ageClass } from '../dist/scanner/scanner-logic.mjs';

const stocks = {
  A: { keys: { fin: [1] }, name: 'أ', sector: 'البنوك', score: 6, bits: '111111', avgVal20: 50e6, volRatio: 2, dividendYield: 4 },
  B: { keys: { fin: [0] }, name: 'ب', sector: 'التجزئة', score: 5, bits: '101111', avgVal20: 2e6, volRatio: 0.5, dividendYield: null },
  C: { keys: { fin: [1] }, name: 'ج', sector: 'البنوك', score: 4, bits: '101101', avgVal20: 9e6, volRatio: 1.2, dividendYield: 1 },
};

test('default filter keeps only 5 or 6 keys; the minimum is adjustable', () => {
  const f = x => filterStocks(stocks, { ...DEFAULT_FILTERS, ...x }).map(s => s.symbol).sort();
  assert.deepEqual(f({}), ['A', 'B']);
  assert.deepEqual(f({ minScore: 6 }), ['A']);
  assert.deepEqual(f({ minScore: 4 }), ['A', 'B', 'C']);
  assert.deepEqual(f({ minScore: 4, sector: 'البنوك' }), ['A', 'C']);
  assert.deepEqual(f({ minScore: 4, minValue: 5e6 }), ['A', 'C']);
  assert.deepEqual(f({ query: 'تجزئة' }), ['B']);
  assert.deepEqual(f({ excludeLoss: true }), ['A']); // B خاسرة
  assert.deepEqual(f({ minScore: 4, excludeLoss: true }), ['A', 'C']);
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

test('signal age: Arabic session counts, age classes, age filter and newest-first sort use the chosen key threshold', () => {
  assert.deepEqual([1, 2, 3, 10, 11, 25].map(sessionsText), ['جلسة واحدة', 'جلستان', '3 جلسات', '10 جلسات', '11 جلسة', '25 جلسة']);
  assert.deepEqual([1, 3, 4, 10, 11].map(ageClass), ['new', 'new', 'recent', 'recent', 'old']);
  const mk = (score, since) => ({ keys: { fin: [1] }, name: 'س', sector: 'ق', score, bits: '111111', avgVal20: 5e6, since });
  const age = {
    N: mk(5, { 5: { date: '2026-11-19', sessions: 1, capped: false } }),
    M: mk(5, { 5: { date: '2026-11-12', sessions: 6, capped: false } }),
    O: mk(5, { 5: { date: '2026-06-01', sessions: 120, capped: true } }),
    Q: mk(6, { 5: { date: '2026-11-17', sessions: 3, capped: false }, 6: { date: '2026-11-19', sessions: 1, capped: false } }),
  };
  const f = x => filterStocks(age, { ...DEFAULT_FILTERS, ...x }).map(s => s.symbol).sort();
  assert.deepEqual(f({}), ['M', 'N', 'O', 'Q']);
  assert.deepEqual(f({ age: 1 }), ['N']);
  assert.deepEqual(f({ age: 3 }), ['N', 'Q']);
  assert.deepEqual(f({ age: 22 }), ['M', 'N', 'Q']);      // a capped run (older than the examined window) is never "recent"
  assert.deepEqual(f({ age: 1, minScore: 6 }), ['Q']);     // the age is measured at the 6-key threshold
  assert.equal(sinceFor(age.Q, 6).date, '2026-11-19');
  assert.equal(sinceFor({ score: 5 }, 5), null);
  const all = filterStocks(age, { ...DEFAULT_FILTERS, age: 'all' });
  assert.deepEqual(sortStocks(all, 'newest', 5).map(s => s.symbol), ['N', 'Q', 'M', 'O']);
});

test('published signals: a stock marked at support has real room to resistance, and the signal start matches the score', () => {
  const j = JSON.parse(readFileSync(new URL('../dist/scanner/signals.json', import.meta.url), 'utf8'));
  if (!j.meta.valid) return;
  for (const [sym, s] of Object.entries(j.stocks)) {
    assert.ok(['support', 'resistance', 'squeezed', 'between', 'none'].includes(s.levelPos), sym);
    assert.equal(s.keys.levels[0] === 1, s.levelPos === 'support', `${sym}: levels key and position disagree`);
    if (s.keys.levels[0] === 1 && s.resistanceZone) assert.ok((s.resistanceZone[0] - s.price) / s.atr >= 2 - 1e-6, `${sym}: at support with resistance within 2 ATR`);
    for (const th of [4, 5, 6]) {
      const sc = s.since?.[th];
      assert.equal(!!sc, s.score >= th, `${sym}: since[${th}] must exist exactly when the score reaches it`);
      if (sc) { assert.ok(sc.sessions >= 1 && sc.date <= j.meta.dataDate); if (sc.sessions === 1) assert.equal(sc.date, j.meta.dataDate); }
    }
    assert.equal(+s.hist.at(-1), s.score, `${sym}: last history score is today's score`);
  }
});

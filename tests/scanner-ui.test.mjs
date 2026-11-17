import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterItems, sortItems, watchDiff, toggleWatch, loadWatch, saveWatch, DEFAULT_FILTERS, fmtValue, escapeHtml, concurrentCounts } from '../dist/scanner/scanner-logic.mjs';

const stocks = {
  A: { name: 'أ', sector: 'البنوك', trend: 'up', avgVal20: 50e6, volRatio: 2 },
  B: { name: 'ب', sector: 'التجزئة', trend: 'down', avgVal20: 2e6, volRatio: 0.5 },
  C: { name: 'ج', sector: 'البنوك', trend: 'side', avgVal20: 9e6, volRatio: 1.2 },
};
const items = [
  { symbol: 'A', strategy: 'breakout', status: 'new', ageSessions: 0, riskPct: 6 },
  { symbol: 'A', strategy: 'rs', status: 'continuing', ageSessions: 4, riskPct: 6 },
  { symbol: 'B', strategy: 'pullback', status: 'continuing', ageSessions: 9, riskPct: 11 },
  { symbol: 'C', strategy: 'breakout', status: 'new', ageSessions: 0, riskPct: 4 },
];

test('filters combine: strategy, sector, trend, status, liquidity, age, risk and text', () => {
  const f = (x) => filterItems(items, stocks, { ...DEFAULT_FILTERS, ...x }).map(i => `${i.symbol}:${i.strategy}`);
  assert.equal(f({}).length, 4);
  assert.deepEqual(f({ strategy: 'breakout' }), ['A:breakout', 'C:breakout']);
  assert.deepEqual(f({ sector: 'البنوك', status: 'new' }), ['A:breakout', 'C:breakout']);
  assert.deepEqual(f({ trend: 'down' }), ['B:pullback']);
  assert.deepEqual(f({ minValue: 10e6 }), ['A:breakout', 'A:rs']);
  assert.deepEqual(f({ maxAge: 4 }), ['A:breakout', 'A:rs', 'C:breakout']);
  assert.deepEqual(f({ maxRisk: 6 }), ['A:breakout', 'A:rs', 'C:breakout']);
  assert.deepEqual(f({ query: 'تجزئة' }), ['B:pullback']);
  assert.deepEqual(f({ query: 'zzz' }), []);
});

test('sorting by freshness, liquidity, volume, risk and concurrent signals', () => {
  const ids = key => sortItems(items, stocks, key, { breakout: 'ب', rs: 'ق', pullback: 'ا' }).map(i => `${i.symbol}:${i.strategy}`);
  assert.deepEqual(ids('fresh'), ['A:breakout', 'C:breakout', 'A:rs', 'B:pullback']);
  assert.deepEqual(ids('liquidity')[0], 'A:breakout');
  assert.deepEqual(ids('volume')[0], 'A:breakout');
  assert.deepEqual(ids('risk')[0], 'C:breakout');
  assert.deepEqual(ids('concurrent').slice(0, 2).map(x => x[0]), ['A', 'A']);
  assert.equal(concurrentCounts(items).get('A'), 2);
  assert.equal(items.length, 4, 'sorting does not mutate the input');
});

test('the watch list reports new, ended and unchanged signals since the stock was saved', () => {
  const saved = { strategies: ['breakout', 'rs'] };
  assert.equal(watchDiff(saved, items.filter(i => i.symbol === 'A')).state, 'same');
  assert.deepEqual(watchDiff(saved, [items[0]]), { state: 'removed', added: [], removed: ['rs'], now: ['breakout'] });
  assert.equal(watchDiff(saved, [items[0], items[1], items[2]]).state, 'added');
  assert.equal(watchDiff(saved, [items[0], items[2]]).state, 'changed');
  assert.equal(watchDiff({ strategies: [] }, []).state, 'none');
});

test('saving to the watch list toggles, and survives broken or blocked storage', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let w = toggleWatch(loadWatch(storage), 'A', [items[0]], '2026-11-16', '2026-11-17T00:00:00Z');
  assert.deepEqual(w.A.strategies, ['breakout']); assert.ok(saveWatch(storage, w));
  assert.deepEqual(Object.keys(loadWatch(storage)), ['A']);
  assert.deepEqual(toggleWatch(w, 'A', [], 'd', 't'), {});
  store.set('saudi-sectors-scanner-watch', '{not json'); assert.deepEqual(loadWatch(storage), {});
  store.set('saudi-sectors-scanner-watch', '[1,2]'); assert.deepEqual(loadWatch(storage), {});
  assert.deepEqual(loadWatch({ getItem() { throw new Error('blocked'); } }), {});
  assert.equal(saveWatch({ setItem() { throw new Error('quota'); } }, {}), false);
});

test('number and text helpers', () => {
  assert.equal(fmtValue(24_900_000), '24.9 مليون'); assert.equal(fmtValue(2_500_000_000), '2.5 مليار'); assert.equal(fmtValue(850_000), '850 ألف');
  assert.equal(escapeHtml('<b>"x"&</b>'), '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
});

test('the published signals file is consistent: every item has its stock, its conditions and valid levels', () => {
  const j = JSON.parse(readFileSync(new URL('../dist/scanner/signals.json', import.meta.url), 'utf8'));
  assert.equal(typeof j.meta.valid, 'boolean');
  if (!j.meta.valid) { assert.equal(j.items.length, 0, 'no signals when verification failed'); return; }
  assert.match(j.meta.dataDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(j.meta.officialDate, j.meta.dataDate);
  for (const sym of [...(j.meta.excluded.suspended || []), ...(j.meta.excluded.stale || [])]) assert.ok(!(sym in j.stocks), `${sym} is excluded and must produce no signal`);
  const seen = new Set();
  for (const it of j.items) {
    const s = j.stocks[it.symbol]; assert.ok(s, it.symbol);
    assert.ok(j.strategies[it.strategy], it.strategy);
    assert.equal(it.conds.length, j.strategies[it.strategy].conditions.length);
    assert.ok(it.conds.every(c => c[0] === 1), 'a published signal has every condition met');
    assert.ok(it.stop < it.entryRef && it.entryRef < it.target1 && it.target1 < it.target2, `${it.symbol} levels`);
    assert.ok(it.ageSessions >= 0 && it.ageSessions < 10);
    assert.equal(it.status, it.ageSessions === 0 ? 'new' : 'continuing');
    assert.ok(s.price > it.stop, 'price is still above the reference stop');
    const key = `${it.symbol}:${it.strategy}`; assert.ok(!seen.has(key), `duplicate ${key}`); seen.add(key);
    assert.ok(!('reversal' in j.strategies));
  }
});

test('the strategy statistics shown on the page say nothing is proven', () => {
  const st = JSON.parse(readFileSync(new URL('../dist/scanner/strategy-stats.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(st.strategies).length >= 7);
  for (const [id, s] of Object.entries(st.strategies)) assert.equal(s.verdict, 'unproven', id);
});

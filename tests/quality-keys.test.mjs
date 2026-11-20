import test from 'node:test';
import assert from 'node:assert/strict';
import { swingLevels, trendAt, tasiKey, levelsKey, levelPosition, sma55Key, macdKey, financialKey, financialKeyAsOf, quarterAvailable, runStart, computeKeys, KEY_IDS } from '../scripts/quality-keys.mjs';

const rising = n => Array.from({ length: n }, (_, i) => 100 + i);
const falling = n => Array.from({ length: n }, (_, i) => 500 - i);
const flat = n => Array.from({ length: n }, () => 100);

test('trend: steady rise is up, steady fall is down, flat is side, short history is na', () => {
  assert.equal(trendAt(rising(260), 259).trend, 'up');
  assert.equal(trendAt(falling(260), 259).trend, 'down');
  assert.equal(trendAt(flat(260), 259).trend, 'side');
  assert.equal(trendAt(rising(100), 99).trend, 'na');
});

test('TASI key follows the same trend definition and fails closed without candles', () => {
  assert.equal(tasiKey(rising(260)).ok, 1);
  assert.equal(tasiKey(falling(260)).ok, 0);
  assert.equal(tasiKey(rising(100)).ok, 0);
  assert.equal(tasiKey(null).ok, 0);
});

const Z = (low, high, touches = 3) => ({ low, high, center: (low + high) / 2, touches });
test('levels key: at a support zone and nearer to it than to resistance is 1; near resistance, far from support or no support is 0', () => {
  assert.equal(levelsKey(100, Z(97, 99), Z(108, 110), 2).ok, 1);   // 0.5 ATR above support, resistance 4 ATR away
  assert.equal(levelsKey(100, Z(95, 97), Z(103, 105), 2).ok, 0);   // support 1.5 ATR away (beyond 1 ATR) and resistance 1.5 ATR away
  assert.equal(levelsKey(100, Z(90, 92), Z(110, 112), 2).ok, 0);   // 4 ATR above support: not "at" support
  assert.equal(levelsKey(100, Z(97, 99), Z(101, 103), 2).ok, 0);   // resistance 0.5 ATR away
  assert.equal(levelsKey(100, Z(99, 101), Z(108, 110), 2).ok, 1);  // price inside the support zone
  assert.equal(levelsKey(100, Z(97, 99), null, 2).ok, 1);          // new high: no resistance above, still at support
  assert.equal(levelsKey(100, null, Z(108, 110), 2).ok, 0);
  assert.equal(levelsKey(100, null, null, 2).ok, 0);
  assert.equal(levelsKey(null, Z(97, 99), null, 2).ok, 0);
  assert.equal(levelsKey(100, Z(97, 99), null, 0).ok, 0);
});

test('55-day average key: above is 1, below is 0, short history is 0', () => {
  assert.equal(sma55Key(rising(80), 79).ok, 1);
  assert.equal(sma55Key(falling(80), 79).ok, 0);
  assert.equal(sma55Key(rising(30), 29).ok, 0);
});

test('MACD key: line above signal is 1, below is 0, short history is 0', () => {
  const up = [...flat(40), ...Array.from({ length: 10 }, (_, i) => 100 + (i + 1) * 3)];
  const down = [...flat(40), ...Array.from({ length: 10 }, (_, i) => 100 - (i + 1) * 3)];
  assert.equal(macdKey(up, up.length - 1).ok, 1);
  assert.equal(macdKey(down, down.length - 1).ok, 0);
  assert.equal(macdKey(rising(20), 19).ok, 0);
});

test('financial key: last four consecutive quarters decide; loss is 0; gaps and missing data fall back, never guess', () => {
  const q = (...v) => Object.fromEntries(v.map((x, k) => [`${2025 + Math.floor((k + 3) / 4)}Q${(k + 3) % 4 + 1}`, { netProfit: x }]));
  assert.equal(financialKey({ quarters: q(10, 20, 30, 40) }).ok, 1);
  assert.equal(financialKey({ quarters: q(-50, -20, 5, 10) }).ok, 0); // sum -55
  assert.equal(financialKey({ quarters: q(-50, 20, 30, 40) }).ok, 1); // sum 40: one weak quarter alone is not a loss
  // a gap (missing quarter) means no valid trailing year, so the annual figure is used
  const gap = { quarters: { '2025Q1': { netProfit: 10 }, '2025Q2': { netProfit: 10 }, '2025Q4': { netProfit: 10 }, '2026Q1': { netProfit: 10 } }, years: [{ year: 2025, netProfit: -5 }] };
  const g = financialKey(gap); assert.equal(g.ok, 0); assert.equal(g.basis, 'fy');
  assert.equal(financialKey({ quarters: {}, years: [{ year: 2024, netProfit: 3 }, { year: 2025, netProfit: 7 }] }).ok, 1);
  const none = financialKey(undefined); assert.equal(none.ok, 0); assert.equal(none.basis, 'none');
});

test('computeKeys: six keys, score is their sum, dividend badge is separate from the score', () => {
  const close = rising(260);
  const tasi = tasiKey(rising(260));
  const all = computeKeys({ close, i: 259, support: Z(353, 357), resistance: Z(380, 384), atr: 5, financial: financialKey({ quarters: { '2025Q4': { netProfit: 5 }, '2026Q1': { netProfit: 5 }, '2026Q2': { netProfit: 5 }, '2026Q3': { netProfit: 5 } } }), tasi, dividendYield: 3 });
  assert.deepEqual(Object.keys(all.keys), KEY_IDS);
  // a straight rising line has MACD line above its signal only while accelerating; assert the sum rather than every bit
  assert.equal(all.score, all.bits.split('').reduce((a, b) => a + +b, 0));
  assert.equal(all.keys.trend.ok, 1); assert.equal(all.keys.fin.ok, 1); assert.equal(all.keys.tasi.ok, 1); assert.equal(all.keys.sma55.ok, 1);
  assert.equal(all.dividendOk, true);
  const low = computeKeys({ close, i: 259, support: Z(353, 357), resistance: Z(380, 384), atr: 5, financial: financialKey(undefined), tasi: tasiKey(falling(260)), dividendYield: 2.5 });
  assert.equal(low.keys.fin.ok, 0); assert.equal(low.keys.tasi.ok, 0); assert.equal(low.dividendOk, false); // 2.5 is not "above" 2.5
  assert.ok(low.score <= all.score - 2);
});

test('swing levels come from price structure, not moving averages', () => {
  // range 90..110 with a clear swing low at 95 (bar 12) and swing high at 108 (bar 24); price at 105 near the top
  const n = 40, high = [], low = [], close = [];
  for (let k = 0; k < n; k++) {
    const base = 100 + 8 * Math.sin(k / 3.8); // oscillation
    close.push(base); high.push(base + 1); low.push(base - 1);
  }
  const i = n - 1, { support, resistance } = swingLevels(high, low, close, i);
  assert.ok(support < close[i] && resistance > close[i]);
  assert.ok(resistance <= Math.max(...high.slice(-20)) + 1e-9); // never above the 20-day high when one lies above price
  // price at a new high: no resistance above it
  const up = Array.from({ length: 60 }, (_, k) => 100 + k);
  assert.equal(swingLevels(up.map(x => x + 1), up.map(x => x - 1), up, 59).resistance, null);
  // price at a new low: no support below it
  const down = Array.from({ length: 60 }, (_, k) => 200 - k);
  assert.equal(swingLevels(down.map(x => x + 1), down.map(x => x - 1), down, 59).support, null);
});

test('levels key: at support is 1 only with 2 ATR of room to resistance; a support cut right under a resistance is 0', () => {
  assert.equal(levelsKey(100, Z(97, 99), Z(103, 105), 2).ok, 0);      // resistance 1.5 ATR away: not enough room
  assert.equal(levelsKey(100, Z(97, 99), Z(104, 106), 2).ok, 1);      // exactly 2 ATR of room is enough
  assert.equal(levelsKey(100, Z(98, 100.5), Z(100.6, 103), 2).ok, 0); // one band cut in two: support right under resistance
  assert.equal(levelsKey(100, Z(95, 97), Z(99.5, 103), 2).ok, 0);     // price inside the resistance zone: at resistance
});

test('level position labels: support, resistance, squeezed, between, none; the key is 1 exactly when the position is support', () => {
  assert.equal(levelPosition(100, Z(97, 99), Z(108, 110), 2), 'support');
  assert.equal(levelPosition(100, Z(97, 99), null, 2), 'support');
  assert.equal(levelPosition(100, Z(97, 99), Z(101, 103), 2), 'squeezed');   // near both
  assert.equal(levelPosition(100, Z(97, 99), Z(103, 105), 2), 'squeezed');   // at support but only 1.5 ATR of room
  assert.equal(levelPosition(100, Z(90, 92), Z(101, 103), 2), 'resistance');
  assert.equal(levelPosition(100, Z(90, 92), Z(110, 112), 2), 'between');
  assert.equal(levelPosition(100, null, null, 2), 'none');
  assert.equal(levelPosition(null, Z(97, 99), null, 2), 'none');
  for (const [s, r] of [[Z(97, 99), Z(108, 110)], [Z(97, 99), Z(101, 103)], [Z(90, 92), Z(101, 103)], [Z(99, 101), null], [null, Z(108, 110)]]) {
    assert.equal(levelsKey(100, s, r, 2).ok === 1, levelPosition(100, s, r, 2) === 'support');
  }
});

test('signal start: the current unbroken run at or above the threshold, with its length', () => {
  const d = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(runStart([3, 5, 5, 4, 5, 6], d, 5), { date: 'e', sessions: 2, capped: false });
  assert.deepEqual(runStart([3, 5, 5, 4, 5, 6], d, 4), { date: 'b', sessions: 5, capped: false });
  assert.deepEqual(runStart([3, 5, 5, 4, 5, 6], d, 6), { date: 'f', sessions: 1, capped: false });
  assert.equal(runStart([5, 5, 4], d.slice(0, 3), 5), null);                                          // not in the signal today
  assert.deepEqual(runStart([5, 5, 6], d.slice(0, 3), 5), { date: 'a', sessions: 3, capped: true });  // reaches the oldest session examined
  assert.equal(runStart([], [], 5), null);
});

test('financial key as of a date uses only quarters published by then (no look-ahead)', () => {
  assert.equal(quarterAvailable('2026Q1'), '2026-05-15');
  assert.equal(quarterAvailable('2025Q4'), '2026-04-10');
  const fin = { quarters: { '2025Q3': { netProfit: 5 }, '2025Q4': { netProfit: 5 }, '2026Q1': { netProfit: 5 }, '2026Q2': { netProfit: 5 }, '2026Q3': { netProfit: -100 } } };
  assert.equal(financialKeyAsOf(fin, '2026-10-01').ok, 1);   // Q3 2026 results (a big loss) are not out yet
  assert.equal(financialKeyAsOf(fin, '2026-12-01').ok, 0);   // after they are: trailing four quarters are negative
  assert.equal(financialKeyAsOf(undefined, '2026-12-01').ok, 0);
});

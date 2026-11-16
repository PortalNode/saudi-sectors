import test from 'node:test';
import assert from 'node:assert/strict';
import { isFakeBar, parseYahooSplits, tvDistance, parseOfficialCloses, scaleFactors, rebuildBars, candleFile, validOhlc, addSession, scanBars, applyFactor } from './ohlc-merge.mjs';

const bar = (d, c, extra = {}) => ({ d, o: c, h: c + 0.1, l: c - 0.1, c, v: 1000, ...extra });
const days = n => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 4 + i)).toISOString().slice(0, 10));

test('the exchange chart becomes sorted adjusted closes', () => {
  const closes = parseOfficialCloses([{ dateTime: '2026-11-15', indexPrice: 26.68 }, { dateTime: '2026-11-12', indexPrice: 26.4 }, { dateTime: 'x', indexPrice: 1 }, { dateTime: '2026-11-11', indexPrice: 0 }]);
  assert.deepEqual(closes, [{ d: '2026-11-12', c: 26.4 }, { d: '2026-11-15', c: 26.68 }]);
  assert.throws(() => parseOfficialCloses({}), /shape/);
});

test('a flat bar with no volume is a session the source never received', () => {
  assert.ok(isFakeBar({ o: 5, h: 5, l: 5, c: 5, v: 0 }));
  assert.ok(!isFakeBar({ o: 5, h: 5, l: 5, c: 5, v: 10 }), 'a traded session with one price is real');
  assert.ok(!isFakeBar({ o: 5, h: 5.1, l: 5, c: 5, v: 0 }));
});

test('the scale factor steps at a capital action and odd days keep their own', () => {
  const d = days(12);
  const official = d.map((x, i) => ({ d: x, c: i < 6 ? 6.344 : 10 }));
  // Yahoo before the action is on the unadjusted scale (×1/0.6344); day 2 is on a third scale.
  const daily = new Map(d.map((x, i) => [x, bar(x, i < 6 ? 10 : 10)]));
  daily.set(d[2], bar(d[2], 6.678));
  const k = scaleFactors(official, daily);
  assert.equal(k[0].toFixed(4), '0.6344');
  assert.equal(k[5].toFixed(4), '0.6344', 'the step starts on the action day, not a day late');
  assert.equal(k[6], 1);
  assert.equal(k[2].toFixed(2), '0.95', 'a day Yahoo scaled differently keeps its own factor');
});

test('candles are rebuilt on the exchange basis: official closes, scaled open/high/low, no suspended days', () => {
  const d = days(8);
  const official = [10, 10.2, 10.2, 10.2, 10.5, 10.4, 10.6, 10.8].map((c, i) => ({ d: d[i], c }));
  const daily = new Map([
    [d[0], bar(d[0], 20, { o: 19.8, h: 20.4 })], [d[1], bar(d[1], 20.4)],
    [d[2], { d: d[2], o: 20.4, h: 20.4, l: 20.4, c: 20.4, v: 0 }], // suspended: same close, no trade
    [d[4], { d: d[4], o: 20.4, h: 20.4, l: 20.4, c: 20.4, v: 0 }], // a session Yahoo never received
    [d[6], bar(d[6], 21.2)], [d[7], bar(d[7], 21.6)]
  ]);
  const hourly = new Map([[d[5], { d: d[5], o: 21, h: 21.2, l: 20.6, c: 20.9, v: 500 }]]);
  const { bars, est } = rebuildBars({ official, daily, hourly });
  // Hourly bars Yahoo left unadjusted (daily ones are ×2 here) follow their own close, not the daily factor.
  const odd = rebuildBars({ official, daily, hourly: new Map([[d[5], { d: d[5], o: 10.5, h: 10.6, l: 10.3, c: 10.45, v: 500 }]]) }).bars.find(b => b.d === d[5]);
  assert.deepEqual([odd.o, odd.h, odd.l, odd.c], [10.45, 10.55, 10.25, 10.4], 'an hourly bar on its own scale is not halved');
  assert.deepEqual(bars.map(b => b.d), [d[0], d[1], d[4], d[5], d[6], d[7]], 'days without a trade are left out');
  assert.deepEqual(bars[0], { d: d[0], o: 9.9, h: 10.2, l: 9.9, c: 10, v: 2000 }, 'Yahoo halved to the exchange basis, volume doubled');
  assert.deepEqual(bars[2], { d: d[4], o: 10.2, h: 10.5, l: 10.2, c: 10.5, v: 0 }, 'a missed session runs from the previous close');
  assert.deepEqual(bars[3], { d: d[5], o: 10.5, h: 10.6, l: 10.3, c: 10.4, v: 1000 }, 'hourly bars fill a missed session');
  assert.deepEqual(est, [d[4], d[5]]);
  const file = candleFile('1213', 'x', d[7], bars, est);
  assert.ok(validOhlc(file));
  assert.ok(!validOhlc(candleFile('1213', 'x', d[7], bars.concat({ d: '2026-02-01', o: 9, h: 9, l: 9, c: 9, v: 0 }), est)), 'a flat no-volume bar that is not estimated is invalid');
});

test('TradingView scanner rows become the session and the previous one', () => {
  const t = iso => Date.parse(`${iso}T00:00:00+03:00`) / 1000;
  const row = { d: [t('2026-11-15'), 12, 12.35, 11.44, 11.47, 1140975, t('2026-11-12'), 11.88, 11.95, 11.59, 11.8, 749265, 'SAR'] };
  assert.deepEqual(scanBars(row), { today: { d: '2026-11-15', o: 12, h: 12.35, l: 11.44, c: 11.47, v: 1140975 }, prev: { d: '2026-11-12', o: 11.88, h: 11.95, l: 11.59, c: 11.8, v: 749265 } });
  assert.equal(scanBars({ d: [...row.d.slice(0, 12), 'USD'] }), null);
  assert.equal(scanBars({ d: [t('2026-11-15'), 12, 12, 12, 12, 0, null] }).today, null, 'no volume, no session');
});

test('a finished session is added with the official close; anything else is ignored', () => {
  const stored = [bar('2026-11-11', 10), bar('2026-11-12', 10.2)];
  const today = { d: '2026-11-15', o: 10.2, h: 10.6, l: 10.1, c: 10.48, v: 900 }, prev = { ...stored[1] };
  const { bars, factor, added } = addSession(stored, { today, prev }, { date: '2026-11-15', price: 10.5 });
  assert.ok(added); assert.equal(factor, null);
  assert.deepEqual(bars.at(-1), { ...today, c: 10.5 }, 'the official close is final');
  assert.equal(addSession(stored, { today, prev }, { date: '2026-11-12', price: 10.2 }).added, false, 'a session still in progress is not stored');
});

test('when TradingView rescales the previous session, a capital action took effect and history follows', () => {
  const stored = [bar('2026-11-11', 20), bar('2026-11-12', 20.4)];
  const prev = { d: '2026-11-12', o: 10.2, h: 10.25, l: 10.15, c: 10.2, v: 2000 }; // a 1-for-1 bonus issue
  const today = { d: '2026-11-15', o: 10.2, h: 10.4, l: 10.1, c: 10.3, v: 900 };
  const { bars, factor } = addSession(stored, { today, prev }, { date: '2026-11-15', price: 10.3 });
  assert.equal(factor, 0.5);
  assert.deepEqual(bars[0], { d: '2026-11-11', o: 10, h: 10.05, l: 9.95, c: 10, v: 2000 });
  assert.deepEqual(bars[1], prev);
  // A corrected close alone (open/high/low unchanged) is not a capital action.
  const corrected = addSession(stored, { today, prev: { ...stored[1], c: 20.3, l: 20.25 } }, { date: '2026-11-15', price: 10.3 });
  assert.equal(corrected.factor, null);
  assert.equal(corrected.bars[0].c, 20);
  assert.deepEqual(applyFactor([bar('2026-01-01', 4)], '2026-01-02', 0.5)[0].c, 2);
});

test('sessions an update missed are filled, never with flat no-volume bars', () => {
  const stored = [bar('2026-11-04', 10)];
  const fill = [bar('2026-11-05', 10.1), { d: '2026-11-08', o: 10.1, h: 10.1, l: 10.1, c: 10.1, v: 0 }, bar('2026-11-09', 10.3)];
  const prev = bar('2026-11-10', 10.4), today = bar('2026-11-11', 10.5);
  const { bars } = addSession(stored, { today, prev }, { date: '2026-11-11', price: 10.5 }, { fill });
  assert.deepEqual(bars.map(b => b.d), ['2026-11-04', '2026-11-05', '2026-11-09', '2026-11-10', '2026-11-11']);
});

test('a bonus issue follows the exact share ratio Yahoo reports, not the exchange\'s capital factor', () => {
  const d = days(30), split = d[15];
  // A 6:5 bonus issue: Yahoo divides earlier prices by 1.2 exactly; the exchange by 1.22 (its capital factor).
  const daily = new Map(d.map((x, i) => [x, bar(x, 10)]));
  const official = d.map((x, i) => ({ d: x, c: i < 15 ? Math.round(10 * 1.2 / 1.22 * 100) / 100 : 10 }));
  const { bars } = rebuildBars({ official, daily, splits: [{ d: split, ratio: 1.2 }], exactSplits: true });
  assert.notEqual(rebuildBars({ official, daily, splits: [{ d: split, ratio: 1.2 }] }).bars[0].c, 10, 'the exchange\'s basis is the default');
  assert.equal(bars[0].c, 10, 'history before the split is on the exact ratio');
  assert.equal(bars.at(-1).c, 10);
  const json = { chart: { result: [{ meta: { gmtoffset: 10800 }, events: { splits: { a: { date: Date.parse('2026-01-11T07:00:00Z') / 1000, numerator: 6, denominator: 5 } } } }] } };
  assert.deepEqual(parseYahooSplits(json), [{ d: '2026-01-11', ratio: 1.2 }]);
});

test('a stock that moved from Nomu keeps its earlier sessions when they continue without a jump', () => {
  const d = days(12);
  const daily = new Map(d.map((x, i) => [x, bar(x, 5 + i * 0.1)]));
  const official = d.slice(8).map((x, i) => ({ d: x, c: Math.round((5 + (i + 8) * 0.1) * 100) / 100 }));
  const { bars } = rebuildBars({ official, daily, earlier: true });
  assert.equal(bars[0].d, d[0], 'the sessions before the move are kept');
  assert.equal(rebuildBars({ official, daily }).bars[0].d, d[8], 'only when asked');
  assert.equal(bars.length, 12);
  const jumped = new Map(d.map((x, i) => [x, bar(x, i < 8 ? 2 : 5 + i * 0.1)]));
  assert.equal(rebuildBars({ official, daily: jumped, earlier: true }).bars[0].d, d[8], 'a history that does not continue is not joined');
});

test('candidates are scored against TradingView\'s own figures', () => {
  const bars = days(60).map((d, i) => bar(d, 10 + (i % 5) * 0.1));
  const today = bars.at(-1).d;
  const exact = [10.5, 9.9, 10.5, 9.9, 10.2, null, null];
  assert.equal(tvDistance(bars, exact, today).mismatches, 0);
  assert.equal(tvDistance(bars, [11, 9.9, 10.5, 9.9, 10.2, null, null], today).mismatches, 1, 'a 52-week high 5% apart is a mismatch');
});

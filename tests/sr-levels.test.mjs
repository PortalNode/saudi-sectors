import test from 'node:test';
import assert from 'node:assert/strict';
import { atr as atrSeries } from '../dist/scanner/indicators.mjs';
import { pivots, zonesAt, nearestZones, windowStart, mergeZones, SR_DEFAULTS } from '../scripts/sr-levels.mjs';

// سلسلة تتأرجح بين 100 و110 مرات عدة (قاع 100 وقمة 110 تتكرر)، تنتهي قرب 103
function ranging(cycles = 5, ending = 103) {
  const c = [];
  for (let k = 0; k < cycles; k++) { for (let s = 0; s <= 10; s++) c.push(100 + s); for (let s = 9; s >= 1; s--) c.push(100 + s); }
  c.push(ending);
  const h = c.map(x => x + 0.5), l = c.map(x => x - 0.5);
  return { h, l, c };
}

test('repeated turning points merge into one zone each, with their touch counts', () => {
  const { h, l, c } = ranging(5, 104);
  const i = c.length - 1, atr = atrSeries(h, l, c, 14), { support, resistance } = nearestZones(h, l, c, i, SR_DEFAULTS, atr);
  assert.ok(support && resistance);
  assert.ok(support.center > 99 && support.center < 101.5, `support ${support.center}`);
  assert.ok(resistance.center > 109 && resistance.center < 111.5, `resistance ${resistance.center}`);
  assert.ok(support.touches >= 3 && resistance.touches >= 3);
  assert.ok(support.high - support.low >= 0.25 * atr[i] - 1e-9); // a zone has width, never a bare line
});

test('a level touched once is not a zone', () => {
  const c = [...Array.from({ length: 30 }, (_, k) => 100 - k * 0.2), ...Array.from({ length: 30 }, (_, k) => 94 + k * 0.4)];
  const h = c.map(x => x + 0.5), l = c.map(x => x - 0.5), atr = atrSeries(h, l, c, 14);
  const zs = zonesAt(h, l, c, c.length - 1, atr);
  assert.ok(zs.every(z => z.touches >= SR_DEFAULTS.minTouches));
});

test('no look-ahead: levels at bar i are identical when later bars are removed', () => {
  const { h, l, c } = ranging(6, 105);
  for (const i of [150, 180, 200]) {
    const full = nearestZones(h, l, c, i), cut = nearestZones(h.slice(0, i + 1), l.slice(0, i + 1), c.slice(0, i + 1), i);
    assert.deepEqual([full.support?.center, full.resistance?.center], [cut.support?.center, cut.resistance?.center]);
  }
});

test('a pivot needs a real reaction and 5 confirming bars each side', () => {
  const { h, l, c } = ranging(3);
  const atr = atrSeries(h, l, c, 14), last = c.length - 1;
  const pv = pivots(h, l, atr, last);
  assert.ok(pv.length > 0);
  for (const v of pv) { assert.ok(v.j <= last - SR_DEFAULTS.k); assert.ok(v.reaction >= SR_DEFAULTS.reactionAtr); }
});

test('a flat series has no zones, and a new high has no resistance above it', () => {
  const f = Array.from({ length: 80 }, () => 100), h = f.map(x => x + 0.1), l = f.map(x => x - 0.1);
  assert.equal(nearestZones(h, l, f, 79).support, null);
  const { h: rh, l: rl, c: rc } = ranging(5, 120);
  assert.equal(nearestZones(rh, rl, rc, rc.length - 1).resistance, null);
});

test('only the last two calendar years count: older pivots are ignored when dates are given', () => {
  // قمة وقاع قويان قبل 3 سنوات ثم سوق هادئ بلا محاور: مع التواريخ لا مناطق، وبدونها تظهر
  const n = 900, c = [], d = [];
  const start = Date.UTC(2023, 0, 1);
  for (let k = 0; k < n; k++) {
    d.push(new Date(start + k * 86400000 * 1.2).toISOString().slice(0, 10));
    const swing = k < 120 ? 8 * Math.sin(k / 3.8) : 0; // التأرجح في أول 120 شمعة فقط
    c.push(100 + swing);
  }
  const h = c.map(x => x + 0.5), l = c.map(x => x - 0.5), i = n - 1;
  const atr = atrSeries(h, l, c, 14);
  const withDates = nearestZones(h, l, c, i, { ...SR_DEFAULTS, lookback: 5000 }, atr, d);
  assert.equal(withDates.zones.length, 0);
  const noDates = nearestZones(h, l, c, i, { ...SR_DEFAULTS, lookback: 5000 }, atr);
  assert.ok(noDates.zones.length > 0);
  assert.equal(windowStart(d, i, 2) > 0, true);
  assert.ok(d[windowStart(d, i, 2)] >= `${+d[i].slice(0, 4) - 2}${d[i].slice(4)}`);
});

test('a flat top over adjacent bars is one pivot, so one touch', () => {
  // قمة مسطحة (شمعتان بنفس الارتفاع) ثم هبوط حاد: محور واحد فقط
  const c = [...Array.from({ length: 20 }, (_, k) => 100 + k * 0.5), 110, 110, ...Array.from({ length: 20 }, (_, k) => 109 - k * 1.5)];
  const h = c.map(x => x + 0.5), l = c.map(x => x - 0.5), atr = atrSeries(h, l, c, 14);
  const tops = pivots(h, l, atr, c.length - 1).filter(v => v.type === 'high');
  assert.equal(tops.length, 1);
});

test('adjacent zones are one band: a support right under a resistance merges, distant or too wide ones do not', () => {
  const Zn = (low, high, touches, score) => ({ low, high, center: (low + high) / 2, touches, score, first: 1, last: 9, highs: 1, lows: 1 });
  const a = 2; // ATR
  const merged = mergeZones([Zn(98, 100, 3, 3), Zn(100.4, 102, 4, 4)], a); // gap 0.4 = 0.2 ATR
  assert.equal(merged.length, 1);
  assert.equal(merged[0].low, 98); assert.equal(merged[0].high, 102); assert.equal(merged[0].touches, 7);
  assert.ok(merged[0].center > 100 && merged[0].center < 101.2);
  assert.equal(mergeZones([Zn(98, 100, 3, 3), Zn(104, 106, 4, 4)], a).length, 2);  // gap 2 ATR: separate levels
  assert.equal(mergeZones([Zn(90, 94, 3, 3), Zn(94.5, 99, 4, 4)], a).length, 2);   // merged width would exceed 2 ATR
  assert.equal(mergeZones([Zn(100.5, 102, 4, 4), Zn(98, 100, 3, 3)], a).length, 1); // order-independent
});

test('zones from zonesAt are never adjacent: either a real gap separates them or merging would exceed the width cap', () => {
  const { h, l, c } = ranging(6, 105);
  const atr = atrSeries(h, l, c, 14), i = c.length - 1, zs = zonesAt(h, l, c, i, atr).sort((x, y) => x.low - y.low);
  for (let k = 1; k < zs.length; k++) assert.ok(zs[k].low - zs[k - 1].high > SR_DEFAULTS.mergeGapAtr * atr[i] - 1e-9 || zs[k].high - zs[k - 1].low > SR_DEFAULTS.mergeMaxAtr * atr[i]);
});

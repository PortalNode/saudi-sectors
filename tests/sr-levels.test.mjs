import test from 'node:test';
import assert from 'node:assert/strict';
import { atr as atrSeries } from '../dist/scanner/indicators.mjs';
import { pivots, zonesAt, nearestZones, SR_DEFAULTS } from '../scripts/sr-levels.mjs';

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

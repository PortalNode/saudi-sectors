import test from 'node:test';
import assert from 'node:assert/strict';
import { sinceListing, cagr } from './build-since-listing.mjs';
import { buildAnchor } from './fetch-listing-history.mjs';

const ours = (d, c, div = []) => ({ d, c, div });

test('price only and with one reinvested dividend, from our candles', () => {
  // 10 → 12, with a 1 SAR dividend going ex when the previous close was 10: factor 0.9.
  const r = sinceListing({ ours: ours(['2020-01-05', '2020-06-01', '2021-06-01'], [10, 10, 12], [['2020-06-01', 1]]), listed: '2020-01-05' });
  assert.equal(r.priceReturn, 20);
  assert.equal(r.totalReturn, round2((12 / (10 * 0.9) - 1) * 100));
  assert.equal(r.complete, true);
  assert.equal(r.source, 'candles');
  assert.equal(r.priceValue, 1200);
});

test('no dividends: both figures are equal', () => {
  const r = sinceListing({ ours: ours(['2019-01-01', '2026-01-01'], [20, 30]), listed: '2019-01-01' });
  assert.equal(r.priceReturn, 50);
  assert.equal(r.totalReturn, 50);
  assert.equal(r.priceCagr, round2(cagr(0.5, r.years) * 100));
});

test('history that starts after the listing is marked partial', () => {
  const r = sinceListing({ ours: ours(['2010-03-03', '2026-01-01'], [10, 15]), listed: '1993-01-02' });
  assert.equal(r.complete, false);
  assert.equal(r.base, '2010-03-03');
});

test('TradingView carries the years before our candles; the official closes carry the rest', () => {
  // TradingView: ×5 from 1999 to our first candle, ×10 to the anchor; its dividends double the anchor move.
  const anchor = { base: { d: '1999-01-10', c: 2, ca: 1 }, join: { d: '2010-03-03', c: 10, ca: 6 }, anchor: { d: '2026-01-01', c: 20, ca: 20 } };
  const r = sinceListing({ ours: ours(['2010-03-03', '2026-01-01', '2026-02-01', '2026-03-01'], [9, 20, 20, 22], [['2026-02-01', 2]]), anchor, listed: '1999-01-10' });
  // price: ×5 from TradingView, then 9 → 22 on the official closes (not TradingView's 10 → 20)
  assert.equal(r.priceReturn, round2((5 * 22 / 9 - 1) * 100));
  // dividends: TradingView's (20 / 1) ÷ (20 / 2) = ×2 to the anchor, then our 2 SAR dividend (factor 0.9)
  assert.equal(r.totalReturn, round2(((5 * 22 / 9) * 2 / 0.9 - 1) * 100));
  assert.equal(r.source, 'tradingview');
  assert.equal(r.base, '1999-01-10');
});

test('a capital action after the anchor rescales our history and changes nothing', () => {
  const anchor = { base: { d: '2020-01-01', c: 10, ca: 8 }, join: { d: '2020-01-01', c: 10, ca: 8 }, anchor: { d: '2026-01-01', c: 30, ca: 30 } };
  const before = sinceListing({ ours: ours(['2020-01-01', '2026-01-01', '2026-02-01'], [10, 30, 33]), anchor, listed: '2020-01-01' });
  // A 1-for-2 bonus issue: every earlier close is now two thirds of what it was.
  const after = sinceListing({ ours: ours(['2020-01-01', '2026-01-01', '2026-02-01'], [10 * 2 / 3, 20, 22]), anchor, listed: '2020-01-01' });
  assert.equal(after.priceReturn, before.priceReturn);
  assert.equal(after.totalReturn, before.totalReturn);
  assert.equal(before.priceReturn, 230);
  assert.equal(before.totalReturn, round2((3.3 * (30 / 8) / (30 / 10) - 1) * 100));
});

test('an anchor whose sessions our candles lost falls back to our candles', () => {
  const anchor = { base: { d: '2001-01-01', c: 1, ca: 1 }, join: { d: '2010-01-01', c: 2, ca: 2 }, anchor: { d: '2024-01-01', c: 5, ca: 5 } };
  const r = sinceListing({ ours: ours(['2025-01-01', '2026-01-01'], [5, 6]), anchor, listed: '2001-01-01' });
  assert.equal(r.source, 'candles');
  assert.equal(r.complete, false);
});

test('anchor: base on the listing day, join and anchor on sessions our candles have', () => {
  const splits = [{ d: '2019-12-11', c: 29.1 }, { d: '2019-12-12', c: 30 }, { d: '2026-11-24', c: 26.3 }];
  const dividends = [{ d: '2019-12-11', c: 21 }, { d: '2019-12-12', c: 22 }, { d: '2026-11-24', c: 26.3 }];
  const a = buildAnchor({ splits, dividends }, { d: ['2019-12-12', '2026-11-24'], c: [30, 26.3] }, '2019-12-11');
  assert.equal(a.base.d, '2019-12-11');
  assert.equal(a.join.d, '2019-12-12');
  assert.equal(a.anchor.d, '2026-11-24');
  assert.equal(a.complete, true);
  assert.equal(a.check.mismatched, 0);
  assert.equal(a.check.window, 0);
  // A different move over the shared sessions shows in the window check.
  const b = buildAnchor({ splits, dividends }, { d: ['2019-12-12', '2026-11-24'], c: [15, 26.3] }, '2019-12-11');
  assert.ok(b.check.window < -25);
});

test('anchor: an older company keeps the first session TradingView has, marked incomplete', () => {
  const splits = [{ d: '1999-01-10', c: 3 }, { d: '2010-03-03', c: 19 }, { d: '2026-11-24', c: 60 }];
  const dividends = [{ d: '1999-01-10', c: 1.4 }, { d: '2010-03-03', c: 12 }, { d: '2026-11-24', c: 60 }];
  const a = buildAnchor({ splits, dividends }, { d: ['2010-03-03', '2026-11-24'], c: [19, 60] }, '1988-12-01');
  assert.equal(a.base.d, '1999-01-10');
  assert.equal(a.join.d, '2010-03-03');
  assert.equal(a.complete, false);
});

function round2(x) { return Math.round(x * 100) / 100; }

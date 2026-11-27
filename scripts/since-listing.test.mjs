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

test('TradingView carries the price to the anchor; the official closes and our dividends carry the rest', () => {
  // TradingView: ×10 from 1999 to the anchor, and its dividends before our candles doubled a holding.
  const anchor = { base: { d: '1999-01-10', c: 2, ca: 1 }, join: { d: '2010-03-03', c: 10, ca: 10 }, anchor: { d: '2026-01-01', c: 20, ca: 20 }, preDiv: 2 };
  const r = sinceListing({ ours: ours(['2010-03-03', '2026-01-01', '2026-02-01', '2026-03-01'], [9, 20, 20, 22], [['2026-02-01', 2]]), anchor, listed: '1999-01-10' });
  // price: ×10 from TradingView (not the official 9 → 20 from 2010), then 20 → 22 on the official closes
  assert.equal(r.priceReturn, round2((10 * 22 / 20 - 1) * 100));
  // dividends: ×2 before our candles, then our 2 SAR dividend (factor 0.9)
  assert.equal(r.totalReturn, round2((11 * 2 / 0.9 - 1) * 100));
  assert.equal(r.source, 'tradingview');
  assert.equal(r.base, '1999-01-10');
  assert.equal(r.divFrom, undefined);
  // An untrusted early record: dividends count from our first candle, and the figure says so.
  const later = sinceListing({ ours: ours(['2010-03-03', '2026-01-01', '2026-03-01'], [9, 20, 22]), anchor: { ...anchor, preDiv: 1, divFrom: '2010-03-03' }, listed: '1999-01-10' });
  assert.equal(later.divFrom, '2010-03-03');
  assert.equal(later.totalReturn, later.priceReturn);
});

test('a capital action after the anchor rescales our history and changes nothing', () => {
  const anchor = { base: { d: '2020-01-01', c: 10, ca: 8 }, join: { d: '2020-01-01', c: 10, ca: 8 }, anchor: { d: '2026-01-01', c: 30, ca: 30 }, preDiv: 1 };
  const before = sinceListing({ ours: ours(['2020-01-01', '2026-01-01', '2026-02-01'], [10, 30, 33], [['2026-01-01', 3]]), anchor, listed: '2020-01-01' });
  // A 1-for-2 bonus issue: every earlier close and dividend is now two thirds of what it was.
  const after = sinceListing({ ours: ours(['2020-01-01', '2026-01-01', '2026-02-01'], [10 * 2 / 3, 20, 22], [['2026-01-01', 2]]), anchor, listed: '2020-01-01' });
  assert.equal(after.priceReturn, before.priceReturn);
  assert.equal(after.totalReturn, before.totalReturn);
  assert.equal(before.priceReturn, 230);
  // the 3 SAR dividend on a previous close of 10: factor 0.7
  assert.equal(before.totalReturn, round2((3.3 / 0.7 - 1) * 100));
});

test('an anchor whose sessions our candles lost falls back to our candles', () => {
  const anchor = { base: { d: '2001-01-01', c: 1, ca: 1 }, join: { d: '2010-01-01', c: 2, ca: 2 }, anchor: { d: '2024-01-01', c: 5, ca: 5 }, preDiv: 1 };
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

test('dividends: TradingView\'s record checked against Yahoo\'s and the official close, on our basis', async () => {
  const { tvDividendEvents, chooseDividends, preJoinDividends } = await import('./fetch-listing-history.mjs');
  const { dividendFactors } = await import('./adjust-dividends.mjs');
  // TradingView: a dividend of 10% of the previous close goes ex on 2020-02-03.
  const splits = [{ d: '2020-01-01', c: 20 }, { d: '2020-02-02', c: 20 }, { d: '2020-02-03', c: 18 }, { d: '2020-03-01', c: 19 }];
  const dividends = [{ d: '2020-01-01', c: 18 }, { d: '2020-02-02', c: 18 }, { d: '2020-02-03', c: 18 }, { d: '2020-03-01', c: 19 }];
  const tv = tvDividendEvents({ splits, dividends });
  assert.equal(tv.length, 1);
  assert.ok(Math.abs(tv[0].f - 0.1) < 1e-9);
  // Our closes are on another basis (half): the amount follows our previous close, so the factor is the same.
  const ours = { d: ['2020-01-01', '2020-02-02', '2020-02-03', '2020-03-01'], c: [10, 10, 9, 9.5] };
  const div = chooseDividends(tv, [{ d: '2020-02-04', f: 0.098 }], ours);
  assert.deepEqual(div, [['2020-02-03', 1]]);
  assert.ok(Math.abs(dividendFactors(ours.d, ours.c, div)[0] - 0.9) < 1e-9);
  // The sources disagree: the one closer to the official fall on the ex-date wins (here Yahoo's 1%).
  const flat = { d: ours.d, c: [10, 10, 9.9, 9.9] };
  assert.deepEqual(chooseDividends([{ d: '2020-02-03', f: 0.2, move: 1 }], [{ d: '2020-02-03', f: 0.01 }], flat), [['2020-02-03', 0.1]]);
  // A 35% "dividend" the price did not fall by is a capital action: dropped. A Yahoo-only one too.
  assert.deepEqual(chooseDividends([{ d: '2020-02-03', f: 0.35, move: 1 }], [{ d: '2020-03-01', f: 0.03 }], flat), []);
  // Before our candles: TradingView's dividends count when the price fell by them on their ex-dates.
  const fine = preJoinDividends([{ d: '2001-01-01', f: 0.05, move: 0.96 }, { d: '2002-01-01', f: 0.5, move: 1 }, { d: '2011-01-01', f: 0.5, move: 0.5 }], '2000-01-01', '2010-01-01');
  assert.equal(fine.trusted, true);
  assert.ok(Math.abs(fine.mul - 1 / 0.95) < 1e-9, 'the 50% one the price did not fall by and the one after the range are left out');
  // Dividends three times the price falls (amounts from before a split): none count.
  const inflated = preJoinDividends([1, 2, 3].map(i => ({ d: `200${i}-01-01`, f: 0.09, move: 0.98 })), '2000-01-01', '2010-01-01');
  assert.deepEqual(inflated, { mul: 1, trusted: false, count: 3 });
});

test('after TradingView\'s record replaces ours, Yahoo only adds later dividends; a capital action rescales them', async () => {
  const { nextDividends, rescaleDividends } = await import('./ohlc-merge.mjs');
  const before = { div: [['2025-03-01', 1]], divSource: 'tradingview', divThrough: '2026-01-01' };
  // Yahoo's own amount for an old date and an in-kind distribution are ignored; a new dividend is added.
  const next = nextDividends(before, [['2025-03-01', 3], ['2025-06-01', 9], ['2026-02-01', 0.5]]);
  assert.deepEqual(next, { div: [['2025-03-01', 1], ['2026-02-01', 0.5]], divSource: 'tradingview', divThrough: '2026-01-01' });
  // Without TradingView's record Yahoo's report merges as before.
  assert.deepEqual(nextDividends({ div: [['2025-03-01', 1]] }, [['2025-03-01', 3]]).div, [['2025-03-01', 3]]);
  // A 1-for-2 bonus issue on 2026-01-10 makes earlier closes two thirds: so are earlier amounts.
  assert.deepEqual(rescaleDividends([['2025-03-01', 1.5], ['2026-02-01', 0.5]], '2026-01-10', 2 / 3), [['2025-03-01', 1], ['2026-02-01', 0.5]]);
});

test('the base is the first session\'s open, as TradingView\'s «All» (Alinma: open 7.125, close 8)', () => {
  const anchor = { base: { d: '2008-06-03', o: 7.125, c: 8, ca: 5.53 }, join: { d: '2010-03-03', c: 6.35, ca: 4.39 }, anchor: { d: '2026-11-26', c: 21.33, ca: 21.33 }, preDiv: 1 };
  const r = sinceListing({ ours: ours(['2010-03-03', '2026-11-26'], [6.5, 21.33]), anchor, listed: '2008-06-03' });
  assert.equal(r.priceReturn, round2((21.33 / 7.125 - 1) * 100)); // TradingView Perf.All +199.37%
  // Our own candles alone start from their first open too.
  const c = sinceListing({ ours: { d: ['2020-01-01', '2026-01-01'], o: [9, 12], c: [10, 12], div: [] }, listed: '2020-01-01' });
  assert.equal(c.priceReturn, round2((12 / 9 - 1) * 100));
});

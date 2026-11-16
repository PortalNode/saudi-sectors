import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateStock, COSTS, EXITS, WARMUP } from '../scripts/backtest/engine.mjs';
import { STRATEGIES } from '../scripts/backtest/strategies.mjs';
import { computeFeatures, marketContext } from '../scripts/backtest/features.mjs';
import { buildIndex } from '../scripts/backtest/market.mjs';
import { readCandles } from '../scripts/ohlc-files.mjs';
import { runPortfolio } from '../scripts/backtest/portfolio.mjs';

const N = WARMUP + 60, SIG = WARMUP + 5;          // the signal bar
const date = i => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10);
// A flat stock at 10 with a constant ATR of 0.5 (stop = entry - 2 ATR = 9, 1R = 1, 2R target = 12).
function flat(patch = {}) {
  const s = { symbol: 'T', sector: 'x', d: Array.from({ length: N }, (_, i) => date(i)), o: Array(N).fill(10), h: Array(N).fill(10), l: Array(N).fill(10), c: Array(N).fill(10),
    v: Array(N).fill(1e6), est: Array(N).fill(false), flag: Array(N).fill(false) };
  s.val = s.c.map((c, i) => c * s.v[i]);
  for (const [k, edits] of Object.entries(patch)) for (const [i, x] of Object.entries(edits)) s[k][+i] = x;
  const f = { avgVal20: Array(N).fill(5e7), nEst20: Array(N).fill(0), nFlag20: Array(N).fill(0), atr: Array(N).fill(0.5), regime: Array(N).fill('up') };
  return { s, f };
}
const only = i => (s, f, k) => k === i;
const free = { ...COSTS, commission: 0, slipTiers: [[0, 0]] };
const run = (patch, opts = {}) => { const { s, f } = flat(patch); return simulateStock(s, f, only(SIG), { costs: free, ...opts }); };
const E = SIG + 1; // entry bar

test('the order fills at the next open, never at the close that produced the signal', () => {
  const [t] = run({ o: { [E]: 10.3 }, c: { [SIG]: 10 }, h: { [E]: 10.3, [E + 1]: 12.4 } });
  assert.equal(t.entry, 10.3); assert.equal(t.entryDate, date(E)); assert.equal(t.signalDate, date(SIG));
});

test('target: 2R above entry fills at the target price', () => {
  const [t] = run({ h: { [E + 1]: 12.5 } });
  assert.equal(t.why, 'target'); assert.equal(t.exitPx, 12); assert.ok(Math.abs(t.R - 2) < 1e-12);
});

test('a gap down through the stop fills at the open, not at the stop price', () => {
  const [t] = run({ o: { [E + 1]: 8.5 }, l: { [E + 1]: 8.4 }, h: { [E + 1]: 8.6 }, c: { [E + 1]: 8.5 } });
  assert.equal(t.why, 'gap-stop'); assert.equal(t.exitPx, 8.5); assert.ok(t.R < -1);
});

test('when stop and target both fit inside one bar the loss is assumed', () => {
  const [t] = run({ l: { [E + 1]: 8.9 }, h: { [E + 1]: 13 } });
  assert.equal(t.why, 'stop'); assert.equal(t.exitPx, 9); assert.ok(Math.abs(t.R + 1) < 1e-12);
});

test('on an estimated bar only the close counts: its made-up low cannot trigger the stop', () => {
  const [t] = run({ est: { [E + 1]: true }, l: { [E + 1]: 5 }, c: { [E + 1]: 9.8 } });
  assert.notEqual(t.why, 'stop'); // the close 9.8 is above the stop 9, so the trade continues to the time exit
  assert.equal(t.why, 'time');
});

test('no entry when the next session is estimated, or when the stock was suspended for weeks', () => {
  assert.equal(run({ est: { [E]: true } }).length, 0);
  const { s, f } = flat(); for (let i = E; i < N; i++) s.d[i] = date(i + 40);
  assert.equal(simulateStock(s, f, only(SIG), { costs: free }).length, 0);
});

test('commission and slippage are charged on both sides', () => {
  const costs = { commission: 0.0015, slipTiers: [[0, 0.001]], stopSlipMult: 2, minAvgVal: 0 };
  const [t] = run({ h: { [E + 1]: 12.5 } }, { costs });
  const paid = 10 * 1.001 * 1.0015, received = 12 * 0.999 * 0.9985;
  assert.ok(Math.abs(t.ret - (received / paid - 1)) < 1e-12);
  assert.ok(t.ret < 0.2, 'net return is below the gross 20%');
});

test('stock too illiquid, bar flagged, or still inside the warm-up: no trade', () => {
  const { s, f } = flat(); f.avgVal20.fill(1e5);
  assert.equal(simulateStock(s, f, only(SIG), { costs: COSTS }).length, 0);
  assert.equal(run({ flag: { [SIG]: true } }, { costs: COSTS }).length, 0);
  const early = flat(); assert.equal(simulateStock(early.s, early.f, only(WARMUP - 1), { costs: free }).length, 0);
});

test('a trade still open when the data ends is not counted', () => {
  const { s, f } = flat();
  assert.equal(simulateStock(s, f, only(N - 3), { costs: free, exit: { ...EXITS.target, maxBars: 99 } }).length, 0);
});

test('the account never holds more positions than its limit and equity starts at the account size', () => {
  const stocks = new Map(), trades = [];
  for (let k = 0; k < 15; k++) {
    const { s } = flat(); s.symbol = `S${k}`; stocks.set(s.symbol, s);
    trades.push({ symbol: s.symbol, entryDate: date(E), exitDate: date(E + 5), entry: 10, ret: 0.05, riskPct: 0.1, avgVal: 1e9 - k });
  }
  const r = runPortfolio(trades, stocks, Array.from({ length: 20 }, (_, i) => date(E - 1 + i)), { equity: 1e6, riskPct: 0.01, maxPositions: 10, maxPositionPct: 0.15, capacityPct: 0.05, minAllocPct: 0.005 });
  assert.equal(r.taken, 10); assert.equal(r.skipped, 5); assert.equal(r.curve[0].equity, 1e6);
  assert.ok(r.curve.at(-1).equity > 1e6);
});

// ---- no look-ahead: a signal at bar i must not change when every later bar is removed ----
test('every strategy gives the same signal with the future removed (real candles)', async () => {
  const dir = new URL('../dist/ohlc/', import.meta.url);
  for (const symbol of ['2222', '1120', '2010']) {
    const file = await readCandles(dir, symbol);
    const mk = f => ({ symbol, sector: 'x', d: f.d, o: f.o, h: f.h, l: f.l, c: f.c, v: f.v, est: f.d.map(() => false), flag: f.d.map(() => false), val: f.c.map((c, i) => c * f.v[i]) });
    const full = mk(file);
    const mkt = marketContext(buildIndex([{ ...full, shares: 1 }], { cap: 1 }));
    const ff = computeFeatures(full, mkt);
    // the cross-sectional rank needs every stock, so it is held constant here; it is a per-date rank of that date's own return
    ff.rsRank = ff.rsRank.map(() => 90);
    for (let i = 300; i < full.d.length; i += 37) {
      const cut = mk({ d: file.d.slice(0, i + 1), o: file.o.slice(0, i + 1), h: file.h.slice(0, i + 1), l: file.l.slice(0, i + 1), c: file.c.slice(0, i + 1), v: file.v.slice(0, i + 1) });
      const fc = computeFeatures(cut, mkt);
      fc.rsRank = ff.rsRank.slice(0, i + 1);
      for (const [name, fn] of Object.entries(STRATEGIES)) {
        assert.equal(fn(cut, fc, i), fn(full, ff, i), `${symbol} ${name} at ${full.d[i]} changed when the future was removed`);
      }
    }
  }
});

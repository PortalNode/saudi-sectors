// Per-stock feature arrays used by every strategy. Index i of every array depends only on bars 0..i
// (tests/scanner-backtest.test.mjs checks this by truncation), so a signal read at bar i is a signal
// that existed at that day's close.
import * as I from '../../dist/scanner/indicators.mjs';

// Market regime per market date from the approximate index: up / down / side / na (not enough history).
export function marketContext(market) {
  const sma200 = I.sma(market.level, 200), slope = I.slope(sma200, 20);
  const regime = market.level.map((x, t) => sma200[t] == null || slope[t] == null ? 'na' : x > sma200[t] && slope[t] > 0 ? 'up' : x < sma200[t] && slope[t] < 0 ? 'down' : 'side');
  return { ...market, sma200, regime, roc63: I.roc(market.level, 63), roc126: I.roc(market.level, 126) };
}

const countTrue = (flags, n) => { const out = []; let run = 0; flags.forEach((x, i) => { run += x ? 1 : 0; if (i >= n) run -= flags[i - n] ? 1 : 0; out.push(run); }); return out; };
const shift = (a, k) => a.map((_, i) => i >= k ? a[i - k] : null);

export function computeFeatures(s, mkt, sectorMkt = null) {
  const at = (m, arr) => s.d.map(d => { const p = m.pos.get(d); return p == null ? null : arr[p]; });
  const idx = at(mkt, mkt.level), idxRoc63 = at(mkt, mkt.roc63), idxRoc126 = at(mkt, mkt.roc126), regime = at(mkt, mkt.regime);
  const secLevel = sectorMkt ? at(sectorMkt, sectorMkt.level) : null;
  const roc63 = I.roc(s.c, 63), roc126 = I.roc(s.c, 126);
  const bb = I.bollinger(s.c, 20, 2), bbWidth = bb.map(b => b ? b.width : null);
  const sma50 = I.sma(s.c, 50), sma200 = I.sma(s.c, 200);
  const avgVol20 = I.sma(s.v, 20), avgVal20 = I.sma(s.val, 20);
  const secRoc63 = secLevel ? I.roc(secLevel, 63) : null;
  return {
    n: s.d.length, regime,
    sma20: I.sma(s.c, 20), sma50, sma200, ema20: I.ema(s.c, 20),
    sma50Slope: I.slope(sma50, 20), sma200Slope: I.slope(sma200, 20),
    rsi: I.rsi(s.c, 14), macd: I.macd(s.c), atr: I.atr(s.h, s.l, s.c, 14), adx: I.adx(s.h, s.l, s.c, 14),
    roc63, roc126, rsVsMarket63: roc63.map((r, i) => r != null && idxRoc63[i] != null ? r - idxRoc63[i] : null),
    rsVsSector63: secRoc63 ? roc63.map((r, i) => r != null && secRoc63[i] != null ? r - secRoc63[i] : null) : null,
    idxRoc126, rs126: roc126.map((r, i) => r != null && idxRoc126[i] != null ? r - idxRoc126[i] : null),
    hh20: I.priorHighest(s.c, 20), hh40: I.priorHighest(s.c, 40), hh55: I.priorHighest(s.c, 55), hh60: I.priorHighest(s.c, 60),
    ll60: I.priorLowest(s.l, 60), ll20: I.priorLowest(s.l, 20),
    bbUp: bb.map(b => b ? b.up : null), bbWidth, bbRank: I.percentRank(bbWidth, 120),
    // average of the 20 sessions BEFORE bar i, so "today's volume vs normal" does not include today
    avgVol20Prev: shift(avgVol20, 1), avgVal20, avgVal60: I.sma(s.val, 60),
    nEst20: countTrue(s.est, 20), nFlag20: countTrue(s.flag, 20),
    rsRank: new Array(s.d.length).fill(null), // filled by addRsRank()
  };
}

// Cross-sectional rank (0..100) of each stock's 126-day return among the stocks that have one that day.
export function addRsRank(stocks, feats) {
  const byDate = new Map();
  stocks.forEach((s, k) => s.d.forEach((d, i) => { const r = feats[k].roc126[i]; if (r == null || s.est[i]) return; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([r, k, i]); }));
  for (const rows of byDate.values()) {
    if (rows.length < 20) continue;
    rows.sort((a, b) => a[0] - b[0]);
    rows.forEach(([, k, i], pos) => { feats[k].rsRank[i] = 100 * pos / (rows.length - 1); });
  }
}

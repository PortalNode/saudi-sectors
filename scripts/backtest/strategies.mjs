// The strategies under test. Each is a pure function of (stock, features, i): does a signal exist at
// the CLOSE of bar i? Entry is simulated at the next open by engine.mjs. Parameters are fixed here,
// before any result was looked at; sensitivity.mjs varies them to see whether a result survives.
// Long only: the Saudi retail market has no short selling, so a "sell" signal is an exit, not a trade.

const ok = (...xs) => xs.every(x => x != null && Number.isFinite(x));

export const DEFAULTS = {
  breakout: { n: 55 },
  pullback: { touch: 0.01 },
  squeeze: { rank: 20, lookback: 5, n: 20 },
  reversal: { n: 60, near: 0.02, rsiBelow: 40 },
  rs: { minRank: 80, n: 20 },
  cross: { fast: 20, slow: 50 },
  base: { n: 60, maxWidth: 0.25 },
  volume: { n: 55, mult: 2 },
};

export const STRATEGIES = {
  // 1. A close above the highest close of the previous 55 sessions, inside an established uptrend.
  breakout: (s, f, i, p = DEFAULTS.breakout) => {
    const hh = p.n === 55 ? f.hh55[i] : p.n === 40 ? f.hh40[i] : p.n === 20 ? f.hh20[i] : f.hh60[i];
    return ok(hh, f.sma50[i], f.sma200[i]) && s.c[i] > hh && f.sma50[i] > f.sma200[i] && s.c[i] > f.sma50[i];
  },
  // 2. In an uptrend (50 above 200, 50 rising) price dips to the 20-day average and closes back above it on a rising candle.
  pullback: (s, f, i, p = DEFAULTS.pullback) =>
    ok(f.sma20[i], f.sma50[i], f.sma200[i], f.sma50Slope[i]) && f.sma50[i] > f.sma200[i] && f.sma50Slope[i] > 0 &&
    s.l[i] <= f.sma20[i] * (1 + p.touch) && s.c[i] > f.sma20[i] && s.c[i] > s.o[i] && s.c[i] > s.c[i - 1] && s.c[i] > f.sma50[i],
  // 3. Volatility squeeze (Bollinger width in its lowest range of the last 120 sessions within the last few bars), then a close above the 20-day high.
  squeeze: (s, f, i, p = DEFAULTS.squeeze) => {
    if (!ok(f.hh20[i], f.sma200[i])) return false;
    let squeezed = false;
    for (let k = 1; k <= p.lookback; k++) if (f.bbRank[i - k] != null && f.bbRank[i - k] <= p.rank) squeezed = true;
    return squeezed && s.c[i] > f.hh20[i] && s.c[i] > f.sma200[i];
  },
  // 4. Reversal from support: price tags the 60-day low area, RSI was oversold and turns up, and a candle closes above the prior high.
  reversal: (s, f, i, p = DEFAULTS.reversal) =>
    ok(f.ll60[i], f.rsi[i], f.rsi[i - 1]) && s.l[i] <= f.ll60[i] * (1 + p.near) && f.rsi[i - 1] < p.rsiBelow && f.rsi[i] > f.rsi[i - 1] &&
    s.c[i] > s.o[i] && s.c[i] > s.h[i - 1],
  // 5. Relative strength: top-ranked 126-day return, beating the market over 63 days, in an uptrend, on a fresh 20-day high.
  rs: (s, f, i, p = DEFAULTS.rs) =>
    ok(f.rsRank[i], f.rsVsMarket63[i], f.hh20[i], f.sma50[i], f.sma200[i]) && f.rsRank[i] >= p.minRank && f.rsVsMarket63[i] > 0 &&
    f.sma50[i] > f.sma200[i] && s.c[i] > f.hh20[i],
  // 6. 20/50 average cross up inside a long-term uptrend (price above a rising 200-day average).
  cross: (s, f, i, p = DEFAULTS.cross) => {
    const a = p.fast === 20 ? f.sma20 : f.sma50, b = p.slow === 50 ? f.sma50 : f.sma200;
    return ok(a[i], b[i], a[i - 1], b[i - 1], f.sma200[i], f.sma200Slope[i]) && a[i - 1] <= b[i - 1] && a[i] > b[i] && s.c[i] > f.sma200[i] && f.sma200Slope[i] > 0;
  },
  // 7. Breakout from a long, tight base: the last 60 closes sit within a 25% band and today closes above their high.
  base: (s, f, i, p = DEFAULTS.base) => {
    if (i < p.n + 1 || !ok(f.sma200[i])) return false;
    const hh = p.n === 60 ? f.hh60[i] : f.hh40[i];
    if (!ok(hh)) return false;
    let lo = Infinity; for (let k = i - p.n; k < i; k++) lo = Math.min(lo, s.c[k]);
    return (hh - lo) / hh <= p.maxWidth && s.c[i] > hh;
  },
  // 8. Breakout (as 1) on at least `mult` times the previous 20-day average volume.
  volume: (s, f, i, p = DEFAULTS.volume) =>
    STRATEGIES.breakout(s, f, i, { n: p.n }) && ok(f.avgVol20Prev[i]) && f.avgVol20Prev[i] > 0 && s.v[i] >= p.mult * f.avgVol20Prev[i],
};

export const NAMES = {
  breakout: 'اختراق المقاومة', pullback: 'ارتداد من المتوسط', squeeze: 'انكماش التذبذب ثم اختراق', reversal: 'انعكاس من الدعم',
  rs: 'القوة النسبية', cross: 'تقاطع المتوسطات', base: 'اختراق قاعدة سعرية', volume: 'اختراق بحجم مرتفع',
};

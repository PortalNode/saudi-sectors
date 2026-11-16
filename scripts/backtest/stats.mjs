// Statistics over a list of simulated trades (net of costs) and over a portfolio equity curve.
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = a => { if (!a.length) return 0; const x = [...a].sort((p, q) => p - q); return x.length % 2 ? x[x.length >> 1] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2; };

export function summarize(trades) {
  const n = trades.length, wins = trades.filter(t => t.ret > 0), losses = trades.filter(t => t.ret <= 0);
  const gw = wins.reduce((a, t) => a + t.ret, 0), gl = -losses.reduce((a, t) => a + t.ret, 0);
  return {
    n, winRate: n ? wins.length / n : null,
    avgWin: wins.length ? mean(wins.map(t => t.ret)) : null, avgLoss: losses.length ? mean(losses.map(t => t.ret)) : null,
    profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null),
    avgRet: n ? mean(trades.map(t => t.ret)) : null, medianRet: n ? median(trades.map(t => t.ret)) : null,
    expectancyR: n ? mean(trades.map(t => t.R)) : null, avgBars: n ? mean(trades.map(t => t.bars)) : null,
  };
}

export function groupBy(trades, keyFn) {
  const m = new Map(); for (const t of trades) { const k = keyFn(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return m;
}

// Bootstrap-free quick significance guide: standard error of the mean trade return (not a p-value).
export function tStat(trades) {
  const r = trades.map(t => t.ret), n = r.length; if (n < 2) return null;
  const m = mean(r), sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  return sd ? m / (sd / Math.sqrt(n)) : null;
}

// t-statistic of the mean trade return after averaging within each signal month. Trades signalled in the
// same month are driven by the same market, so they are not independent; this is the safer figure.
export function tStatClustered(trades, keyFn = t => t.signalDate.slice(0, 7)) {
  const groups = [...groupBy(trades, keyFn).values()].map(g => mean(g.map(t => t.ret)));
  const n = groups.length; if (n < 3) return null;
  const m = mean(groups), sd = Math.sqrt(groups.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  return sd ? m / (sd / Math.sqrt(n)) : null;
}

/** Equity-curve statistics from daily equity values ({date, equity}[]). */
export function curveStats(curve) {
  if (curve.length < 2) return { totalReturn: null, cagr: null, maxDrawdown: null };
  const first = curve[0], last = curve.at(-1);
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 864e5);
  let peak = first.equity, mdd = 0;
  for (const p of curve) { peak = Math.max(peak, p.equity); mdd = Math.min(mdd, p.equity / peak - 1); }
  const total = last.equity / first.equity - 1;
  return { totalReturn: total, cagr: years > 0 ? (1 + total) ** (1 / years) - 1 : null, maxDrawdown: mdd };
}

export const pct = (x, d = 1) => x == null ? '—' : `${(100 * x).toFixed(d)}%`;
export const num = (x, d = 2) => x == null ? '—' : x === Infinity ? '∞' : x.toFixed(d);

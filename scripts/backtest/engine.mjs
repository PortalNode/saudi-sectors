// Turns a strategy's signals into simulated trades for one stock. The rules that keep it honest:
//  * a signal is read at the CLOSE of bar i; the order fills at the OPEN of bar i+1 (never at the close that made the signal)
//  * entry is skipped when bar i+1 is an estimated session (its open is not a real price) or follows a long gap
//  * inside a bar the stop is tested before the target, so when both fit in one bar the loss is assumed (worst case)
//  * a gap through the stop fills at the open, not at the stop price
//  * on an estimated bar only the (official) close is trusted: stops and trailing stops use it alone
//  * commission and a liquidity-dependent slippage are charged on both sides; stop orders slip twice as much
import { usable } from './data.mjs';

export const COSTS = {
  commission: 0.0015,                 // per side, VAT included (an assumption: confirm with your broker)
  slipTiers: [[10e6, 0.001], [2e6, 0.002], [0, 0.004]], // [min 20-day average value in SAR, slippage per side]
  stopSlipMult: 2,
  minAvgVal: 1e6,                     // a stock trading under 1M SAR a day on average is not tradable
};
export const EXITS = {
  target: { stopAtr: 2, targetR: 2, trailAtr: 0, maxBars: 30 },
  trail: { stopAtr: 2, targetR: 0, trailAtr: 3, maxBars: 80 },
};
export const WARMUP = 250; // sessions needed before any signal (200-day average plus a margin)

const slipFor = (avgVal, costs) => { for (const [min, slip] of costs.slipTiers) if (avgVal >= min) return slip; return costs.slipTiers.at(-1)[1]; };
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Is a signal at bar i allowed to be traded at all? (data quality + liquidity, nothing about price direction) */
export function eligible(s, f, i, costs = COSTS) {
  return i >= WARMUP && usable(s, i) && f.avgVal20[i] != null && f.avgVal20[i] >= costs.minAvgVal && f.nEst20[i] <= 3 && f.nFlag20[i] === 0 && f.atr[i] > 0;
}

export function simulateStock(s, f, signal, { exit = EXITS.target, costs = COSTS, from = '0000', to = '9999', cooldown = 10, eligibleFn = eligible } = {}) {
  const trades = [], n = s.d.length;
  let blockedUntil = -1;
  for (let i = WARMUP; i < n - 1; i++) {
    if (i <= blockedUntil || s.d[i] < from || s.d[i] > to) continue;
    if (!eligibleFn(s, f, i, costs) || !signal(s, f, i)) continue;
    const e = i + 1;
    if (s.est[e] || daysBetween(s.d[i], s.d[e]) > 10 || !(s.o[e] > 0)) continue;
    const slip = slipFor(f.avgVal20[i], costs), atr = f.atr[i];
    const entry = s.o[e], paid = entry * (1 + slip) * (1 + costs.commission);
    let stop = entry - exit.stopAtr * atr;
    if (!(stop > 0)) continue;
    const risk = entry - stop, target = exit.targetR ? entry + exit.targetR * risk : null;
    let hc = entry, out = null;
    for (let j = e; j < n && !out; j++) {
      const real = !s.est[j];
      let px = null, why = null;
      if (real && j > e && s.o[j] <= stop) { px = s.o[j]; why = 'gap-stop'; }
      else if (real && s.l[j] <= stop) { px = stop; why = 'stop'; }
      else if (!real && j > e && s.c[j] <= stop) { px = s.c[j]; why = 'stop'; }
      else if (real && target && s.h[j] >= target) { px = j > e ? Math.max(target, s.o[j]) : target; why = 'target'; }
      else if (j - e >= exit.maxBars) { px = s.c[j]; why = 'time'; }
      if (px != null) { out = { j, px, why }; break; }
      if (exit.trailAtr) { hc = Math.max(hc, s.c[j]); stop = Math.max(stop, hc - exit.trailAtr * atr); }
    }
    if (!out) break; // still open at the end of the data: not a completed trade, not counted
    const exitSlip = (out.why === 'stop' || out.why === 'gap-stop' ? costs.stopSlipMult : 1) * slip;
    const received = out.px * (1 - exitSlip) * (1 - costs.commission);
    trades.push({
      symbol: s.symbol, sector: s.sector, signalDate: s.d[i], entryDate: s.d[e], exitDate: s.d[out.j],
      entryIdx: e, exitIdx: out.j, entry, stop: entry - exit.stopAtr * atr, exitPx: out.px, why: out.why, bars: out.j - e + 1,
      ret: received / paid - 1, R: (received - paid) / risk, riskPct: risk / entry, avgVal: f.avgVal20[i], regime: f.regime[i] || 'na',
    });
    blockedUntil = Math.max(out.j, i + cooldown);
  }
  return trades;
}

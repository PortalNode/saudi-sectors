// Turns a list of simulated trades into one account: fixed fractional risk per trade, a cap on the number
// of simultaneous positions, a cap on each position and on how much of a stock's daily value it may use.
// Trades are never stacked on top of each other: when more signals arrive than there are free slots, the
// order is `priority`: 'random' (seeded, the neutral default: no skill in picking is assumed) or 'liquidity'
// (most liquid first; kept for reference, it tilts the account toward large caps).
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
import { curveStats } from './stats.mjs';

export const ACCOUNT = { priority: 'random', seed: 1, equity: 1_000_000, riskPct: 0.01, maxPositions: 10, maxPositionPct: 0.15, capacityPct: 0.05, minAllocPct: 0.005 };

export function runPortfolio(trades, stocksBySymbol, dates, account = ACCOUNT) {
  const lookup = new Map();
  const at = sym => { if (!lookup.has(sym)) lookup.set(sym, new Map(stocksBySymbol.get(sym).d.map((d, i) => [d, i]))); return lookup.get(sym); };
  const entries = new Map(), exits = new Map();
  for (const t of trades) {
    if (!entries.has(t.entryDate)) entries.set(t.entryDate, []); entries.get(t.entryDate).push(t);
  }
  const rand = rng(account.seed || 1);
  let cash = account.equity;
  const open = []; const curve = []; const takenTrades = []; let taken = 0, skipped = 0;
  for (const d of dates) {
    // 1. fills at today's open
    const todays = (entries.get(d) || []).map(t => ({ t, k: account.priority === 'liquidity' ? -t.avgVal : rand() })).sort((a, b) => a.k - b.k).map(x => x.t);
    for (const t of todays) {
      const equityNow = cash + open.reduce((a, p) => a + p.value, 0);
      if (open.length >= account.maxPositions) { skipped += 1; continue; }
      const alloc = Math.min(account.riskPct * equityNow / t.riskPct, account.maxPositionPct * equityNow, account.capacityPct * t.avgVal, cash);
      if (alloc < account.minAllocPct * equityNow) { skipped += 1; continue; }
      cash -= alloc; taken += 1; takenTrades.push({ ...t, alloc });
      open.push({ t, invested: alloc, value: alloc });
    }
    // 2. exits at today's exit price (positions entered and stopped the same day close here too)
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k];
      if (p.t.exitDate !== d) continue;
      cash += p.invested * (1 + p.t.ret); open.splice(k, 1);
    }
    // 3. mark what is still open to today's close
    for (const p of open) {
      const s = stocksBySymbol.get(p.t.symbol), i = at(p.t.symbol).get(d);
      if (i != null) p.value = p.invested * (s.c[i] / p.t.entry);
    }
    curve.push({ date: d, equity: cash + open.reduce((a, p) => a + p.value, 0) });
  }
  return { curve, taken, skipped, takenTrades, ...curveStats(curve) };
}

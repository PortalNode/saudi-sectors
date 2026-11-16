// Builds a market index and sector indices from the stocks themselves. The repo has no daily TASI
// series (Yahoo only serves TASI monthly), so this is an APPROXIMATION and is labelled as such:
//   * weights: previous close x today's share count (prices are already adjusted for capital actions,
//     so this is market capitalisation in today's share terms), each weight capped at `cap` (10%, chosen by closeness to the real TASI, not to strategy results)
//   * only today's 272 listed stocks exist, so it carries survivorship bias
//   * a stock contributes on a day only if its previous bar is the previous market session and neither bar
//     is a flagged jump. ESTIMATED bars are kept: they estimate open/high/low/volume only, the close is the
//     official close (dropping them removed whole-market sessions and inflated the index by ~20 points)
// validate-index.mjs compares it with the real monthly TASI series and the official YTD / 1Y figures.

// Caps every weight at `cap` and hands the excess to the stocks still under it, repeating until none
// exceeds it. If the cap is infeasible (fewer than 1/cap stocks) the weights become equal.
export function capWeights(weights, cap) {
  const n = weights.length;
  if (n * cap < 1) return weights.map(() => 1 / n);
  const w = [...weights], fixed = new Array(n).fill(false);
  for (let round = 0; round < n; round++) {
    let free = 0, freeSum = 0, excess = 0, over = false;
    for (let i = 0; i < n; i++) { if (fixed[i]) continue; if (w[i] > cap) { excess += w[i] - cap; w[i] = cap; fixed[i] = true; over = true; } else { free += 1; freeSum += w[i]; } }
    if (!over || !free) break;
    for (let i = 0; i < n; i++) if (!fixed[i]) w[i] += freeSum ? excess * w[i] / freeSum : excess / free;
  }
  return w;
}

export function buildIndex(stocks, { cap = 0.1, start = '2010-01-01' } = {}) {
  const dates = [...new Set(stocks.flatMap(s => s.d))].filter(d => d >= start).sort();
  const pos = new Map(dates.map((d, i) => [d, i]));
  const rows = stocks.map(s => ({ s, at: new Map(s.d.map((d, i) => [d, i])) }));
  const level = [100], ret = [null];
  for (let t = 1; t < dates.length; t++) {
    const parts = [];
    for (const { s, at } of rows) {
      const i = at.get(dates[t]), j = at.get(dates[t - 1]);
      if (i == null || j == null || j !== i - 1 || s.flag[i] || s.flag[j] || !s.shares) continue;
      parts.push({ w: s.c[j] * s.shares, r: s.c[i] / s.c[j] - 1 });
    }
    const total = parts.reduce((a, p) => a + p.w, 0);
    let r = 0;
    if (total > 0) {
      const w = capWeights(parts.map(p => p.w / total), cap);
      r = parts.reduce((a, p, k) => a + w[k] * p.r, 0);
    }
    ret.push(total > 0 ? r : 0);
    level.push(level[t - 1] * (1 + ret[t]));
  }
  return { dates, level, ret, pos };
}

export function buildSectorIndices(stocks, options) {
  const bySector = new Map();
  for (const s of stocks) { if (!bySector.has(s.sector)) bySector.set(s.sector, []); bySector.get(s.sector).push(s); }
  const out = new Map();
  for (const [name, list] of bySector) if (list.length >= 3) out.set(name, buildIndex(list, options));
  return out;
}

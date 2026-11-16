// Data-quality audit that decides what the backtests may trust. Run: node scripts/backtest/audit.mjs
// Prints year-by-year coverage and quality so the research window is chosen from evidence, not habit.
import { loadStocks } from './data.mjs';

const { stocks, priceDate } = await loadStocks();
const years = {};
const bucket = y => (years[y] ||= { stocks: new Set(), bars: 0, est: 0, flag: 0, zeroVol: 0, tradedValues: [] });
for (const s of stocks) {
  s.d.forEach((d, i) => {
    const b = bucket(d.slice(0, 4));
    b.stocks.add(s.symbol); b.bars += 1;
    if (s.est[i]) b.est += 1;
    if (s.flag[i]) b.flag += 1;
    if (!s.v[i]) b.zeroVol += 1;
    if (s.v[i] > 0 && !s.est[i]) b.tradedValues.push(s.val[i]);
  });
}
const med = a => { if (!a.length) return 0; const x = [...a].sort((p, q) => p - q); return x[x.length >> 1]; };
console.log('year  stocks     bars  est%  flag%  zeroVol%  median daily value (SAR)');
for (const y of Object.keys(years).sort()) {
  const b = years[y];
  console.log(`${y}  ${String(b.stocks.size).padStart(6)} ${String(b.bars).padStart(8)}  ${(100 * b.est / b.bars).toFixed(1).padStart(4)}  ${(100 * b.flag / b.bars).toFixed(2).padStart(5)}  ${(100 * b.zeroVol / b.bars).toFixed(1).padStart(8)}  ${Math.round(med(b.tradedValues)).toLocaleString('en')}`);
}
const latest = stocks.map(s => s.d.at(-1)).sort().at(-1);
const stale = stocks.filter(s => s.d.at(-1) < latest);
console.log(`\nstocks: ${stocks.length}; newest bar ${latest} (data.json priceDate ${priceDate}); stale (last bar older): ${stale.map(s => `${s.symbol}@${s.d.at(-1)}`).join(', ') || 'none'}`);
const young = stocks.filter(s => s.d.length < 260).map(s => `${s.symbol}(${s.d.length})`);
console.log(`stocks with < 260 bars (too short for 200-day logic): ${young.length} -> ${young.join(' ')}`);
// duplicate or non-increasing dates would corrupt every rolling window
let bad = 0; for (const s of stocks) for (let i = 1; i < s.d.length; i++) if (s.d[i] <= s.d[i - 1]) bad += 1;
console.log(`non-increasing date pairs: ${bad}`);

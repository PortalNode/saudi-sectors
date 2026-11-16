// Checks the approximate market index against real TASI data. Run: node scripts/backtest/validate-index.mjs
// Reference 1: Yahoo's monthly ^TASI.SR series (read-only public request).
// Reference 2: the official YTD / 3M / 6M / 1Y performance in dist/data.json (marketSummary).
import { loadStocks } from './data.mjs';
import { buildIndex } from './market.mjs';

const { stocks, marketSummary } = await loadStocks();
const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETASI.SR?range=max&interval=1mo', { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
const r = (await res.json()).chart.result[0];
const month = new Map(); r.timestamp.forEach((t, i) => { const c = r.indicators.quote[0].close[i]; if (c) month.set(new Date(t * 1000 + 3 * 3600e3).toISOString().slice(0, 7), c); });
const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };

for (const cap of [0.05, 0.1, 0.2, 1]) {
  const idx = buildIndex(stocks, { cap, start: '2014-01-01' });
  // month-end level of the proxy
  const end = new Map(); idx.dates.forEach((d, i) => end.set(d.slice(0, 7), idx.level[i]));
  const months = [...end.keys()].filter(m => month.has(m)).sort();
  const pr = [], tr = [];
  for (let i = 1; i < months.length; i++) { pr.push(end.get(months[i]) / end.get(months[i - 1]) - 1); tr.push(month.get(months[i]) / month.get(months[i - 1]) - 1); }
  const te = Math.sqrt(pr.reduce((a, x, i) => a + (x - tr[i]) ** 2, 0) / pr.length);
  const L = idx.level, D = idx.dates, last = L.at(-1), back = ym => { const k = D.findIndex(d => d >= ym); return L[k]; };
  const yearStart = back(`${D.at(-1).slice(0, 4)}-01-01`), y1 = back(new Date(Date.parse(D.at(-1)) - 365 * 864e5).toISOString().slice(0, 10));
  console.log(`cap ${cap}: monthly corr ${corr(pr, tr).toFixed(3)}, tracking error ${(100 * te).toFixed(2)}%/month over ${pr.length} months | proxy YTD ${(100 * (last / yearStart - 1)).toFixed(1)}% vs official ${marketSummary.ytd}% | 1Y ${(100 * (last / y1 - 1)).toFixed(1)}% vs ${marketSummary.year1}%`);
}

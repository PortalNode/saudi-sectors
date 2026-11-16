#!/usr/bin/env node
// Compare the chart's candles with TradingView's own figures for every stock: 52-week high/low,
// 6-month high/low, SMA50, SMA200, EMA20 and RSI(14), all of which TradingView computes on its own
// (adjusted) history. Its screener performance figures (Perf.*) are left out: their base day varies
// from stock to stock, so they do not test the candles. A mismatch means our candles differ from TradingView's.
// Usage: node scripts/compare-ohlc-tradingview.mjs [dir=dist/ohlc] [symbols]
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../dist/', import.meta.url);
const [dir, list] = [process.argv[2] || new URL('ohlc', root).pathname, process.argv[3]];
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() {} }, Intl, Math, JSON, Date, Number, Set, Map, Promise, console, structuredClone };
vm.runInNewContext(readFileSync(new URL('company-chart.js', root), 'utf8'), ctx);
const calc = ctx.window.CompanyChart.calc;
const syms = list ? list.split(',') : readdirSync(dir).filter(f => /^\d{4}\.json$/.test(f)).map(f => f.slice(0, 4));
const cols = ['price_52_week_high', 'price_52_week_low', 'SMA50', 'SMA200', 'EMA20', 'RSI', 'High.6M', 'Low.6M'];
// TradingView's windows run back from today (Riyadh), not from the last candle.
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const tv = new Map();
for (let i = 0; i < syms.length; i += 100) {
  const j = await fetch('https://scanner.tradingview.com/ksa/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: { tickers: syms.slice(i, i + 100).map(s => 'TADAWUL:' + s) }, columns: cols }) }).then(r => r.json());
  for (const r of j.data) tv.set(r.s.slice(8), r.d);
}
const back = (last, months) => { const d = new Date(last + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); };
const backY = (last) => { const d = new Date(last + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); };
const tol = { price_52_week_high: 0.006, price_52_week_low: 0.006, SMA50: 0.003, SMA200: 0.003, EMA20: 0.003, RSI: 1.0, 'High.6M': 0.006, 'Low.6M': 0.006 };
const bad = Object.fromEntries(cols.map(c => [c, 0])), ex = [];
let n = 0;
for (const s of syms) {
  const t = tv.get(s); if (!t) continue;
  const f = JSON.parse(readFileSync(`${dir}/${s}.json`)); const last = f.d.at(-1); n++;
  const idx = from => f.d.map((d, i) => i).filter(i => f.d[i] > from);
  // TradingView's windows: 52 weeks = 364 days and 6 months = 180 days back from today, inclusive.
  const daysBack = n => new Date(Date.parse(today + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
  const y = idx(daysBack(365)), m6 = idx(daysBack(181));
  const ours = {
    price_52_week_high: Math.max(...y.map(i => f.h[i])), price_52_week_low: Math.min(...y.map(i => f.l[i])),
    SMA50: calc.sma(f.c, 50).at(-1), SMA200: calc.sma(f.c, 200).at(-1), EMA20: calc.ema(f.c, 20).at(-1), RSI: calc.rsi(f.c, 14).at(-1),
    'High.6M': Math.max(...m6.map(i => f.h[i])), 'Low.6M': Math.min(...m6.map(i => f.l[i]))
  };
  cols.forEach((c, j) => {
    const a = ours[c], b = t[j]; if (a == null || b == null) return;
    const off = c === 'RSI' ? Math.abs(a - b) : Math.abs(a / b - 1);
    if (off > tol[c]) { bad[c]++; if (ex.length < 25) ex.push(`${s} ${c}: ours ${(+a).toFixed(3)} tv ${(+b).toFixed(3)}`); }
  });
}
console.log('stocks', n, 'mismatches', JSON.stringify(bad)); console.log(ex.join('\n'));

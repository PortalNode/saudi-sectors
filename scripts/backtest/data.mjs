// Loads the stored candles into one in-memory universe for research. Read-only; nothing here writes
// to dist/. Each stock keeps the file's columnar arrays plus two per-bar quality masks:
//   est[i]  — the session is an estimate (flat candle / zero volume), so its volume and range are not real
//   flag[i] — the move into this bar is an unexplained jump the data pipeline flagged
// Backtests refuse to trade on bars where these are set (see usable()).
import { readFileSync, readdirSync } from 'node:fs';
import { readCandles } from '../ohlc-files.mjs';

export const DIST = new URL('../../dist/', import.meta.url);
export const OHLC_DIR = new URL('ohlc/', DIST);

export function loadMarket() {
  const data = JSON.parse(readFileSync(new URL('data.json', DIST), 'utf8'));
  const meta = new Map();
  for (const sector of data.sectors) for (const s of sector.stocks) meta.set(s.symbol, { symbol: s.symbol, name: s.name, sector: sector.name, suspended: !!s.suspended, marketCap: s.marketCap });
  return { data, meta };
}

export async function loadStocks() {
  const { data, meta } = loadMarket();
  const stocks = [];
  for (const [symbol, m] of meta) {
    const f = await readCandles(OHLC_DIR, symbol);
    if (!f || f.d.length < 2) continue;
    const est = new Set(f.est || []), flags = new Set((f.flags || []).map(x => x.date));
    stocks.push({
      ...m, d: f.d, o: f.o, h: f.h, l: f.l, c: f.c, v: f.v, div: f.div || [],
      est: f.d.map(x => est.has(x) || false),
      flag: f.d.map(x => flags.has(x)),
      // value traded in SAR, approximated per bar (the repo keeps no per-bar turnover)
      val: f.d.map((_, i) => f.c[i] * f.v[i]),
    });
  }
  return { stocks, marketSummary: data.marketSummary, priceDate: data.priceDate };
}

export const usable = (s, i) => !s.est[i] && !s.flag[i] && s.v[i] > 0;

export function listSymbols() { return readdirSync(OHLC_DIR).filter(f => /^\d+\.json$/.test(f)).map(f => f.slice(0, -5)); }

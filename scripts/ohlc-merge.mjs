// Pure helpers for dist/ohlc/<symbol>.json: five years of daily candles per stock.
// Source: Yahoo Finance daily bars. The official Saudi Exchange close (data.json) is final for its day;
// bad prints are removed and unadjusted capital actions are flagged for the chart.

export const YEARS = 5;
export const DAILY_LIMIT = 0.105; // Tadawul caps a session's move at ±10%
export const REVERT_WINDOW = 15;  // a jump that reverts within this many sessions is a bad print
const round2 = value => Math.round(value * 100) / 100;
const iso = (seconds, offsetSeconds = 10800) => new Date((seconds + offsetSeconds) * 1000).toISOString().slice(0, 10); // Riyadh
const validBar = b => /^\d{4}-\d{2}-\d{2}$/.test(b.d) && [b.o, b.h, b.l, b.c].every(x => Number.isFinite(x) && x > 0);

/** Yahoo chart JSON → bars. */
export function parseYahoo(json) {
  const r = json?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!Array.isArray(r?.timestamp) || !q) throw new Error('unexpected Yahoo chart shape');
  if (r.meta?.currency && r.meta.currency !== 'SAR') throw new Error(`unexpected currency ${r.meta.currency}`);
  return r.timestamp.map((t, i) => ({ d: iso(t, r.meta?.gmtoffset ?? 10800), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 })).filter(validBar);
}

/**
 * Sort, de-duplicate, keep the last YEARS years, end on the official close, drop bad prints and
 * flag the remaining impossible jumps (capital actions the source did not adjust for).
 */
export function cleanBars(input, { official = null, years = YEARS } = {}) {
  const byDate = new Map();
  for (const b of input) if (validBar(b)) byDate.set(b.d, { ...b });
  let bars = [...byDate.values()].sort((a, b) => a.d < b.d ? -1 : 1);
  if (official?.date && Number.isFinite(official.price) && official.price > 0) {
    // A session in progress is not a close: nothing after the last official close is kept.
    bars = bars.filter(b => b.d <= official.date);
    const last = bars.at(-1);
    if (last?.d === official.date) { last.c = official.price; last.h = Math.max(last.h, last.c); last.l = Math.min(last.l, last.c); }
  }
  if (bars.length) {
    const from = new Date(`${bars.at(-1).d}T12:00:00Z`); from.setUTCFullYear(from.getUTCFullYear() - years);
    const start = from.toISOString().slice(0, 10);
    bars = bars.filter(b => b.d >= start);
  }
  const dropped = new Set();
  for (let i = 1; i < bars.length; i++) {
    const base = bars[i - 1].c;
    if (Math.abs(bars[i].c / base - 1) <= DAILY_LIMIT) continue;
    for (let j = i + 1; j < Math.min(bars.length, i + REVERT_WINDOW); j++) {
      if (Math.abs(bars[j].c / base - 1) <= DAILY_LIMIT * 1.5 && Math.abs(bars[j].c / bars[j - 1].c - 1) > DAILY_LIMIT) {
        for (let k = i; k < j; k++) dropped.add(bars[k].d);
        i = j; break;
      }
    }
  }
  bars = bars.filter(b => !dropped.has(b.d)).map(b => ({ d: b.d, o: round2(b.o), h: round2(Math.max(b.h, b.o, b.c)), l: round2(Math.min(b.l, b.o, b.c)), c: round2(b.c), v: Math.round(b.v || 0) }));
  const flags = [];
  for (let i = 1; i < bars.length; i++) {
    const change = bars[i].c / bars[i - 1].c - 1;
    if (Math.abs(change) > DAILY_LIMIT) flags.push({ date: bars[i].d, change: round2(change * 100) });
  }
  return { bars, dropped: [...dropped], flags };
}

/** The file written for the page (column arrays keep it small). */
export function ohlcFile(symbol, source, official, { bars, dropped, flags }) {
  return { symbol, source, officialThrough: official?.date ?? null, dropped, flags,
    d: bars.map(b => b.d), o: bars.map(b => b.o), h: bars.map(b => b.h), l: bars.map(b => b.l), c: bars.map(b => b.c), v: bars.map(b => b.v) };
}

export function validOhlc(file) {
  if (!file || !/^\d{4}$/.test(file.symbol) || !Array.isArray(file.d) || file.d.length < 2) return false;
  const n = file.d.length;
  if (!['o', 'h', 'l', 'c', 'v'].every(k => Array.isArray(file[k]) && file[k].length === n)) return false;
  for (let i = 0; i < n; i++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(file.d[i]) || (i && file.d[i] <= file.d[i - 1])) return false;
    const [o, h, l, c] = [file.o[i], file.h[i], file.l[i], file.c[i]];
    if (![o, h, l, c].every(x => Number.isFinite(x) && x > 0) || h < Math.max(o, c) || l > Math.min(o, c) || !(file.v[i] >= 0)) return false;
  }
  return true;
}

// Pure helpers for dist/ohlc/<symbol>.json: five years of daily candles per stock.
// Source: Yahoo Finance daily bars. The official Saudi Exchange close (data.json) is final for its day;
// bad prints are removed and unadjusted capital actions are flagged for the chart.

export const YEARS = 5;
export const DAILY_LIMIT = 0.105; // Tadawul caps a session's move at ±10%
export const REVERT_WINDOW = 15;  // a jump that reverts within this many sessions is a bad print
const round2 = value => Math.round(value * 100) / 100;
export const round2Price = round2;
export const SOURCE = 'TradingView · إغلاق تداول السعودية الرسمي';
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
  // Rebuilt files (with `est`) never show a session the source did not receive as a flat bar.
  if (Array.isArray(file.est)) {
    const est = new Set(file.est);
    for (let i = 0; i < n; i++) if (!est.has(file.d[i]) && isFakeBar({ o: file.o[i], h: file.h[i], l: file.l[i], c: file.c[i], v: file.v[i] })) return false;
  }
  return true;
}

/* ---------- Candles as TradingView shows them ----------
 * TradingView's TADAWUL history is adjusted for every capital action (bonus shares, splits, capital
 * reductions, rights issues), not for cash dividends — the same basis as the Saudi Exchange's own
 * adjusted closes. Sessions and closes come from the exchange; Yahoo gives the open/high/low/volume.
 * Yahoo marks sessions it never received as a flat bar with no volume; those are never shown. */

/** A flat bar without volume: a session the source never received (or a suspended stock). */
export const isFakeBar = b => !(b.v > 0) && b.o === b.h && b.h === b.l && b.l === b.c;
const median = list => { const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dayOf = (seconds, offsetSeconds = 10800) => iso(seconds, offsetSeconds);

/** Saudi Exchange ChartGenerator (chart-type SQL_CI_CV_COM) → [{ d, c }]: every session's adjusted close. */
export function parseOfficialCloses(json) {
  if (!Array.isArray(json)) throw new Error('unexpected official chart shape');
  const byDate = new Map();
  for (const x of json) {
    const d = String(x?.dateTime ?? '').slice(0, 10), c = Number(x?.indexPrice);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(c) && c > 0) byDate.set(d, c);
  }
  if (byDate.size < 2) throw new Error('too few official closes');
  return [...byDate].sort(([a], [b]) => a < b ? -1 : 1).map(([d, c]) => ({ d, c }));
}

/** Yahoo 60-minute chart → one bar per Riyadh session. Open/high/low match the session; the close
 * and volume miss the closing auction, so only the open/high/low/volume are used (marked estimated). */
export function hourlyDays(json) {
  const days = new Map();
  for (const b of parseYahoo(json)) {
    const day = days.get(b.d);
    if (!day) days.set(b.d, { ...b });
    else { day.h = Math.max(day.h, b.h); day.l = Math.min(day.l, b.l); day.c = b.c; day.v += b.v; }
  }
  return days;
}

/** Scale factor (exchange adjusted price ÷ Yahoo price) for every official session. Constant between
 * capital actions, so it is the median of its stretch; a stretch ends where the factor steps. */
export function scaleFactors(official, daily, { step = 0.02 } = {}) {
  const points = [];
  official.forEach((x, i) => { const y = daily.get(x.d); if (y && !isFakeBar(y) && y.c > 0) points.push({ i, k: x.c / y.c }); });
  const k = new Array(official.length).fill(null);
  if (!points.length) return k;
  const dev = points.map((_, p) => {
    if (p < 3 || p > points.length - 3) return 0;
    const left = median(points.slice(p - 3, p).map(x => x.k)), right = median(points.slice(p, p + 3).map(x => x.k));
    return Math.abs(right / left - 1);
  });
  const starts = [0];
  // A step shows as a plateau of equal deviations; it starts at the plateau's first point.
  for (let p = 1; p < points.length; p++) if (dev[p] > step && dev[p] > dev[p - 1] && dev[p] >= (dev[p + 1] ?? 0)) starts.push(p);
  starts.push(points.length);
  for (let s = 0; s < starts.length - 1; s++) {
    const seg = points.slice(starts[s], starts[s + 1]), value = median(seg.map(x => x.k));
    const from = s === 0 ? 0 : points[starts[s]].i, to = s === starts.length - 2 ? official.length : points[starts[s + 1]].i;
    for (let i = from; i < to; i++) k[i] = value;
  }
  // Yahoo's close differs from the official one by an auction tick or two: those days keep their
  // stretch's factor. A day on a different scale altogether (Yahoo re-adjusts some days) keeps its own.
  for (const { i, k: own } of points) if (Math.abs(own / k[i] - 1) > 0.015) k[i] = own;
  return k;
}

/**
 * Rebuild a stock's daily candles on TradingView's basis.
 * official: [{ d, c }] adjusted closes from the exchange (decides the sessions and every close).
 * daily: Map date → Yahoo daily bar; hourly: Map date → Yahoo session bar from 60-minute data.
 * Returns { bars, est, flags }: est lists sessions whose open/high/low/volume are estimated.
 */
export function rebuildBars({ official, daily, hourly = new Map(), years = YEARS }) {
  if (!official.length) return { bars: [], est: [], flags: [] };
  const from = new Date(`${official.at(-1).d}T12:00:00Z`); from.setUTCFullYear(from.getUTCFullYear() - years);
  const start = from.toISOString().slice(0, 10);
  const k = scaleFactors(official, daily);
  const bars = [], est = [];
  for (let i = 0; i < official.length; i++) {
    const { d, c } = official[i], prev = official[i - 1], f = k[i] ?? 1;
    const y = daily.get(d), h = hourly.get(d);
    const real = y && !isFakeBar(y) && y.c > 0 && Math.abs((c / y.c) / f - 1) <= 0.05;
    let bar;
    if (real) bar = { d, o: y.o * f, h: y.h * f, l: y.l * f, c, v: y.v / f };
    else if (h?.v > 0) {
      // Yahoo's 60-minute bars are not always on its daily scale: their own close sets the factor
      // when it is far from the daily one (the close itself misses the auction by a tick or two).
      const fh = h.c > 0 && Math.abs(c / h.c / f - 1) > 0.03 ? c / h.c : f;
      bar = { d, o: h.o * fh, h: h.h * fh, l: h.l * fh, c, v: h.v / fh };
      // A session moves at most ±10% from the previous close; anything wider is not this session.
      if (prev && (bar.h > prev.c * (1 + DAILY_LIMIT) || bar.l < prev.c * (1 - DAILY_LIMIT))) bar = { d, o: prev.c, h: Math.max(prev.c, c), l: Math.min(prev.c, c), c, v: bar.v };
      est.push(d);
    }
    else if (prev && c === prev.c && (!y || isFakeBar(y))) continue; // no trade that session (suspended)
    else if (prev) { bar = { d, o: prev.c, h: Math.max(prev.c, c), l: Math.min(prev.c, c), c, v: 0 }; est.push(d); }
    else continue;
    if (d < start) continue;
    bars.push({ d, o: round2(bar.o), h: round2(Math.max(bar.h, bar.o, c)), l: round2(Math.min(bar.l, bar.o, c)), c: round2(c), v: Math.round(bar.v || 0) });
  }
  return { bars, est: est.filter(d => d >= start && bars.some(b => b.d === d)), flags: jumpFlags(bars) };
}

/** Session-to-session moves beyond the ±10% limit that no capital action explains. */
export function jumpFlags(bars) {
  const flags = [];
  for (let i = 1; i < bars.length; i++) {
    const change = bars[i].c / bars[i - 1].c - 1;
    if (Math.abs(change) > DAILY_LIMIT) flags.push({ date: bars[i].d, change: round2(change * 100) });
  }
  return flags;
}

/** File → bars, and bars → file (keeps the page's column format). */
export const fileBars = file => file.d.map((d, i) => ({ d, o: file.o[i], h: file.h[i], l: file.l[i], c: file.c[i], v: file.v[i] }));
export function candleFile(symbol, source, officialThrough, bars, est = []) {
  const kept = new Set(bars.map(b => b.d));
  return { symbol, source, officialThrough, est: est.filter(d => kept.has(d)), flags: jumpFlags(bars),
    d: bars.map(b => b.d), o: bars.map(b => b.o), h: bars.map(b => b.h), l: bars.map(b => b.l), c: bars.map(b => b.c), v: bars.map(b => b.v) };
}

/** A capital action took effect on `date`: every earlier price is multiplied by `factor`, volume divided. */
export function applyFactor(bars, date, factor) {
  return bars.map(b => b.d >= date ? b : { d: b.d, o: round2(b.o * factor), h: round2(b.h * factor), l: round2(b.l * factor), c: round2(b.c * factor), v: Math.round(b.v / factor) });
}

/**
 * TradingView scanner row (columns SCAN_COLUMNS) → today's and the previous session's candles.
 * `time` is the session's daily bar (seconds); prices are as TradingView shows them.
 */
export const SCAN_COLUMNS = ['time', 'open', 'high', 'low', 'close', 'volume', 'time[1]', 'open[1]', 'high[1]', 'low[1]', 'close[1]', 'volume[1]', 'currency'];
export function scanBars(row) {
  const [t, o, h, l, c, v, t1, o1, h1, l1, c1, v1, currency] = row?.d ?? [];
  if (currency && currency !== 'SAR') return null;
  const make = (time, open, high, low, close, volume) => Number.isFinite(time) && [open, high, low, close].every(x => Number.isFinite(x) && x > 0) && volume > 0
    ? { d: dayOf(time), o: round2(open), h: round2(Math.max(high, open, close)), l: round2(Math.min(low, open, close)), c: round2(close), v: Math.round(volume) } : null;
  return { today: make(t, o, h, l, c, v), prev: make(t1, o1, h1, l1, c1, v1) };
}

/**
 * Add a finished session to a stock's candles.
 * session: { today, prev } from scanBars; official: { date, price } (the exchange's close is final).
 * When TradingView's previous session closes at a different price from the stored one, a capital
 * action took effect today: earlier history is rescaled by that factor, as TradingView does.
 * fill: Yahoo bars for sessions this update missed (between the stored history and `prev`).
 */
export function addSession(bars, { today, prev }, official, { fill = [], years = YEARS } = {}) {
  if (!today || !official?.date || today.d !== official.date) return { bars, factor: null, added: false };
  today = { ...today, c: round2(official.price), h: Math.max(today.h, round2(official.price)), l: Math.min(today.l, round2(official.price)) };
  let out = bars.filter(b => b.d < today.d), factor = null;
  const stored = prev && out.find(b => b.d === prev.d);
  if (stored && Math.abs(prev.c / stored.c - 1) > 0.01) {
    // A capital action moves the whole bar by one factor; a different close alone is a correction.
    // (Smaller actions are picked up by the weekly rebuild from the exchange's adjusted closes.)
    const ratios = ['o', 'h', 'l', 'c'].map(x => prev[x] / stored[x]);
    if (Math.max(...ratios) / Math.min(...ratios) - 1 <= 0.004) { factor = prev.c / stored.c; out = applyFactor(out, prev.d, factor); }
  }
  if (prev && prev.d < today.d) {
    const last = out.at(-1)?.d ?? '';
    for (const b of fill) if (b.d > last && b.d < prev.d && !isFakeBar(b) && !out.some(x => x.d === b.d)) out.push(b);
    out = out.filter(b => b.d !== prev.d).concat(prev);
  }
  out = out.concat(today).sort((a, b) => a.d < b.d ? -1 : 1);
  const from = new Date(`${today.d}T12:00:00Z`); from.setUTCFullYear(from.getUTCFullYear() - years);
  const start = from.toISOString().slice(0, 10);
  return { bars: out.filter(b => b.d >= start), factor, added: true };
}

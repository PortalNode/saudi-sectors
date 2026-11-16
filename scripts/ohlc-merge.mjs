// Pure helpers for dist/ohlc/<symbol>.json: five years of daily candles per stock.
// Source: Yahoo Finance daily bars. The official Saudi Exchange close (data.json) is final for its day;
// bad prints are removed and unadjusted capital actions are flagged for the chart.

// Candles start here: Yahoo's daily open/high/low/volume for TADAWUL begin in March 2010, so every
// candle from then on is a full one. (The exchange's closes go back further, but would give no candles.)
export const HISTORY_START = '2010-01-01';
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
 * Sort, de-duplicate, keep everything since HISTORY_START, end on the official close, drop bad prints and
 * flag the remaining impossible jumps (capital actions the source did not adjust for).
 */
export function cleanBars(input, { official = null, start = HISTORY_START } = {}) {
  const byDate = new Map();
  for (const b of input) if (validBar(b)) byDate.set(b.d, { ...b });
  let bars = [...byDate.values()].sort((a, b) => a.d < b.d ? -1 : 1);
  if (official?.date && Number.isFinite(official.price) && official.price > 0) {
    // A session in progress is not a close: nothing after the last official close is kept.
    bars = bars.filter(b => b.d <= official.date);
    const last = bars.at(-1);
    if (last?.d === official.date) { last.c = official.price; last.h = Math.max(last.h, last.c); last.l = Math.min(last.l, last.c); }
  }
  bars = bars.filter(b => b.d >= start);
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

/** Yahoo chart JSON (requested with events=split) → [{ d, ratio }]: share splits and bonus issues. */
export function parseYahooSplits(json) {
  const r = json?.chart?.result?.[0], offset = r?.meta?.gmtoffset ?? 10800;
  return Object.values(r?.events?.splits ?? {}).filter(e => Number.isFinite(e?.date) && e.numerator > 0 && e.denominator > 0)
    .map(e => ({ d: iso(e.date, offset), ratio: e.numerator / e.denominator })).sort((a, b) => a.d < b.d ? -1 : 1);
}

/** Yahoo chart JSON (requested with events=div) → [[date, amount]]: cash dividends by ex-date (SAR). */
export function parseYahooDividends(json) {
  const r = json?.chart?.result?.[0], offset = r?.meta?.gmtoffset ?? 10800;
  const byDate = new Map();
  for (const e of Object.values(r?.events?.dividends ?? {})) if (Number.isFinite(e?.date) && e.amount > 0) byDate.set(iso(e.date, offset), Math.round(e.amount * 1e6) / 1e6);
  return [...byDate].sort(([a], [b]) => a < b ? -1 : 1);
}
/** Stored dividends with newly reported ones (a newer report wins for its date). */
export function mergeDividends(stored = [], fresh = []) {
  const byDate = new Map(stored); for (const [d, a] of fresh) byDate.set(d, a);
  return [...byDate].sort(([a], [b]) => a < b ? -1 : 1);
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
export function rebuildBars({ official, daily, hourly = new Map(), splits = [], exactSplits = false, earlier = false, start: from = HISTORY_START }) {
  if (!official.length) return { bars: [], est: [], flags: [] };
  if (earlier) official = withEarlierHistory(official, daily);
  // From HISTORY_START, and not before Yahoo's daily candles begin (March 2010): earlier closes would
  // give no candles. A stock Yahoo barely covers (1325) keeps its exchange closes as estimated candles.
  const firstReal = [...daily.values()].filter(b => !isFakeBar(b)).reduce((m, b) => b.d < m ? b.d : m, '9999');
  const yahooStart = firstReal < '2010-12-31' ? firstReal : '2010-12-31';
  const start = yahooStart > from ? yahooStart : from;
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
  const exact = exactSplits ? splitRatios(bars, daily, splits) : bars;
  return { bars: exact, est: est.filter(d => d >= start && exact.some(b => b.d === d)), flags: jumpFlags(exact) };
}

/**
 * A stock that moved to the main market from Nomu has exchange closes only from the move, while
 * TradingView (and Yahoo) carry its earlier sessions. Yahoo's earlier closes are put in front when
 * they continue the exchange's history without a jump.
 */
function withEarlierHistory(official, daily) {
  const first = official[0];
  const earlier = [...daily.values()].filter(b => b.d < first.d && !isFakeBar(b) && b.c > 0).sort((a, b) => a.d < b.d ? -1 : 1);
  // The scale comes from the first exchange sessions Yahoo also has (it may miss the very first one).
  const shared = official.slice(0, 10).map(x => ({ x, y: daily.get(x.d) })).filter(({ y }) => y && !isFakeBar(y) && y.c > 0);
  if (earlier.length < 5 || !shared.length) return official;
  const k = median(shared.map(({ x, y }) => x.c / y.c)), before = earlier.at(-1);
  if (Math.abs(k - 1) > 0.05 || Math.abs((first.c / k) / before.c - 1) > DAILY_LIMIT * 1.5) return official;
  return earlier.map(b => ({ d: b.d, c: round2(b.c * k) })).concat(official);
}

/**
 * The exchange adjusts a bonus issue or split by its change in capital; TradingView by the exact
 * share ratio, which is what Yahoo applies. Where the two differ slightly around a split Yahoo
 * reports, history before it is moved onto the exact ratio.
 */
function splitRatios(bars, daily, splits) {
  let out = bars;
  for (const { d } of [...splits].reverse()) { // latest first: an earlier split sees history already on later ratios
    const ratio = side => {
      const list = out.filter(b => side < 0 ? b.d < d : b.d >= d).map(b => { const y = daily.get(b.d); return y && !isFakeBar(y) && y.c > 0 ? b.c / y.c : null; }).filter(Boolean);
      const near = side < 0 ? list.slice(-15) : list.slice(0, 15);
      return near.length >= 5 ? median(near) : null;
    };
    const before = ratio(-1), after = ratio(1);
    if (!before || !after) continue;
    const r = before / after;
    if (Math.abs(r - 1) > 0.002 && Math.abs(r - 1) < 0.08) out = applyFactor(out, d, 1 / r);
  }
  return out;
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
export function candleFile(symbol, source, officialThrough, bars, est = [], div = []) {
  const kept = new Set(bars.map(b => b.d)), first = bars[0]?.d ?? '', last = bars.at(-1)?.d ?? '';
  // Cash dividends (ex-date, SAR) for the chart's ADJ option; the candles themselves are not adjusted for them.
  return { symbol, source, officialThrough, est: est.filter(d => kept.has(d)), div: div.filter(([d]) => d > first && d <= last), flags: jumpFlags(bars),
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
export function addSession(bars, { today, prev }, official, { fill = [], start = HISTORY_START } = {}) {
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
  return { bars: out.filter(b => b.d >= start), factor, added: true };
}

/* ---------- Choosing between adjustment bases with TradingView's own figures ----------
 * The exchange and Yahoo sometimes adjust a bonus issue by slightly different factors, and a stock
 * that moved from Nomu may or may not show its earlier sessions on TradingView. TradingView's
 * screener publishes figures computed on its own history; the rebuild keeps the candidate closest
 * to them, and the exchange's own basis when they cannot tell the candidates apart. */
export const TV_FIGURES = ['price_52_week_high', 'price_52_week_low', 'High.6M', 'Low.6M', 'SMA50', 'SMA200', 'EMA20'];
const smaLast = (values, n) => values.length >= n ? values.slice(-n).reduce((a, b) => a + b, 0) / n : null;
function emaLast(values, n) {
  if (values.length < n) return null;
  const k = 2 / (n + 1); let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (const v of values.slice(n)) prev = v * k + prev * (1 - k);
  return prev;
}
/** Figures for `bars` as TradingView computes them (windows of 364 and 180 days back from `today`). */
export function tvFigures(bars, today) {
  const back = n => new Date(Date.parse(`${today}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
  const y = bars.filter(b => b.d > back(365)), m6 = bars.filter(b => b.d > back(181)), closes = bars.map(b => b.c);
  const ext = (list, key, fn) => list.length ? fn(...list.map(b => b[key])) : null;
  return [ext(y, 'h', Math.max), ext(y, 'l', Math.min), ext(m6, 'h', Math.max), ext(m6, 'l', Math.min), smaLast(closes, 50), smaLast(closes, 200), emaLast(closes, 20)];
}
/** How far `bars` are from TradingView's figures (row in TV_FIGURES order): mismatches, then total relative gap. */
export function tvDistance(bars, tvRow, today) {
  const ours = tvFigures(bars, today);
  let mismatches = 0, gap = 0;
  ours.forEach((a, i) => { const b = tvRow?.[i]; if (a == null || !(b > 0)) return; const off = Math.abs(a / b - 1); gap += off; if (off > (i < 4 ? 0.006 : 0.003)) mismatches += 1; });
  return { mismatches, gap };
}

/* ---------- Two files per stock ----------
 * ohlc/<symbol>.json holds the recent sessions (from January 1 of last year) and changes every
 * session; ohlc/history/<symbol>.json holds everything earlier and changes only when history is
 * rebuilt or rescaled. The daily commit stays small, and the page joins the two. */
export const historyBoundary = lastDate => `${Number(String(lastDate).slice(0, 4)) - 1}-01-01`;
const pick = (file, keep) => {
  const idx = file.d.map((d, i) => i).filter(i => keep(file.d[i]));
  const at = key => idx.map(i => file[key][i]);
  return { d: at('d'), o: at('o'), h: at('h'), l: at('l'), c: at('c'), v: at('v') };
};
/** A full candle file → { recent, history } (history is null when everything is recent). */
export function splitFile(file, boundary = historyBoundary(file.d.at(-1))) {
  if (!file.d.length || file.d[0] >= boundary) return { recent: { ...file, historyThrough: null }, history: null };
  const recentPart = pick(file, d => d >= boundary), historyPart = pick(file, d => d < boundary);
  const est = file.est || [], flags = file.flags || [];
  const recent = { ...file, historyThrough: historyPart.d.at(-1), est: est.filter(d => d >= boundary), flags: flags.filter(f => f.date >= boundary), ...recentPart };
  const history = { symbol: file.symbol, source: file.source, est: est.filter(d => d < boundary), flags: flags.filter(f => f.date < boundary), ...historyPart };
  return { recent, history };
}
/** The recent file and its history file (or null) → one full candle file. */
export function joinFiles(recent, history) {
  if (!history || !recent.historyThrough) return recent;
  const older = pick(history, d => d < recent.d[0]);
  const full = { ...recent, est: [...(history.est || []), ...(recent.est || [])], flags: [...(history.flags || []), ...(recent.flags || [])] };
  for (const key of ['d', 'o', 'h', 'l', 'c', 'v']) full[key] = [...older[key], ...recent[key]];
  delete full.historyThrough;
  return full;
}

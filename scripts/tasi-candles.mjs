// Daily candles for the Saudi market index (TASI) as TradingView shows them (TADAWUL:TASI).
// TradingView's chart socket serves the index's full daily history; the stocks' candles come from the
// scanner and Yahoo (see update-ohlc.mjs), but Yahoo has TASI only monthly, so the index uses the socket.
import { candleFile, HISTORY_START } from './ohlc-merge.mjs';

export const TASI_SYMBOL = 'TASI';
export const TASI_NAME = 'مؤشر السوق السعودي';
export const TASI_SOURCE = 'TradingView · مؤشر السوق السعودي TASI';
export const TASI_TICKER = 'TADAWUL:TASI';
const SOCKET = 'wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart';
// 6,000 sessions reach back to 2002; the chart keeps what starts on HISTORY_START (2010-01-01).
const BAR_COUNT = 6000;

/* ---------- TradingView socket framing: "~m~<length>~m~<json>" ---------- */
export const frame = payload => { const text = typeof payload === 'string' ? payload : JSON.stringify(payload); return `~m~${text.length}~m~${text}`; };
export const message = (m, p) => frame({ m, p });

/** The payloads inside one socket message (it may hold several frames). */
export function unframe(text) {
  const out = [];
  for (let at = 0; at < text.length;) {
    const head = /^~m~(\d+)~m~/.exec(text.slice(at, at + 24));
    if (!head) break;
    const start = at + head[0].length, end = start + Number(head[1]);
    out.push(text.slice(start, end));
    at = end;
  }
  return out;
}

/** [time, open, high, low, close, volume] rows from a timescale_update / du message, or []. */
export function seriesRows(payload) {
  const points = payload?.p?.[1]?.sds_1?.s;
  return payload && (payload.m === 'timescale_update' || payload.m === 'du') && Array.isArray(points) ? points.map(point => point.v) : [];
}

/* ---------- Cleaning ---------- */
const round2 = x => Math.round(x * 100) / 100;
const dateOf = seconds => new Date(seconds * 1000).toISOString().slice(0, 10);

/** Raw socket rows → one candle per session since `start`, ascending, with 2-decimal prices. Bad rows are counted, never guessed. */
export function cleanTasiBars(rows, { start = HISTORY_START } = {}) {
  const byDate = new Map();
  let dropped = 0;
  for (const [time, o, h, l, c, v] of rows) {
    const d = Number.isFinite(time) ? dateOf(time) : null;
    const bar = d && { d, o: round2(o), h: round2(h), l: round2(l), c: round2(c), v: Math.round(v) };
    if (!bar || d < start || !validBar(bar)) { if (d >= start) dropped += 1; continue; }
    byDate.set(d, bar); // a repeated session keeps the latest row
  }
  return { bars: [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1)), dropped };
}

export const validBar = ({ o, h, l, c, v }) => [o, h, l, c].every(x => Number.isFinite(x) && x > 0) && h >= Math.max(o, c) && l <= Math.min(o, c) && Number.isFinite(v) && v >= 0;

/** Throws unless the candles are a believable TASI history: since 2010, ascending, no long gaps, same sessions as before. */
export function checkTasiBars(bars, { previous = null, start = HISTORY_START, maxGapDays = 16 } = {}) {
  if (bars.length < 3000) throw new Error(`only ${bars.length} candles`);
  const first = bars[0].d;
  if (first > `${start.slice(0, 4)}-01-15`) throw new Error(`history starts ${first}, not ${start}`);
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].d <= bars[i - 1].d) throw new Error(`candles out of order at ${bars[i].d}`);
    const gap = (Date.parse(`${bars[i].d}T00:00:00Z`) - Date.parse(`${bars[i - 1].d}T00:00:00Z`)) / 864e5;
    if (gap > maxGapDays) throw new Error(`${gap}-day gap before ${bars[i].d}`);
    if (Math.abs(bars[i].c / bars[i - 1].c - 1) > 0.15) throw new Error(`implausible move on ${bars[i].d}`);
  }
  // Sessions already stored must not disappear (a short or truncated answer from the source).
  if (previous?.d?.length) {
    const have = new Set(bars.map(b => b.d));
    const lost = previous.d.filter(d => d >= first && !have.has(d));
    if (lost.length) throw new Error(`${lost.length} stored sessions missing, e.g. ${lost[0]}`);
  }
  return true;
}

/** Candles → the file the chart reads (the same columns as a stock's). */
export const tasiFile = (bars, officialThrough = null) => candleFile(TASI_SYMBOL, TASI_SOURCE, officialThrough, bars);

/* ---------- Fetching ---------- */
/** Raw rows of TADAWUL:TASI daily candles from TradingView's chart socket. */
export function fetchTasiRows({ timeout = 30000, Socket = globalThis.WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    if (!Socket) { reject(new Error('WebSocket is not available (Node 22 or newer is needed)')); return; }
    const rows = new Map(), session = `cs_${Math.random().toString(36).slice(2, 14)}`;
    let socket, finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      try { socket?.close(); } catch { /* already closed */ }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('TradingView did not answer in time')), timeout);
    try { socket = new Socket(SOCKET, { headers: { Origin: 'https://www.tradingview.com', 'User-Agent': 'Mozilla/5.0' } }); } catch (error) { finish(error); return; }
    socket.onopen = () => {
      socket.send(message('set_auth_token', ['unauthorized_user_token']));
      socket.send(message('chart_create_session', [session, '']));
      socket.send(message('resolve_symbol', [session, 'sds_sym_1', `=${JSON.stringify({ adjustment: 'splits', symbol: TASI_TICKER })}`]));
      socket.send(message('create_series', [session, 'sds_1', 's1', 'sds_sym_1', '1D', BAR_COUNT, '']));
    };
    socket.onmessage = event => {
      for (const part of unframe(String(event.data))) {
        if (part.startsWith('~h~')) { socket.send(frame(part)); continue; } // keep-alive
        let payload; try { payload = JSON.parse(part); } catch { continue; }
        if (['critical_error', 'protocol_error', 'symbol_error', 'series_error'].includes(payload.m)) { finish(new Error(`TradingView: ${payload.m}`)); return; }
        for (const row of seriesRows(payload)) rows.set(row[0], row);
        if (payload.m === 'series_completed') { finish(null, [...rows.values()]); return; }
      }
    };
    socket.onerror = () => finish(new Error('TradingView socket error'));
    socket.onclose = () => finish(new Error('TradingView socket closed early'));
  });
}

export async function fetchTasiBars({ attempts = 3, ...options } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return cleanTasiBars(await fetchTasiRows(options)); } catch (error) { last = error; await new Promise(r => setTimeout(r, 1500 * attempt)); }
  }
  throw last;
}

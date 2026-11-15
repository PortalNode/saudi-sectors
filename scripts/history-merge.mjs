// Pure helpers for dist/history/<symbol>.json: one year of daily closes per stock.
// Yahoo Finance supplies the past year; the official Saudi Exchange close (data.json)
// is authoritative for its own date and is the only bar kept for that day.

export const KEEP_DAYS = 372; // a year plus a week of margin

/** Yahoo chart JSON → [{date:'YYYY-MM-DD' (Riyadh), close}] with empty bars dropped. */
export function parseYahooChart(json) {
  const result = json?.chart?.result?.[0];
  const stamps = result?.timestamp, closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) throw new Error('unexpected Yahoo chart shape');
  if (result.meta?.currency && result.meta.currency !== 'SAR') throw new Error(`unexpected currency ${result.meta.currency}`);
  const offset = (result.meta?.gmtoffset ?? 10800) * 1000; // Riyadh is UTC+3
  const points = [];
  stamps.forEach((stamp, index) => {
    const close = closes[index];
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return;
    points.push({ date: new Date(stamp * 1000 + offset).toISOString().slice(0, 10), close: Math.round(close * 100) / 100 });
  });
  return points;
}

/**
 * Merge fetched points with the existing file and the official close.
 * - Days after the last official close are dropped (a session in progress is not a close).
 * - The official close replaces whatever the source had for that date, or is appended.
 * - Without fetched points (source down), the existing file is kept and only the official close is added.
 */
export function mergeHistory({ fetched = null, existing = null, official = null }) {
  const byDate = new Map();
  for (const [date, close] of zip(existing)) byDate.set(date, close);
  if (fetched?.length) for (const { date, close } of fetched) byDate.set(date, close);
  const cutoff = official?.date ?? null;
  if (cutoff) for (const date of [...byDate.keys()]) if (date > cutoff) byDate.delete(date);
  let corrected = null;
  if (official && Number.isFinite(official.price) && official.price > 0) {
    const had = byDate.get(official.date);
    if (had != null && Math.abs(had - official.price) >= 0.005) corrected = { date: official.date, from: had, to: official.price };
    byDate.set(official.date, Math.round(official.price * 100) / 100);
  }
  const dates = [...byDate.keys()].sort();
  const last = dates.at(-1);
  if (!last) return { dates: [], close: [], corrected };
  const from = new Date(`${last}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - KEEP_DAYS);
  const start = from.toISOString().slice(0, 10);
  const kept = dates.filter(date => date >= start);
  return { dates: kept, close: kept.map(date => byDate.get(date)), corrected };
}

function zip(file) {
  if (!Array.isArray(file?.dates) || !Array.isArray(file?.close) || file.dates.length !== file.close.length) return [];
  return file.dates.map((date, index) => [date, file.close[index]]).filter(([date, close]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0);
}

/** Shape check used by the tests and before writing. */
export function validHistory(file) {
  return !!file && /^\d{4}$/.test(file.symbol) && Array.isArray(file.dates) && Array.isArray(file.close)
    && file.dates.length === file.close.length && file.dates.length > 1
    && file.dates.every((date, index) => /^\d{4}-\d{2}-\d{2}$/.test(date) && (!index || date > file.dates[index - 1]))
    && file.close.every(close => Number.isFinite(close) && close > 0);
}

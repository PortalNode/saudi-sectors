// Pure logic of the scanner page (filtering, sorting, watch-list comparison, number formats). No DOM, so the
// same file is loaded by the page and by tests/scanner-ui.test.mjs.

export const DEFAULT_FILTERS = { strategy: 'all', sector: 'all', trend: 'all', minValue: 1e6, status: 'all', maxAge: 10, maxRisk: null, query: '' };

export function filterItems(items, stocks, f = DEFAULT_FILTERS) {
  const q = (f.query || '').trim().toLowerCase();
  return items.filter(it => {
    const s = stocks[it.symbol];
    if (!s) return false;
    if (f.strategy !== 'all' && it.strategy !== f.strategy) return false;
    if (f.sector !== 'all' && s.sector !== f.sector) return false;
    if (f.trend !== 'all' && s.trend !== f.trend) return false;
    if (f.status !== 'all' && it.status !== f.status) return false;
    if (s.avgVal20 < f.minValue) return false;
    if (it.ageSessions > f.maxAge) return false;
    if (f.maxRisk != null && it.riskPct > f.maxRisk) return false;
    if (q && !(`${it.symbol} ${s.name} ${s.sector}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

// How many different strategies fire on the same stock (shown as "concurrent signals"; it is not a score).
export function concurrentCounts(items) {
  const m = new Map();
  for (const it of items) m.set(it.symbol, (m.get(it.symbol) || 0) + 1);
  return m;
}

export const SORTS = {
  fresh: (a, b, st) => a.ageSessions - b.ageSessions || st[b.symbol].avgVal20 - st[a.symbol].avgVal20,
  liquidity: (a, b, st) => st[b.symbol].avgVal20 - st[a.symbol].avgVal20,
  volume: (a, b, st) => (st[b.symbol].volRatio ?? -1) - (st[a.symbol].volRatio ?? -1),
  risk: (a, b) => a.riskPct - b.riskPct,
  strategy: (a, b, st, names) => (names[a.strategy] || '').localeCompare(names[b.strategy] || '', 'ar') || st[b.symbol].avgVal20 - st[a.symbol].avgVal20,
  concurrent: (a, b, st, names, counts) => (counts.get(b.symbol) || 0) - (counts.get(a.symbol) || 0) || st[b.symbol].avgVal20 - st[a.symbol].avgVal20,
};
export function sortItems(items, stocks, key = 'fresh', names = {}) {
  const counts = concurrentCounts(items), fn = SORTS[key] || SORTS.fresh;
  return [...items].sort((a, b) => fn(a, b, stocks, names, counts));
}

// Compare what was firing when the stock was saved with what fires now.
export function watchDiff(saved, nowItems) {
  const before = new Set(saved?.strategies || []), now = new Set(nowItems.map(i => i.strategy));
  const added = [...now].filter(x => !before.has(x)), removed = [...before].filter(x => !now.has(x));
  const state = added.length && removed.length ? 'changed' : added.length ? 'added' : removed.length ? 'removed' : now.size ? 'same' : 'none';
  return { state, added, removed, now: [...now] };
}

export function loadWatch(storage) {
  try { const v = JSON.parse(storage.getItem('saudi-sectors-scanner-watch') || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
export function saveWatch(storage, watch) { try { storage.setItem('saudi-sectors-scanner-watch', JSON.stringify(watch)); return true; } catch { return false; } }
export function toggleWatch(watch, symbol, nowItems, dataDate, savedAt) {
  const next = { ...watch };
  if (next[symbol]) delete next[symbol];
  else next[symbol] = { savedAt, dataDate, strategies: nowItems.map(i => i.strategy) };
  return next;
}

const en = (d, min = 0) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: d });
export const fmtPrice = x => x == null ? '—' : en(2, 2).format(x);
export const fmtNum = (x, d = 1) => x == null ? '—' : en(d, d).format(x);
export function fmtValue(x) {
  if (x == null) return '—';
  if (x >= 1e9) return `${en(2).format(x / 1e9)} مليار`;
  if (x >= 1e6) return `${en(1).format(x / 1e6)} مليون`;
  return `${en(0).format(x / 1e3)} ألف`;
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const TREND_LABEL = { up: 'صاعد', side: 'عرضي / غير واضح', down: 'هابط', na: '—' };
export const STATUS_LABEL = { new: 'جديدة', continuing: 'مستمرة' };
export const WATCH_LABEL = { added: 'إشارة جديدة منذ الحفظ', removed: 'انتهت إشارة منذ الحفظ', changed: 'تغيّرت الإشارات منذ الحفظ', same: 'لم تتغير الإشارات', none: 'لا توجد إشارة' };

// منطق صفحة «مفاتيح جودة السهم» (فلترة وترتيب ومقارنة المراقبة وتنسيق الأرقام). بلا DOM، فيُحمَّل من الصفحة ومن الاختبارات.

export const KEY_IDS = ['trend', 'fin', 'tasi', 'levels', 'sma55', 'macd'];
export const DEFAULT_FILTERS = { minScore: 5, sector: 'all', minValue: 1e6, query: '' };

// يحوّل خريطة الأسهم إلى قائمة { symbol, ...stock } بعد الفلترة
export function filterStocks(stocks, f = DEFAULT_FILTERS) {
  const q = (f.query || '').trim().toLowerCase();
  return Object.entries(stocks).map(([symbol, s]) => ({ symbol, ...s })).filter(s => {
    if (s.score < f.minScore) return false;
    if (f.sector !== 'all' && s.sector !== f.sector) return false;
    if (s.avgVal20 < f.minValue) return false;
    if (q && !`${s.symbol} ${s.name} ${s.sector}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const SORTS = {
  score: (a, b) => b.score - a.score || b.avgVal20 - a.avgVal20,
  liquidity: (a, b) => b.avgVal20 - a.avgVal20,
  volume: (a, b) => (b.volRatio ?? -1) - (a.volRatio ?? -1) || b.score - a.score,
  dividend: (a, b) => (b.dividendYield ?? -1) - (a.dividendYield ?? -1) || b.score - a.score,
  name: (a, b) => a.name.localeCompare(b.name, 'ar'),
};
export const sortStocks = (list, key = 'score') => [...list].sort(SORTS[key] || SORTS.score);

// يقارن مفاتيح السهم وقت الحفظ بمفاتيحه الآن (bits: سلسلة من ستة أرقام 0/1 بترتيب KEY_IDS)
export function watchDiff(saved, now) {
  if (!now) return { state: 'none', gained: [], lost: [] };
  if (!saved?.bits || saved.bits.length !== KEY_IDS.length) return { state: 'same', gained: [], lost: [] };
  const gained = [], lost = [];
  KEY_IDS.forEach((id, k) => {
    if (saved.bits[k] === '0' && now.bits[k] === '1') gained.push(id);
    if (saved.bits[k] === '1' && now.bits[k] === '0') lost.push(id);
  });
  const state = gained.length && lost.length ? 'changed' : gained.length ? 'added' : lost.length ? 'removed' : 'same';
  return { state, gained, lost };
}

export function loadWatch(storage) {
  try { const v = JSON.parse(storage.getItem('saudi-sectors-scanner-watch') || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
export function saveWatch(storage, watch) { try { storage.setItem('saudi-sectors-scanner-watch', JSON.stringify(watch)); return true; } catch { return false; } }
export function toggleWatch(watch, symbol, now, dataDate, savedAt) {
  const next = { ...watch };
  if (next[symbol]) delete next[symbol];
  else next[symbol] = { savedAt, dataDate, score: now?.score ?? null, bits: now?.bits ?? null };
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
export const WATCH_LABEL = { added: 'تحسّنت مفاتيح منذ الحفظ', removed: 'تراجعت مفاتيح منذ الحفظ', changed: 'تغيّرت المفاتيح منذ الحفظ', same: 'لم تتغير المفاتيح', none: 'خارج نطاق الفحص' };

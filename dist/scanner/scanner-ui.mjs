// واجهة «مفاتيح جودة السهم» وقائمة المراقبة. تقرأ dist/scanner/signals.json (يبنيه scripts/build-scanner.mjs بعد كل
// تحديث أسعار) ولا تحسب أي مؤشر بنفسها. كل المنطق القابل للاختبار في scanner-logic.mjs.
import { KEY_IDS, DEFAULT_FILTERS, filterStocks, sortStocks, watchDiff, loadWatch, saveWatch, toggleWatch,
  fmtPrice, fmtNum, fmtValue, escapeHtml as esc, TREND_LABEL, WATCH_LABEL } from './scanner-logic.mjs?v=sc-20261119d';

const FILTER_KEY = 'saudi-sectors-scanner-filters-v2';
const base = file => new URL(file, import.meta.url);
const getJson = async file => { const r = await fetch(base(file), { cache: 'no-cache' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const store = { get: () => { try { return localStorage; } catch { return { getItem: () => null, setItem() { throw new Error('blocked'); } }; } } };

let ta, data, watch, filters, sortKey = 'score', card = null, cardObserver = null;
const $ = id => document.getElementById(id);
const stockOf = symbol => data.stocks[symbol] ? { symbol, ...data.stocks[symbol] } : null;
const label = id => data.keys[id];
const REASON = { suspended: 'السهم موقوف', stale: 'آخر شمعة أقدم من أحدث جلسة', unverified: 'تعذر التحقق من إغلاقه الرسمي', shortHistory: 'تاريخه أقصر من سنة تداول', dataQuality: 'جودة بياناته الأخيرة غير كافية', illiquid: 'سيولته أقل من مليون ريال يومياً' };
const reasonOf = symbol => Object.entries(data.meta.excluded || {}).find(([, list]) => list.includes(symbol))?.[0] || null;

function readFilters() { try { return { ...DEFAULT_FILTERS, ...JSON.parse(store.get().getItem(FILTER_KEY) || '{}') }; } catch { return { ...DEFAULT_FILTERS }; } }
function writeFilters() { try { store.get().setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ } }
const mark = ok => ok ? '<span class="sc-key on" title="1+">1+</span>' : '<span class="sc-key off" title="0">0</span>';

/* ---------- القائمة ---------- */
function banner() {
  const m = data.meta;
  if (!m.valid) return `<div class="sc-banner sc-bad" role="alert"><strong>تعذر التحقق من البيانات، فلا تُعرض أي نتائج.</strong> ${esc(m.reasonInvalid || '')}</div>`;
  const excluded = Object.entries(m.excluded || {}).map(([k, v]) => `${REASON[k] || k}: ${v.length}`).join(' · ');
  const tasiOff = m.tasi && m.tasi.trend !== 'up';
  return `<div class="sc-banner" role="note"><strong>استراتيجية «مفاتيح جودة السهم».</strong> لكل سهم ستة مفاتيح: اتجاه السهم، التحليل المالي (صافي ربح آخر 4 أرباع موجب)، اتجاه TASI، مستويات الأسعار (أقرب لدعم منه لمقاومة)، الإغلاق فوق المتوسط 55، وMACD فوق خط الإشارة. المفتاح إما <b>1+</b> أو <b>0</b>، ويظهر السهم إذا حقق <b>${m.minScore} مفاتيح أو أكثر</b> من 6. استراتيجية وصفية لا تتنبأ وليست توصية استثمارية.</div>
  ${tasiOff ? `<div class="sc-banner sc-warn-banner" role="note">مفتاح السوق (TASI) <b>0</b> الآن: ${esc(m.tasi.detail)}. لذلك لا يمكن لأي سهم تجاوز 5 من 6 حتى يعود المؤشر للاتجاه الصاعد.</div>` : ''}
  <div class="sc-meta"><span>آخر إغلاق رسمي: <bdi class="num">${esc(m.dataDate)}</bdi></span><span>الأسهم المفحوصة: <bdi class="num">${m.scanned}</bdi> من <bdi class="num">${m.universe}</bdi></span><span>6 من 6: <bdi class="num">${m.counts.six}</bdi> · 5 من 6: <bdi class="num">${m.counts.five}</bdi></span><span>اتجاه TASI: ${esc(TREND_LABEL[m.tasi?.trend] || '—')}</span>${excluded ? `<span>مستبعد: ${esc(excluded)}</span>` : ''}</div>`;
}

function filterBar() {
  const sectors = [...new Set(Object.values(data.stocks).map(s => s.sector))].sort((a, b) => a.localeCompare(b, 'ar'));
  const opt = (v, text, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(text)}</option>`;
  const f = filters;
  return `<form class="sc-filters" id="sc-filters" autocomplete="off" aria-label="فلاتر الماسح">
    <label>عدد المفاتيح<select name="minScore">${opt(5, '5 من 6 فأكثر', f.minScore)}${opt(6, '6 من 6 فقط', f.minScore)}${opt(4, '4 فأكثر (للاستكشاف)', f.minScore)}</select></label>
    <label>القطاع<select name="sector">${opt('all', 'الكل', f.sector)}${sectors.map(s => opt(s, s, f.sector)).join('')}</select></label>
    <label>أدنى متوسط قيمة تداول (20 يوماً)<select name="minValue">${opt(1e6, 'مليون ريال', f.minValue)}${opt(5e6, '5 ملايين', f.minValue)}${opt(10e6, '10 ملايين', f.minValue)}${opt(25e6, '25 مليوناً', f.minValue)}</select></label>
    <label>الشركات الخاسرة<select name="excludeLoss">${opt('0', 'عرض الكل', f.excludeLoss ? 1 : 0)}${opt('1', 'استثناء الخاسرة', f.excludeLoss ? 1 : 0)}</select></label>
    <label>ترتيب حسب<select name="sort">${[['score', 'عدد المفاتيح ثم السيولة'], ['liquidity', 'السيولة'], ['volume', 'الحجم مقابل المتوسط'], ['dividend', 'عائد التوزيعات'], ['name', 'الاسم']].map(([k, v]) => opt(k, v, sortKey)).join('')}</select></label>
    <label class="sc-search">بحث<input type="search" name="query" value="${esc(f.query)}" placeholder="رمز أو اسم أو قطاع"></label>
    <button type="button" class="sc-reset" data-reset>إعادة الضبط</button>
  </form>`;
}

function tableRows(list) {
  return list.map(s => {
    const watched = !!watch[s.symbol];
    return `<tr data-open="${esc(s.symbol)}">
      <td class="sc-sticky"><button type="button" class="fav-toggle${watched ? ' on' : ''}" data-watch="${esc(s.symbol)}" aria-pressed="${watched}" aria-label="${watched ? 'إزالة' : 'إضافة'} ${esc(s.name)} ${watched ? 'من' : 'إلى'} قائمة المراقبة">${watched ? '★' : '☆'}</button><span class="symbol-badge">${esc(s.symbol)}</span> <span class="sc-name">${esc(s.name)}</span></td>
      <td>${esc(s.sector)}</td>
      <td><bdi class="num price">${fmtPrice(s.price)}</bdi></td>
      <td><span class="sc-score s${s.score}"><bdi class="num" dir="ltr">${s.score}/6</bdi></span></td>
      ${KEY_IDS.map(id => `<td class="sc-keycell">${mark(s.keys[id][0] === 1)}</td>`).join('')}
      <td>${s.dividendYield == null ? '<span class="sc-dim">—</span>' : `<bdi class="num${s.dividendOk ? ' up' : ''}">${fmtNum(s.dividendYield, 2)}%</bdi>`}${s.dividendOk ? ' <span class="sc-tag" title="توزيعات أعلى من 2.5%">+2.5%</span>' : ''}</td>
      <td><bdi class="num">${fmtValue(s.tradedValue)}</bdi><small class="sc-dim">متوسط ${fmtValue(s.avgVal20)}</small></td>
      <td><button type="button" class="sc-open" data-open-btn>التفاصيل</button></td></tr>`;
  }).join('');
}

function renderScanner() {
  const box = $('sc-scanner');
  if (!data.meta.valid) { box.innerHTML = banner(); return; }
  box.innerHTML = `${banner()}${filterBar()}<div id="sc-result"></div>`;
  renderResult();
}
function renderResult() {
  const list = sortStocks(filterStocks(data.stocks, filters), sortKey), out = $('sc-result');
  const head = ['السهم', 'القطاع', 'السعر', 'المجموع', ...KEY_IDS.map(label), 'توزيعات الأرباح', 'قيمة التداول', ''];
  out.innerHTML = list.length
    ? `<p class="sc-count-line"><bdi class="num">${list.length}</bdi> سهماً. <b>1+</b> = المفتاح متحقق، <b>0</b> = غير متحقق. اضغط على أي سهم لرؤية سبب كل مفتاح والشارت.</p>
       <div class="table-wrap sc-wrap"><table class="sc-table"><thead><tr>${head.map((h, i) => `<th${i === 0 ? ' class="sc-sticky"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${tableRows(list)}</tbody></table></div>`
    : `<div class="sc-empty"><strong>لا توجد أسهم تحقق ${filters.minScore} مفاتيح فأكثر الآن.</strong><p>هذا متوقع حين يكون اتجاه السوق (TASI) غير صاعد، فمفتاح السوق صفر لكل الأسهم ويصبح المطلوب تحقق المفاتيح الخمسة الباقية كلها.</p>${filters.minScore > 4 ? '<p><button type="button" class="sc-btn" data-lower-score>اعرض الأسهم ذات 4 مفاتيح (للاستكشاف)</button></p>' : ''}</div>`;
}

/* ---------- بطاقة التفاصيل ---------- */
function levelsFor(s) {
  const out = [];
  if (s.support) out.push({ price: s.support, title: 'أقرب دعم', color: '#22c55e' });
  if (s.resistance) out.push({ price: s.resistance, title: 'أقرب مقاومة', color: '#f05252' });
  return out;
}
function cardHtml(s) {
  const watched = !!watch[s.symbol];
  const rows = KEY_IDS.map(id => { const [ok, detail] = s.keys[id]; return `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '1+' : '0'}</span> <b>${esc(label(id))}</b>${detail ? `<small class="sc-dim">${esc(detail)}</small>` : ''}</li>`; }).join('');
  const verdict = s.score === 6 ? 'حقق المفاتيح الستة كلها.' : s.score >= data.meta.minScore ? `حقق ${s.score} من 6 مفاتيح.` : `حقق ${s.score} من 6 فقط، أقل من الحد الأدنى (${data.meta.minScore}) للظهور في القائمة.`;
  return `<article class="sc-card" aria-label="تفاصيل ${esc(s.name)}">
    <header><div class="sc-card-title"><img class="sc-logo" src="logos/${esc(s.symbol)}.svg" alt="" onerror="this.remove()"><div><h3>${esc(s.name)} <bdi class="num">${esc(s.symbol)}</bdi></h3><p>${esc(s.sector)} · الإغلاق <bdi class="num">${fmtPrice(s.price)}</bdi> · اتجاه السهم: ${esc(TREND_LABEL[s.trend])}</p></div></div>
      <div class="sc-card-actions"><button type="button" class="sc-btn${watched ? ' on' : ''}" data-watch="${esc(s.symbol)}" aria-pressed="${watched}">${watched ? '★ في المراقبة' : '☆ أضف للمراقبة'}</button><button type="button" class="sc-btn" data-card-close>إغلاق</button></div></header>
    <p class="sc-why"><span class="sc-score s${s.score}"><bdi class="num" dir="ltr">${s.score}/6</bdi></span> ${esc(verdict)}</p>
    <div class="sc-grid">
      <section class="sc-block sc-wide"><h4>المفاتيح الستة</h4><ul class="sc-conds sc-keylist">${rows}</ul></section>
      <section class="sc-block"><h4>دعم ومقاومة</h4><dl class="sc-dl"><dt>أقرب دعم</dt><dd><bdi class="num">${fmtPrice(s.support)}</bdi></dd><dt>أقرب مقاومة</dt><dd>${s.resistance ? `<bdi class="num">${fmtPrice(s.resistance)}</bdi>` : 'لا توجد (عند قمة الفترة)'}</dd><dt>متوسط 50 / 200</dt><dd><bdi class="num">${fmtPrice(s.sma50)} / ${fmtPrice(s.sma200)}</bdi></dd></dl></section>
      <section class="sc-block"><h4>توزيعات الأرباح</h4><p>${s.dividendYield == null ? 'لا تتوفر نسبة توزيعات لهذا السهم.' : `عائد التوزيعات <bdi class="num">${fmtNum(s.dividendYield, 2)}%</bdi>${s.dividendOk ? ' — أعلى من 2.5% (يفضّلها المنهج، ولا تدخل في عدّ المفاتيح).' : ' — أقل من 2.5%.'}`}</p></section>
    </div>
    <p class="sc-foot">يُعرض الشارت أدناه بخطي الدعم والمقاومة. البيانات حتى <bdi class="num">${esc(data.meta.dataDate)}</bdi>، وهذه ليست توصية استثمارية.</p></article>`;
}
function openCard(symbol, { switchTab = true } = {}) {
  const s = stockOf(symbol);
  if (!s) return;
  card = { symbol };
  const slot = $('sc-card');
  slot.innerHTML = cardHtml(s); slot.hidden = false;
  if (switchTab) ta.setTab('chart', { mount: false });
  ta.mountChart(symbol, levelsFor(s)).then(() => watchChartSymbol(symbol));
  slot.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}
function closeCard() { card = null; const slot = $('sc-card'); slot.hidden = true; slot.innerHTML = ''; cardObserver?.disconnect(); }
// إذا غيّر المستخدم السهم من بحث الشارت تُخفى البطاقة حتى لا تصف سهماً غير المعروض
function watchChartSymbol(symbol) {
  cardObserver?.disconnect();
  cardObserver = new MutationObserver(() => {
    const head = ta.chartPanel.querySelector('.cc-head');
    if (card && head && !head.textContent.includes(symbol)) closeCard();
  });
  cardObserver.observe(ta.chartPanel, { childList: true, subtree: true });
}

/* ---------- قائمة المراقبة ---------- */
function updateWatchBadge() { const n = Object.keys(watch).length, b = $('sc-watch-count'); if (b) { b.textContent = n; b.hidden = !n; } }
const ta_known = x => ta.knownSymbols?.has(x);
function renderWatch() {
  const box = $('sc-watch'), symbols = Object.keys(watch);
  updateWatchBadge();
  const favs = (() => { try { const v = JSON.parse(localStorage.getItem('saudi-sectors-favorites') || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } })();
  const missingFavs = favs.filter(x => !watch[x] && (data.stocks[x] || ta_known(x)));
  const rows = symbols.map(sym => {
    const s = stockOf(sym), saved = watch[sym];
    if (!s) return `<tr><td class="sc-sticky"><button type="button" class="fav-toggle on" data-watch="${esc(sym)}" aria-pressed="true" aria-label="إزالة ${esc(sym)} من المراقبة">★</button><span class="symbol-badge">${esc(sym)}</span></td><td colspan="5" class="sc-dim">${esc(REASON[reasonOf(sym)] || 'خارج نطاق الفحص')} — لا مفاتيح له الآن.</td></tr>`;
    const d = watchDiff(saved, s), names = ids => ids.map(id => esc(label(id))).join('، ');
    const change = `<span class="sc-change ${d.state}">${esc(WATCH_LABEL[d.state])}</span>${d.gained.length ? `<small>تحققت: ${names(d.gained)}</small>` : ''}${d.lost.length ? `<small>سقطت: ${names(d.lost)}</small>` : ''}`;
    return `<tr data-open-watch="${esc(sym)}"><td class="sc-sticky"><button type="button" class="fav-toggle on" data-watch="${esc(sym)}" aria-pressed="true" aria-label="إزالة ${esc(s.name)} من المراقبة">★</button><span class="symbol-badge">${esc(sym)}</span> <span class="sc-name">${esc(s.name)}</span></td>
      <td>${esc(s.sector)}</td><td><bdi class="num price">${fmtPrice(s.price)}</bdi></td>
      <td><span class="sc-score s${s.score}"><bdi class="num" dir="ltr">${s.score}/6</bdi></span>${saved.score != null ? `<small>عند الحفظ: <bdi class="num" dir="ltr">${saved.score}/6</bdi></small>` : ''}</td>
      <td>${change}</td><td><button type="button" class="sc-open" data-open-watch-btn>التفاصيل</button></td></tr>`;
  }).join('');
  box.innerHTML = `<div class="sc-banner" role="note">قائمة مراقبة شخصية تُحفظ في هذا المتصفح فقط. تُقارن مفاتيح كل سهم الآن بما كانت عليه وقت الحفظ، وتتحدث بعد كل تحديث أسعار.</div>
    ${missingFavs.length ? `<p><button type="button" class="sc-btn" data-import-favs>أضف أسهم المفضلة (${missingFavs.length}) إلى المراقبة</button></p>` : ''}
    ${symbols.length ? `<div class="table-wrap sc-wrap"><table class="sc-table sc-watch-table"><thead><tr><th class="sc-sticky">السهم</th><th>القطاع</th><th>السعر</th><th>المجموع</th><th>التغيّر منذ الحفظ</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="sc-empty"><strong>القائمة فارغة.</strong><p>اضغط ☆ بجانب أي سهم في القائمة أو في بطاقة التفاصيل لمتابعة تغيّر مفاتيحه.</p></div>'}`;
}

function toggle(symbol) {
  watch = toggleWatch(watch, symbol, stockOf(symbol), data.meta.dataDate, new Date().toISOString());
  saveWatch(store.get(), watch);
  document.querySelectorAll(`[data-watch="${CSS.escape(symbol)}"]`).forEach(b => {
    const on = !!watch[symbol]; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on);
    if (b.classList.contains('fav-toggle')) b.textContent = on ? '★' : '☆'; else if (b.classList.contains('sc-btn')) b.textContent = on ? '★ في المراقبة' : '☆ أضف للمراقبة';
  });
  renderWatch();
}

export async function init(api) {
  ta = api; filters = readFilters(); watch = loadWatch(store.get());
  const scanner = $('sc-scanner');
  try {
    data = await getJson('signals.json');
    const known = await ta.ready; ta.knownSymbols = new Set(known ? [...known.keys()] : []);
  } catch (error) {
    console.warn('Scanner data unavailable:', error);
    scanner.innerHTML = '<p class="cq-empty">تعذر تحميل بيانات الماسح. تبويب «الشارت» يعمل بشكل طبيعي.</p>';
    return;
  }
  renderScanner(); renderWatch();

  scanner.addEventListener('change', e => {
    const el = e.target; if (!(el instanceof HTMLSelectElement) && !(el instanceof HTMLInputElement)) return;
    if (el.name === 'sort') sortKey = el.value;
    else if (el.name === 'excludeLoss') filters.excludeLoss = el.value === '1';
    else if (['minValue', 'minScore'].includes(el.name)) filters[el.name] = +el.value;
    else filters[el.name] = el.value;
    writeFilters(); renderResult();
  });
  scanner.addEventListener('input', e => { if (e.target.name === 'query') { filters.query = e.target.value; renderResult(); } });
  scanner.addEventListener('submit', e => e.preventDefault());
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const w = t.closest('[data-watch]'); if (w) { e.stopPropagation(); toggle(w.dataset.watch); return; }
    if (t.closest('[data-reset]')) { filters = { ...DEFAULT_FILTERS }; sortKey = 'score'; writeFilters(); renderScanner(); return; }
    if (t.closest('[data-lower-score]')) { filters.minScore = 4; writeFilters(); renderScanner(); return; }
    if (t.closest('[data-card-close]')) { closeCard(); return; }
    const wo = t.closest('[data-open-watch]'); if (wo) { openCard(wo.dataset.openWatch); return; }
    if (t.closest('[data-import-favs]')) {
      try { for (const x of JSON.parse(localStorage.getItem('saudi-sectors-favorites') || '[]').map(String)) if (!watch[x] && (data.stocks[x] || ta_known(x))) watch = toggleWatch(watch, x, stockOf(x), data.meta.dataDate, new Date().toISOString()); } catch { /* ignore */ }
      saveWatch(store.get(), watch); renderWatch(); return;
    }
    const row = t.closest('tr[data-open]'); if (row && scanner.contains(row)) openCard(row.dataset.open);
  });
}

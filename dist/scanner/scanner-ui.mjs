// واجهة ماسح السوق وقائمة المراقبة. تقرأ dist/scanner/signals.json (يبنيه scripts/build-scanner.mjs بعد كل
// تحديث أسعار) ولا تحسب أي مؤشر بنفسها. كل المنطق القابل للاختبار في scanner-logic.mjs.
import { DEFAULT_FILTERS, filterItems, sortItems, concurrentCounts, watchDiff, loadWatch, saveWatch, toggleWatch,
  fmtPrice, fmtNum, fmtValue, escapeHtml as esc, TREND_LABEL, STATUS_LABEL, WATCH_LABEL } from './scanner-logic.mjs';

const FILTER_KEY = 'saudi-sectors-scanner-filters';
const base = file => new URL(file, import.meta.url);
const getJson = async file => { const r = await fetch(base(file), { cache: 'no-cache' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const store = { get: () => { try { return localStorage; } catch { return { getItem: () => null, setItem() { throw new Error('blocked'); } }; } } };

let ta, data, stats, watch, filters, sortKey = 'fresh', card = null, cardObserver = null;
const $ = id => document.getElementById(id);
const names = () => Object.fromEntries(Object.entries(data.strategies).map(([k, v]) => [k, v.name]));
const itemsOf = symbol => data.items.filter(i => i.symbol === symbol);
const stockOf = symbol => data.stocks[symbol];
const reasonOf = symbol => Object.entries(data.meta.excluded || {}).find(([, list]) => list.includes(symbol))?.[0] || null;
const REASON = { suspended: 'السهم موقوف', stale: 'آخر شمعة أقدم من أحدث جلسة', unverified: 'تعذر التحقق من إغلاقه الرسمي', shortHistory: 'تاريخه أقصر من سنة تداول', dataQuality: 'جودة بياناته الأخيرة غير كافية', illiquid: 'سيولته أقل من مليون ريال يومياً' };
const pct = x => x == null ? '—' : `<bdi class="num">${fmtNum(x, 1)}%</bdi>`;

function readFilters() { try { return { ...DEFAULT_FILTERS, ...JSON.parse(store.get().getItem(FILTER_KEY) || '{}') }; } catch { return { ...DEFAULT_FILTERS }; } }
function writeFilters() { try { store.get().setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ } }

/* ---------- ماسح السوق ---------- */
function banner() {
  const m = data.meta;
  if (!m.valid) return `<div class="sc-banner sc-bad" role="alert"><strong>تعذر التحقق من البيانات، فلا تُعرض أي إشارات.</strong> ${esc(m.reasonInvalid || '')}</div>`;
  const age = Math.floor((Date.now() - Date.parse(m.dataDate)) / 864e5);
  const excluded = Object.entries(m.excluded || {}).map(([k, v]) => `${REASON[k] || k}: ${v.length}`).join(' · ');
  return `<div class="sc-banner" role="note"><strong>ماسح وصفي وليس توصية.</strong> يرصد الأسهم التي يتطابق رسمها مع شروط استراتيجيات فنية معروفة. اختُبرت هذه الاستراتيجيات تاريخياً بعد العمولة والانزلاق ولم تُثبت فاعلية أي منها في فترة الاختبار خارج العينة (2022–2026)، ولذلك تُعرض كلها بوسم «غير مثبتة». المستويات مرجعية وليست أوامر، وليست احتمال ربح.</div>
  <div class="sc-meta"><span>آخر تحديث للبيانات: <bdi class="num">${esc(m.dataDate)}</bdi></span><span>الأسهم المفحوصة: <bdi class="num">${m.scanned}</bdi> من <bdi class="num">${m.universe}</bdi></span><span>اتجاه السوق (تقريبي): <b>${esc(TREND_LABEL[m.market?.regime] || '—')}</b></span>${age > 5 ? '<span class="sc-warn">البيانات أقدم من 5 أيام</span>' : ''}${excluded ? `<span class="sc-dim" title="الأسهم المستبعدة من الفحص">مستبعد: ${esc(excluded)}</span>` : ''}</div>`;
}

function filterBar() {
  const sectors = [...new Set(Object.values(data.stocks).map(s => s.sector))].sort((a, b) => a.localeCompare(b, 'ar'));
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const f = filters;
  return `<form class="sc-filters" id="sc-filters" autocomplete="off" aria-label="فلاتر الماسح">
    <label>الاستراتيجية<select name="strategy">${opt('all', 'الكل', f.strategy)}${Object.entries(data.strategies).map(([k, v]) => opt(k, v.name, f.strategy)).join('')}</select></label>
    <label>القطاع<select name="sector">${opt('all', 'الكل', f.sector)}${sectors.map(s => opt(s, s, f.sector)).join('')}</select></label>
    <label>اتجاه السهم<select name="trend">${opt('all', 'الكل', f.trend)}${opt('up', 'صاعد', f.trend)}${opt('side', 'عرضي / غير واضح', f.trend)}${opt('down', 'هابط', f.trend)}</select></label>
    <label>الإشارة<select name="status">${opt('all', 'الكل', f.status)}${opt('new', 'جديدة فقط', f.status)}${opt('continuing', 'مستمرة فقط', f.status)}</select></label>
    <label>عمر الإشارة<select name="maxAge">${opt(0, 'اليوم فقط', f.maxAge)}${opt(2, 'آخر 3 جلسات', f.maxAge)}${opt(4, 'آخر 5 جلسات', f.maxAge)}${opt(9, 'آخر 10 جلسات', f.maxAge)}</select></label>
    <label>أدنى متوسط قيمة تداول (20 يوماً)<select name="minValue">${opt(1e6, 'مليون ريال', f.minValue)}${opt(5e6, '5 ملايين', f.minValue)}${opt(10e6, '10 ملايين', f.minValue)}${opt(25e6, '25 مليوناً', f.minValue)}${opt(50e6, '50 مليوناً', f.minValue)}</select></label>
    <label>أقصى مسافة للوقف<select name="maxRisk">${opt('', 'بلا حد', f.maxRisk ?? '')}${opt(5, '5%', f.maxRisk)}${opt(8, '8%', f.maxRisk)}${opt(12, '12%', f.maxRisk)}</select></label>
    <label>ترتيب حسب<select name="sort">${[['fresh', 'الأحدث ثم السيولة'], ['liquidity', 'السيولة'], ['volume', 'الحجم مقابل المتوسط'], ['concurrent', 'عدد الإشارات المتزامنة'], ['strategy', 'الاستراتيجية'], ['risk', 'أقل مسافة للوقف']].map(([k, l]) => opt(k, l, sortKey)).join('')}</select></label>
    <label class="sc-search">بحث<input type="search" name="query" value="${esc(f.query)}" placeholder="رمز أو اسم أو قطاع"></label>
    <button type="button" class="sc-reset" data-reset>إعادة الضبط</button>
  </form>`;
}

function tableRows(list, counts) {
  return list.map(it => {
    const s = stockOf(it.symbol), watched = !!watch[it.symbol], info = data.strategies[it.strategy];
    return `<tr data-open="${esc(it.symbol)}" data-strategy="${esc(it.strategy)}">
      <td class="sc-sticky"><button type="button" class="fav-toggle${watched ? ' on' : ''}" data-watch="${esc(it.symbol)}" aria-pressed="${watched}" aria-label="${watched ? 'إزالة' : 'إضافة'} ${esc(s.name)} ${watched ? 'من' : 'إلى'} قائمة المراقبة" title="${watched ? 'إزالة من المراقبة' : 'إضافة إلى المراقبة'}">${watched ? '★' : '☆'}</button><span class="symbol-badge">${esc(it.symbol)}</span> <span class="sc-name">${esc(s.name)}</span></td>
      <td>${esc(s.sector)}</td>
      <td><bdi class="num price">${fmtPrice(s.price)}</bdi></td>
      <td>${esc(info.name)} <span class="sc-tag" title="لم تجتز هذه الاستراتيجية معايير القبول في الاختبار التاريخي">غير مثبتة</span></td>
      <td><span class="sc-status ${it.status}">${STATUS_LABEL[it.status]}</span></td>
      <td><span class="sc-trend ${s.trend}">${TREND_LABEL[s.trend]}</span></td>
      <td><bdi class="num ${s.volRatio >= 1.5 ? 'up' : ''}">${s.volRatio == null ? '—' : `${fmtNum(s.volRatio, 1)}×`}</bdi></td>
      <td><bdi class="num">${fmtValue(s.tradedValue)}</bdi><small class="sc-dim">متوسط ${fmtValue(s.avgVal20)}</small></td>
      <td><bdi class="num">${fmtPrice(it.entryRef)}</bdi></td>
      <td><bdi class="num down">${fmtPrice(it.stop)}</bdi></td>
      <td><bdi class="num up">${fmtPrice(it.target1)}</bdi></td>
      <td><bdi class="num up">${fmtPrice(it.target2)}</bdi></td>
      <td><bdi class="num">${pct(it.riskPct)}</bdi></td>
      <td><bdi class="num">${counts.get(it.symbol)}</bdi></td>
      <td><bdi class="num">${esc(it.signalDate)}</bdi></td>
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
  const list = sortItems(filterItems(data.items, data.stocks, filters), data.stocks, sortKey, names()), counts = concurrentCounts(data.items);
  const out = $('sc-result');
  const head = ['السهم', 'القطاع', 'السعر', 'الاستراتيجية', 'الإشارة', 'اتجاه السهم', 'حجم اليوم / المتوسط', 'قيمة التداول', 'دخول مرجعي', 'وقف مرجعي', 'هدف 1', 'هدف 2', 'مسافة الوقف', 'إشارات متزامنة', 'تاريخ الإشارة', ''];
  out.innerHTML = list.length
    ? `<p class="sc-count-line"><bdi class="num">${list.length}</bdi> إشارة على <bdi class="num">${new Set(list.map(i => i.symbol)).size}</bdi> سهماً. الأهداف والوقف مستويات مرجعية (وقف بضعف <bdi>ATR</bdi> وأهداف <bdi>1R</bdi> و<bdi>2R</bdi>)، وليست ما اختُبر: الاختبار استخدم وقفاً متحركاً.</p>
       <div class="table-wrap sc-wrap"><table class="sc-table"><thead><tr>${head.map((h, i) => `<th${i === 0 ? ' class="sc-sticky"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${tableRows(list, counts)}</tbody></table></div>`
    : '<div class="sc-empty"><strong>لا توجد إشارات تطابق الفلاتر الحالية.</strong><p>هذا طبيعي في الأسواق الضعيفة: عدم ظهور إشارة لا يعني شيئاً عن الاتجاه القادم. جرّب توسيع الفلاتر.</p></div>';
}

/* ---------- بطاقة التفاصيل ---------- */
function levelsFor(symbol, it) {
  const s = stockOf(symbol), out = [];
  if (it) out.push({ price: it.entryRef, title: 'دخول مرجعي' }, { price: it.stop, title: 'وقف مرجعي', color: '#f05252' }, { price: it.target1, title: 'هدف 1', color: '#22c55e' }, { price: it.target2, title: 'هدف 2', color: '#22c55e' });
  if (s.support) out.push({ price: s.support, title: 'أقرب دعم', color: '#9da7b2' });
  if (s.resistance) out.push({ price: s.resistance, title: 'أقرب مقاومة', color: '#9da7b2' });
  return out;
}
const statRow = (label, v) => v ? `<tr><th>${label}</th><td><bdi class="num">${fmtNum(v.trades, 0)}</bdi></td><td>${pct(100 * v.winRate)}</td><td>${pct(100 * v.avgWin)}</td><td>${pct(100 * v.avgLoss)}</td><td><bdi class="num">${v.profitFactor == null ? '—' : fmtNum(v.profitFactor, 2)}</bdi></td><td><bdi class="num">${fmtNum(v.expectancyR, 2)}R</bdi></td></tr>` : '';
function statsBlock(strategy) {
  const st = stats?.strategies?.[strategy];
  if (!st) return '';
  const b = stats.baseline?.holdOut;
  return `<section class="sc-block sc-wide"><h4>ما قاله الاختبار التاريخي لهذه الاستراتيجية</h4>
    <div class="table-wrap"><table class="sc-mini"><thead><tr><th></th><th>صفقات</th><th>نسبة الرابحة</th><th>متوسط الربح</th><th>متوسط الخسارة</th><th>معامل الربحية</th><th>توقّع الصفقة</th></tr></thead><tbody>
    ${statRow(`تطوير ${stats.windows.development}`, st.development)}${statRow(`خارج العينة ${stats.windows.holdOut}`, st.holdOut)}${statRow('Walk-Forward', st.walkForward)}${statRow('أي سهم صاعد (مرجع)', b)}</tbody></table></div>
    <p class="sc-verdict"><b>الحكم: غير مثبتة.</b> سنوات إيجابية ${esc(st.positiveYears)}؛ عائد محفظة اختبارية في فترة خارج العينة ${pct(100 * st.portfolioHoldOut.cagr)} سنوياً بأقصى تراجع ${pct(100 * st.portfolioHoldOut.maxDrawdown)}. النتائج بعد العمولة والانزلاق، وبأسهم مدرجة اليوم فقط (تحيّز بقاء). توقّع الصفقة بوحدة R: مضاعف المخاطرة الأولية.</p></section>`;
}
function cardHtml(symbol, strategy) {
  const s = stockOf(symbol), items = itemsOf(symbol), it = items.find(i => i.strategy === strategy) || null, watched = !!watch[symbol];
  const sid = it?.strategy || strategy || items[0]?.strategy || null, info = sid ? data.strategies[sid] : null;
  const lv = it || s.levels, chg = it ? (s.price / it.entryRef - 1) * 100 : null;
  const bits = sid ? s.strat[sid] : '';
  const conds = info ? info.conditions.map((label, k) => { const ok = it ? it.conds[k][0] === 1 : bits[k] === '1', detail = it ? it.conds[k][1] : ''; return `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✗'}</span> ${esc(label)}${detail ? ` <small class="sc-dim">${esc(detail)}</small>` : ''}</li>`; }).join('') : '';
  const others = items.filter(i => i !== it).map(i => `<button type="button" class="sc-chip" data-card="${esc(symbol)}" data-card-strategy="${esc(i.strategy)}">${esc(data.strategies[i.strategy].name)}</button>`).join('');
  const why = it
    ? `ظهر السهم لأن كل شروط «${esc(info.name)}» تحققت ${it.status === 'new' ? 'عند إغلاق اليوم' : `منذ ${esc(it.signalDate)} (قبل ${it.ageSessions} جلسات) ولم يُكسر الوقف المرجعي بعد`}.`
    : 'لا توجد إشارة نشطة لهذا السهم الآن، والقائمة أدناه تبيّن أين يقف من شروط الاستراتيجية.';
  return `<article class="sc-card" aria-label="تفاصيل ${esc(s.name)}">
    <header><div class="sc-card-title"><img class="sc-logo" src="logos/${esc(symbol)}.svg" alt="" onerror="this.remove()"><div><h3>${esc(s.name)} <bdi class="num">${esc(symbol)}</bdi></h3><p>${esc(s.sector)} · الإغلاق <bdi class="num">${fmtPrice(s.price)}</bdi> · اتجاه السهم: ${TREND_LABEL[s.trend]} · اتجاه القطاع (تقريبي): ${esc(TREND_LABEL[s.sectorTrend] || '—')}</p></div></div>
      <div class="sc-card-actions"><button type="button" class="sc-btn${watched ? ' on' : ''}" data-watch="${esc(symbol)}" aria-pressed="${watched}">${watched ? '★ في المراقبة' : '☆ أضف للمراقبة'}</button><button type="button" class="sc-btn" data-card-close aria-label="إغلاق البطاقة">✕</button></div></header>
    ${info ? `<p class="sc-why"><span class="sc-tag">غير مثبتة</span> <b>${esc(info.name)}</b>${it ? ` <span class="sc-status ${it.status}">${STATUS_LABEL[it.status]}</span>` : ''} — ${why}</p>` : '<p class="sc-why">لا توجد إشارة نشطة لهذا السهم الآن.</p>'}
    ${others ? `<p class="sc-others">إشارات أخرى على السهم: ${others}</p>` : ''}
    <div class="sc-grid">
      ${info ? `<section class="sc-block"><h4>الشروط</h4><ul class="sc-conds">${conds}</ul></section>` : ''}
      <section class="sc-block"><h4>المؤشرات الداعمة</h4><ul class="sc-list ok">${s.supporting.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="sc-dim">لا شيء</li>'}</ul></section>
      <section class="sc-block"><h4>المؤشرات المعارضة</h4><ul class="sc-list no">${s.opposing.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="sc-dim">لا شيء</li>'}</ul></section>
      <section class="sc-block"><h4>أقرب دعم ومقاومة</h4><dl class="sc-dl"><dt>أقرب دعم</dt><dd><bdi class="num">${fmtPrice(s.support)}</bdi></dd><dt>أقرب مقاومة</dt><dd>${s.resistance ? `<bdi class="num">${fmtPrice(s.resistance)}</bdi>` : 'لا مقاومة قريبة (السعر قرب قمة 52 أسبوعاً)'}</dd><dt>متوسط 20 / 50 / 200</dt><dd><bdi class="num">${fmtPrice(s.sma20)} / ${fmtPrice(s.sma50)} / ${fmtPrice(s.sma200)}</bdi></dd></dl></section>
      <section class="sc-block"><h4>المستويات المرجعية</h4><dl class="sc-dl"><dt>دخول مرجعي${it ? ' (إغلاق يوم الإشارة)' : ' (إغلاق اليوم)'}</dt><dd><bdi class="num">${fmtPrice(lv.entryRef)}</bdi></dd><dt>وقف الخسارة (ضعف <bdi>ATR</bdi>)</dt><dd class="down"><bdi class="num">${fmtPrice(lv.stop)}</bdi></dd><dt>الهدف الأول (<bdi>1R</bdi>)</dt><dd class="up"><bdi class="num">${fmtPrice(lv.target1)}</bdi></dd><dt>الهدف الثاني (<bdi>2R</bdi>)</dt><dd class="up"><bdi class="num">${fmtPrice(lv.target2)}</bdi></dd><dt>المخاطرة المحتملة</dt><dd><bdi class="num">${pct(lv.riskPct)}</bdi> من سعر الدخول</dd>${chg != null ? `<dt>السعر الآن مقابل الدخول المرجعي</dt><dd><bdi class="num ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '+' : ''}${fmtNum(chg, 1)}%</bdi></dd>` : ''}</dl>
        <p class="sc-note">مستويات للاسترشاد فقط. الدخول الفعلي يكون بعد الإغلاق، والفجوات قد تتجاوز الوقف، وحدّ التذبذب اليومي ±10%. الاختبار التاريخي لم يستخدم أهدافاً ثابتة بل وقفاً متحركاً (ثلاثة أضعاف <bdi>ATR</bdi>).</p></section>
      ${info ? `<section class="sc-block"><h4>ما الذي يبطل الإشارة؟</h4><p>${esc(info.invalidation)}${it ? ` الوقف المرجعي <bdi class="num">${fmtPrice(it.stop)}</bdi>.` : ''}</p></section>` : ''}
      ${sid ? statsBlock(sid) : ''}
    </div>
    <p class="sc-foot">يُعرض الشارت أدناه بالمستويات المرجعية. البيانات حتى <bdi class="num">${esc(data.meta.dataDate)}</bdi>، وهذه ليست توصية استثمارية.</p></article>`;
}
function openCard(symbol, strategy = null, { switchTab = true } = {}) {
  const s = stockOf(symbol);
  if (!s) return;
  const it = itemsOf(symbol).find(i => i.strategy === strategy) || itemsOf(symbol)[0] || null;
  card = { symbol, strategy: it?.strategy ?? strategy };
  const slot = $('sc-card');
  slot.innerHTML = cardHtml(symbol, card.strategy); slot.hidden = false;
  if (switchTab) ta.setTab('chart', { mount: false });
  ta.mountChart(symbol, levelsFor(symbol, it)).then(() => watchChartSymbol(symbol));
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
function renderWatch() {
  const box = $('sc-watch'), symbols = Object.keys(watch);
  updateWatchBadge();
  const favs = (() => { try { const v = JSON.parse(localStorage.getItem('saudi-sectors-favorites') || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } })();
  const missingFavs = favs.filter(x => !watch[x] && (stockOf(x) || ta_known(x)));
  const rows = symbols.map(sym => {
    const s = stockOf(sym), saved = watch[sym], now = itemsOf(sym), d = watchDiff(saved, now);
    if (!s) return `<tr><td class="sc-sticky"><span class="symbol-badge">${esc(sym)}</span></td><td colspan="5" class="sc-dim">${esc(REASON[reasonOf(sym)] || 'خارج نطاق الفحص')} — لا إشارات له الآن.</td><td><button type="button" class="sc-open" data-watch="${esc(sym)}">إزالة</button></td></tr>`;
    const chips = now.map(i => `<span class="sc-chip-static">${esc(data.strategies[i.strategy].name)} <span class="sc-status ${i.status}">${STATUS_LABEL[i.status]}</span></span>`).join('') || '<span class="sc-dim">لا إشارة</span>';
    const change = `<span class="sc-change ${d.state}">${esc(WATCH_LABEL[d.state])}</span>${d.added.length ? `<small>جديد: ${d.added.map(x => esc(data.strategies[x].name)).join('، ')}</small>` : ''}${d.removed.length ? `<small>انتهى: ${d.removed.map(x => esc(data.strategies[x]?.name || x)).join('، ')}</small>` : ''}`;
    return `<tr><td class="sc-sticky"><button type="button" class="fav-toggle on" data-watch="${esc(sym)}" aria-pressed="true" aria-label="إزالة ${esc(s.name)} من المراقبة">★</button><span class="symbol-badge">${esc(sym)}</span> <span class="sc-name">${esc(s.name)}</span></td><td>${esc(s.sector)}</td><td><bdi class="num price">${fmtPrice(s.price)}</bdi></td><td class="sc-chips">${chips}</td><td>${change}</td><td><bdi class="num">${esc((saved.savedAt || '').slice(0, 10))}</bdi><small class="sc-dim">بيانات ${esc(saved.dataDate || '')}</small></td><td><button type="button" class="sc-open" data-open-watch="${esc(sym)}">التفاصيل</button></td></tr>`;
  }).join('');
  box.innerHTML = `<div class="sc-banner" role="note">قائمة مراقبة شخصية تُحفظ في هذا المتصفح فقط. تُقارن إشارات كل سهم الآن بما كانت عليه وقت الحفظ، وتتحدث بعد كل تحديث للبيانات (آخر بيانات <bdi class="num">${esc(data.meta.dataDate)}</bdi>).</div>
    ${missingFavs.length ? `<p><button type="button" class="sc-btn" data-import-favs>أضف أسهم المفضلة (${missingFavs.length}) إلى المراقبة</button></p>` : ''}
    ${symbols.length ? `<div class="table-wrap sc-wrap"><table class="sc-table sc-watch-table"><thead><tr><th class="sc-sticky">السهم</th><th>القطاع</th><th>السعر</th><th>الإشارات الآن</th><th>التغيّر منذ الحفظ</th><th>تاريخ الحفظ</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="sc-empty"><strong>القائمة فارغة.</strong><p>اضغط ☆ بجانب أي سهم في الماسح أو في بطاقة التفاصيل لمتابعة تغيّر إشاراته.</p></div>'}`;
}
const ta_known = x => ta.knownSymbols?.has(x);

function toggle(symbol) {
  watch = toggleWatch(watch, symbol, itemsOf(symbol), data.meta.dataDate, new Date().toISOString());
  saveWatch(store.get(), watch);
  document.querySelectorAll(`[data-watch="${CSS.escape(symbol)}"]`).forEach(b => { const on = !!watch[symbol]; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); if (b.classList.contains('fav-toggle')) b.textContent = on ? '★' : '☆'; else if (b.classList.contains('sc-btn')) b.textContent = on ? '★ في المراقبة' : '☆ أضف للمراقبة'; });
  renderWatch();
}

export async function init(api) {
  ta = api; filters = readFilters(); watch = loadWatch(store.get());
  const scanner = $('sc-scanner');
  try {
    [data, stats] = await Promise.all([getJson('signals.json'), getJson('strategy-stats.json').catch(() => null)]);
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
    else if (el.name === 'maxRisk') filters.maxRisk = el.value === '' ? null : +el.value;
    else if (['minValue', 'maxAge'].includes(el.name)) filters[el.name] = +el.value;
    else filters[el.name] = el.value;
    writeFilters(); renderResult();
  });
  scanner.addEventListener('input', e => { if (e.target.name === 'query') { filters.query = e.target.value; renderResult(); } });
  scanner.addEventListener('submit', e => e.preventDefault());
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const w = t.closest('[data-watch]'); if (w) { e.stopPropagation(); toggle(w.dataset.watch); return; }
    if (t.closest('[data-reset]')) { filters = { ...DEFAULT_FILTERS }; sortKey = 'fresh'; writeFilters(); renderScanner(); return; }
    if (t.closest('[data-card-close]')) { closeCard(); return; }
    const chip = t.closest('[data-card]'); if (chip) { openCard(chip.dataset.card, chip.dataset.cardStrategy, { switchTab: false }); return; }
    const wo = t.closest('[data-open-watch]'); if (wo) { openCard(wo.dataset.openWatch, null); return; }
    if (t.closest('[data-import-favs]')) {
      try { for (const x of JSON.parse(localStorage.getItem('saudi-sectors-favorites') || '[]').map(String)) if (!watch[x] && (stockOf(x) || ta_known(x))) watch = toggleWatch(watch, x, itemsOf(x), data.meta.dataDate, new Date().toISOString()); } catch { /* ignore */ }
      saveWatch(store.get(), watch); renderWatch(); return;
    }
    const row = t.closest('tr[data-open]'); if (row && scanner.contains(row)) openCard(row.dataset.open, row.dataset.strategy);
  });
}

// قائمة مراقبة جانبية بجوار شارت «التحليل الفني» على طريقة TradingView، مبنية على القطاعات:
// يختار المستخدم قطاعًا فتظهر شركاته (السعر وتغير اليوم)، والنقر على شركة يفتح شارتها في المكان نفسه.
// تحتها لوحة تفاصيل السهم المعروض: السعر والتغير ونطاق 52 أسبوعًا وأهم المؤشرات.
// تعتمد على window.TA من technical-analysis.js وعلى data.json؛ إن تعذّر شيء يبقى الشارت يعمل وحده.
(() => {
  const TA = window.TA;
  const box = document.getElementById('ta-wl');
  if (!TA || !box) return;

  const SECTOR_KEY = 'saudi-sectors-ta-watch-sector';
  const SORT_KEY = 'saudi-sectors-ta-watch-sort';
  const OPEN_KEY = 'saudi-sectors-ta-watch-open';
  const ALL = '__all', MINE = '__mine';
  const SECTOR_PAGES = window.CompanyChart?.calc?.SECTOR_PAGES || {};
  const norm = window.CompanyChart?.calc?.norm || (v => String(v ?? '').toLowerCase().trim());
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } }
  };
  const num = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const signed = (v, d = 2, suffix = '') => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)}${suffix}` : '—';
  const dir = v => !Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down';
  const pointChange = s => Number.isFinite(s.pointChange) ? s.pointChange : Number.isFinite(s.price) && Number.isFinite(s.day) ? s.price * s.day / (100 + s.day) : NaN;
  const capText = v => !Number.isFinite(v) ? '—' : v >= 1e6 ? `${num(v / 1e6, 2)} تريليون` : v >= 1000 ? `${num(v / 1000, 1)} مليار` : `${num(v, 0)} مليون`;
  const dateText = iso => { const d = iso ? new Date(`${iso}T12:00:00`) : null; return d && !isNaN(d) ? d.toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long' }) : ''; };

  let sectors = [], bySymbol = new Map(), index = null, priceDate = '';
  let sector = store.get(SECTOR_KEY, null), sort = store.get(SORT_KEY, { key: 'cap', dir: -1 }), query = '';
  let active = null, rows = [];

  const ICON_LIST = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>';
  const ICON_LINK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  box.innerHTML = `
    <div class="wl-index" id="wl-index"></div>
    <div class="wl-head">
      <label class="wl-select"><span class="sr-only">اختر القطاع</span><select id="wl-sector" aria-label="اختر القطاع"></select></label>
      <button type="button" class="wl-collapse" data-wl-toggle aria-expanded="true" title="إخفاء قائمة المراقبة">${ICON_LIST}</button>
    </div>
    <div class="wl-stats" id="wl-stats"></div>
    <div class="wl-filter"><input type="search" id="wl-filter" placeholder="تصفية بالاسم أو الرمز" aria-label="تصفية الشركات بالاسم أو الرمز" autocomplete="off" spellcheck="false"></div>
    <div class="wl-cols" role="presentation">
      <button type="button" data-sort="symbol" title="ترتيب حسب الرمز: اضغط مرة أخرى لعكس الترتيب">الرمز</button>
      <button type="button" data-sort="price" title="ترتيب حسب آخر سعر: اضغط مرة أخرى لعكس الترتيب">آخر سعر</button>
      <button type="button" data-sort="day" title="ترتيب حسب التغير: اضغط مرة أخرى لعكس الترتيب (تنازلي ▼ / تصاعدي ▲)">تغير%</button>
    </div>
    <ul class="wl-list" id="wl-list" role="listbox" aria-label="شركات القطاع" tabindex="0"></ul>
    <div class="wl-detail" id="wl-detail" aria-live="polite"></div>`;
  const $ = id => box.querySelector(`#${id}`);
  const select = $('wl-sector'), list = $('wl-list'), indexBox = $('wl-index'), detail = $('wl-detail'), stats = $('wl-stats'), filter = $('wl-filter');
  const workspace = box.closest('.ta-workspace');

  /* ---------- إظهار القائمة وإخفاؤها ---------- */
  // القائمة جزء من الشارت: زرها في شريط أدوات الشارت بجوار «ملء الشاشة»، ويعمل في الوضع العادي وفي ملء الشاشة،
  // فيمكن تكبير الشارت وحده أو معه القائمة
  let isOpen = store.get(OPEN_KEY, true) !== false;
  const toolbarButton = () => TA.chartPanel.querySelector('[data-wl-btn]');
  function paintButton() {
    const b = toolbarButton(); if (!b) return;
    b.setAttribute('aria-pressed', String(isOpen));
    b.title = isOpen ? 'إخفاء قائمة المراقبة (W)' : 'إظهار قائمة المراقبة (W)';
  }
  function setOpen(open) {
    isOpen = open;
    workspace?.classList.toggle('wl-closed', !open);
    box.querySelector('[data-wl-toggle]').setAttribute('aria-expanded', String(open));
    paintButton();
    store.set(OPEN_KEY, open);
    window.dispatchEvent(new Event('resize')); // يعيد الشارت حساب عرضه
  }
  // الشارت يعيد بناء شريط أدواته مع كل سهم، فيُعاد إدراج الزر كلما اختفى
  function ensureButton() {
    if (toolbarButton()) return;
    const end = TA.chartPanel.querySelector('.cc-toolbar .cc-end'); if (!end) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cc-full-btn cc-wl-btn'; b.dataset.wlBtn = '';
    b.innerHTML = `${ICON_LIST}<span>قائمة المراقبة</span>`;
    b.addEventListener('click', () => setOpen(!isOpen));
    end.insertBefore(b, end.querySelector('[data-full]'));
    paintButton();
  }
  box.querySelector('[data-wl-toggle]').addEventListener('click', () => setOpen(false));
  // W يُظهر القائمة أو يخفيها كما F لملء الشاشة، إلا أثناء الكتابة في حقل
  document.addEventListener('keydown', e => {
    if (e.code !== 'KeyW' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (document.body.dataset.tab && document.body.dataset.tab !== 'chart') return;
    e.preventDefault(); setOpen(!isOpen);
  });

  /* ---------- البيانات ---------- */
  function readMine() {
    try { return Object.keys(JSON.parse(localStorage.getItem('saudi-sectors-scanner-watch') || '{}')); } catch { return []; }
  }
  function stocksOf(id) {
    if (id === ALL) return sectors.flatMap(s => s.stocks);
    if (id === MINE) return readMine().map(sym => bySymbol.get(sym)).filter(Boolean);
    return sectors.find(s => s.name === id)?.stocks || [];
  }
  const SORTERS = {
    cap: (a, b) => (a.marketCap ?? -1) - (b.marketCap ?? -1),
    symbol: (a, b) => a.symbol.localeCompare(b.symbol, 'en', { numeric: true }),
    price: (a, b) => (a.price ?? -Infinity) - (b.price ?? -Infinity),
    day: (a, b) => (a.day ?? -Infinity) - (b.day ?? -Infinity)
  };

  function fillSelect() {
    const mine = readMine().length;
    select.innerHTML = `
      <optgroup label="قوائم">
        <option value="${MINE}">★ قائمتي (${mine})</option>
        <option value="${ALL}">كل الشركات (${bySymbol.size})</option>
      </optgroup>
      <optgroup label="القطاعات">
        ${sectors.map(s => `<option value="${esc(s.name)}">${esc(s.name)} (${s.stocks.length})</option>`).join('')}
      </optgroup>`;
    select.value = sector;
  }

  /* ---------- الرسم ---------- */
  function rowHtml(s, pinned = false) {
    const d = dir(s.day), on = s.symbol === active;
    return `<li role="option" id="wl-opt-${esc(s.symbol)}" data-sym="${esc(s.symbol)}" class="wl-row${pinned ? ' wl-pinned' : ''}${on ? ' on' : ''}${s.suspended ? ' wl-susp' : ''}" aria-selected="${on}">
      <img class="wl-logo" src="logos/${esc(s.symbol)}.svg" alt="" width="26" height="26" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'wl-logo wl-logo-txt',textContent:'${esc(String(s.name).trim().charAt(0))}'}))">
      <span class="wl-id"><b>${esc(s.symbol)}</b><small>${esc(s.name)}</small></span>
      <span class="wl-num wl-price">${num(s.price)}</span>
      <span class="wl-num wl-chg ${d}"><b>${signed(s.day, 2, '%')}</b><small>${signed(pointChange(s))}</small></span>
    </li>`;
  }

  // مؤشر السوق في بطاقة مستقلة أعلى القائمة، لا يدخل مع الشركات في الترتيب ولا التصفية
  function renderIndex() {
    if (!index) { indexBox.hidden = true; return; }
    const d = dir(index.day);
    indexBox.innerHTML = `<button type="button" class="wl-row wl-index-row${active === index.symbol ? ' on' : ''}" data-sym="${esc(index.symbol)}" title="فتح شارت مؤشر السوق">
      <img class="wl-logo" src="logos/${esc(index.symbol)}.svg" alt="" width="26" height="26" onerror="this.remove()">
      <span class="wl-id"><b>TASI</b><small>مؤشر السوق الرئيسية (تاسي)</small></span>
      <span class="wl-num wl-price">${num(index.price)}</span>
      <span class="wl-num wl-chg ${d}"><b>${signed(index.day, 2, '%')}</b><small>${signed(pointChange(index))}</small></span>
    </button>`;
  }

  function render() {
    const q = norm(query);
    let items = stocksOf(sector).slice();
    if (q) items = items.filter(s => s.symbol.includes(q) || norm(s.name).includes(q));
    items.sort((a, b) => sort.dir * SORTERS[sort.key](a, b));
    rows = items.map(s => s.symbol);
    list.innerHTML = (items.length ? items.map(s => rowHtml(s)).join('') :
      `<li class="wl-empty">${sector === MINE && !q ? 'قائمتك فارغة. أضف أسهمًا بالنجمة ☆ من تبويب «مفاتيح جودة السهم».' : 'لا توجد شركات مطابقة.'}</li>`);
    for (const b of box.querySelectorAll('[data-sort]')) {
      const on = b.dataset.sort === sort.key;
      b.classList.toggle('on', on);
      b.dataset.arrow = on ? (sort.dir > 0 ? '▲' : '▼') : '⇅';
      b.setAttribute('aria-sort', on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    // ملخص القطاع: عدد المرتفعة والمنخفضة ومتوسط التغير المرجّح بالقيمة السوقية
    const all = stocksOf(sector).filter(s => Number.isFinite(s.day));
    const up = all.filter(s => s.day > 0).length, down = all.filter(s => s.day < 0).length;
    const capSum = all.reduce((t, s) => t + (s.marketCap || 0), 0);
    const avg = capSum ? all.reduce((t, s) => t + s.day * (s.marketCap || 0), 0) / capSum : NaN;
    stats.innerHTML = all.length ? `<span class="up">▲ ${up}</span><span class="down">▼ ${down}</span><span class="flat">● ${all.length - up - down}</span><span class="wl-avg" title="متوسط تغير اليوم مرجّحًا بالقيمة السوقية">المتوسط <b class="${dir(avg)}">${signed(avg, 2, '%')}</b></span>` : '';
    markActive(false);
  }

  function renderDetail() {
    const s = active && (active === index?.symbol ? index : bySymbol.get(active));
    if (!s) { detail.innerHTML = ''; return; }
    const d = dir(s.day), isIndex = s === index;
    const lo = s.week52Low, hi = s.week52High;
    const pos = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? Math.min(100, Math.max(0, (s.price - lo) / (hi - lo) * 100)) : null;
    const page = !isIndex && SECTOR_PAGES[s.sector];
    const facts = isIndex ? [] : [
      ['مكرر الربحية', Number.isFinite(s.pe) && s.pe > 0 ? num(s.pe, 1) : '—'],
      ['القيمة السوقية', capText(s.marketCap)],
      ['عائد التوزيع', Number.isFinite(s.dividendYield) ? `${num(s.dividendYield, 2)}%` : '—'],
      ['منذ بداية العام', `<span class="${dir(s.ytd)}">${signed(s.ytd, 2, '%')}</span>`]
    ];
    detail.innerHTML = `
      <div class="wl-d-head">
        <img class="wl-logo" src="logos/${esc(s.symbol)}.svg" alt="" width="30" height="30" onerror="this.remove()">
        <div class="wl-d-name"><b>${esc(s.name)}</b><small>${esc(s.symbol)} · ${esc(isIndex ? 'تداول' : s.sector)}${s.suspended ? ' · <span class="down">موقوف</span>' : ''}</small></div>
        ${page ? `<a class="wl-d-link" href="${esc(page)}?symbol=${encodeURIComponent(s.symbol)}" title="نتائج ${esc(s.name)} المالية">النتائج ${ICON_LINK}</a>` : ''}
      </div>
      <div class="wl-d-price"><b class="wl-num">${num(s.price)}</b><span class="wl-num ${d}">${signed(pointChange(s))} (${signed(s.day, 2, '%')})</span></div>
      <p class="wl-d-date">إغلاق ${esc(dateText(s.priceDate || priceDate))}</p>
      ${pos == null ? '' : `
      <div class="wl-range" aria-label="نطاق 52 أسبوعًا من ${num(lo)} إلى ${num(hi)}">
        <div class="wl-range-top" dir="ltr"><span class="wl-num">${num(lo)}</span><span dir="rtl">نطاق 52 أسبوعًا</span><span class="wl-num">${num(hi)}</span></div>
        <div class="wl-range-bar" dir="ltr"><i style="width:${pos.toFixed(1)}%"></i><em style="left:${pos.toFixed(1)}%"></em></div>
      </div>`}
      ${facts.length ? `<dl class="wl-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd class="wl-num">${v}</dd></div>`).join('')}</dl>` : ''}`;
  }

  function markActive(scroll = true) {
    for (const li of list.querySelectorAll('.wl-row')) {
      const on = li.dataset.sym === active;
      li.classList.toggle('on', on); li.setAttribute('aria-selected', String(on));
      if (on && scroll) li.scrollIntoView({ block: 'nearest' });
    }
    const card = indexBox.querySelector('.wl-row');
    if (card) { const on = card.dataset.sym === active; card.classList.toggle('on', on); card.setAttribute('aria-pressed', String(on)); }
    if (active && rows.includes(active)) list.setAttribute('aria-activedescendant', `wl-opt-${active}`); else list.removeAttribute('aria-activedescendant');
  }

  /* ---------- التفاعل ---------- */
  let pendingMount = null;
  function open(sym, { delay = 0 } = {}) {
    if (!sym) return;
    active = sym; markActive(); renderDetail();
    clearTimeout(pendingMount);
    pendingMount = setTimeout(() => { if (TA.current() !== sym) TA.mountChart(sym); }, delay);
  }

  select.addEventListener('change', () => { sector = select.value; store.set(SECTOR_KEY, sector); list.scrollTop = 0; render(); });
  select.addEventListener('focus', () => { const v = select.value; fillSelect(); select.value = v; }); // يحدّث عدد «قائمتي»
  filter.addEventListener('input', () => { query = filter.value; render(); });
  filter.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); list.focus(); move(1); } });
  for (const b of box.querySelectorAll('[data-sort]')) b.addEventListener('click', () => {
    const key = b.dataset.sort;
    // الضغط على العمود نفسه يقلب الترتيب بين تنازلي ▼ وتصاعدي ▲، وعمود جديد يبدأ تنازليًا (والرمز تصاعديًا)
    sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: key === 'symbol' ? 1 : -1 };
    store.set(SORT_KEY, sort); render();
  });
  // على الجوال القائمة تحت الشارت، فبعد الاختيار يُمرَّر إلى الشارت ليرى المستخدم السهم الجديد
  const stacked = window.matchMedia('(max-width: 860px)');
  indexBox.addEventListener('click', e => {
    if (!e.target.closest('[data-sym]')) return;
    open(index.symbol);
    if (stacked.matches) TA.chartPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  list.addEventListener('click', e => {
    const li = e.target.closest('[data-sym]'); if (!li) return;
    open(li.dataset.sym);
    if (stacked.matches) TA.chartPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  function move(step) {
    if (!rows.length) return;
    const i = rows.indexOf(active);
    open(rows[i < 0 ? 0 : (i + step + rows.length) % rows.length], { delay: 160 });
  }
  // الأسهم ↑↓ تنتقل بين الشركات وتفتح شارتها كما في TradingView، وHome/End لأول القائمة وآخرها
  list.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); if (rows.length) open(rows[e.key === 'Home' ? 0 : rows.length - 1], { delay: 160 }); }
  });

  // إذا غيّر المستخدم السهم من بحث الشارت نفسه تتبعه القائمة واللوحة
  const syncFromChart = () => {
    ensureButton();
    const sym = TA.chartPanel.querySelector('.cc-head-sym')?.textContent?.trim();
    if (sym && sym !== active) { active = sym; markActive(); renderDetail(); }
  };
  new MutationObserver(syncFromChart).observe(TA.chartPanel, { childList: true, subtree: true });

  /* ---------- البدء ---------- */
  (TA.dataReady || fetch('data.json').then(r => r.json())).then(data => {
    if (!data) throw new Error('no data');
    priceDate = data.sectors[0]?.stocks[0]?.priceDate || '';
    sectors = data.sectors.map(s => ({ name: s.name, stocks: s.stocks.map(x => ({ ...x, symbol: String(x.symbol), sector: s.name })) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    bySymbol = new Map(sectors.flatMap(s => s.stocks).map(x => [x.symbol, x]));
    const m = data.marketSummary;
    if (m && Number.isFinite(m.value)) index = { symbol: 'TASI', name: 'مؤشر السوق السعودي (تاسي)', price: m.value, day: m.day, pointChange: m.pointChange, ytd: m.ytd, priceDate: data.priceDate?.split('.').reverse().join('-') };
    active = TA.current() || new URLSearchParams(location.search).get('symbol') || '2222';
    if (active.toUpperCase() === 'TASI') active = 'TASI';
    // القطاع الافتراضي: قطاع السهم المعروض، أو آخر قطاع اختاره المستخدم
    const valid = id => id === ALL || id === MINE || sectors.some(s => s.name === id);
    if (!valid(sector)) sector = bySymbol.get(active)?.sector || sectors[0]?.name;
    fillSelect(); renderIndex(); render(); renderDetail(); markActive();
    box.classList.add('ready');
  }).catch(error => {
    console.warn('Watchlist unavailable:', error);
    box.innerHTML = '<p class="cq-empty">تعذّر تحميل قائمة المراقبة.</p>';
  });

  if (!isOpen) setOpen(false);
  ensureButton();
})();

// «حركة السوق»: أربع قوائم مختصرة (أعلى 10 شركات) فوق جدول الشركات في الرئيسية:
// الأكثر ارتفاعًا، الأكثر انخفاضًا، الحجم (عدد الأسهم المتداولة)، القيمة (بالريال).
// المنطق (الترتيب والتنسيق) دوال نقية تُختبر في tests/market-movers.test.mjs،
// ويستدعي app.js الدالة paint(data) بعد كل تحديث للأسعار.
(() => {
  const LIMIT = 10;
  const f2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

  // صفحة نتائج كل قطاع (الجدول الحالي يربط اسم الشركة بها بالطريقة نفسها).
  const SECTOR_PAGES = {
    'البنوك': 'banks', 'التعدين والمعادن': 'mining', 'الاتصالات': 'telecom', 'المرافق والطاقة': 'utilities',
    'خدمات الرعاية الصحية': 'healthservices', 'المواد الاساسية': 'materials', 'البتروكيماويات': 'petrochem',
    'النفط و الغاز': 'oilgas', 'الاسمنت': 'cement', 'تجارة و تجزئة': 'retail', 'الأغذية والمشروبات': 'food',
    'الزراعة': 'agriculture', 'متعددة الأنشطة': 'multi', 'الصناعات التحويلية': 'industrial', 'العقارات': 'realestate',
    'النقل': 'transport', 'وسائل الاعلام': 'media', 'الفنادق و السياحة': 'hotels-tourism',
    'تقنية المعلومات': 'information-technology', 'خدمات الاعمال': 'business-services', 'التعليم و التدريب': 'education',
    'المراكز الرياضية': 'sports', 'موردي الادوية': 'pharma', 'الرعاية الصحية': 'health', 'المنتجات الزجاجية': 'glass',
    'السلع الاستهلاكية': 'consumer', 'أسواق الاوراق المالية': 'exchange', 'الخدمات المالية': 'financial-services',
    'التأمين': 'insurance', 'التمويل': 'finance', 'الصناديق العقارية المتداولة': 'reits',
  };
  const resultsHref = (sector, symbol) => SECTOR_PAGES[sector] ? `${SECTOR_PAGES[sector]}.html?symbol=${encodeURIComponent(symbol)}` : null;

  // الأرقام الكبيرة مختصرة بتنسيق الموقع (أرقام إنجليزية وخانتان عشريتان).
  function compact(value) {
    const n = num(value);
    if (n == null) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${f2.format(n / 1e9)} مليار`;
    if (abs >= 1e6) return `${f2.format(n / 1e6)} مليون`;
    return f0.format(n);
  }

  // قيمة التداول: القيمة المنشورة، وإلا الحجم × السعر (تقدير يُنبَّه إليه في التلميح).
  function tradedValue(stock) {
    const value = num(stock.tradedValue), volume = num(stock.volume), price = num(stock.price);
    if (value != null && value > 0) return { value, estimated: false };
    if (volume != null && volume > 0 && price != null && price > 0) return { value: volume * price, estimated: true };
    return null;
  }

  const byValueDesc = (a, b) => b.metric - a.metric || a.symbol.localeCompare(b.symbol);
  function top(items, pick, keep, limit) {
    return items.map(item => ({ item, metric: pick(item) })).filter(entry => entry.metric != null && keep(entry.metric))
      .map(entry => ({ ...entry, symbol: entry.item.symbol })).sort(byValueDesc).slice(0, limit);
  }

  // data.sectors → أربع قوائم. الأسهم الموقوفة أو بلا سعر لا تدخل أي قائمة.
  function buildLists(sectors, limit = LIMIT) {
    const stocks = (sectors || []).flatMap(sector => (sector.stocks || []).map(stock => ({ ...stock, sector: sector.name })))
      .filter(stock => !stock.suspended && num(stock.price) != null && stock.price > 0);
    const entry = (e, kind) => {
      const s = e.item, day = num(s.day), value = kind === 'value' ? tradedValue(s) : null;
      const shown = kind === 'gainers' || kind === 'losers' ? day : e.metric;
      return { symbol: s.symbol, name: s.name, sector: s.sector, price: s.price, day, kind, metric: shown,
        estimated: !!value?.estimated, href: resultsHref(s.sector, s.symbol) };
    };
    return {
      gainers: top(stocks, s => num(s.day), v => v > 0, limit).map(e => entry(e, 'gainers')),
      // الأكثر انخفاضًا: الأكبر هبوطًا أولًا (يُرتَّب بعكس الإشارة ويُعرض التغير الفعلي).
      losers: top(stocks, s => num(s.day) == null ? null : -s.day, v => v > 0, limit).map(e => entry(e, 'losers')),
      volume: top(stocks, s => num(s.volume), v => v > 0, limit).map(e => entry(e, 'volume')),
      value: top(stocks, s => tradedValue(s)?.value ?? null, v => v > 0, limit).map(e => entry(e, 'value')),
    };
  }
  const LISTS = [
    ['gainers', 'الأكثر ارتفاعًا'],
    ['losers', 'الأكثر انخفاضًا'],
    ['volume', 'الحجم'],
    ['value', 'القيمة'],
  ];
  const HINTS = {
    gainers: 'أعلى 10 شركات حسب نسبة التغير اليومي',
    losers: 'أدنى 10 شركات حسب نسبة التغير اليومي',
    volume: 'أعلى 10 شركات حسب عدد الأسهم المتداولة',
    value: 'أعلى 10 شركات حسب قيمة التداول بالريال',
  };

  function shown(row) {
    if (row.kind === 'gainers' || row.kind === 'losers') {
      return `${row.metric > 0 ? '+' : ''}${f2.format(row.metric)}%`;
    }
    return compact(row.metric);
  }
  function tone(row) { return row.day == null || row.day === 0 ? 'flat' : row.day > 0 ? 'up' : 'down'; }

  function rowHtml(row) {
    const title = row.kind === 'volume' ? `الحجم: ${f0.format(row.metric)} سهم`
      : row.kind === 'value' ? `قيمة التداول: ${f0.format(row.metric)} ريال${row.estimated ? ' (تقدير: الحجم × السعر)' : ''}` : `${row.name} · التغير اليومي`;
    const inner = `<span class="mover-symbol">${esc(row.symbol)}</span><span class="mover-name">${esc(row.name)}</span><span class="mover-price num">${f2.format(row.price)}</span><span class="mover-value num ${tone(row)}" dir="${row.kind === 'gainers' || row.kind === 'losers' ? 'ltr' : 'rtl'}">${shown(row)}${row.estimated ? '<sup aria-hidden="true">≈</sup>' : ''}</span>`;
    return row.href
      ? `<li><a class="mover-row" href="${esc(row.href)}" title="${esc(title)}">${inner}</a></li>`
      : `<li><span class="mover-row" title="${esc(title)}">${inner}</span></li>`;
  }
  function cardHtml(key, label, rows, active) {
    const body = rows.length ? `<ol class="mover-list">${rows.map(rowHtml).join('')}</ol>`
      : `<p class="mover-empty">${key === 'volume' || key === 'value' ? 'بيانات التداول غير متاحة بعد لهذه الجلسة' : 'لا توجد شركات'}</p>`;
    return `<section class="mover-card${active ? ' is-active' : ''}" id="movers-${key}" data-mover="${key}" aria-labelledby="movers-${key}-title"><h3 id="movers-${key}-title" class="mover-title" title="${esc(HINTS[key])}">${label}</h3>${body}</section>`;
  }
  function html(lists, active = 'gainers') {
    const tabs = LISTS.map(([key, label]) => `<button type="button" role="tab" class="mover-tab" data-mover-tab="${key}" aria-selected="${key === active}" aria-controls="movers-${key}">${label}</button>`).join('');
    return `<div class="mover-tabs" role="tablist" aria-label="قوائم حركة السوق">${tabs}</div><div class="mover-grid">${LISTS.map(([key, label]) => cardHtml(key, label, lists[key] || [], key === active)).join('')}</div><button type="button" class="mover-more" data-mover-more aria-expanded="false">عرض كل العشر</button>`;
  }

  // ---- الواجهة ----
  let active = 'gainers', expanded = false;
  function apply(root) {
    root.dataset.active = active;
    root.classList.toggle('is-expanded', expanded);
    for (const card of root.querySelectorAll('.mover-card')) card.classList.toggle('is-active', card.dataset.mover === active);
    for (const tab of root.querySelectorAll('.mover-tab')) tab.setAttribute('aria-selected', String(tab.dataset.moverTab === active));
    const more = root.querySelector('[data-mover-more]');
    if (more) { more.setAttribute('aria-expanded', String(expanded)); more.textContent = expanded ? 'عرض أقل' : 'عرض كل العشر'; }
  }
  function paint(snapshot) {
    const root = typeof document === 'undefined' ? null : document.getElementById('market-movers-body');
    if (!root || !snapshot?.sectors) return;
    root.innerHTML = html(buildLists(snapshot.sectors), active);
    apply(root);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
      const root = document.getElementById('market-movers-body');
      if (!root || !root.contains(event.target)) return;
      const tab = event.target.closest('[data-mover-tab]');
      if (tab) { active = tab.dataset.moverTab; apply(root); return; }
      if (event.target.closest('[data-mover-more]')) { expanded = !expanded; apply(root); }
    });
  }

  const api = { buildLists, compact, tradedValue, resultsHref, html, paint };
  if (typeof window !== 'undefined') window.MarketMovers = api;
})();

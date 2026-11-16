// بطاقة «السهم»: سعر السهم وتغيره اليومي وربحيته ومكرراته وعائد التوزيع، ثم شارت السهم (company-chart.js).
// تظهر تحت «نبذة عن الشركة» (أو تحت عنوان الشركة إن لم تكن لها نبذة) في صفحات النتائج.
// تقرأ الرمز من شارة .symbol-badge في العنوان، فتتحدث تلقائيًا عند التنقل بين الشركات.
// الأسعار من data.json (إغلاق تداول الرسمي)، والربحية والقيمة الدفترية من financial-map.json كما في الصفحة الرئيسية،
// والشموع اليومية من ohlc/<الرمز>.json.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const f2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = value => value == null ? '—' : f2.format(value);
  const dotDate = iso => iso ? iso.split('-').reverse().join('.') : '';

  // الصناديق العقارية تُتداول بالوحدات لا بالأسهم
  const UNIT = /(^|\/)reits\.html$/.test(location.pathname) ? 'الوحدة' : 'السهم';
  let stocks = null, financials = null, shown = null;
  const candleCache = new Map();

  /* ---------- الأرقام ---------- */
  function figures(stock) {
    const record = financials?.[stock.symbol];
    // نفس منطق الصفحة الرئيسية: الربحية المتكررة من أرقام، ثم المعلنة، ثم ربحية ملف الأسعار
    const recurring = num(record?.recurring), reported = num(record?.reported);
    const eps = recurring ?? reported ?? num(stock.eps);
    const price = num(stock.price), book = num(record?.book) ?? num(stock.bookValue);
    const pe = eps > 0 && price > 0 ? price / eps : null;
    const day = num(stock.day), dir = day > 0 ? 'up' : day < 0 ? 'down' : 'flat';
    // بلا سطر تعليق تحت الأرقام؛ التاريخ والمصدر في وسم رأس الصندوق
    const tile = (label, value, unit, cls = '') => `<div class="cq-tile ${cls}"><span class="cq-label">${label}</span><span class="cq-value"><bdi>${value}</bdi>${unit ? `<small>${unit}</small>` : ''}</span></div>`;
    return [
      tile(`سعر ${UNIT}`, fmt(price), 'ريال', 'cq-price'),
      tile('التغير اليومي', day == null ? '—' : `${day > 0 ? '▲' : day < 0 ? '▼' : ''} ${f2.format(Math.abs(day))}%`, '', `cq-${dir}`),
      tile(`ربح ${UNIT}`, fmt(eps), 'ريال'),
      tile('مكرر الأرباح', pe == null ? (eps != null && eps <= 0 ? 'سالب' : '—') : fmt(pe), pe == null ? '' : 'مرة'),
      tile('القيمة الدفترية', fmt(book), 'ريال'),
      tile('عائد التوزيع', num(stock.dividendYield) == null ? '—' : `${f2.format(stock.dividendYield)}%`, '')
    ].join('');
  }

  async function loadCandles(symbol) {
    // الملف الأخير وملف التاريخ معًا (company-chart.js)؛ تتغير يوميًا فلا تُؤخذ من ذاكرة المتصفح
    if (!candleCache.has(symbol)) candleCache.set(symbol, window.CompanyChart?.load ? window.CompanyChart.load(symbol)
      : fetch(`ohlc/${encodeURIComponent(symbol)}.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(d => d?.d?.length > 1 ? d : null).catch(() => null));
    return candleCache.get(symbol);
  }

  function card(stock) {
    return `
      <div class="cq-head"><h3 id="cq-title">${UNIT}</h3><div class="cp-tags"><span class="cp-tag">${stock.priceStatus === 'official_close' ? 'إغلاق رسمي' : 'آخر سعر متاح'} · ${esc(dotDate(stock.priceDate))} · المصدر: تداول السعودية</span></div></div>
      <div class="cq-body">
        <div class="cq-figures">${figures(stock)}</div>
        <div class="cq-chart-panel"><p class="cq-empty">جار تحميل الشارت…</p></div>
      </div>`;
  }

  async function paint() {
    const heading = document.querySelector('.bank-heading');
    const symbol = heading?.querySelector('.symbol-badge')?.textContent.trim();
    if (!stocks || !heading || !symbol || symbol === shown) return;
    const stock = stocks.get(symbol);
    let box = document.getElementById('company-quote');
    if (!stock) { box?.remove(); shown = symbol; return; }
    const anchor = document.getElementById('company-profile') || heading;
    if (!box) {
      box = document.createElement('section');
      box.id = 'company-quote';
      box.className = 'company-profile company-quote cq-wide';
      box.setAttribute('aria-labelledby', 'cq-title');
    }
    // يبقى تحت النبذة حتى لو أُعيد رسمها
    if (box.previousElementSibling !== anchor) anchor.after(box);
    shown = symbol;
    box.innerHTML = card(stock);
    const ohlc = await loadCandles(symbol), panel = box.querySelector('.cq-chart-panel');
    if (shown !== symbol) return;
    if (ohlc && window.CompanyChart) window.CompanyChart.mount(panel, ohlc);
    else panel.innerHTML = '<p class="cq-empty">لا تتوفر بيانات الشموع لهذا السهم بعد.</p>';
  }

  async function start() {
    try {
      const [prices, map] = await Promise.all([
        fetch('data.json').then(r => r.json()),
        fetch('financial-map.json').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      stocks = new Map(prices.sectors.flatMap(sector => sector.stocks).map(stock => [String(stock.symbol), stock]));
      financials = map?.snapshot || null;
    } catch (error) { console.warn('Price snapshot unavailable:', error); return; }
    paint();
    new MutationObserver(() => { paint(); const box = document.getElementById('company-quote'), anchor = document.getElementById('company-profile'); if (box && anchor && box.previousElementSibling !== anchor) anchor.after(box); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

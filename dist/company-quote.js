// بطاقة «السهم»: سعر السهم وتغيره اليومي وربحيته ومكرراته وعائد التوزيع، وإلى يسارها شارت صغير بمدد متعددة
// (الشارت الكامل في صفحة التحليل الفني technical-analysis.html).
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

  // مدد الشارت الصغير، بالنفس الخيارات المعروضة في الشارت الكامل (يوم وأيام وأشهر وسنوات والكل)
  // months: عدد الأشهر إلى الوراء من آخر جلسة؛ days: عدد الجلسات؛ all: كامل الملف
  const MINI_RANGES = [
    { id: '1d', label: 'يوم', sessions: 1 },
    { id: '5d', label: '5 أيام', sessions: 5 },
    { id: '3m', label: '3 أشهر', months: 3 },
    { id: '6m', label: '6 أشهر', months: 6 },
    { id: '1y', label: 'سنة', months: 12 },
    { id: '2y', label: 'سنتين', months: 24 },
    { id: '5y', label: '5 سنوات', months: 60 },
    { id: 'all', label: 'الكل' }
  ];
  let miniRange = '1y'; // يبقى المختار عند التنقل بين الشركات

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

  // أسعار اليوم والخمسة أيام كل 5 دقائق (intraday/<الرمز>.json)، تُحدَّث مع التحديث الدوري للأسعار
  const intradayCache = new Map();
  const loadIntraday = symbol => {
    if (!intradayCache.has(symbol)) intradayCache.set(symbol, fetch(`intraday/${encodeURIComponent(symbol)}.json`, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).then(d => d?.t?.length > 1 ? d : null).catch(() => null));
    return intradayCache.get(symbol);
  };
  // توقيت الرياض للفترات الداخلية: «YYYY-MM-DD» و«HH:MM»
  const riyadh = epoch => new Date((epoch + 3 * 3600) * 1000).toISOString();

  // الشارت الصغير: للمدد الزمنية الطويلة إغلاقات يومية معدلة للتوزيعات (كما في ADJ)، وليوم وخمسة أيام الأسعار كل 5 دقائق،
  // مساحة خطية مربعة، والنقر عليه يفتح التحليل الفني
  function miniChart(file, symbol, rangeId, intraday) {
    const calc = window.CompanyChart?.calc;
    const empty = '<p class="cq-empty cq-mini-empty">لا تتوفر شموع لهذا السهم بعد.</p>';
    if (!calc || !file?.d?.length || file.d.length !== file.c?.length) return empty;
    const raw = file.d.map((time, i) => ({ time, close: file.c[i] }));
    const dividends = (file.div || []).filter(([d]) => d > raw[0].time && d <= raw.at(-1).time);
    const bars = calc.adjustDividends(raw, dividends);
    const last = bars.at(-1);
    const range = MINI_RANGES.find(r => r.id === rangeId) || MINI_RANGES[4];
    let series, base;
    if (range.sessions && intraday?.t?.length > 1) {
      // آخر جلسات التداول في الملف، ونقطة الأساس إغلاق الجلسة السابقة لأول جلسة معروضة
      const points = intraday.t.map((t, i) => ({ epoch: t, iso: riyadh(t), close: intraday.c[i] }));
      const days = [...new Set(points.map(p => p.iso.slice(0, 10)))].slice(-range.sessions);
      series = points.filter(p => days.includes(p.iso.slice(0, 10)));
      const previous = raw.filter(b => b.time < days[0]).at(-1);
      base = (previous ? previous.close : series[0].close);
      const stamp = p => range.sessions === 1 ? p.iso.slice(11, 16) : `${dotDate(p.iso.slice(0, 10)).slice(0, 5)} ${p.iso.slice(11, 16)}`;
      series = series.map(p => ({ time: p.iso, close: p.close, stamp: stamp(p) }));
    } else {
      if (range.months) {
        const from = new Date(`${last.time}T12:00:00Z`);
        from.setUTCMonth(from.getUTCMonth() - range.months);
        const iso = from.toISOString().slice(0, 10);
        series = bars.filter(b => b.time >= iso);
      } else series = bars;
      base = series[0]?.close;
      series = series.map(b => ({ time: b.time, close: b.close, stamp: dotDate(b.time) }));
    }
    if (series.length < 2) return empty;
    const first = series[0], lastPoint = series.at(-1);
    const values = series.map(b => b.close), min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const W = 100, H = 100, pad = 4;
    const x = i => (i / (series.length - 1)) * W;
    const y = v => pad + (1 - (v - min) / span) * (H - 2 * pad);
    const line = series.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(b.close).toFixed(2)}`).join('');
    const change = (lastPoint.close - base) / base * 100;
    const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const buttons = MINI_RANGES.map(r => `<button type="button" data-mini-range="${r.id}" aria-pressed="${r.id === range.id}">${r.label}</button>`).join('');
    return `<div class="cq-mini">
        <div class="cq-mini-ranges" role="group" aria-label="مدة الشارت الصغير">${buttons}</div>
        <div class="cq-mini-meta">
          <span class="cq-${dir}"><bdi>${change > 0 ? '+' : ''}${f2.format(change)}%</bdi></span>
          <a class="cq-mini-open" href="technical-analysis.html?symbol=${encodeURIComponent(symbol)}">التحليل الفني ←</a>
        </div>
        <a class="cq-mini-plot-link" href="technical-analysis.html?symbol=${encodeURIComponent(symbol)}" title="فتح التحليل الفني للسهم">
          <span class="cq-mini-plot">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="cq-mini-area" d="${line}L${W} ${H}L0 ${H}Z"/><path class="cq-mini-line" d="${line}"/></svg>
            <i class="cq-mini-dot" style="top:${y(lastPoint.close).toFixed(2)}%"></i>
          </span>
        </a>
        <span class="cq-mini-foot"><bdi>${first.stamp}</bdi><bdi>${lastPoint.stamp}</bdi></span>
      </div>`;
  }

  function card(stock) {
    return `
      <div class="cq-head"><h3 id="cq-title">${UNIT}</h3><div class="cp-tags"><span class="cp-tag">${stock.priceStatus === 'official_close' ? 'إغلاق رسمي' : 'آخر سعر متاح'} · ${esc(dotDate(stock.priceDate))} · المصدر: تداول السعودية</span></div></div>
      <div class="cq-body">
        <div class="cq-figures">${figures(stock)}</div>
        <div class="cq-mini-slot"><p class="cq-empty cq-mini-empty">جار تحميل الشارت…</p></div>
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
    const [ohlc, intraday] = await Promise.all([loadCandles(symbol), loadIntraday(symbol)]), slot = box.querySelector('.cq-mini-slot');
    if (shown !== symbol || !slot) return;
    const render = () => { slot.innerHTML = miniChart(ohlc, symbol, miniRange, intraday); };
    render();
    // تغيير المدة يعيد رسم الشارت الصغير فقط
    slot.addEventListener('click', event => {
      const b = event.target.closest('[data-mini-range]');
      if (!b) return;
      event.preventDefault();
      miniRange = b.dataset.miniRange;
      render();
    });
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

// بطاقة «السهم»: سعر السهم وتغيره اليومي وربحيته ومكرراته وعائد التوزيع، مع شارت مصغر للإغلاقات اليومية.
// تظهر تحت «نبذة عن الشركة» (أو تحت عنوان الشركة إن لم تكن لها نبذة) في صفحات النتائج.
// تقرأ الرمز من شارة .symbol-badge في العنوان، فتتحدث تلقائيًا عند التنقل بين الشركات.
// الأسعار من data.json (إغلاق تداول الرسمي)، والربحية والقيمة الدفترية من financial-map.json كما في الصفحة الرئيسية،
// والإغلاقات اليومية من history/<الرمز>.json.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const f2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = value => value == null ? '—' : f2.format(value);
  const dotDate = iso => iso ? iso.split('-').reverse().join('.') : '';
  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const longDate = iso => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  const RANGES = [['1m', 'شهر', 1], ['3m', '3 أشهر', 3], ['6m', '6 أشهر', 6], ['1y', 'سنة', 12]];

  // الصناديق العقارية تُتداول بالوحدات لا بالأسهم
  const UNIT = /(^|\/)reits\.html$/.test(location.pathname) ? 'الوحدة' : 'السهم';
  let stocks = null, financials = null, shown = null, range = '1y', history = null;
  const historyCache = new Map();

  /* ---------- الأرقام ---------- */
  function figures(stock) {
    const record = financials?.[stock.symbol];
    // نفس منطق الصفحة الرئيسية: الربحية المتكررة من أرقام، ثم المعلنة، ثم ربحية ملف الأسعار
    const recurring = num(record?.recurring), reported = num(record?.reported);
    const eps = recurring ?? reported ?? num(stock.eps);
    const epsKind = recurring != null ? 'ربحية متكررة' : reported != null ? 'ربحية معلنة' : 'من ملف الأسعار';
    const price = num(stock.price), book = num(record?.book) ?? num(stock.bookValue);
    const pe = eps > 0 && price > 0 ? price / eps : null;
    const pb = book > 0 && price > 0 ? price / book : null;
    const period = record?.period ? ` · حتى ${dotDate(record.period)}` : '';
    const day = num(stock.day), dir = day > 0 ? 'up' : day < 0 ? 'down' : 'flat';
    const tile = (label, value, unit, note, cls = '') => `<div class="cq-tile ${cls}"><span class="cq-label">${label}</span><span class="cq-value"><bdi>${value}</bdi>${unit ? `<small>${unit}</small>` : ''}</span>${note ? `<span class="cq-note">${note}</span>` : ''}</div>`;
    return [
      tile(`سعر ${UNIT}`, fmt(price), 'ريال', stock.priceStatus === 'official_close' ? `إغلاق ${dotDate(stock.priceDate)}` : esc(dotDate(stock.priceDate)), 'cq-price'),
      tile('التغير اليومي', day == null ? '—' : `${day > 0 ? '▲' : day < 0 ? '▼' : ''} ${f2.format(Math.abs(day))}%`, '', day == null ? '' : day > 0 ? 'ارتفاع' : day < 0 ? 'انخفاض' : 'دون تغيير', `cq-${dir}`),
      tile(`ربح ${UNIT}`, fmt(eps), 'ريال', `${epsKind}${recurring != null || reported != null ? period : ''}`),
      tile('مكرر الأرباح', pe == null ? (eps != null && eps <= 0 ? 'سالب' : '—') : fmt(pe), pe == null ? '' : 'مرة', `السعر ÷ ربح ${UNIT}`),
      tile('القيمة الدفترية', fmt(book), 'ريال', pb == null ? '' : `مكرر القيمة الدفترية <bdi>${fmt(pb)}</bdi>`),
      tile('عائد التوزيع', num(stock.dividendYield) == null ? '—' : `${f2.format(stock.dividendYield)}%`, '', 'آخر سنة')
    ].join('');
  }

  /* ---------- الشارت المصغر ---------- */
  function slice(data) {
    const months = RANGES.find(r => r[0] === range)[2];
    const end = new Date(`${data.dates.at(-1)}T12:00:00`); end.setMonth(end.getMonth() - months);
    const from = end.toISOString().slice(0, 10);
    let start = data.dates.findIndex(d => d >= from); if (start < 0) start = 0;
    return { dates: data.dates.slice(start), close: data.close.slice(start) };
  }
  function chart(box) {
    const body = box.querySelector('.cq-chart');
    if (!history) { body.innerHTML = '<p class="cq-empty">لا تتوفر بيانات الإغلاق اليومية لهذا السهم.</p>'; return; }
    const { dates, close } = slice(history);
    const lo = Math.min(...close), hi = Math.max(...close), pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
    const min = lo - pad, max = hi + pad, W = 600, H = 150, n = close.length;
    const X = i => n > 1 ? i / (n - 1) * W : W / 2, Y = v => H - (v - min) / (max - min) * H;
    const line = close.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const first = close[0], last = close.at(-1), change = first ? (last / first - 1) * 100 : null;
    const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const name = RANGES.find(r => r[0] === range)[1];
    box.querySelector('.cq-range-change').innerHTML = change == null ? '' : `<span class="cq-${dir}"><bdi>${change > 0 ? '+' : ''}${f2.format(change)}%</bdi></span> خلال ${name === 'سنة' ? 'سنة' : name === 'شهر' ? 'شهر' : name}`;
    const loI = close.indexOf(lo), hiI = close.indexOf(hi);
    body.className = `cq-chart cq-${dir}`;
    body.innerHTML = `
      <div class="cq-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="cq-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
          <line class="cq-base" x1="0" x2="${W}" y1="${Y(first).toFixed(1)}" y2="${Y(first).toFixed(1)}" vector-effect="non-scaling-stroke"/>
          <path class="cq-area" d="${line}L${W},${H}L0,${H}Z" fill="url(#cq-fill)"/>
          <path class="cq-line" d="${line}" vector-effect="non-scaling-stroke"/>
        </svg>
        <span class="cq-mark hi" style="left:${(X(hiI) / W * 100).toFixed(2)}%;top:${(Y(hi) / H * 100).toFixed(2)}%"><bdi>${fmt(hi)}</bdi></span>
        <span class="cq-mark lo" style="left:${(X(loI) / W * 100).toFixed(2)}%;top:${(Y(lo) / H * 100).toFixed(2)}%"><bdi>${fmt(lo)}</bdi></span>
        <span class="cq-last" style="top:${(Y(last) / H * 100).toFixed(2)}%"></span>
        <span class="cq-cross" hidden></span><span class="cq-dot" hidden></span><span class="cq-tip" hidden></span>
      </div>
      <div class="cq-axis"><span>${esc(dotDate(dates[0]))}</span><span>${esc(dotDate(dates.at(-1)))}</span></div>`;
    const plot = body.querySelector('.cq-plot'), cross = plot.querySelector('.cq-cross'), dot = plot.querySelector('.cq-dot'), tip = plot.querySelector('.cq-tip');
    const move = event => {
      const rect = plot.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round((event.clientX - rect.left) / rect.width * (n - 1))));
      const x = X(i) / W * 100, y = Y(close[i]) / H * 100;
      cross.style.left = dot.style.left = `${x}%`; dot.style.top = `${y}%`;
      const vs = first ? (close[i] / first - 1) * 100 : null;
      tip.innerHTML = `<b><bdi>${fmt(close[i])}</bdi> ريال</b><span>${esc(longDate(dates[i]))}</span>${vs == null || i === 0 ? '' : `<span class="cq-${vs > 0 ? 'up' : vs < 0 ? 'down' : 'flat'}"><bdi>${vs > 0 ? '+' : ''}${f2.format(vs)}%</bdi> منذ بداية الفترة</span>`}`;
      tip.style.left = `${Math.min(Math.max(x, 14), 86)}%`;
      cross.hidden = dot.hidden = tip.hidden = false;
    };
    plot.addEventListener('pointermove', move);
    plot.addEventListener('pointerdown', move);
    plot.addEventListener('pointerleave', () => { cross.hidden = dot.hidden = tip.hidden = true; });
  }

  async function loadHistory(symbol) {
    if (!historyCache.has(symbol)) historyCache.set(symbol, fetch(`history/${encodeURIComponent(symbol)}.json`).then(r => r.ok ? r.json() : null).then(d => Array.isArray(d?.close) && d.close.length > 1 ? d : null).catch(() => null));
    return historyCache.get(symbol);
  }

  function card(stock) {
    return `
      <div class="cq-head"><h3 id="cq-title">${UNIT}</h3><div class="cp-tags"><span class="cp-tag">${stock.priceStatus === 'official_close' ? 'إغلاق رسمي' : 'آخر سعر متاح'} · ${esc(dotDate(stock.priceDate))} · المصدر: تداول السعودية</span></div></div>
      <div class="cq-body">
        <div class="cq-figures">${figures(stock)}</div>
        <div class="cq-chart-panel">
          <div class="cq-chart-head">
            <div class="cq-range" role="group" aria-label="مدة الشارت">${RANGES.map(([id, label]) => `<button type="button" data-range="${id}" aria-pressed="${id === range}">${label}</button>`).join('')}</div>
            <span class="cq-range-change"></span>
          </div>
          <div class="cq-chart"><p class="cq-empty">جار تحميل الإغلاقات اليومية…</p></div>
          <p class="cq-source">إغلاقات يومية حتى آخر إغلاق رسمي · مرّر على الشارت لعرض سعر أي يوم</p>
        </div>
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
      box.className = 'company-profile company-quote';
      box.setAttribute('aria-labelledby', 'cq-title');
      box.addEventListener('click', event => {
        const button = event.target.closest('[data-range]');
        if (!button) return;
        range = button.dataset.range;
        box.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        chart(box);
      });
    }
    // يبقى تحت النبذة حتى لو أُعيد رسمها
    if (box.previousElementSibling !== anchor) anchor.after(box);
    shown = symbol;
    box.innerHTML = card(stock);
    history = await loadHistory(symbol);
    if (shown === symbol) chart(box);
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

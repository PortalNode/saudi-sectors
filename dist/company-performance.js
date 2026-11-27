// «الأداء منذ الإدراج» داخل بطاقة «نبذة عن الشركة»: ارتفاع السهم من إغلاق أول جلسة تداول حتى
// آخر إغلاق رسمي، بدون التوزيعات ومع إعادة استثمارها. البيانات من since-listing.json
// (scripts/build-since-listing.mjs، تُحدَّث مع كل جلسة). يُضاف القسم في آخر #company-profile،
// وإذا أعادت company-profile.js رسم البطاقة يُضاف من جديد.
(() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dmy = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const monthYear = s => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  const num = v => `<span class="cpl-num">${v}</span>`;
  const pct = v => v == null ? '<span class="cpl-muted">—</span>' : `<span class="cpl-num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${(Math.abs(v) >= 1000 ? nf : nf2).format(v)}%</span>`;
  const yearsLabel = y => y >= 1 ? `${nf.format(Math.floor(y))} ${Math.floor(y) === 1 ? 'سنة' : Math.floor(y) === 2 ? 'سنتان' : Math.floor(y) <= 10 ? 'سنوات' : 'سنة'}` : 'أقل من سنة';

  let data = null, loading = null;
  const load = () => loading ??= fetch('since-listing.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => (data = j));

  function html(r) {
    const base = r.close / (1 + r.priceReturn / 100), divAdd = r.totalReturn - r.priceReturn;
    const listed = r.listed ? (r.listedPrecision === 'month' ? monthYear(r.listed) : dmy(r.listed)) : null;
    const note = r.complete ? ''
      : `<p class="cpl-partial">أقدم جلسة متاحة في البيانات ${num(dmy(r.base))}${listed ? `، والإدراج كان ${num(listed)}` : ''}؛ الأرقام هنا منذ تلك الجلسة لا منذ الإدراج الفعلي.</p>`;
    // سجل التوزيعات قبل هذا التاريخ لم يجتز الفحص مقابل الأسعار، فلا يُحسب (scripts/fetch-listing-history.mjs)
    const divNote = r.divFrom ? `<span class="cpl-sub cpl-warn">التوزيعات محسوبة منذ ${num(r.divFrom.slice(0, 4))} فقط</span>` : '';
    const tile = (label, ret, cg, value, cls, extra = '') => `
      <div class="cpl-tile ${cls}">
        <span class="cp-label">${label}</span>
        <span class="cpl-big">${pct(ret)}</span>
        <span class="cpl-sub">${cg == null ? 'أقل من سنة: لا عائد سنوي' : `سنويًا ${pct(cg)}`}</span>
        <span class="cpl-sub">1,000 ريال أصبحت ${num(nf.format(value))} ريال</span>${extra}
      </div>`;
    return `
      <div class="cpl-head"><h4 id="cpl-title">${r.complete ? 'الأداء منذ الإدراج' : `الأداء منذ ${num(r.base.slice(0, 4))}`}</h4><span class="cpl-span">${yearsLabel(r.years)} · من ${num(dmy(r.base))} إلى ${num(dmy(r.last))}</span></div>
      ${note}
      <div class="cpl-grid">
        ${tile('بدون التوزيعات (السعر فقط)', r.priceReturn, r.priceCagr, r.priceValue, 'price')}
        ${tile('مع إعادة استثمار التوزيعات', r.totalReturn, r.totalCagr, r.totalValue, 'total', divNote)}
        <ul class="cpl-facts">
          <li><span>إغلاق أول جلسة (معدّل)</span><b>${num(nf2.format(base))} ريال</b></li>
          <li><span>آخر إغلاق رسمي</span><b>${num(nf2.format(r.close))} ريال</b></li>
          <li><span>ما أضافته التوزيعات</span><b>${Math.abs(divAdd) < 0.005 ? 'لا توزيعات' : `${num((divAdd > 0 ? '+' : '') + nf2.format(divAdd))} نقطة مئوية`}</b></li>
        </ul>
      </div>
      <p class="cpl-method">الأساس إغلاق أول جلسة لا سعر الطرح. السعر معدّل للمنح والتجزئة وحقوق الأولوية؛ العائد مع التوزيعات يفترض إعادة استثمار كل توزيع نقدي في تاريخ استحقاقه، دون زكاة أو رسوم. كل توزيع مُطابق بين TradingView وYahoo ومع هبوط السعر الرسمي في تاريخ استحقاقه. المصدر: تاريخ TradingView وإغلاقات تداول السعودية الرسمية.</p>`;
  }

  async function paint() {
    const box = document.getElementById('company-profile');
    const symbol = document.querySelector('.bank-heading .symbol-badge')?.textContent.trim();
    if (!box || !symbol) return;
    const current = box.querySelector(':scope > .cpl');
    if (current?.dataset.symbol === symbol) return;
    if (!data) { await load(); if (!data) return; return paint(); }
    const r = data.stocks?.[symbol];
    current?.remove();
    if (!r || r.priceReturn == null) return;
    const el = document.createElement('div');
    el.className = 'cpl'; el.dataset.symbol = symbol; el.setAttribute('role', 'group'); el.setAttribute('aria-labelledby', 'cpl-title');
    el.innerHTML = html(r);
    box.append(el);
  }

  function start() {
    paint();
    new MutationObserver(() => paint()).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

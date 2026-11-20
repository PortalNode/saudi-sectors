// «إعلانات الشركة»: إعلانات تداول السعودية لكل شركة، تحت بطاقة السهم في صفحات النتائج.
// تقرأ الرمز من شارة .symbol-badge في العنوان فتتحدث تلقائيًا عند التنقل بين الشركات.
// البيانات من announcements/<الرمز>.json (تُحدَّث تلقائيًا بكل إعلان جديد) وتُجلب بلا ذاكرة مؤقتة.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const PAGE = 8, NEW_HOURS = 48;

  // التصنيف من العنوان؛ الترتيب مهم («نتائج اجتماع الجمعية العامة» جمعية لا نتائج)
  const CATS = [
    { id: 'agm', label: 'جمعية عامة', test: /الجمعية العامة|جمعية عمومية|الجمعية العمومية/ },
    { id: 'dividend', label: 'توزيعات أرباح', test: /توزيع|أرباح نقدية|ارباح نقدية|أسهم منحة|اسهم منحة/ },
    { id: 'meeting', label: 'لقاء ومؤتمر', test: /لقاء|مؤتمر|عرض تقديمي|مكالمة/ },
    { id: 'results', label: 'نتائج مالية', test: /النتائج المالية|القوائم المالية|نتائج مالية|قوائم مالية/ },
    { id: 'board', label: 'مجلس وتعيينات', test: /استقالة|تعيين|لجنة المراجعة|الرئيس التنفيذي|رئيس مجلس|عضو مجلس|تكليف|شغور|تشكيل/ },
    { id: 'capital', label: 'رأس المال والأسهم', test: /رأس المال|أسهم الخزينة|اسهم الخزينة|استحواذ|اندماج|صكوك|طرح|إدراج/ },
    { id: 'contract', label: 'عقود وتمويل', test: /توقيع|اتفاقية|عقد|ترسية|تسهيلات|تمويل|مذكرة تفاهم|مشروع/ }
  ];
  const OTHER = { id: 'other', label: 'أخرى' };
  const category = title => CATS.find(c => c.test.test(title)) || OTHER;

  // t: «YYYY-MM-DD» أو «YYYY-MM-DDTHH:MM» بتوقيت الرياض
  const label = t => {
    const [y, m, d] = t.slice(0, 10).split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}${t.length > 10 ? ` · ${t.slice(11, 16)}` : ''}`;
  };
  const isNew = t => {
    const when = Date.parse(t.length > 10 ? `${t}:00+03:00` : `${t}T23:59:00+03:00`);
    return Number.isFinite(when) && Date.now() - when < NEW_HOURS * 3600 * 1000 && Date.now() >= when - 12 * 3600 * 1000;
  };
  // النص يأتي أسطرًا «البند : القيمة»؛ نعرضه فقرات
  const bodyHtml = text => (text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

  // تنظيم فحوى الإعلان (announcement-format.mjs)؛ إن تعذّر تحميله يُعرض النص الخام كما كان
  let fmt = null;
  const fmtReady = import('./announcement-format.mjs?v=ann-format-20261120b').then(m => { fmt = m; }).catch(() => null);
  const parsedCache = new Map();
  const parsed = item => { if (!parsedCache.has(item.id)) parsedCache.set(item.id, fmt.parseBody(item.body)); return parsedCache.get(item.id); };

  const dateHtml = d => `<span class="ca-d">${esc(label(d.greg))}</span><small>${esc(d.hijri.split('-').join('/'))} هـ</small>`;
  const valueHtml = f => f.date ? dateHtml(f.date) : f.attached ? '<span class="ca-muted">مرفق مع الإعلان في تداول</span>' : esc(f.value).replace(/\n/g, '<br>');
  const pct = v => `${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${Math.abs(v).toFixed(2)}%`;
  const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';

  function tileHtml(t) {
    const sub = t.date ? `<small>${esc(t.date.hijri.split('-').join('/'))} هـ</small>`
      : t.change != null ? `<small class="ca-chg ${tone(t.change)}">${pct(t.change)} عن ${t.versus}</small>` : '';
    const value = t.date ? esc(label(t.date.greg)) : esc(t.value);
    return `<div class="ca-tile" ${t.rowLabel ? `title="${esc(t.rowLabel)}"` : ''}><span class="ca-tl">${esc(t.label)}</span><b class="ca-tv">${value}</b>${sub}</div>`;
  }
  function tableHtml(t) {
    const changeCols = new Set(t.heads.map((h, i) => /%/.test(h) ? i : -1).filter(i => i >= 0));
    const cell = (v, i) => {
      if (!changeCols.has(i) || v === '-') return `<td class="ca-n">${esc(v)}</td>`;
      const n = Number(v.replace(/,/g, ''));
      return `<td class="ca-n ${tone(n)}">${Number.isFinite(n) ? pct(n) : esc(v)}</td>`;
    };
    return `<div class="ca-tablewrap" tabindex="0"><table class="ca-table"><caption>${esc(t.title)}</caption>
      <thead><tr><th>البند</th>${t.heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th>${r.values.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function noteHtml(n) {
    const long = n.key.length > 60;
    return `<div class="ca-note"><h4 class="${long ? 'ca-long' : ''}">${esc(n.key)}</h4>
      ${n.paras.map(p => `<p>${esc(p)}</p>`).join('')}${n.items.length ? `<ul>${n.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  function formattedBody(item) {
    const p = parsed(item), tiles = fmt.keyPoints(p, item.title);
    // ما ظهر في «أبرز النقاط» لا يتكرر في شبكة الحقول
    const shownKeys = new Set(tiles.map(t => t.src).filter(Boolean));
    const fields = p.fields.filter(f => !shownKeys.has(f.key));
    const notes = p.notes.map(noteHtml).join('');
    return `${tiles.length ? `<div class="ca-keys"><h4>أبرز النقاط</h4><div class="ca-tiles">${tiles.map(tileHtml).join('')}</div></div>` : ''}
      ${p.lead.map(t => `<p class="ca-lead">${esc(t)}</p>`).join('')}
      ${p.tables.map(tableHtml).join('')}${p.tables.length ? '<p class="ca-unit">المبالغ كما وردت في إعلان الشركة، والنسب مقارنة بالفترة المذكورة في رأس كل عمود.</p>' : ''}
      ${fields.length ? `<dl class="ca-fields">${fields.map(f => `<div><dt>${esc(f.key)}</dt><dd>${valueHtml(f)}</dd></div>`).join('')}</dl>` : ''}
      ${p.notes.length > 3 ? `<details class="ca-notes"><summary>التفاصيل والأسباب (${p.notes.length})</summary>${notes}</details>` : notes}
      <details class="ca-raw"><summary>النص الأصلي كما نُشر</summary><div class="ca-rawtext">${bodyHtml(item.body)}</div></details>`;
  }

  let shown = null, filter = 'all', visible = PAGE, data = null;
  const cache = new Map();

  function load(symbol) {
    if (!cache.has(symbol)) {
      cache.set(symbol, fetch(`announcements/${encodeURIComponent(symbol)}.json`, { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : { items: [] }).catch(() => null));
    }
    return cache.get(symbol);
  }

  function itemHtml(item) {
    const cat = category(item.title);
    return `
      <details class="ca-item">
        <summary>
          <span class="ca-date">${esc(label(item.t))}</span>
          <span class="ca-cat ca-${cat.id}">${cat.label}</span>
          ${isNew(item.t) ? '<span class="ca-new">جديد</span>' : ''}
          <span class="ca-title">${esc(item.title)}</span>
        </summary>
        <div class="ca-body">${!item.body ? '<p class="ca-none">لا يتوفر نص لهذا الإعلان؛ راجع المصدر.</p>' : fmt ? formattedBody(item) : bodyHtml(item.body)}
          <a class="ca-link" href="${esc(item.url)}" target="_blank" rel="noopener">المصدر في تداول السعودية ↗</a>
        </div>
      </details>`;
  }

  function card(box) {
    const items = data.items, counts = {};
    items.forEach(item => { const id = category(item.title).id; counts[id] = (counts[id] || 0) + 1; });
    const chips = [{ id: 'all', label: 'الكل' }, ...CATS, OTHER].filter(c => c.id === 'all' || counts[c.id])
      .map(c => `<button type="button" data-ca-filter="${c.id}" aria-pressed="${filter === c.id}">${c.label}<b>${c.id === 'all' ? items.length : counts[c.id]}</b></button>`).join('');
    const list = items.filter(item => filter === 'all' || category(item.title).id === filter);
    box.innerHTML = `
      <div class="ca-head"><h3 id="ca-title">إعلانات الشركة</h3><div class="cp-tags"><span class="cp-tag">المصدر: تداول السعودية · آخر إعلان ${esc(label(items[0].t))}</span></div></div>
      <div class="ca-filters" role="group" aria-label="تصنيف الإعلانات">${chips}</div>
      <div class="ca-list">${list.slice(0, visible).map(itemHtml).join('')}</div>
      ${list.length > visible ? `<button type="button" class="ca-more" data-ca-more>عرض الباقي (${list.length - visible})</button>` : ''}`;
  }

  async function paint() {
    const heading = document.querySelector('.bank-heading');
    const symbol = heading?.querySelector('.symbol-badge')?.textContent.trim();
    if (!heading || !symbol) return;
    let box = document.getElementById('company-announcements');
    const anchor = document.getElementById('company-quote') || document.getElementById('company-profile') || heading;
    if (box && symbol === shown) { if (box.previousElementSibling !== anchor) anchor.after(box); return; }
    shown = symbol;
    filter = 'all'; visible = PAGE;
    const [loaded] = await Promise.all([load(symbol), fmtReady]);
    if (shown !== symbol) return;
    box = document.getElementById('company-announcements');
    if (!loaded?.items?.length) {
      if (loaded) {
        // شركة بلا إعلانات: نبقي القسم برسالة واضحة بدل إخفائه
        if (!box) { box = document.createElement('section'); box.id = 'company-announcements'; box.className = 'company-profile company-announcements'; box.setAttribute('aria-labelledby', 'ca-title'); }
        if (box.previousElementSibling !== anchor) anchor.after(box);
        data = null;
        box.innerHTML = '<div class="ca-head"><h3 id="ca-title">إعلانات الشركة</h3><div class="cp-tags"><span class="cp-tag">المصدر: تداول السعودية</span></div></div><p class="ca-empty">لا توجد إعلانات لهذه الشركة في آخر ثلاثة أشهر.</p>';
      } else box?.remove();
      return;
    }
    data = loaded;
    if (!box) {
      box = document.createElement('section');
      box.id = 'company-announcements';
      box.className = 'company-profile company-announcements';
      box.setAttribute('aria-labelledby', 'ca-title');
      box.addEventListener('click', event => {
        const chip = event.target.closest('[data-ca-filter]'), more = event.target.closest('[data-ca-more]');
        if (chip) { filter = chip.dataset.caFilter; visible = PAGE; card(box); }
        else if (more) { visible += PAGE; card(box); }
      });
    }
    if (box.previousElementSibling !== anchor) anchor.after(box);
    card(box);
  }

  function start() {
    paint();
    new MutationObserver(() => paint()).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

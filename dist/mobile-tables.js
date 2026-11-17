// جداول النتائج المالية على الجوال: نسبة التغير تحت القيمة في الخلية نفسها بدل عمود مستقل.
// في الجدول الأصلي يسبق عمودُ «التغير» عمودَ القيمة الذي يخصه (annual-change ثم القيمة)، وهذا يضاعف
// عرض الجدول. هنا ننقل نسبة التغير إلى الخلية التالية فيتقلص العرض إلى النصف تقريبًا.
// وفوق ذلك يبني «بطاقات الفترات»: كل فترة (ربع، 6 أشهر، 9 أشهر، سنة) بطاقة تُسحب أفقيًا، الأحدث أولًا،
// مع شريط للقفز بين الفترات ومفتاح «بطاقات | جدول» يُحفظ اختياره. الافتراضي بطاقات لجداول الفترات وجدول للسنوي.
// لا يعمل إلا على عرض الجوال (max-width:760px)؛ وعند الرجوع لعرض أعرض يُستعاد الجدول الأصلي كما كان.
(() => {
  const mq = window.matchMedia('(max-width:760px)');
  const LABEL = 112, VALUE = 88;          // عرض عمود البند وعمود القيمة بالبكسل بعد الدمج
  const originals = new Map();            // الجدول بعد الدمج → نسخة الجدول الأصلي (HTML)
  const holders = new Map();              // الجدول بعد الدمج → حاوية الشرح والبطاقات فوقه
  const VIEW_KEY = 'saudi-sectors-mobile-results-view';
  let busy = false;

  function merge(table) {
    if (table.dataset.merged) return;
    const original = table.outerHTML;
    const changeCount = table.querySelectorAll('thead th.annual-change-heading').length;
    if (!changeCount) {
      // جدول بلا أعمدة تغير (شركة بفترة واحدة): لا دمج، لكن لا نتركه بعرض 860px الافتراضي وأعمدته فارغة
      const values = table.querySelectorAll('thead th').length - 1;
      table.style.minWidth = `${LABEL + values * VALUE}px`;
      table.classList.add('m-merged');
      table.dataset.merged = '1';
      originals.set(table, original);
      return;
    }
    table.querySelectorAll('col.annual-col-change').forEach(col => col.remove());
    table.querySelectorAll('thead th.annual-change-heading').forEach(th => th.remove());
    for (const row of table.tBodies[0]?.rows ?? []) {
      if (row.classList.contains('annual-group')) {
        const cell = row.cells[0];
        const span = Number(cell?.getAttribute('colspan')) || 1;
        if (span > 1) cell.setAttribute('colspan', String(Math.max(1, span - changeCount)));
        continue;
      }
      for (const cell of [...row.cells]) {
        if (!cell.classList.contains('annual-change')) continue;
        const target = cell.nextElementSibling;
        const text = cell.innerHTML.trim();
        if (target && target.tagName === 'TD') {
          const small = document.createElement('span');
          small.className = 'm-change';
          small.innerHTML = text;
          target.append(small);
        }
        cell.remove();
      }
    }
    // السنة أو الفترة الأولى بلا تغير سابق: نترك مكانًا فارغًا ليبقى ارتفاع الصفوف متساويًا
    for (const row of table.tBodies[0]?.rows ?? []) {
      if (row.classList.contains('annual-group')) continue;
      for (const cell of row.cells) if (cell.tagName === 'TD' && !cell.querySelector('.m-change')) cell.insertAdjacentHTML('beforeend', '<span class="m-change m-none" aria-hidden="true">&nbsp;</span>');
    }
    const values = table.querySelectorAll('thead th').length - 1;
    table.style.minWidth = `${LABEL + values * VALUE}px`;
    table.classList.add('m-merged');
    table.dataset.merged = '1';
    originals.set(table, original);
  }

  // ---------- البطاقات ----------
  const kindOf = table => (table.classList.contains('period-table') ? 'period' : 'annual');
  const readViews = () => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') || {}; } catch { return {}; } };
  const viewFor = kind => readViews()[kind] || (kind === 'period' ? 'cards' : 'table');
  function saveView(kind, view) {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ ...readViews(), [kind]: view })); } catch { /* التخزين غير متاح */ }
  }
  function setView(kind, view) {
    for (const holder of document.querySelectorAll(`.m-view[data-kind="${kind}"]`)) {
      holder.dataset.view = view;
      if (holder._wrap) holder._wrap.dataset.view = view;
      for (const b of holder.querySelectorAll('.m-switch button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    }
  }
  // الفترة الظاهرة الآن: البطاقة الأقرب لبداية الحاوية (يمين الشاشة في العربية)
  function activeCard(cards) {
    const box = cards.getBoundingClientRect(), rtl = getComputedStyle(cards).direction === 'rtl';
    let best = 0, gap = Infinity;
    [...cards.children].forEach((card, i) => {
      const r = card.getBoundingClientRect(), d = Math.abs(rtl ? r.right - box.right : r.left - box.left);
      if (d < gap) { gap = d; best = i; }
    });
    return best;
  }
  function syncTabs(holder) {
    const i = activeCard(holder.querySelector('.q-cards'));
    holder.querySelectorAll('.q-tab').forEach((tab, k) => {
      const on = k === i;
      tab.setAttribute('aria-pressed', String(on));
      if (on && holder.dataset.view === 'cards') {
        const strip = tab.parentElement, s = strip.getBoundingClientRect(), t = tab.getBoundingClientRect();
        if (t.left < s.left || t.right > s.right) strip.scrollBy({ left: t.left < s.left ? t.left - s.left - 8 : t.right - s.right + 8 });
      }
    });
  }
  function gotoCard(holder, i) {
    const cards = holder.querySelector('.q-cards'), card = cards.children[i];
    if (!card) return;
    const box = cards.getBoundingClientRect(), r = card.getBoundingClientRect(), rtl = getComputedStyle(cards).direction === 'rtl';
    cards.scrollBy({ left: rtl ? r.right - box.right : r.left - box.left, behavior: 'smooth' });
  }
  const cell = (td) => {
    if (!td) return { val: '—', chg: '' };
    const clone = td.cloneNode(true), chg = clone.querySelector('.m-change');
    const chgHtml = chg && !chg.classList.contains('m-none') ? chg.innerHTML : '';
    chg?.remove();
    return { val: clone.innerHTML.trim() || '—', chg: chgHtml };
  };
  // يبني البطاقات من كل جداول الحاوية غير الفارغة (قد تضم الحاوية جدول النتائج وجدول الهوامش معًا)
  function cardsHtml(tables) {
    const heads = [...tables[0].tHead.rows[0].cells].slice(1);
    const body = [];
    for (const table of tables) {
      if (tables.length > 1 && table.caption) body.push({ group: table.caption.textContent.trim() });
      for (const section of table.tBodies) for (const row of section.rows) {
        if (row.classList.contains('annual-group')) body.push({ group: row.cells[0].textContent.trim() });
        else body.push({ label: row.cells[0].innerHTML, cells: heads.map((_, i) => cell(row.cells[i + 1])) });
      }
    }
    const order = heads.map((_, i) => i).reverse(); // الأحدث أولًا
    const tabs = order.map(i => `<button type="button" class="q-tab" role="tab" aria-pressed="false">${heads[i].innerHTML}</button>`).join('');
    const cards = order.map(i => `<article class="q-card"><header>${heads[i].innerHTML}</header><dl>${body.map(item => item.group
      ? `<h4>${item.group}</h4>`
      : `<div class="q-row"><dt>${item.label}</dt><dd><span class="q-val">${item.cells[i].val}</span>${item.cells[i].chg ? `<span class="q-chg">${item.cells[i].chg}</span>` : ''}</dd></div>`).join('')}</dl></article>`).join('');
    return { tabs, cards };
  }
  function decorate(wrap, tables) {
    wrap.previousElementSibling?.classList.contains('m-view') && wrap.previousElementSibling.remove();
    const first = tables[0];
    const kind = kindOf(first), hasChange = tables.some(t => t.querySelector('.m-change:not(.m-none)'));
    const periods = first.tHead.rows[0].cells.length - 1;
    const holder = document.createElement('div');
    holder.className = 'm-view';
    holder.dataset.kind = kind;
    holder._wrap = wrap;
    let html = hasChange ? '<p class="m-legend">النسبة الصغيرة تحت كل رقم هي التغير عن الفترة المقابلة السابقة.</p>' : '';
    if (periods >= 2) {
      const { tabs, cards } = cardsHtml(tables);
      const title = (first.caption?.textContent.trim() ?? '').replace(/"/g, '&quot;');
      html += `<div class="m-switch" role="group" aria-label="طريقة عرض النتائج"><button type="button" data-view="cards">بطاقات</button><button type="button" data-view="table">جدول</button></div>`
        + `<div class="q-tabs" role="tablist" aria-label="الفترات">${tabs}</div>`
        + `<div class="q-cards" tabindex="0" role="region" aria-label="${title} — بطاقات الفترات">${cards}</div>`;
    }
    holder.innerHTML = html;
    wrap.before(holder);
    holders.set(wrap, { holder, tables });
    if (periods >= 2) {
      const cardsEl = holder.querySelector('.q-cards');
      holder.querySelector('.m-switch').addEventListener('click', e => {
        const b = e.target.closest('button[data-view]');
        if (b) { saveView(kind, b.dataset.view); setView(kind, b.dataset.view); syncTabs(holder); }
      });
      holder.querySelectorAll('.q-tab').forEach((tab, i) => tab.addEventListener('click', () => gotoCard(holder, i)));
      cardsEl.addEventListener('scroll', () => syncTabs(holder), { passive: true });
      setView(kind, viewFor(kind));
      syncTabs(holder);
    } else {
      wrap.dataset.view = 'table';
    }
  }
  // لكل حاوية جداول: نبني حاوية الشرح والبطاقات مرة واحدة، ونعيد بناءها فقط إذا استُبدلت جداولها
  function decorateWraps() {
    for (const wrap of document.querySelectorAll('.annual-table-wrap')) {
      const tables = [...wrap.querySelectorAll('table.annual-table.m-merged')].filter(t => t.tBodies[0]?.rows.length);
      if (!tables.length) continue;
      const known = holders.get(wrap);
      if (known && known.tables.length === tables.length && known.tables.every((t, i) => t === tables[i]) && known.holder.isConnected) continue;
      decorate(wrap, tables);
    }
  }

  function restore() {
    for (const [table, html] of originals) {
      if (table.isConnected) {
        const holder = document.createElement('template');
        holder.innerHTML = html;
        table.replaceWith(holder.content.firstElementChild);
      }
      holders.get(table)?.remove();
    }
    originals.clear();
    holders.clear();
    document.querySelectorAll('.m-view').forEach(h => h.remove());
    document.querySelectorAll('[data-view]').forEach(w => w.removeAttribute('data-view'));
  }

  function apply() {
    if (busy) return;
    busy = true;
    try {
      if (mq.matches) {
        document.querySelectorAll('.m-view').forEach(h => { if (!h._wrap?.isConnected) h.remove(); });
        document.querySelectorAll('table.annual-table').forEach(merge);
        decorateWraps();
      }
      else restore();
    } finally { busy = false; }
  }

  // ترويسة السنوات/الفترات تبقى ظاهرة أعلى الشاشة أثناء النزول في جدول طويل. حاوية الجدول تتمرر أفقيًا
  // (overflow) فلا يعمل sticky العمودي، فنزيح الترويسة بالتمرير كما تفعل الصفحة الرئيسية (sticky-header.js).
  let frame = 0;
  function updateHeads() {
    frame = 0;
    for (const table of document.querySelectorAll('table.annual-table.m-merged')) {
      const head = table.tHead;
      if (!head) continue;
      const rect = table.getBoundingClientRect();
      // موضع الترويسة الطبيعي أسفل عنوان الجدول (caption)؛ ولا تتجاوز آخر صف
      const above = table.caption ? table.caption.offsetHeight : 0;
      const natural = rect.top + above;
      const offset = Math.max(0, Math.min(-natural, rect.height - above - head.offsetHeight));
      head.style.setProperty('--table-head-offset', `${offset}px`);
    }
  }
  const scheduleHeads = () => { if (!frame && mq.matches) frame = requestAnimationFrame(updateHeads); };

  // الجداول تُعاد كتابتها عند تغيير الشركة أو الفترة: نراقب حاوياتها وندمج الجدول الجديد
  const start = () => {
    apply();
    window.addEventListener('scroll', scheduleHeads, { passive: true });
    const root = document.querySelector('main') || document.body;
    new MutationObserver(() => { if (mq.matches) { apply(); scheduleHeads(); } }).observe(root, { childList: true, subtree: true });
    if (mq.addEventListener) mq.addEventListener('change', apply); else mq.addListener?.(apply);
    window.addEventListener('resize', apply);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

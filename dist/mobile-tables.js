// جداول النتائج المالية على الجوال: نسبة التغير تحت القيمة في الخلية نفسها بدل عمود مستقل.
// في الجدول الأصلي يسبق عمودُ «التغير» عمودَ القيمة الذي يخصه (annual-change ثم القيمة)، وهذا يضاعف
// عرض الجدول. هنا ننقل نسبة التغير إلى الخلية التالية فيتقلص العرض إلى النصف تقريبًا.
// لا يعمل إلا على عرض الجوال (max-width:760px)؛ وعند الرجوع لعرض أعرض يُستعاد الجدول الأصلي كما كان.
(() => {
  const mq = window.matchMedia('(max-width:760px)');
  const LABEL = 112, VALUE = 88;          // عرض عمود البند وعمود القيمة بالبكسل بعد الدمج
  const originals = new Map();            // الجدول بعد الدمج → نسخة الجدول الأصلي (HTML)
  const legends = new Map();              // الجدول بعد الدمج → سطر الشرح فوقه
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
    // سطر شرح قصير فوق الجدول
    const wrap = table.closest('.annual-table-wrap');
    if (wrap && !wrap.previousElementSibling?.classList.contains('m-legend')) {
      const legend = document.createElement('p');
      legend.className = 'm-legend';
      legend.textContent = 'النسبة الصغيرة تحت كل رقم هي التغير عن الفترة المقابلة السابقة.';
      wrap.before(legend);
      legends.set(table, legend);
    }
  }

  function restore() {
    for (const [table, html] of originals) {
      if (table.isConnected) {
        const holder = document.createElement('template');
        holder.innerHTML = html;
        table.replaceWith(holder.content.firstElementChild);
      }
      legends.get(table)?.remove();
    }
    originals.clear();
    legends.clear();
  }

  function apply() {
    if (busy) return;
    busy = true;
    try {
      if (mq.matches) document.querySelectorAll('table.annual-table').forEach(merge);
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

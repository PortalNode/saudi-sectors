// تحويل إجابة المحلل الذكي (Markdown) إلى HTML مرتب للصفحة العربية.
// - الأرقام كلها بالأرقام الإنجليزية 0-9، وكل رقم (مع إشارته ونسبته) معزول باتجاه LTR حتى لا ينقلب
//   «+4.5%» إلى «%4.5+» داخل النص العربي.
// - جداول Markdown تُرسم جداول حقيقية حتى لو فصل النموذج بين صفوفها بأسطر فارغة.
// - تُحذف علامات التنصيص والنجوم الشاردة (حواشي النموذج)، ويبقى **العريض** فقط.
// دالة نقية بلا DOM، تعمل في المتصفح وفي اختبارات Node.

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
export const toLatinDigits = s => String(s).replace(ARABIC_DIGITS, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(d) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/٫/g, '.').replace(/٬/g, ',').replace(/٪/g, '%');

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// رقم بإشارته وفواصله ونسبته؛ الفاصلة والنقطة والشرطة داخل الرقم فقط (لا تُلتقط نقطة نهاية الجملة).
const NUMBER = /[+\-−±]?\d(?:[0-9A-Za-z%×]|[.,:/\-–+](?=[0-9A-Za-z]))*/g;

/** نص سطر واحد: أرقام إنجليزية، بلا تنصيص أو نجوم شاردة، أرقام معزولة LTR، و**عريض**. */
export function inline(text) {
  let t = toLatinDigits(text)
    .replace(/%\s?([+\-−]?\d(?:[\d,]|\.(?=\d))*)/g, '$1%')      // «%4.5» ← «4.5%»
    .replace(/\*\*(.+?)\*\*/g, '\u0001$1\u0002')    // احفظ العريض
    .replace(/[*«»“”„"`]/g, '')                     // تنصيص ونجوم شاردة وعلامات كود
    .replace(/\s{2,}/g, ' ').trim();
  t = esc(t).replace(NUMBER, m => `<span class="n">${m}</span>`);
  return t.replace(/\u0001/g, '<b>').replace(/\u0002/g, '</b>');
}

const isTableRow = l => /^\|.*\|$/.test(l) || (/^\|/.test(l) && l.split('|').length > 2);
const isSeparator = l => /^\|?[\s:|\-–—]+\|?$/.test(l) && /-{2,}|—|–/.test(l);
const cells = l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const NUMERIC_CELL = /^[+\-−±]?[\d.,]+\s?[%×x]?$|^—$/;

function renderTable(rows) {
  const width = Math.max(...rows.map(r => r.length));
  const pad = r => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = rows;
  const td = (c, tag) => `<${tag}${NUMERIC_CELL.test(toLatinDigits(c).replace(/[*«»"]/g, '').trim()) ? ' class="ai-num"' : ''}>${inline(c)}</${tag}>`;
  return `<div class="ai-table-wrap"><table class="ai-table"><thead><tr>${pad(head).map(c => td(c, 'th')).join('')}</tr></thead>`
    + `<tbody>${body.map(r => `<tr>${pad(r).map(c => td(c, 'td')).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** Markdown مبسّط: عناوين، نقاط، قوائم مرقمة، جداول، وفقرات. */
export function renderAnswer(src) {
  const lines = toLatinDigits(src).replace(/\r/g, '').split('\n');
  const nextFilled = i => { for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim(); return ''; };
  let html = '', list = null, table = null;
  const flushList = () => { if (list) { html += `<${list.tag}>${list.items.join('')}</${list.tag}>`; list = null; } };
  const flushTable = () => { if (table) { html += renderTable(table); table = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim().replace(/^\*+\d*(?=\s)\s*/, '');   // علامة حاشية في أول السطر مثل «*1»
    if (!l) {
      const next = nextFilled(i);
      if (table && isTableRow(next)) continue;          // صفوف الجدول نفسه مفصولة بأسطر فارغة
      if (list && /^([-•*]|\d+[.)])\s+/.test(next)) continue;
      flushTable(); flushList(); continue;
    }
    if (isTableRow(l)) { flushList(); if (!isSeparator(l)) (table ??= []).push(cells(l)); continue; }
    if (table && isSeparator(l)) continue;
    flushTable();
    if (/^(-{3,}|\*{3,}|_{3,}|—{2,})$/.test(l)) { flushList(); continue; }   // خطوط فاصلة: لا داعي لها
    let m;
    if ((m = l.match(/^#{1,6}\s+(.*)$/))) { flushList(); html += `<h4>${inline(m[1])}</h4>`; continue; }
    if ((m = l.match(/^(\d+)[.)]\s+(.*)$/))) {
      if (list && list.tag !== 'ol') flushList();
      list ??= { tag: 'ol', items: [] };
      list.items.push(`<li value="${m[1]}">${inline(m[2])}</li>`); continue;
    }
    if ((m = l.match(/^[-•*]\s+(.*)$/))) {
      if (list && list.tag !== 'ul') flushList();
      list ??= { tag: 'ul', items: [] };
      list.items.push(`<li>${inline(m[1])}</li>`); continue;
    }
    flushList();
    html += `<p>${inline(l)}</p>`;
  }
  flushList(); flushTable();
  return html;
}

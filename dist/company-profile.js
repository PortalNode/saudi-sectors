// نبذة الشركة: تُضاف تحت عنوان الشركة (.bank-heading) في كل صفحات النتائج السنوية.
// تقرأ الرمز من شارة .symbol-badge في العنوان، فتتحدث تلقائيًا عند التنقل بين الشركات.
(() => {
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const years = n => n === 1 ? 'سنة واحدة' : n === 2 ? 'سنتان' : n >= 3 && n <= 10 ? `${n} سنوات` : `${n} سنة`;
  const months = n => n === 1 ? 'شهر' : n === 2 ? 'شهران' : n >= 3 && n <= 10 ? `${n} أشهر` : `${n} شهرًا`;
  const toDate = iso => new Date(`${iso}T12:00:00`);
  const dotDate = iso => iso.split('-').reverse().join('.');
  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  // listedPrecision "month": the source gives only the month and year, so the day is not shown.
  const listedLabel = p => p.listedPrecision === 'month' ? `${MONTHS[Number(p.listed.slice(5, 7)) - 1]} ${p.listed.slice(0, 4)}` : dotDate(p.listed);
  function diff(fromIso, to) {
    const from = toDate(fromIso);
    let y = to.getFullYear() - from.getFullYear(), m = to.getMonth() - from.getMonth();
    if (to.getDate() < from.getDate()) m--;
    if (m < 0) { y--; m += 12; }
    return { y, m };
  }
  const span = ({ y, m }) => y && m ? `${years(y)} و${months(m)}` : y ? years(y) : m ? months(m) : 'أقل من شهر';

  function card(p) {
    const today = new Date(), founded = toDate(p.founded), listed = p.listed ? toDate(p.listed) : null;
    const pos = d => Math.max(0, Math.min(100, (d - founded) / (today - founded) * 100)).toFixed(2);
    const age = diff(p.founded, today), listedAge = listed && diff(p.listed, today), gap = listed && diff(p.founded, listed);
    const tags = `${p.market ? `<span class="cp-tag market">${escapeHtml(p.market)}</span>` : ''}<span class="cp-tag">المصدر: تداول السعودية${p.listedSource ? ' · الإدراج: ' + escapeHtml(p.listedSource) : ''}</span>`;
    return `
      <div class="cp-head"><h3 id="cp-title">نبذة عن الشركة</h3><div class="cp-tags">${tags}</div></div>
      <div class="cp-body">
        <div class="cp-activity"><span class="cp-label">مجال العمل</span><p>${escapeHtml(p.activity)}</p>${p.official ? `<p class="cp-official">${escapeHtml(p.official)}</p>` : ''}</div>
        <div class="cp-facts">
          <div class="cp-fact"><span class="cp-label">تاريخ التأسيس</span><span class="cp-year">${founded.getFullYear()}</span><span class="cp-date">${dotDate(p.founded)}</span><span class="cp-ago">منذ ${years(age.y)}</span></div>
          ${listed
            ? `<div class="cp-fact listed" title="${escapeHtml(p.listedSource ? `مصدر تاريخ الإدراج: ${p.listedSource}` : 'مصدر تاريخ الإدراج: تداول السعودية')}"><span class="cp-label">تاريخ الإدراج في تداول</span><span class="cp-year">${listed.getFullYear()}</span><span class="cp-date"${p.listedPrecision === 'month' ? ' style="direction:rtl"' : ''}>${listedLabel(p)}</span><span class="cp-ago">مدرجة منذ ${years(listedAge.y)}</span></div>`
            : `<div class="cp-fact cp-missing"><span class="cp-label">تاريخ الإدراج في تداول</span><span class="cp-year">—</span><span class="cp-date">غير متوفر في المصدر</span></div>`}
          <div class="cp-fact gap"><span class="cp-label">من التأسيس إلى الإدراج</span><span class="cp-gap ${listed ? '' : 'none'}">${listed ? span(gap) : '—'}</span></div>
        </div>
        <div class="cp-timeline" role="img" aria-label="تأسست ${founded.getFullYear()}${listed ? `، وأُدرجت ${listed.getFullYear()}` : ''}">
          <div class="cp-track">
            ${listed ? `<div class="cp-listed-seg" style="right:${pos(listed)}%"></div>` : ''}
            <span class="cp-dot" style="right:0%"></span>
            ${listed ? `<span class="cp-dot gold" style="right:${pos(listed)}%"></span>` : ''}
            <span class="cp-dot today" style="right:100%"></span>
            <span class="cp-tick" style="right:0%"><b>${founded.getFullYear()}</b>التأسيس</span>
            ${listed ? `<span class="cp-tick gold" style="right:${pos(listed)}%"><b>${listed.getFullYear()}</b>الإدراج</span>` : ''}
            <span class="cp-tick" style="right:100%"><b>${today.getFullYear()}</b>اليوم</span>
          </div>
          <div class="cp-legend"><span><i></i>${listed ? 'قبل الإدراج' : 'منذ التأسيس'}</span>${listed ? '<span><i class="gold"></i>مدرجة في السوق</span>' : ''}</div>
        </div>
      </div>`;
  }

  let profiles = null, shown = null;
  function paint() {
    const heading = document.querySelector('.bank-heading');
    const symbol = heading?.querySelector('.symbol-badge')?.textContent.trim();
    if (!profiles || !heading || !symbol || symbol === shown) return;
    shown = symbol;
    let box = document.getElementById('company-profile');
    const profile = profiles[symbol];
    if (!profile) { box?.remove(); return; }
    if (!box) {
      box = document.createElement('section');
      box.id = 'company-profile';
      box.className = 'company-profile';
      box.setAttribute('aria-labelledby', 'cp-title');
      heading.after(box);
    }
    box.innerHTML = card(profile);
  }

  async function start() {
    try {
      profiles = window.COMPANY_PROFILES || await (await fetch('company-profiles.json?v=20261115')).json();
    } catch (error) { console.warn('Company profiles unavailable:', error); return; }
    paint();
    new MutationObserver(paint).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

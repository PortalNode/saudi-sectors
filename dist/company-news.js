// إعلانات الشركة من لقطة تداول السعودية المحفوظة في company-news.json.
(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const snapshotUrl = `company-news.json?v=${Date.now()}`;
  let snapshot = null;
  let shown = null;

  const formatDate = value => {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
    if (!match) return text;
    const [, day, month, year, time] = match;
    return `${day}.${month}.${year}${time ? ` · ${time}` : ''}`;
  };

  function itemMarkup(item, index) {
    const hidden = index >= 10 ? ' hidden' : '';
    const date = formatDate(item.date);
    const title = item.description || item.title || 'إعلان شركة';
    return `<li${hidden} class="company-news-item" data-news-extra="${index >= 10}">
      <a class="company-news-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
        <span class="company-news-text">${escapeHtml(title)}</span>
        <span class="company-news-date">${escapeHtml(date)}</span>
      </a>
    </li>`;
  }

  function render() {
    const profile = document.getElementById('company-profile');
    const heading = document.querySelector('.bank-heading');
    const symbol = heading?.querySelector('.symbol-badge')?.textContent.trim();
    if (!profile || !snapshot || !symbol || shown === symbol) return;
    shown = symbol;
    let box = document.getElementById('company-news');
    const company = snapshot.companies?.[symbol];
    if (!company || !company.announcements?.length) {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement('section');
      box.id = 'company-news';
      box.className = 'company-news';
      box.setAttribute('aria-labelledby', 'company-news-title');
      (document.getElementById('company-quote') || profile).after(box);
    }
    const total = Number(company.totalCount || company.announcements.length);
    const period = snapshot.period ? `من ${snapshot.period.from} إلى ${snapshot.period.to}` : 'آخر ثلاثة أشهر';
    box.innerHTML = `<div class="company-news-head">
      <div><h3 id="company-news-title">آخر أخبار وإعلانات الشركة</h3><p class="company-news-count">${total} إعلانًا محفوظًا من تداول السعودية</p></div>
      <span class="company-news-source">المصدر: <b>تداول السعودية</b></span>
    </div>
    <div class="company-news-note">${escapeHtml(period)} · مرتبة من الأحدث إلى الأقدم · آخر تحديث: ${escapeHtml(snapshot.updatedAt?.replace('T', ' ').replace('Z', ' UTC') || 'غير معروف')}</div>
    <ul class="company-news-list">${company.announcements.map(itemMarkup).join('')}</ul>
    <div class="company-news-foot">
      ${company.announcements.length > 10 ? '<button type="button" class="company-news-more" aria-expanded="false">عرض جميع الإعلانات</button>' : ''}
      <a href="${escapeHtml(company.announcements[0]?.url || 'https://www.saudiexchange.sa/') }" target="_blank" rel="noopener noreferrer">فتح آخر إعلان في تداول ←</a>
    </div>`;
    const more = box.querySelector('.company-news-more');
    more?.addEventListener('click', () => {
      const expanded = more.getAttribute('aria-expanded') === 'true';
      box.querySelectorAll('[data-news-extra="true"]').forEach(el => { el.hidden = expanded; });
      more.setAttribute('aria-expanded', String(!expanded));
      more.textContent = expanded ? 'عرض جميع الإعلانات' : 'إخفاء الإعلانات القديمة';
    });
  }

  async function start() {
    try {
      const response = await fetch(snapshotUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`News snapshot unavailable: ${response.status}`);
      snapshot = await response.json();
      render();
      new MutationObserver(render).observe(document.body, { childList: true, subtree: true });
    } catch (error) {
      console.warn('Company news unavailable:', error);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

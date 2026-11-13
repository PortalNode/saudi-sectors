// Layout helpers shared by every page. They only rearrange what the page
// scripts already render; no prices or financial values are computed here.
(() => {
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

  // ----- Home page: column views -----
  const sections = document.getElementById('sectors');
  const views = document.getElementById('col-views');
  if (sections && views) {
    const allowed = ['val', 'perf', 'trade', 'all'];
    const apply = (view, persist) => {
      if (!allowed.includes(view)) view = 'val';
      sections.dataset.cols = view;
      for (const button of views.querySelectorAll('button[data-cols]')) {
        button.setAttribute('aria-pressed', String(button.dataset.cols === view));
      }
      const eps = document.querySelector('.table-tools .eps-switch');
      if (eps) eps.hidden = view === 'perf' || view === 'trade';
      if (persist) write('saudi-sectors-columns', view);
      // The sticky header measures the table; let it re-measure the new width.
      window.dispatchEvent(new Event('resize'));
    };
    views.addEventListener('click', event => {
      const button = event.target.closest('button[data-cols]');
      if (button) apply(button.dataset.cols, true);
    });
    apply(read('saudi-sectors-columns') || sections.dataset.cols || 'val', false);
  }

  // ----- Home page: one-line copy of the price status -----
  const status = document.getElementById('price-status');
  const brief = document.getElementById('status-brief');
  if (status && brief) {
    const mirror = () => { brief.textContent = status.textContent; brief.title = status.textContent; };
    new MutationObserver(mirror).observe(status, { childList: true, characterData: true, subtree: true });
    mirror();
  }

  // ----- Results pages: key figures strip built from the annual table -----
  const PREFERRED = ['revenue', 'netFinancingIncome', 'operatingIncome', 'netProfit', 'eps', 'netMargin', 'returnOnEquity', 'assets', 'equity'];
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function buildKeyFigures(wrap) {
    const table = wrap.querySelector('table.annual-table');
    const panel = wrap.closest('.bank-panel');
    if (!panel) return;
    let strip = panel.querySelector('.key-figures');
    let title = panel.querySelector('.key-figures-title');
    if (!table) { strip?.remove(); title?.remove(); return; }
    const headings = [...table.querySelectorAll('thead th')];
    const year = headings.at(-1)?.textContent.trim() || '';
    const previousYear = headings.at(-3)?.textContent.trim() || '';
    const rows = new Map([...table.querySelectorAll('tbody tr[data-metric]')].map(row => [row.dataset.metric, row]));
    const keys = PREFERRED.filter(key => rows.has(key)).concat([...rows.keys()].filter(key => !PREFERRED.includes(key))).slice(0, 5);
    const cells = keys.map(key => {
      const row = rows.get(key);
      const label = row.querySelector('th')?.firstChild?.textContent.trim() || '';
      const tds = row.querySelectorAll('td');
      const value = tds[tds.length - 1]?.textContent.trim() || '—';
      const changeCell = tds.length > 1 ? tds[tds.length - 2] : null;
      const change = changeCell?.textContent.trim() || '';
      const tone = changeCell?.querySelector('.up') ? 'up' : changeCell?.querySelector('.down') ? 'down' : 'flat';
      const sub = change && change !== '—' && previousYear ? `<b class="${tone}">${escapeHtml(change)}</b><span>عن ${escapeHtml(previousYear)}</span>` : '<span>&nbsp;</span>';
      return `<div class="key-figure"><dt title="${escapeHtml(label)}">${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd><small>${sub}</small></div>`;
    }).join('');
    if (!strip) {
      title = document.createElement('p');
      title.className = 'key-figures-title';
      strip = document.createElement('dl');
      strip.className = 'key-figures';
      const anchor = panel.querySelector('.bank-unit-note') || wrap;
      anchor.before(title, strip);
    }
    title.textContent = year ? `أبرز أرقام ${year}` : 'أبرز الأرقام';
    strip.innerHTML = cells;
  }
  for (const wrap of document.querySelectorAll('.annual-table-wrap')) {
    new MutationObserver(() => buildKeyFigures(wrap)).observe(wrap, { childList: true });
    buildKeyFigures(wrap);
  }
})();

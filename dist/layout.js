// Layout helpers shared by every page. They only rearrange what the page
// scripts already render; no prices or financial values are computed here.
(() => {
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

  // ----- Results pages: switch to another sector's results page -----
  // [page, sector name as on the main table]; shown sorted by name.
  const SECTOR_PAGES = [
    ['agriculture', 'الزراعة'], ['banks', 'البنوك'], ['business-services', 'خدمات الاعمال'], ['cement', 'الاسمنت'],
    ['consumer', 'السلع الاستهلاكية'], ['education', 'التعليم و التدريب'], ['exchange', 'أسواق الاوراق المالية'],
    ['finance', 'التمويل'], ['financial-services', 'الخدمات المالية'], ['food', 'الأغذية والمشروبات'],
    ['glass', 'المنتجات الزجاجية'], ['health', 'الرعاية الصحية'], ['healthservices', 'خدمات الرعاية الصحية'],
    ['hotels-tourism', 'الفنادق و السياحة'], ['industrial', 'الصناعات التحويلية'], ['information-technology', 'تقنية المعلومات'],
    ['insurance', 'التأمين'], ['materials', 'المواد الاساسية'], ['media', 'وسائل الاعلام'], ['mining', 'التعدين والمعادن'],
    ['multi', 'متعددة الأنشطة'], ['oilgas', 'النفط و الغاز'], ['petrochem', 'البتروكيماويات'], ['pharma', 'موردي الادوية'],
    ['realestate', 'العقارات'], ['reits', 'الصناديق العقارية المتداولة'], ['retail', 'تجارة و تجزئة'],
    ['sports', 'المراكز الرياضية'], ['telecom', 'الاتصالات'], ['transport', 'النقل'], ['utilities', 'المرافق والطاقة']
  ];
  const currentPage = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  const siteName = document.querySelector('.site-bar .site-name');
  // «نتائج الشركات» in the top bar opens the last results page viewed (Banks the first time).
  const onResultsPage = SECTOR_PAGES.some(([page]) => page === currentPage);
  if (onResultsPage) write('saudi-sectors-results-page', currentPage);
  const lastResults = read('saudi-sectors-results-page');
  if (SECTOR_PAGES.some(([page]) => page === lastResults)) {
    for (const link of document.querySelectorAll('a[data-results-link]')) link.href = `${lastResults}.html`;
  }
  if (siteName && onResultsPage) {
    const collator = new Intl.Collator('ar');
    const sorted = [...SECTOR_PAGES].sort((a, b) => collator.compare(a[1], b[1]));
    const label = document.createElement('label');
    label.className = 'sector-switch';
    const caption = document.createElement('span');
    caption.textContent = 'القطاع';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'التبديل إلى نتائج قطاع آخر');
    for (const [page, name] of sorted) select.add(new Option(name, page, false, page === currentPage));
    select.addEventListener('change', () => {
      // Keep the chosen period (quarter, 6 or 9 months); pages without it fall back to annual.
      const from = new URLSearchParams(location.search), to = new URLSearchParams();
      for (const key of ['period', 'q']) if (from.get(key)) to.set(key, from.get(key));
      location.href = `${select.value}.html${to.toString() ? `?${to}` : ''}`;
    });
    label.append(caption, select);
    siteName.after(label);

    // Company picker beside the sector picker; it mirrors the page's company buttons
    // (nav.bank-nav), which stay in the page but are hidden, and clicks the chosen one.
    const nav = document.querySelector('nav.bank-nav');
    if (nav) {
      const companyLabel = document.createElement('label');
      companyLabel.className = 'sector-switch company-switch';
      const companyCaption = document.createElement('span');
      companyCaption.textContent = 'الشركة';
      const companySelect = document.createElement('select');
      companySelect.setAttribute('aria-label', 'اختيار شركة من القطاع');
      companySelect.disabled = true;
      const sync = () => {
        const buttons = [...nav.querySelectorAll('button')];
        if (!buttons.length) return;
        companySelect.replaceChildren(...buttons.map(button => new Option(button.textContent.trim(), button.dataset.company || button.dataset.bank || button.textContent.trim(), false, button.getAttribute('aria-pressed') === 'true')));
        companySelect.disabled = false;
        document.body.classList.add('has-company-switch');
      };
      companySelect.addEventListener('change', () => {
        [...nav.querySelectorAll('button')].find(button => (button.dataset.company || button.dataset.bank || button.textContent.trim()) === companySelect.value)?.click();
      });
      new MutationObserver(sync).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
      sync();
      companyLabel.append(companyCaption, companySelect);
      label.after(companyLabel);
    }
  }

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

  // ----- Results pages: key figures strip -----
  // Built from the company's latest 3/6/9/12 months when the page left that table in
  // <template class="latest-results"> (latest-results.mjs); otherwise from the visible table.
  const PREFERRED = ['revenue', 'netFinancingIncome', 'operatingIncome', 'netProfit', 'eps', 'netMargin', 'returnOnEquity', 'assets', 'equity'];
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function buildKeyFigures(wrap) {
    const panel = wrap.closest('.bank-panel');
    if (!panel) return;
    const latest = panel.querySelector('template.latest-results')?.content;
    const source = latest?.querySelector('table.annual-table') ? latest : wrap;
    const table = source.querySelector('table.annual-table');
    let strip = panel.querySelector('.key-figures');
    let title = panel.querySelector('.key-figures-title');
    if (!table) { strip?.remove(); title?.remove(); return; }
    const headings = [...table.querySelectorAll('thead th')];
    // A table may name its own periods (e.g. quarterly views comparing with the same quarter last year).
    const year = table.dataset.latestLabel || headings.at(-1)?.textContent.trim() || '';
    const previousYear = table.dataset.compareLabel || headings.at(-3)?.textContent.trim() || '';
    const rows = new Map([...(source === latest ? source : table).querySelectorAll('tbody tr[data-metric]')].map(row => [row.dataset.metric, row]));
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
    title.textContent = source === latest ? `آخر النتائج المالية: ${year}` : year ? `أبرز أرقام ${year}` : 'أبرز الأرقام';
    strip.innerHTML = cells;
  }
  for (const wrap of document.querySelectorAll('.annual-table-wrap')) {
    new MutationObserver(() => buildKeyFigures(wrap)).observe(wrap, { childList: true });
    buildKeyFigures(wrap);
  }

  // ----- Company logos -----
  // dist/logos/<symbol>.svg from TradingView (scripts/fetch-logos.mjs); manifest.json lists
  // the symbols that have one. A company without a logo gets the first letter of its name.
  // Added beside what the pages render: the company heading, the home table and the chart search.
  const logoSymbols = fetch('logos/manifest.json?v=20261116')
    .then(res => (res.ok ? res.json() : { symbols: [] }))
    .then(manifest => new Set(manifest.symbols))
    .catch(() => new Set());
  const letterLogo = (name, size) => {
    const span = document.createElement('span');
    span.className = `co-logo co-logo-letter co-logo-${size}`;
    span.textContent = (name || '').trim().charAt(0);
    return span;
  };
  const makeLogo = (symbol, name, size, have) => {
    if (!have.has(symbol)) return letterLogo(name, size);
    const img = document.createElement('img');
    img.className = `co-logo co-logo-${size}`;
    img.src = `logos/${symbol}.svg`;
    img.alt = '';
    img.decoding = 'async';
    if (size === 'sm') img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(letterLogo(name, size)), { once: true });
    return img;
  };
  // Puts the logo first in `host`, replacing one left from another company.
  const placeLogo = (host, symbol, name, size, have) => {
    if (!symbol) return;
    const old = host.querySelector(':scope > .co-logo');
    if (old?.dataset.symbol === symbol) return;
    const logo = makeLogo(symbol, name, size, have);
    logo.dataset.symbol = symbol;
    logo.setAttribute('aria-hidden', 'true');
    if (old) old.replaceWith(logo); else host.prepend(logo);
    host.classList.add('has-co-logo');
  };
  const nameOf = el => [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !n.matches('.co-logo, .symbol-badge'))).map(n => n.textContent).join('').trim();
  const addLogos = have => {
    for (const heading of document.querySelectorAll('.bank-heading h2')) {
      placeLogo(heading, heading.querySelector('.symbol-badge')?.textContent.trim(), nameOf(heading), 'lg', have);
    }
    for (const cell of document.querySelectorAll('tbody td.company-name')) {
      placeLogo(cell, cell.closest('tr')?.querySelector('.symbol-badge')?.textContent.trim(), nameOf(cell), 'sm', have);
    }
    for (const button of document.querySelectorAll('.cc-search-btn')) {
      const symbol = button.querySelector('b')?.textContent.trim();
      const old = button.querySelector('.co-logo');
      if (!symbol || old?.dataset.symbol === symbol) continue;
      old?.remove();
      const logo = makeLogo(symbol, button.querySelector('.cc-search-name')?.textContent, 'xs', have);
      logo.dataset.symbol = symbol;
      logo.setAttribute('aria-hidden', 'true');
      button.querySelector('b').before(logo);
    }
  };
  logoSymbols.then(have => {
    let queued = false;
    const run = () => { queued = false; addLogos(have); };
    // A microtask runs before the next paint, so a new heading or row never shows without its logo.
    new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(run); } })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    run();
  });
})();

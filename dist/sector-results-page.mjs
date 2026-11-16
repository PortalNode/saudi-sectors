import { loadMarketCaps, sortByMarketCap } from './market-cap-order.mjs?v=mcap-order-20261115';
import { escapeHtml, PERIODS, QUARTER_NAMES, MONTH_NAMES, buildPeriodColumns, sumQuarters, chartCompanyFor, renderPeriodTable, quarterLabel, validateQuarterly, isCalendarYear, monthRange, periodRange } from './quarterly-periods.mjs?v=quarterly-20261115';
import { latestYearToDateColumns, setLatestResults } from './latest-results.mjs?v=latest-ytd-20261116';

/**
 * Drives a sector results page (annual table + bar chart) and, when
 * dist/<slug>-quarterly-financials.json exists, adds the period selector:
 * quarter (Q1–Q4 or the last eight in sequence), 6 months, 9 months, annual.
 *
 * The page HTML must keep the usual ids: <slug>-nav, -load-status, -panel, -title,
 * -subtitle, -table-wrap, -charts-context, -chart-metric, -chart-selection-status,
 * -charts-grid, -import-info; and link quarterly-periods.css.
 */
export function initSectorResultsPage({ slug, sectorName, metrics, charts, version, quarterly: wantQuarterly = true }) {
  const $ = id => document.getElementById(`${slug}-${id}`);
  const { validateDataset, renderAnnualTable } = metrics;
  const periodSpec = metrics.PERIOD_SPEC; // optional: the page's own items for quarterly and cumulative views
  let dataset, quarterly, activeCompany, chartCompany, activeYears = [], selectedChartKey = 'netProfit';
  let period = 'fy', quarter = '3';
  let fiscal = { end: 12, note: '' }; // the selected company's fiscal year (quarters are numbered within it)

  const annualRange = () => dataset ? `${dataset.years[0]}–${dataset.years.at(-1)}` : '';
  function periodSummary() {
    if (period === 'q') return quarter === 'seq' ? 'آخر الأرباع المتتالية' : `الربع ${QUARTER_NAMES[quarter]} عبر السنوات`;
    return period === 'fy' ? 'النتائج السنوية' : `${PERIODS[period].label} (${periodRange(period, fiscal.end)})`;
  }
  function mountPeriodBar() {
    const heading = $('panel').querySelector('.bank-heading');
    if (!heading || $('period')) return;
    heading.insertAdjacentHTML('afterend', `<div class="period-bar"><div class="period-group"><span>الفترة</span><div class="period-seg" id="${slug}-period" role="group" aria-label="نوع الفترة">${['q', 'h1', 'm9', 'fy'].map(key => `<button type="button" data-period="${key}" aria-pressed="${key === period}">${PERIODS[key].label}</button>`).join('')}</div></div><div class="period-group" id="${slug}-quarter-group" hidden><span>الربع</span><div class="period-seg small" id="${slug}-quarter" role="group" aria-label="اختيار الربع">${['1', '2', '3', '4'].map(key => `<button type="button" data-quarter="${key}" aria-pressed="${key === quarter}">Q${key}</button>`).join('')}<button type="button" data-quarter="seq" aria-pressed="${quarter === 'seq'}">متتالية</button></div></div><p class="period-desc" id="${slug}-period-desc"></p></div>`);
    $('period').addEventListener('click', event => { const button = event.target.closest('[data-period]'); if (button && dataset) { period = button.dataset.period; selectCompany(activeCompany?.symbol); } });
    $('quarter').addEventListener('click', event => { const button = event.target.closest('[data-quarter]'); if (button && dataset) { quarter = button.dataset.quarter; selectCompany(activeCompany?.symbol); } });
    const notes = $('panel').querySelector('.bank-notes ul');
    // Drop the annual-only disclaimers ("سنوية فقط … لم تُدرج … بيانات ربع سنوية").
    for (const item of notes?.querySelectorAll('li') ?? []) if (/ربع سنوية|سنوية فقط/.test(item.textContent)) item.remove();
    const footnote = $('panel').querySelector('.bank-charts-footnote');
    if (footnote) footnote.textContent = footnote.textContent.replace(/اختر أي بند لعرض مقارنة السنوات السنوية بين \d{4} و\d{4}\./, 'اختر أي بند لعرض المقارنة للفترة المختارة.');
    notes?.insertAdjacentHTML('beforeend', [
      `البيانات الربعية من ملف «${escapeHtml(quarterly.source.name)}» من ${quarterLabel(quarterly.quarters[0])} إلى ${quarterLabel(quarterly.quarters.at(-1))}.`,
      'الأرباع مستقلة (Q4 هو الربع الرابع وحده وليس السنة). فترتا 6 و9 أشهر مجموع الأرباع، والهوامش محسوبة من المجاميع.',
      ...(quarterly.companies.some(company => !isCalendarYear(company.fiscalYearEnd)) ? ['بعض الشركات سنتها المالية لا تنتهي في ديسمبر؛ أرباعها مرقّمة حسب سنتها المالية كما في أرقام، فقد لا يغطي الربع نفسه الأشهر نفسها في كل الشركات.'] : []),
      'ربح السهم في فترتي 6 و9 أشهر مجموع ربح السهم للأرباع، فهو تقريبي إذا تغير عدد الأسهم خلال السنة.',
      'العرض السنوي من الملف السنوي؛ قد يختلف قليلًا عن مجموع الأرباع عند تعديل أرقام سابقة.',
      'في عرض «متتالية» يقارن التغير كل ربع بنفس الربع من العام السابق لتجنب أثر المواسم.'
    ].map(text => `<li class="period-note">${text}</li>`).join(''));
    const hint = $('panel').querySelector('.bank-table-hint');
    if (hint) hint.textContent = 'اسحب الجدول أفقيًا لرؤية الفترات كاملة. «التغير» هو نسبة التغير مقارنةً بنفس الفترة من العام السابق، وليس فرق النسب بالنقاط المئوية.';
  }
  function syncPeriodControls(latestKey) {
    const badge = $('panel').querySelector('.bank-period');
    if (!quarterly) return;
    for (const button of $('period').querySelectorAll('[data-period]')) button.setAttribute('aria-pressed', String(button.dataset.period === period));
    for (const button of $('quarter').querySelectorAll('[data-quarter]')) button.setAttribute('aria-pressed', String(button.dataset.quarter === quarter));
    $('quarter-group').hidden = period !== 'q';
    $('period-desc').innerHTML = period === 'fy'
      ? 'من الملف السنوي · «نسبة التغير» مقارنةً بالسنة السابقة'
      : period === 'q'
        ? (quarter === 'seq' ? 'الأرباع بالترتيب · التغير مقارنةً بنفس الربع من العام السابق' : `الربع <b>${QUARTER_NAMES[quarter]}</b>${isCalendarYear(fiscal.end) ? '' : ` (${monthRange(fiscal.end, Number(quarter))})`} مقارنةً بنفسه في السنوات السابقة`)
        : `تراكمي ${periodRange(period, fiscal.end)} · مقارنةً بنفس الفترة من العام السابق`;
    if (period !== 'fy' && !isCalendarYear(fiscal.end)) {
      $('period-desc').innerHTML += `<br><span class="period-fiscal">السنة المالية للشركة تنتهي في ${MONTH_NAMES[fiscal.end]}، والأرباع والسنوات مرقّمة حسبها كما في أرقام (الربع الأول ${monthRange(fiscal.end, 1)}).${fiscal.note ? ` ${escapeHtml(fiscal.note)}` : ''}</span>`;
    }
    if (badge) badge.innerHTML = latestKey ? `آخر ربع متاح <bdi dir="ltr">${quarterLabel(latestKey)}</bdi>` : `السنوات المتاحة <bdi>${annualRange()}</bdi>`;
  }
  function drawSelectedChart() {
    if (!chartCompany) return;
    const option = charts.options(chartCompany, activeYears).find(item => item.key === selectedChartKey);
    const range = activeYears.length ? `${activeYears[0]} – ${activeYears.at(-1)}` : '—';
    $('charts-context').textContent = `${activeCompany.name} · ${periodSummary()} · ${range}`;
    $('chart-selection-status').textContent = option?.available
      ? `مقارنة ${option.label} · ${periodSummary()}. يمكنك اختيار أي بند آخر من القائمة.`
      : 'هذا البند غير متاح لبعض الفترات في الملف؛ تظهر بعلامة «—» دون أرقام افتراضية.';
    $('charts-grid').innerHTML = charts.render(chartCompany, activeYears, selectedChartKey);
    charts.fit($('charts-grid'), chartCompany, activeYears);
  }
  function populateChartOptions() {
    const grouped = new Map();
    for (const option of charts.options(chartCompany, activeYears)) {
      if (!grouped.has(option.group)) grouped.set(option.group, []);
      grouped.get(option.group).push(option);
    }
    $('chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
    if ($('chart-metric').value !== selectedChartKey) selectedChartKey = $('chart-metric').value;
  }
  function selectCompany(symbol, replaceHistory = false) {
    const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
    const quarterCompany = quarterly?.companies.find(item => item.symbol === company.symbol);
    if (period !== 'fy' && !quarterCompany) period = 'fy';
    fiscal = { end: quarterCompany?.fiscalYearEnd ?? 12, note: quarterCompany?.fiscalNote ?? '' };
    $('nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
    $('title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
    $('subtitle').textContent = `${company.fullName || company.name} · قطاع ${sectorName} · ${quarterly ? periodSummary() : 'نتائج سنوية فقط'}`;
    syncPeriodControls(quarterCompany ? Object.keys(quarterCompany.quarters).sort().at(-1) : null);
    // The key figures strip always shows the latest 3/6/9/12 months, whatever the table shows.
    const latestColumns = quarterCompany ? latestYearToDateColumns(quarterCompany, (item, year, count) => sumQuarters(item, year, count, periodSpec)) : null;
    setLatestResults($('panel'), latestColumns && renderPeriodTable(company, latestColumns, { caption: 'آخر النتائج', metrics: periodSpec?.metrics }));
    if (period === 'fy') {
      activeYears = company.years.map(record => record.year).sort((a, b) => a - b);
      chartCompany = company;
      $('table-wrap').innerHTML = renderAnnualTable(company, activeYears);
    } else {
      const columns = buildPeriodColumns(quarterCompany, period, quarter, periodSpec);
      activeYears = columns.map(column => column.chartLabel ?? column.label);
      chartCompany = chartCompanyFor(company, columns);
      $('table-wrap').innerHTML = renderPeriodTable(company, columns, { sequential: period === 'q' && quarter === 'seq', caption: periodSummary(), metrics: periodSpec?.metrics });
    }
    $('table-wrap').scrollLeft = 0;
    $('panel').hidden = false;
    activeCompany = company;
    populateChartOptions();
    drawSelectedChart();
    document.title = `${company.name} | ${quarterly ? periodSummary() : `النتائج السنوية ${annualRange()}`} | السوق السعودي`;
    const url = new URL(window.location.href);
    url.searchParams.set('symbol', company.symbol);
    if (period === 'fy') url.searchParams.delete('period'); else url.searchParams.set('period', period);
    if (period === 'q') url.searchParams.set('q', quarter); else url.searchParams.delete('q');
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (replaceHistory) window.history.replaceState({ symbol: company.symbol }, '', next);
    else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({ symbol: company.symbol }, '', next);
  }
  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    period = quarterly && PERIODS[params.get('period')] ? params.get('period') : 'fy';
    quarter = ['1', '2', '3', '4', 'seq'].includes(params.get('q')) ? params.get('q') : '3';
    return params.get('symbol');
  }
  async function loadQuarterly() {
    if (!wantQuarterly) return null;
    try {
      const response = await fetch(`${slug}-quarterly-financials.json?v=${version}`);
      if (!response.ok) return null;
      return validateQuarterly(await response.json());
    } catch (error) {
      console.error(`Quarterly ${slug} data could not be loaded:`, error);
      return null;
    }
  }
  async function load() {
    try {
      const [annualResponse, quarterlyData, caps] = await Promise.all([fetch(`${slug}-financials.json?v=${version}`), loadQuarterly(), loadMarketCaps()]);
      if (!annualResponse.ok) throw new Error(`HTTP ${annualResponse.status}`);
      dataset = validateDataset(await annualResponse.json());
      // Company tabs from the largest market cap down (the cap itself is not shown).
      dataset = { ...dataset, companies: sortByMarketCap(dataset.companies, caps) };
      quarterly = quarterlyData?.sector === dataset.sector ? quarterlyData : null;
      if (quarterlyData && !quarterly) console.error(`${slug}: quarterly file sector «${quarterlyData.sector}» ≠ «${dataset.sector}»`);
      if (quarterly) mountPeriodBar();
      $('import-info').textContent = `المصدر المحفوظ: ${dataset.source.name}${quarterly ? ` و${quarterly.source.name}` : ''} · ${dataset.source.provider}.`;
      selectCompany(readUrlState(), true);
      // The loading line is only needed while loading or on failure; the sources are listed in the notes.
      $('load-status').hidden = true;
    } catch (error) {
      $('load-status').textContent = `تعذر تحميل ملف نتائج ${sectorName}. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.`;
      console.error(`${slug} data could not be loaded:`, error);
    }
  }
  $('nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
  $('chart-metric').addEventListener('change', () => { selectedChartKey = $('chart-metric').value; drawSelectedChart(); });
  window.addEventListener('popstate', () => { if (dataset) selectCompany(readUrlState(), true); });
  const resizeCharts = () => { if (chartCompany) charts.fit($('charts-grid'), chartCompany, activeYears); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(resizeCharts).observe($('charts-grid')); else window.addEventListener('resize', resizeCharts);
  load();
}

import { escapeHtml, validateDataset, renderAnnualTable } from './retail-metrics.mjs?v=retail-periods-20261113-w2';
import { renderRetailCharts, fitRetailCharts, getChartOptions } from './retail-charts.mjs?v=retail-value-labels-20261106-v12';
import { PERIODS, QUARTER_NAMES, buildPeriodColumns, chartCompanyFor, renderPeriodTable, quarterLabel } from './retail-periods.mjs?v=retail-periods-20261113-w2';
const $ = id => document.getElementById(id);
const VERSION = 'retail-periods-20261113';
let dataset, quarterly, activeCompany, chartCompany, activeYears = [], selectedChartKey = 'netProfit';
let period = 'fy', quarter = '3';

function periodSummary() {
  if (period === 'q') return quarter === 'seq' ? `آخر الأرباع المتتالية` : `الربع ${QUARTER_NAMES[quarter]} عبر السنوات`;
  return period === 'fy' ? 'النتائج السنوية' : `${PERIODS[period].label} (${PERIODS[period].range})`;
}
function drawSelectedChart() {
  if (!dataset || !chartCompany) return;
  const option = getChartOptions(chartCompany, activeYears).find(item => item.key === selectedChartKey);
  const range = activeYears.length ? `${activeYears[0]} – ${activeYears.at(-1)}` : '—';
  $('retail-charts-context').textContent = `${activeCompany.name} · ${periodSummary()} · ${range}`;
  $('retail-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} · ${periodSummary()}. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لبعض الفترات في الملف؛ تظهر بعلامة «—» دون أرقام افتراضية.';
  $('retail-charts-grid').innerHTML = renderRetailCharts(chartCompany, activeYears, selectedChartKey);
  fitRetailCharts($('retail-charts-grid'), chartCompany, activeYears);
}
function populateChartOptions() {
  const grouped = new Map();
  for (const option of getChartOptions(chartCompany, activeYears)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  $('retail-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if ($('retail-chart-metric').value !== selectedChartKey) selectedChartKey = $('retail-chart-metric').value;
}
function syncPeriodControls(latestKey) {
  const quarterlyReady = !!quarterly;
  for (const button of document.querySelectorAll('#retail-period [data-period]')) {
    button.setAttribute('aria-pressed', String(button.dataset.period === period));
    if (button.dataset.period !== 'fy') button.disabled = !quarterlyReady;
  }
  for (const button of document.querySelectorAll('#retail-quarter [data-quarter]')) button.setAttribute('aria-pressed', String(button.dataset.quarter === quarter));
  $('retail-quarter-group').hidden = period !== 'q';
  $('retail-period-desc').innerHTML = period === 'fy'
    ? 'من الملف السنوي · «نسبة التغير» مقارنةً بالسنة السابقة'
    : period === 'q'
      ? (quarter === 'seq' ? 'الأرباع بالترتيب · التغير مقارنةً بنفس الربع من العام السابق' : `الربع <b>${QUARTER_NAMES[quarter]}</b> مقارنةً بنفسه في السنوات السابقة`)
      : `تراكمي ${PERIODS[period].range} · مقارنةً بنفس الفترة من العام السابق`;
  $('retail-latest-quarter').innerHTML = latestKey ? `آخر ربع متاح <bdi dir="ltr">${quarterLabel(latestKey)}</bdi>` : 'السنوات المتاحة <bdi>2021–2025</bdi>';
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  const quarterCompany = quarterly?.companies.find(item => item.symbol === company.symbol);
  if (period !== 'fy' && !quarterCompany) period = 'fy';
  $('retail-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('retail-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('retail-subtitle').textContent = `${company.fullName || company.name} · قطاع تجارة و تجزئة · ${periodSummary()}`;
  const latestKey = quarterCompany ? Object.keys(quarterCompany.quarters).sort().at(-1) : null;
  syncPeriodControls(latestKey);
  if (period === 'fy') {
    activeYears = company.years.map(record => record.year).sort((a, b) => a - b);
    chartCompany = company;
    $('retail-table-wrap').innerHTML = renderAnnualTable(company, activeYears);
  } else {
    const columns = buildPeriodColumns(quarterCompany, period, quarter);
    activeYears = columns.map(column => column.chartLabel ?? column.label);
    chartCompany = chartCompanyFor(company, columns);
    $('retail-table-wrap').innerHTML = renderPeriodTable(company, columns, { sequential: period === 'q' && quarter === 'seq', caption: periodSummary() });
  }
  $('retail-table-wrap').scrollLeft = 0;
  $('retail-panel').hidden = false;
  activeCompany = company;
  populateChartOptions();
  drawSelectedChart();
  document.title = `${company.name} | ${periodSummary()} | السوق السعودي`;
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
  period = PERIODS[params.get('period')] ? params.get('period') : 'fy';
  quarter = ['1', '2', '3', '4', 'seq'].includes(params.get('q')) ? params.get('q') : '3';
  return params.get('symbol');
}
function validateQuarterly(data) {
  if (data?.schemaVersion !== 1 || data.sector !== 'تجارة و تجزئة' || !Array.isArray(data.companies)) throw new Error('invalid quarterly retail dataset');
  for (const company of data.companies) {
    if (!/^\d{4}$/.test(company.symbol) || typeof company.quarters !== 'object') throw new Error('invalid quarterly retail company');
    for (const [key, values] of Object.entries(company.quarters)) {
      if (!/^\d{4}Q[1-4]$/.test(key)) throw new Error('invalid quarter key');
      for (const value of Object.values(values)) if (value !== null && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('nonnumeric quarterly value');
    }
  }
  return data;
}
async function load() {
  try {
    const [annualResponse, quarterlyResult] = await Promise.all([
      fetch(`retail-financials.json?v=${VERSION}`),
      fetch(`retail-quarterly-financials.json?v=${VERSION}`).then(response => response.ok ? response.json() : null).then(validateQuarterly).catch(error => { console.error('Quarterly retail data could not be loaded:', error); return null; })
    ]);
    if (!annualResponse.ok) throw new Error(`HTTP ${annualResponse.status}`);
    dataset = validateDataset(await annualResponse.json());
    quarterly = quarterlyResult;
    $('retail-import-info').textContent = `المصدر المحفوظ: ${dataset.source.name}${quarterly ? ` و${quarterly.source.name}` : ''} · ${dataset.source.provider}.`;
    selectCompany(readUrlState(), true);
    $('retail-load-status').textContent = quarterly
      ? `المصدر: أرقام · سنوي 2021–2025 وربعي ${quarterLabel(quarterly.quarters[0])} – ${quarterLabel(quarterly.quarters.at(-1))}`
      : 'المصدر: ملف argaam_retail.xlsx · بيانات سنوية 2021–2025 (تعذر تحميل البيانات الربعية)';
  } catch (error) {
    $('retail-load-status').textContent = 'تعذر تحميل ملف نتائج تجارة و تجزئة. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.';
    console.error('Retail data could not be loaded:', error);
  }
}
$('retail-nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
$('retail-period').addEventListener('click', event => { const button = event.target.closest('[data-period]'); if (button && !button.disabled && dataset) { period = button.dataset.period; selectCompany(activeCompany?.symbol); } });
$('retail-quarter').addEventListener('click', event => { const button = event.target.closest('[data-quarter]'); if (button && dataset) { quarter = button.dataset.quarter; selectCompany(activeCompany?.symbol); } });
$('retail-chart-metric').addEventListener('change', () => { selectedChartKey = $('retail-chart-metric').value; drawSelectedChart(); });
window.addEventListener('popstate', () => { if (dataset) selectCompany(readUrlState(), true); });
const resizeCharts = () => { if (dataset && chartCompany) fitRetailCharts($('retail-charts-grid'), chartCompany, activeYears); };
if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(resizeCharts); observer.observe($('retail-charts-grid')); } else window.addEventListener('resize', resizeCharts);
load();

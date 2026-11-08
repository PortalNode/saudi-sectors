import { escapeHtml, validateDataset, renderAnnualTable } from './sports-metrics.mjs?v=sports-value-labels-20261106-v12';
import { renderSportsCharts, fitSportsCharts, getChartOptions } from './sports-charts.mjs?v=sports-value-labels-20261106-v12';
const $ = id => document.getElementById(id);
let dataset, activeCompany, activeYears = [], selectedChartKey = 'netProfit';
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const option = getChartOptions(activeCompany, activeYears).find(item => item.key === selectedChartKey);
  $('sports-charts-context').textContent = `${activeCompany.name} · ${activeYears[0]}–${activeYears.at(-1)} · من بيانات الملف المحفوظ`;
  $('sports-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام ${activeYears[0]}–${activeYears.at(-1)}. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لبعض السنوات في الملف؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  $('sports-charts-grid').innerHTML = renderSportsCharts(activeCompany, activeYears, selectedChartKey);
  fitSportsCharts($('sports-charts-grid'), activeCompany, activeYears);
}
function populateChartOptions(company) {
  const grouped = new Map();
  for (const option of getChartOptions(company, activeYears)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  $('sports-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if ($('sports-chart-metric').value !== selectedChartKey) selectedChartKey = $('sports-chart-metric').value;
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('sports-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('sports-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('sports-subtitle').textContent = `${company.fullName || company.name} · قطاع المراكز الرياضية · نتائج سنوية فقط`;
  const availableYears = company.years.map(record => record.year).sort((a, b) => a - b);
  activeYears = availableYears;
  $('sports-table-wrap').innerHTML = renderAnnualTable(company, availableYears);
  $('sports-table-wrap').scrollLeft = 0;
  $('sports-panel').hidden = false;
  activeCompany = company;
  populateChartOptions(company);
  drawSelectedChart();
  document.title = `${company.name} | النتائج السنوية 2021–2025 | السوق السعودي`;
  const url = new URL(window.location.href); url.searchParams.set('symbol', company.symbol);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (replaceHistory) window.history.replaceState({ symbol: company.symbol }, '', next);
  else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({ symbol: company.symbol }, '', next);
}
async function load() {
  try {
    const response = await fetch('sports-financials.json?v=sports-value-labels-20261106-v12');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    $('sports-import-info').textContent = `المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`;
    selectCompany(new URLSearchParams(window.location.search).get('symbol'), true);
    $('sports-load-status').textContent = 'المصدر: ملف argaam_sports.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من القيم السنوية المخزنة';
  } catch (error) {
    $('sports-load-status').textContent = 'تعذر تحميل ملف نتائج المراكز الرياضية. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.';
    console.error('Materials annual data could not be loaded:', error);
  }
}
$('sports-nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
$('sports-chart-metric').addEventListener('change', () => { selectedChartKey = $('sports-chart-metric').value; drawSelectedChart(); });
window.addEventListener('popstate', () => { if (dataset) selectCompany(new URLSearchParams(window.location.search).get('symbol'), true); });
const resizeCharts = () => { if (dataset && activeCompany) fitSportsCharts($('sports-charts-grid'), activeCompany, activeYears); };
if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(resizeCharts); observer.observe($('sports-charts-grid')); } else window.addEventListener('resize', resizeCharts);
load();

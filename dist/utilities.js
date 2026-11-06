import { escapeHtml, validateDataset, renderAnnualTable } from './utilities-metrics.mjs?v=utilities-value-labels-20261106-v11';
import { renderUtilitiesCharts, fitUtilitiesCharts, getChartOptions } from './utilities-charts.mjs?v=utilities-value-labels-20261106-v11';
const $ = id => document.getElementById(id);
let dataset, activeCompany, activeYears = [], selectedChartKey = 'netProfit';
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const option = getChartOptions(activeCompany, activeYears).find(item => item.key === selectedChartKey);
  $('utilities-charts-context').textContent = `${activeCompany.name} · ${activeYears[0]}–${activeYears.at(-1)} · من بيانات الملف المحفوظ`;
  $('utilities-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام ${activeYears[0]}–${activeYears.at(-1)}. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لبعض السنوات في الملف؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  $('utilities-charts-grid').innerHTML = renderUtilitiesCharts(activeCompany, activeYears, selectedChartKey);
  fitUtilitiesCharts($('utilities-charts-grid'), activeCompany, activeYears);
}
function populateChartOptions(company) {
  const grouped = new Map();
  for (const option of getChartOptions(company, activeYears)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  $('utilities-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if ($('utilities-chart-metric').value !== selectedChartKey) selectedChartKey = $('utilities-chart-metric').value;
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('utilities-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('utilities-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('utilities-subtitle').textContent = `${company.fullName || company.name} · قطاع المرافق والطاقة · نتائج سنوية فقط`;
  const availableYears = company.years.map(record => record.year).sort((a, b) => a - b);
  activeYears = availableYears;
  $('utilities-table-wrap').innerHTML = renderAnnualTable(company, availableYears);
  $('utilities-table-wrap').scrollLeft = 0;
  $('utilities-panel').hidden = false;
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
    const response = await fetch('utilities-financials.json?v=utilities-value-labels-20261106-v11');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    $('utilities-import-info').textContent = `المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`;
    selectCompany(new URLSearchParams(window.location.search).get('symbol'), true);
    $('utilities-load-status').textContent = 'المصدر: ملف argaam_utilities.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من القيم السنوية المخزنة';
  } catch (error) {
    $('utilities-load-status').textContent = 'تعذر تحميل ملف نتائج المرافق والطاقة. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.';
    console.error('Utilities annual data could not be loaded:', error);
  }
}
$('utilities-nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
$('utilities-chart-metric').addEventListener('change', () => { selectedChartKey = $('utilities-chart-metric').value; drawSelectedChart(); });
window.addEventListener('popstate', () => { if (dataset) selectCompany(new URLSearchParams(window.location.search).get('symbol'), true); });
const resizeCharts = () => { if (dataset && activeCompany) fitUtilitiesCharts($('utilities-charts-grid'), activeCompany, activeYears); };
if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(resizeCharts); observer.observe($('utilities-charts-grid')); } else window.addEventListener('resize', resizeCharts);
load();

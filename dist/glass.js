import { escapeHtml, validateDataset, renderAnnualTable } from './glass-metrics.mjs?v=glass-value-labels-20261106-v12';
import { renderGlassCharts, fitGlassCharts, getChartOptions } from './glass-charts.mjs?v=glass-value-labels-20261106-v12';
const $ = id => document.getElementById(id);
let dataset, activeCompany, activeYears = [], selectedChartKey = 'netProfit';
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const option = getChartOptions(activeCompany, activeYears).find(item => item.key === selectedChartKey);
  $('glass-charts-context').textContent = `${activeCompany.name} · ${activeYears[0]}–${activeYears.at(-1)} · من بيانات الملف المحفوظ`;
  $('glass-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام ${activeYears[0]}–${activeYears.at(-1)}. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لبعض السنوات في الملف؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  $('glass-charts-grid').innerHTML = renderGlassCharts(activeCompany, activeYears, selectedChartKey);
  fitGlassCharts($('glass-charts-grid'), activeCompany, activeYears);
}
function populateChartOptions(company) {
  const grouped = new Map();
  for (const option of getChartOptions(company, activeYears)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  $('glass-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if ($('glass-chart-metric').value !== selectedChartKey) selectedChartKey = $('glass-chart-metric').value;
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('glass-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('glass-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('glass-subtitle').textContent = `${company.fullName || company.name} · قطاع المنتجات الزجاجية · نتائج سنوية فقط`;
  const availableYears = company.years.map(record => record.year).sort((a, b) => a - b);
  activeYears = availableYears;
  $('glass-table-wrap').innerHTML = renderAnnualTable(company, availableYears);
  $('glass-table-wrap').scrollLeft = 0;
  $('glass-panel').hidden = false;
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
    const response = await fetch('glass-financials.json?v=glass-value-labels-20261106-v12');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    $('glass-import-info').textContent = `المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`;
    selectCompany(new URLSearchParams(window.location.search).get('symbol'), true);
    $('glass-load-status').textContent = 'المصدر: ملف argaam_glass.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من القيم السنوية المخزنة';
  } catch (error) {
    $('glass-load-status').textContent = 'تعذر تحميل ملف نتائج المنتجات الزجاجية. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.';
    console.error('Glass annual data could not be loaded:', error);
  }
}
$('glass-nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
$('glass-chart-metric').addEventListener('change', () => { selectedChartKey = $('glass-chart-metric').value; drawSelectedChart(); });
window.addEventListener('popstate', () => { if (dataset) selectCompany(new URLSearchParams(window.location.search).get('symbol'), true); });
const resizeCharts = () => { if (dataset && activeCompany) fitGlassCharts($('glass-charts-grid'), activeCompany, activeYears); };
if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(resizeCharts); observer.observe($('glass-charts-grid')); } else window.addEventListener('resize', resizeCharts);
load();

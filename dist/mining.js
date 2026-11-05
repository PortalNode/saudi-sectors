import { escapeHtml, validateDataset, renderAnnualTable } from './mining-metrics.mjs?v=mining-charts-final-20261105';
import { renderMiningCharts, fitMiningCharts, getChartOptions } from './mining-charts.mjs?v=mining-charts-final-20261105';
const $ = id => document.getElementById(id);
let dataset, activeCompany, selectedChartKey = 'netProfit';
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const option = getChartOptions(activeCompany, dataset.years).find(item => item.key === selectedChartKey);
  $('mining-charts-context').textContent = `${activeCompany.name} · 2020–2025 · من بيانات الملف المحفوظ`;
  $('mining-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام 2020–2025. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لبعض السنوات في الملف؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  $('mining-charts-grid').innerHTML = renderMiningCharts(activeCompany, dataset.years, selectedChartKey);
  fitMiningCharts($('mining-charts-grid'), activeCompany, dataset.years);
}
function populateChartOptions(company) {
  const grouped = new Map();
  for (const option of getChartOptions(company, dataset.years)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  $('mining-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if ($('mining-chart-metric').value !== selectedChartKey) selectedChartKey = $('mining-chart-metric').value;
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('mining-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('mining-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('mining-subtitle').textContent = `${company.fullName || company.name} · قطاع التعدين والمعادن · نتائج سنوية فقط`;
  $('mining-table-wrap').innerHTML = renderAnnualTable(company, dataset.years);
  $('mining-table-wrap').scrollLeft = 0;
  $('mining-panel').hidden = false;
  activeCompany = company;
  populateChartOptions(company);
  drawSelectedChart();
  document.title = `${company.name} | النتائج السنوية 2020–2025 | السوق السعودي`;
  const url = new URL(window.location.href); url.searchParams.set('symbol', company.symbol);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (replaceHistory) window.history.replaceState({ symbol: company.symbol }, '', next);
  else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({ symbol: company.symbol }, '', next);
}
async function load() {
  try {
    const response = await fetch('mining-financials.json?v=mining-charts-final-20261105');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    $('mining-import-info').textContent = `المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`;
    selectCompany(new URLSearchParams(window.location.search).get('symbol'), true);
    $('mining-load-status').textContent = 'المصدر: ملف قطاعالتعدين.txt · بيانات ثابتة 2020–2025 · نسب التغير محسوبة من القيم السنوية المخزنة';
  } catch (error) {
    $('mining-load-status').textContent = 'تعذر تحميل ملف نتائج التعدين. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.';
    console.error('Mining annual data could not be loaded:', error);
  }
}
$('mining-nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
$('mining-chart-metric').addEventListener('change', () => { selectedChartKey = $('mining-chart-metric').value; drawSelectedChart(); });
window.addEventListener('popstate', () => { if (dataset) selectCompany(new URLSearchParams(window.location.search).get('symbol'), true); });
const resizeCharts = () => { if (dataset && activeCompany) fitMiningCharts($('mining-charts-grid'), activeCompany, dataset.years); };
if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(resizeCharts); observer.observe($('mining-charts-grid')); } else window.addEventListener('resize', resizeCharts);
load();

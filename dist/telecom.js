import { escapeHtml, validateDataset, renderAnnualTable } from './telecom-metrics.mjs?v=telecom-charts-20261106-v6';
import { renderTelecomCharts, fitTelecomCharts, getChartOptions } from './telecom-charts.mjs?v=telecom-charts-20261106-v6';
const $ = id => document.getElementById(id);
let dataset, activeCompany, selectedChartKey = 'netProfit';
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const option = getChartOptions(activeCompany, dataset.years).find(item => item.key === selectedChartKey);
  $('telecom-charts-20261106-v6').textContent = `${activeCompany.name} · 2021–2025 · من بيانات الملف المحفوظ`;
  $('telecom-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام 2021–2025. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لبعض السنوات في الملف؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  $('telecom-charts-20261106-v6').innerHTML = renderTelecomCharts(activeCompany, dataset.years, selectedChartKey);
  fitTelecomCharts($('telecom-charts-20261106-v6'), activeCompany, dataset.years);
}
function populateChartOptions(company) {
  const grouped = new Map();
  for (const option of getChartOptions(company, dataset.years)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  $('telecom-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if ($('telecom-chart-metric').value !== selectedChartKey) selectedChartKey = $('telecom-chart-metric').value;
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('telecom-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('telecom-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('telecom-subtitle').textContent = `${company.fullName || company.name} · قطاع الاتصالات · نتائج سنوية فقط`;
  $('telecom-table-wrap').innerHTML = renderAnnualTable(company, dataset.years);
  $('telecom-table-wrap').scrollLeft = 0;
  $('telecom-panel').hidden = false;
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
    const response = await fetch('telecom-financials.json?v=telecom-charts-20261106-v6');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    $('telecom-import-info').textContent = `المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`;
    selectCompany(new URLSearchParams(window.location.search).get('symbol'), true);
    $('telecom-load-status').textContent = 'المصدر: ملف argaam_telecom.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من القيم السنوية المخزنة';
  } catch (error) {
    $('telecom-load-status').textContent = 'تعذر تحميل ملف نتائج الاتصالات. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.';
    console.error('Telecom annual data could not be loaded:', error);
  }
}
$('telecom-nav').addEventListener('click', event => { const button = event.target.closest('[data-company]'); if (button && dataset) selectCompany(button.dataset.company); });
$('telecom-chart-metric').addEventListener('change', () => { selectedChartKey = $('telecom-chart-metric').value; drawSelectedChart(); });
window.addEventListener('popstate', () => { if (dataset) selectCompany(new URLSearchParams(window.location.search).get('symbol'), true); });
const resizeCharts = () => { if (dataset && activeCompany) fitTelecomCharts($('telecom-charts-20261106-v6'), activeCompany, dataset.years); };
if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(resizeCharts); observer.observe($('telecom-charts-20261106-v6')); } else window.addEventListener('resize', resizeCharts);
load();

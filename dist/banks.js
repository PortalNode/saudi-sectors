import { escapeHtml, validateDataset, renderAnnualTable } from './bank-metrics.mjs?v=compact-columns-20261104';
import { renderBankCharts, fitBankCharts, getChartOptions } from './bank-charts.mjs?v=metric-selector-20261104';

const element = id => document.getElementById(id);
let dataset, activeChartBank;
let selectedChartKey = 'netProfit';
function drawSelectedChart() {
  if (!dataset || !activeChartBank) return;
  const option = getChartOptions(activeChartBank, dataset.years).find(item => item.key === selectedChartKey);
  element('bank-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام 2021–2025. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لهذا البنك في الملف؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  element('bank-charts-grid').innerHTML = renderBankCharts(activeChartBank, dataset.years, selectedChartKey);
  fitBankCharts(element('bank-charts-grid'), activeChartBank, dataset.years);
}
function populateChartOptions(bank) {
  const grouped = new Map();
  for (const option of getChartOptions(bank, dataset.years)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  element('bank-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح لهذا البنك)'))}</option>`).join('')}</optgroup>`).join('');
  if (element('bank-chart-metric').value !== selectedChartKey) selectedChartKey = element('bank-chart-metric').value;
}
function selectBank(symbol, replaceHistory = false) {
  const bank = dataset.banks.find(item => item.symbol === symbol) || dataset.banks.find(item => item.symbol === '1120') || dataset.banks[0];
  element('bank-nav').innerHTML = dataset.banks.map(item => `<button type="button" class="bank-tab" data-bank="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === bank.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  element('bank-title').innerHTML = `${escapeHtml(bank.name)} <span class="symbol-badge">${escapeHtml(bank.symbol)}</span>`;
  element('bank-subtitle').textContent = `${bank.fullName || bank.name} · قطاع البنوك · نتائج سنوية كاملة في الملف`;
  element('bank-table-wrap').innerHTML = renderAnnualTable(bank, dataset.years);
  element('bank-table-wrap').scrollLeft = 0;
  element('bank-table-wrap').scrollTop = 0;
  element('bank-panel').hidden = false;
  activeChartBank = bank;
  element('bank-charts-context').textContent = `${bank.name} · 2021–2025 · من بيانات الملف المحفوظ`;
  populateChartOptions(bank);
  drawSelectedChart();
  element('bank-load-status').textContent = 'المصدر: ملف البنوك.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من قيم الملف';
  document.title = `${bank.name} | النتائج السنوية 2021–2025 | السوق السعودي`;
  const url = new URL(window.location.href);
  url.searchParams.set('symbol', bank.symbol);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (replaceHistory) window.history.replaceState({ symbol: bank.symbol }, '', next);
  else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({ symbol: bank.symbol }, '', next);
}
async function load() {
  try {
    const response = await fetch('banks-financials.json?v=workbook-20261104');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    const imported = new Date(dataset.source?.importedAt);
    const date = Number.isNaN(imported.getTime()) ? 'غير محدد' : new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit' }).format(imported);
    element('bank-import-info').textContent = `تاريخ استيراد الملف: ${date} · تاريخ الاستيراد ليس تاريخ إعلان النتائج · ورقة المصدر تظهر لكل بنك في الملف المحفوظ.`;
    selectBank(new URLSearchParams(window.location.search).get('symbol'), true);
  } catch (error) {
    element('bank-load-status').textContent = 'تعذر تحميل ملف نتائج البنوك. أعد تحميل الصفحة؛ لم تُستبدل البيانات بأرقام افتراضية.';
    element('bank-panel').hidden = true;
    console.error('Bank annual data could not be loaded:', error);
  }
}
element('bank-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-bank]');
  if (button && dataset) selectBank(button.dataset.bank);
});
element('bank-chart-metric').addEventListener('change', () => {
  selectedChartKey = element('bank-chart-metric').value;
  drawSelectedChart();
});
window.addEventListener('popstate', () => {
  if (dataset) selectBank(new URLSearchParams(window.location.search).get('symbol'), true);
});
const resizeCharts = () => {
  if (dataset && activeChartBank) fitBankCharts(element('bank-charts-grid'), activeChartBank, dataset.years);
};
if (typeof ResizeObserver === 'function') {
  const chartObserver = new ResizeObserver(resizeCharts);
  chartObserver.observe(element('bank-charts-grid'));
} else {
  window.addEventListener('resize', resizeCharts);
}
load();

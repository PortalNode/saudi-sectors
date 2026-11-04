import { escapeHtml, validateDataset, renderAnnualTable } from './bank-metrics.mjs?v=compact-columns-20261104';
import { renderBankCharts, fitBankCharts } from './bank-charts.mjs?v=annual-charts-20261104';

const element = id => document.getElementById(id);
let dataset, activeChartBank;
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
  element('bank-charts-grid').innerHTML = renderBankCharts(bank, dataset.years);
  fitBankCharts(element('bank-charts-grid'), bank, dataset.years);
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

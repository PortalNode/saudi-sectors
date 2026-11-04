import { escapeHtml, validateDataset, renderAnnualTable } from './bank-metrics.mjs?v=compact-columns-20261104';
import { renderBankCharts, fitBankCharts, getChartOptions } from './bank-charts.mjs?v=metric-selector-20261104';
import { buildCurrentBankPE, renderCurrentBankPECard } from './bank-current-pe.mjs?v=20261105';
import { renderCurrentPEComparison, fitCurrentPEComparison } from './bank-current-pe-chart.mjs?v=20261105';

const element = id => document.getElementById(id);
let dataset, activeChartBank;
let selectedChartKey = 'netProfit';
let currentRatios = [], currentRefreshRunning = false, currentPriceTime = -Infinity;
let currentPEError = '';
const checkedTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'غير متاح' : new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh', calendar: 'gregory', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date);
};
function chartOptions(bank) {
  return [...getChartOptions(bank, dataset.years), {
    key: 'currentPE', label: 'مكرر الربح الحالي — جميع البنوك', group: 'المؤشرات الحالية',
    available: currentRatios.some(record => record.pe !== null)
  }];
}
function drawSelectedChart() {
  if (!dataset || !activeChartBank) return;
  if (selectedChartKey === 'currentPE') {
    element('bank-charts-context').textContent = 'مقارنة حالية بين البنوك، وليست سلسلة سنوية';
    element('bank-chart-selection-status').textContent = currentRatios.length
      ? `المكرر الحالي للبنوك العشرة · آخر فحص للأسعار: ${checkedTime(currentRatios[0].checkedAt)} بتوقيت الرياض. ${currentPEError}`
      : currentPEError || 'جار تحميل المكرر الحالي؛ لا تُستخدم قيم السنوات التاريخية بديلًا عنه.';
    element('bank-charts-grid').innerHTML = currentRatios.length
      ? renderCurrentPEComparison(currentRatios)
      : '<p class="financial-status">المكرر الحالي غير متاح بعد؛ تبقى المقارنات التاريخية متاحة.</p>';
    fitCurrentPEComparison(element('bank-charts-grid'), currentRatios);
    return;
  }
  element('bank-charts-context').textContent = `${activeChartBank.name} · 2021–2025 · من بيانات الملف المحفوظ`;
  const option = getChartOptions(activeChartBank, dataset.years).find(item => item.key === selectedChartKey);
  element('bank-chart-selection-status').textContent = option?.available
    ? `مقارنة ${option.label} للأعوام 2021–2025. يمكنك اختيار أي بند آخر من القائمة.`
    : 'هذا البند غير متاح لهذا البنك في الملف؛ تظهر السنوات بعلامة «—» دون أرقام افتراضية.';
  element('bank-charts-grid').innerHTML = renderBankCharts(activeChartBank, dataset.years, selectedChartKey);
  fitBankCharts(element('bank-charts-grid'), activeChartBank, dataset.years);
}
function populateChartOptions(bank) {
  const grouped = new Map();
  for (const option of chartOptions(bank)) {
    if (!grouped.has(option.group)) grouped.set(option.group, []);
    grouped.get(option.group).push(option);
  }
  element('bank-chart-metric').innerHTML = [...grouped].map(([group, options]) => `<optgroup label="${escapeHtml(group)}">${options.map(option => `<option value="${escapeHtml(option.key)}"${option.key === selectedChartKey ? ' selected' : ''}>${escapeHtml(option.label + (option.available ? '' : ' (غير متاح حاليًا)'))}</option>`).join('')}</optgroup>`).join('');
  if (element('bank-chart-metric').value !== selectedChartKey) selectedChartKey = element('bank-chart-metric').value;
}
function paintCurrentCard() {
  if (!activeChartBank) return;
  const record = currentRatios.find(item => item.symbol === activeChartBank.symbol);
  element('bank-current-pe').innerHTML = record ? renderCurrentBankPECard(record) : '';
  element('bank-current-pe-status').textContent = currentPEError || (record
    ? 'المكرر الحالي من آخر لقطة أسعار وربحية متاحة في المشروع؛ ليس سعرًا مباشرًا، ولا يُحسب بربحية 2025 من الجدول السنوي.'
    : 'جار تحميل مكرر الربح الحالي من بيانات المشروع…');
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
  paintCurrentCard();
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
async function readCurrentJSON(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function refreshCurrentPE() {
  if (!dataset || currentRefreshRunning) return;
  currentRefreshRunning = true;
  try {
    const [pricesResult, mapResult] = await Promise.allSettled([
      readCurrentJSON('data.json'), readCurrentJSON('financial-map.json')
    ]);
    if (pricesResult.status !== 'fulfilled') throw new Error('price snapshot unavailable');
    const prices = pricesResult.value;
    if (!Array.isArray(prices?.sectors) || prices.sectors.some(sector => !Array.isArray(sector.stocks))) throw new Error('invalid price dataset');
    const incoming = new Date(prices.priceSource?.checkedAt).getTime();
    if (!Number.isFinite(incoming) || incoming < currentPriceTime || incoming > Date.now()) throw new Error('older or undated price dataset');
    const map = mapResult.status === 'fulfilled' ? mapResult.value : null;
    currentRatios = buildCurrentBankPE(dataset.banks, prices, map);
    currentPriceTime = incoming;
    currentPEError = map ? '' : 'تعذر تحميل لقطة ربحية أرقام؛ استُخدمت ربحية ملف الأسعار مع إظهار مصدرها.';
  } catch (error) {
    currentPEError = currentRatios.length
      ? 'تعذر تحديث المكرر الحالي؛ احتُفظ باللقطة المعروضة وتاريخها، وستُعاد المحاولة.'
      : 'تعذر تحميل المكرر الحالي؛ لم تُستخدم قيم المكرر التاريخي بدلًا منه.';
    console.warn('Current bank PE snapshot unavailable:', error);
  } finally {
    currentRefreshRunning = false;
    paintCurrentCard();
    if (activeChartBank) {
      populateChartOptions(activeChartBank);
      if (selectedChartKey === 'currentPE') drawSelectedChart();
    }
  }
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
    refreshCurrentPE();
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
  if (!dataset || !activeChartBank) return;
  if (selectedChartKey === 'currentPE') fitCurrentPEComparison(element('bank-charts-grid'), currentRatios);
  else fitBankCharts(element('bank-charts-grid'), activeChartBank, dataset.years);
};
if (typeof ResizeObserver === 'function') {
  const chartObserver = new ResizeObserver(resizeCharts);
  chartObserver.observe(element('bank-charts-grid'));
} else window.addEventListener('resize', resizeCharts);
// Only the current snapshot refreshes; the annual workbook remains immutable.
setInterval(refreshCurrentPE, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshCurrentPE();
});
load();

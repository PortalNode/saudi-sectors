import { escapeHtml, validateDataset, renderAnnualTable } from './bank-metrics.mjs?v=compact-columns-20261104';
import { renderBankCharts, fitBankCharts, getChartOptions } from './bank-charts.mjs?v=value-labels-20261106';
import { buildCurrentBankPE, renderCurrentBankPECard } from './bank-current-pe.mjs?v=20261105';
import { renderCurrentPEComparison, fitCurrentPEComparison } from './bank-current-pe-chart.mjs?v=20261105';
import { PERIODS, QUARTER_NAMES, quarterLabel, validateQuarterly, buildBankPeriodColumns, renderBankPeriodTable, getBankPeriodChartOptions, renderBankPeriodChart, fitBankPeriodChart } from './bank-quarterly.mjs?v=banks-quarterly-20261115';

const element = id => document.getElementById(id);
let dataset, activeChartBank;
let selectedChartKey = 'netProfit';
let currentRatios = [], currentRefreshRunning = false, currentPriceTime = -Infinity;
let currentPEError = '';
// Period views (quarter / 6 months / 9 months) come from banks-quarterly-financials.json;
// 'fy' is the unchanged annual view from banks-financials.json.
let quarterly = null, period = 'fy', quarter = '3', periodColumns = [];
const QUARTERLY_VERSION = 'banks-quarterly-20261115';
function periodSummary() {
  if (period === 'q') return quarter === 'seq' ? 'آخر الأرباع المتتالية' : `الربع ${QUARTER_NAMES[quarter]} عبر السنوات`;
  return period === 'fy' ? 'النتائج السنوية' : `${PERIODS[period].label} (${PERIODS[period].range})`;
}
function syncPeriodControls(quarterBank) {
  element('bank-period-bar').hidden = !quarterly;
  if (!quarterly) return;
  for (const button of element('bank-period-seg').querySelectorAll('[data-period]')) button.setAttribute('aria-pressed', String(button.dataset.period === period));
  for (const button of element('bank-quarter-seg').querySelectorAll('[data-quarter]')) button.setAttribute('aria-pressed', String(button.dataset.quarter === quarter));
  element('bank-quarter-group').hidden = period !== 'q';
  element('bank-period-desc').innerHTML = period === 'fy'
    ? 'من الملف السنوي · «نسبة التغير» مقارنةً بالسنة السابقة'
    : period === 'q'
      ? (quarter === 'seq' ? 'الأرباع بالترتيب · التغير مقارنةً بنفس الربع من العام السابق' : `الربع <b>${QUARTER_NAMES[quarter]}</b> مقارنةً بنفسه في السنوات السابقة`)
      : `تراكمي ${PERIODS[period].range} · مقارنةً بنفس الفترة من العام السابق`;
  const latest = quarterBank ? Object.keys(quarterBank.quarters).sort().at(-1) : null;
  element('bank-period-badge').innerHTML = period !== 'fy' && latest ? `آخر ربع متاح <bdi dir="ltr">${quarterLabel(latest)}</bdi>` : 'آخر خمس سنوات في الملف <bdi>2021–2025</bdi>';
  element('bank-table-hint').textContent = period === 'fy'
    ? 'اسحب الجدول أفقيًا لرؤية السنوات كاملة. «التغير» هو نسبة تغير السنة عن السابقة، وليس فرق النسب بالنقاط المئوية.'
    : 'اسحب الجدول أفقيًا لرؤية الفترات كاملة. «التغير» هو نسبة التغير مقارنةً بنفس الفترة من العام السابق. المركز المالي والمؤشرات المالية في العرض السنوي فقط.';
}
const checkedTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'غير متاح' : new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh', calendar: 'gregory', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date);
};
function chartOptions(bank) {
  return [...(period === 'fy' ? getChartOptions(bank, dataset.years) : getBankPeriodChartOptions(periodColumns)), {
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
  if (period !== 'fy') {
    const option = getBankPeriodChartOptions(periodColumns).find(item => item.key === selectedChartKey);
    const range = periodColumns.length ? `${periodColumns[0].chartLabel ?? periodColumns[0].label} – ${periodColumns.at(-1).chartLabel ?? periodColumns.at(-1).label}` : '—';
    element('bank-charts-context').textContent = `${activeChartBank.name} · ${periodSummary()} · ${range}`;
    element('bank-chart-selection-status').textContent = option?.available
      ? `مقارنة ${option.label} · ${periodSummary()}. يمكنك اختيار أي بند آخر من القائمة.`
      : 'هذا البند غير متوفر لهذا البنك في ملف النتائج الربعية؛ تظهر الفترات بعلامة «—» دون أرقام افتراضية.';
    element('bank-charts-grid').innerHTML = renderBankPeriodChart(activeChartBank, periodColumns, selectedChartKey);
    fitBankPeriodChart(element('bank-charts-grid'), activeChartBank, periodColumns, selectedChartKey);
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
  const quarterBank = quarterly?.companies.find(item => item.symbol === bank.symbol);
  if (period !== 'fy' && !quarterBank) period = 'fy';
  element('bank-nav').innerHTML = dataset.banks.map(item => `<button type="button" class="bank-tab" data-bank="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === bank.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  element('bank-title').innerHTML = `${escapeHtml(bank.name)} <span class="symbol-badge">${escapeHtml(bank.symbol)}</span>`;
  element('bank-subtitle').textContent = `${bank.fullName || bank.name} · قطاع البنوك · ${period === 'fy' ? 'نتائج سنوية كاملة في الملف' : periodSummary()}`;
  syncPeriodControls(quarterBank);
  if (period === 'fy') {
    periodColumns = [];
    element('bank-table-wrap').innerHTML = renderAnnualTable(bank, dataset.years);
  } else {
    periodColumns = buildBankPeriodColumns(quarterBank, period, quarter);
    element('bank-table-wrap').innerHTML = renderBankPeriodTable(bank, periodColumns, { sequential: period === 'q' && quarter === 'seq', caption: periodSummary() });
  }
  element('bank-table-wrap').scrollLeft = 0;
  element('bank-table-wrap').scrollTop = 0;
  element('bank-panel').hidden = false;
  activeChartBank = bank;
  paintCurrentCard();
  populateChartOptions(bank);
  drawSelectedChart();
  element('bank-load-status').hidden = true; // sources are listed in the notes
  document.title = period === 'fy' ? `${bank.name} | النتائج السنوية 2021–2025 | السوق السعودي` : `${bank.name} | ${periodSummary()} | السوق السعودي`;
  const url = new URL(window.location.href);
  url.searchParams.set('symbol', bank.symbol);
  if (period === 'fy') url.searchParams.delete('period'); else url.searchParams.set('period', period);
  if (period === 'q') url.searchParams.set('q', quarter); else url.searchParams.delete('q');
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
function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  period = quarterly && PERIODS[params.get('period')] ? params.get('period') : 'fy';
  quarter = ['1', '2', '3', '4', 'seq'].includes(params.get('q')) ? params.get('q') : '3';
  return params.get('symbol');
}
// The quarterly file is optional: without it the page stays annual-only.
async function loadQuarterly() {
  try {
    const response = await fetch(`banks-quarterly-financials.json?v=${QUARTERLY_VERSION}`);
    if (!response.ok) return null;
    return validateQuarterly(await response.json(), 'البنوك');
  } catch (error) {
    console.error('Quarterly bank data could not be loaded:', error);
    return null;
  }
}
async function load() {
  try {
    const [response, quarterlyData] = await Promise.all([fetch('banks-financials.json?v=workbook-20261104'), loadQuarterly()]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = validateDataset(await response.json());
    quarterly = quarterlyData;
    const imported = new Date(dataset.source?.importedAt);
    const date = Number.isNaN(imported.getTime()) ? 'غير محدد' : new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit' }).format(imported);
    element('bank-import-info').textContent = `تاريخ استيراد الملف: ${date} · تاريخ الاستيراد ليس تاريخ إعلان النتائج · ورقة المصدر تظهر لكل بنك في الملف المحفوظ.`;
    selectBank(readUrlState(), true);
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
element('bank-period-seg').addEventListener('click', event => {
  const button = event.target.closest('[data-period]');
  if (button && dataset && quarterly) { period = button.dataset.period; selectBank(activeChartBank?.symbol); }
});
element('bank-quarter-seg').addEventListener('click', event => {
  const button = event.target.closest('[data-quarter]');
  if (button && dataset && quarterly) { quarter = button.dataset.quarter; selectBank(activeChartBank?.symbol); }
});
window.addEventListener('popstate', () => {
  if (dataset) selectBank(readUrlState(), true);
});
const resizeCharts = () => {
  if (!dataset || !activeChartBank) return;
  if (selectedChartKey === 'currentPE') fitCurrentPEComparison(element('bank-charts-grid'), currentRatios);
  else if (period !== 'fy') fitBankPeriodChart(element('bank-charts-grid'), activeChartBank, periodColumns, selectedChartKey);
  else fitBankCharts(element('bank-charts-grid'), activeChartBank, dataset.years);
};
if (typeof ResizeObserver === 'function') {
  const chartObserver = new ResizeObserver(resizeCharts);
  chartObserver.observe(element('bank-charts-grid'));
} else window.addEventListener('resize', resizeCharts);
// Only the current snapshot refreshes; the annual and quarterly workbooks remain immutable.
setInterval(refreshCurrentPE, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshCurrentPE();
});
load();

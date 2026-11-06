import { escapeHtml, validateDataset, renderAnnualTable } from './telecom-metrics.mjs?v=telecom-comparison-20261106-v12';
import { renderTelecomCharts, fitTelecomCharts } from './telecom-charts.mjs?v=telecom-comparison-20261106-v12';
const $ = id => document.getElementById(id);
let dataset, activeCompany, activeYears = [], selectedYear;
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const companies = dataset.companies;
  $('telecom-charts-context').textContent = `مقارنة جميع شركات القطاع · السنة ${selectedYear}`;
  $('telecom-chart-selection-status').textContent = `الأعمدة تعرض الإيرادات وإجمالي الدخل ودخل العمليات وصافي الدخل لجميع شركات القطاع في السنة المختارة.`;
  $('telecom-charts-grid').innerHTML = renderTelecomCharts(companies, selectedYear);
  fitTelecomCharts($('telecom-charts-grid'), companies, selectedYear);
}
function populateChartOptions() {
  $('telecom-chart-metric').innerHTML = dataset.years.slice().sort((a,b)=>a-b).map(year => `<option value="${year}"${year === selectedYear ? ' selected' : ''}>${year}</option>`).join('');
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('telecom-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('telecom-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('telecom-subtitle').textContent = `${company.fullName || company.name} · قطاع الاتصالات · نتائج سنوية فقط`;
  const availableYears = company.years.map(record => record.year).sort((a,b)=>a-b); activeYears = availableYears;
  if (selectedYear === undefined || !dataset.years.includes(selectedYear)) selectedYear = Math.max(...dataset.years);
  $('telecom-table-wrap').innerHTML = renderAnnualTable(company, availableYears); $('telecom-table-wrap').scrollLeft = 0; $('telecom-panel').hidden = false; activeCompany = company;
  populateChartOptions(); drawSelectedChart(); document.title = `${company.name} | النتائج السنوية 2021–2025 | السوق السعودي`;
  const url = new URL(window.location.href); url.searchParams.set('symbol', company.symbol); const next = `${url.pathname}${url.search}${url.hash}`;
  if (replaceHistory) window.history.replaceState({symbol:company.symbol},'',next); else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({symbol:company.symbol},'',next);
}
async function load() { try { const response=await fetch('telecom-financials.json?v=telecom-comparison-20261106-v12'); if(!response.ok)throw new Error(`HTTP ${response.status}`); dataset=validateDataset(await response.json()); $('telecom-import-info').textContent=`المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`; selectCompany(new URLSearchParams(window.location.search).get('symbol'),true); $('telecom-load-status').textContent='المصدر: ملف argaam_telecom.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من القيم السنوية المخزنة'; } catch(error) { $('telecom-load-status').textContent='تعذر تحميل ملف النتائج المالية؛ أعد تحميل الصفحة.'; console.error('Telecom annual data could not be loaded:',error); } }
$('telecom-nav').addEventListener('click',event=>{const button=event.target.closest('[data-company]');if(button&&dataset)selectCompany(button.dataset.company);});
$('telecom-chart-metric').addEventListener('change',()=>{selectedYear=Number($('telecom-chart-metric').value);drawSelectedChart();});
window.addEventListener('popstate',()=>{if(dataset)selectCompany(new URLSearchParams(window.location.search).get('symbol'),true);});
const resizeCharts=()=>{if(dataset&&activeCompany)fitTelecomCharts($('telecom-charts-grid'),dataset.companies,selectedYear);}; if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resizeCharts);observer.observe($('telecom-charts-grid'));}else window.addEventListener('resize',resizeCharts); load();

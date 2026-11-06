import { escapeHtml, validateDataset, renderAnnualTable } from './consumer-metrics.mjs?v=consumer-comparison-20261106-v12';
import { renderConsumerCharts, fitConsumerCharts } from './consumer-charts.mjs?v=consumer-comparison-20261106-v12';
const $ = id => document.getElementById(id);
let dataset, activeCompany, activeYears = [], selectedYear;
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const companies = dataset.companies;
  $('consumer-charts-context').textContent = `مقارنة جميع شركات القطاع · السنة ${selectedYear}`;
  $('consumer-chart-selection-status').textContent = `الأعمدة تعرض الإيرادات وإجمالي الدخل ودخل العمليات وصافي الدخل لجميع شركات القطاع في السنة المختارة.`;
  $('consumer-charts-grid').innerHTML = renderConsumerCharts(companies, selectedYear);
  fitConsumerCharts($('consumer-charts-grid'), companies, selectedYear);
}
function populateChartOptions() {
  $('consumer-chart-metric').innerHTML = dataset.years.slice().sort((a,b)=>a-b).map(year => `<option value="${year}"${year === selectedYear ? ' selected' : ''}>${year}</option>`).join('');
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('consumer-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('consumer-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('consumer-subtitle').textContent = `${company.fullName || company.name} · قطاع السلع الاستهلاكية · نتائج سنوية فقط`;
  const availableYears = company.years.map(record => record.year).sort((a,b)=>a-b); activeYears = availableYears;
  if (selectedYear === undefined || !dataset.years.includes(selectedYear)) selectedYear = Math.max(...dataset.years);
  $('consumer-table-wrap').innerHTML = renderAnnualTable(company, availableYears); $('consumer-table-wrap').scrollLeft = 0; $('consumer-panel').hidden = false; activeCompany = company;
  populateChartOptions(); drawSelectedChart(); document.title = `${company.name} | النتائج السنوية 2021–2025 | السوق السعودي`;
  const url = new URL(window.location.href); url.searchParams.set('symbol', company.symbol); const next = `${url.pathname}${url.search}${url.hash}`;
  if (replaceHistory) window.history.replaceState({symbol:company.symbol},'',next); else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({symbol:company.symbol},'',next);
}
async function load() { try { const response=await fetch('consumer-financials.json?v=consumer-comparison-20261106-v12'); if(!response.ok)throw new Error(`HTTP ${response.status}`); dataset=validateDataset(await response.json()); $('consumer-import-info').textContent=`المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`; selectCompany(new URLSearchParams(window.location.search).get('symbol'),true); $('consumer-load-status').textContent='المصدر: ملف argaam_consumer.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من القيم السنوية المخزنة'; } catch(error) { $('consumer-load-status').textContent='تعذر تحميل ملف النتائج المالية؛ أعد تحميل الصفحة.'; console.error('Consumer annual data could not be loaded:',error); } }
$('consumer-nav').addEventListener('click',event=>{const button=event.target.closest('[data-company]');if(button&&dataset)selectCompany(button.dataset.company);});
$('consumer-chart-metric').addEventListener('change',()=>{selectedYear=Number($('consumer-chart-metric').value);drawSelectedChart();});
window.addEventListener('popstate',()=>{if(dataset)selectCompany(new URLSearchParams(window.location.search).get('symbol'),true);});
const resizeCharts=()=>{if(dataset&&activeCompany)fitConsumerCharts($('consumer-charts-grid'),dataset.companies,selectedYear);}; if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resizeCharts);observer.observe($('consumer-charts-grid'));}else window.addEventListener('resize',resizeCharts); load();

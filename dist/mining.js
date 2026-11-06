import { escapeHtml, validateDataset, renderAnnualTable } from './mining-metrics.mjs?v=mining-comparison-20261106-v12';
import { renderMiningCharts, fitMiningCharts } from './mining-charts.mjs?v=mining-comparison-20261106-v12';
const $ = id => document.getElementById(id);
let dataset, activeCompany, activeYears = [], selectedYear;
function drawSelectedChart() {
  if (!dataset || !activeCompany) return;
  const companies = dataset.companies;
  $('mining-charts-context').textContent = `مقارنة جميع شركات القطاع · السنة ${selectedYear}`;
  $('mining-chart-selection-status').textContent = `الأعمدة تعرض الإيرادات وإجمالي الدخل ودخل العمليات وصافي الدخل لجميع شركات القطاع في السنة المختارة.`;
  $('mining-charts-grid').innerHTML = renderMiningCharts(companies, selectedYear);
  fitMiningCharts($('mining-charts-grid'), companies, selectedYear);
}
function populateChartOptions() {
  $('mining-chart-metric').innerHTML = dataset.years.slice().sort((a,b)=>a-b).map(year => `<option value="${year}"${year === selectedYear ? ' selected' : ''}>${year}</option>`).join('');
}
function selectCompany(symbol, replaceHistory = false) {
  const company = dataset.companies.find(item => item.symbol === symbol) || dataset.companies[0];
  $('mining-nav').innerHTML = dataset.companies.map(item => `<button type="button" class="bank-tab" data-company="${escapeHtml(item.symbol)}" aria-pressed="${item.symbol === company.symbol}" title="نتائج ${escapeHtml(item.name)} ${escapeHtml(item.symbol)}">${escapeHtml(item.name)}</button>`).join('');
  $('mining-title').innerHTML = `${escapeHtml(company.name)} <span class="symbol-badge">${escapeHtml(company.symbol)}</span>`;
  $('mining-subtitle').textContent = `${company.fullName || company.name} · قطاع التعدين والمعادن · نتائج سنوية فقط`;
  const availableYears = company.years.map(record => record.year).sort((a,b)=>a-b); activeYears = availableYears;
  if (selectedYear === undefined || !dataset.years.includes(selectedYear)) selectedYear = Math.max(...dataset.years);
  $('mining-table-wrap').innerHTML = renderAnnualTable(company, availableYears); $('mining-table-wrap').scrollLeft = 0; $('mining-panel').hidden = false; activeCompany = company;
  populateChartOptions(); drawSelectedChart(); document.title = `${company.name} | النتائج السنوية 2021–2025 | السوق السعودي`;
  const url = new URL(window.location.href); url.searchParams.set('symbol', company.symbol); const next = `${url.pathname}${url.search}${url.hash}`;
  if (replaceHistory) window.history.replaceState({symbol:company.symbol},'',next); else if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState({symbol:company.symbol},'',next);
}
async function load() { try { const response=await fetch('mining-financials.json?v=mining-comparison-20261106-v12'); if(!response.ok)throw new Error(`HTTP ${response.status}`); dataset=validateDataset(await response.json()); $('mining-import-info').textContent=`المصدر المحفوظ: ${dataset.source.name} · ${dataset.source.provider} · بيانات سنوية فقط.`; selectCompany(new URLSearchParams(window.location.search).get('symbol'),true); $('mining-load-status').textContent='المصدر: ملف argaam_mining.xlsx · بيانات ثابتة 2021–2025 · نسب التغير محسوبة من القيم السنوية المخزنة'; } catch(error) { $('mining-load-status').textContent='تعذر تحميل ملف النتائج المالية؛ أعد تحميل الصفحة.'; console.error('Mining annual data could not be loaded:',error); } }
$('mining-nav').addEventListener('click',event=>{const button=event.target.closest('[data-company]');if(button&&dataset)selectCompany(button.dataset.company);});
$('mining-chart-metric').addEventListener('change',()=>{selectedYear=Number($('mining-chart-metric').value);drawSelectedChart();});
window.addEventListener('popstate',()=>{if(dataset)selectCompany(new URLSearchParams(window.location.search).get('symbol'),true);});
const resizeCharts=()=>{if(dataset&&activeCompany)fitMiningCharts($('mining-charts-grid'),dataset.companies,selectedYear);}; if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resizeCharts);observer.observe($('mining-charts-grid'));}else window.addEventListener('resize',resizeCharts); load();

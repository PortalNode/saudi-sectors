const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const METRICS = [
  { key: 'revenue', label: 'الإيرادات' },
  { key: 'grossIncome', label: 'إجمالي الدخل' },
  { key: 'operatingIncome', label: 'دخل العمليات' },
  { key: 'netProfit', label: 'صافي الدخل' },
  { key: 'epsBeforeExceptional', label: 'ربح السهم قبل البنود الاستثنائية', unit: 'sar' },
  { key: 'eps', label: 'ربح السهم', unit: 'sar' },
  { key: 'grossMargin', label: 'هامش إجمالي الربح', unit: 'percent' },
  { key: 'operatingMargin', label: 'هامش دخل العمليات', unit: 'percent' },
  { key: 'netMargin', label: 'هامش صافي الربح', unit: 'percent' }
];
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
export function numericValue(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
export function annualChange(current, previous) {
  current = numericValue(current); previous = numericValue(previous);
  if (current === null || previous === null || previous === 0) return null;
  const result = (current - previous) / Math.abs(previous) * 100;
  return Number.isFinite(result) ? result : null;
}
function formatValue(value, unit) {
  value = numericValue(value);
  if (value === null) return '<span class="missing" title="غير متاح في الجدول السنوي">—</span>';
  const displayValue = unit === 'percent' ? value * 100 : value;
  return `<span class="num${value < 0 ? ' down' : ''}">${formatter.format(displayValue)}${unit === 'percent' ? '%' : ''}</span>`;
}
function formatChange(current, previous) {
  const value = annualChange(current, previous);
  if (value === null) return '<span class="missing" title="لا يمكن حساب التغير">—</span>';
  const zero = Math.abs(value) < 0.005;
  const trend = zero ? 'flat' : value > 0 ? 'up' : 'down';
  return `<span class="num ${trend}">${!zero && value > 0 ? '+' : ''}${formatter.format(zero ? 0 : value)}%</span>`;
}
export function validateDataset(data) {
  if (data?.schemaVersion !== 1 || data.sector !== 'الصناعات التحويلية' || !Array.isArray(data.years) || JSON.stringify(data.years) !== JSON.stringify([2021, 2022, 2023, 2024, 2025]) || !Array.isArray(data.companies) || data.companies.length !== 32) throw new Error('invalid annual industrial dataset');
  const symbols = new Set();
  for (const company of data.companies) {
    if (!/^\d{4}$/.test(company.symbol) || symbols.has(company.symbol) || typeof company.name !== 'string' || !Array.isArray(company.years)) throw new Error('invalid industrial company');
    symbols.add(company.symbol);
    for (const record of company.years) {
      if (!data.years.includes(record.year) || record.period !== 'FY' || !record.values || typeof record.values !== 'object') throw new Error('nonannual industrial record');
      for (const value of Object.values(record.values)) if (value !== null && numericValue(value) === null) throw new Error('nonnumeric industrial value');
    }
  }
  return data;
}
export function renderAnnualTable(company, years) {
  const records = new Map(company.years.map(record => [record.year, record.values]));
  const value = (year, key) => records.get(year)?.[key] ?? null;
  const financialMetrics = METRICS.filter(metric => metric.unit !== 'percent');
  const marginMetrics = METRICS.filter(metric => metric.unit === 'percent');
  const renderTable = (metrics, includeChanges, caption, tableClass = '') => {
    const columns = '<col class="annual-col-label"><col class="annual-col-value">' + years.slice(1).map(() => '<col class="annual-col-change"><col class="annual-col-value">').join('');
    const header = includeChanges
      ? `<tr><th scope="col" class="annual-label">البند</th><th scope="col">${years[0]}</th>${years.slice(1).map(year => `<th scope="col" class="annual-change-heading">نسبة التغير</th><th scope="col">${year}</th>`).join('')}</tr>`
      : `<tr><th scope="col" class="annual-label">البند</th><th scope="col">${years[0]}</th>${years.slice(1).map(year => '<th scope="col" class="annual-change-heading annual-change-spacer" aria-label="فاصل محاذاة"></th><th scope="col">'+year+'</th>').join('')}</tr>`;
    const rows = metrics.map(metric => {
      const suffix = metric.unit === 'sar' ? ' (ريال)' : metric.unit === 'percent' ? ' (%)' : metric.unit === 'million_shares' ? ' (مليون سهم)' : ' (مليون ريال)';
      const label = `<th scope="row" class="annual-label">${escapeHtml(metric.label + suffix)}</th>`;
      const cells = includeChanges
        ? `<td>${formatValue(value(years[0], metric.key), metric.unit)}</td>` + years.slice(1).map((year, index) => `<td class="annual-change">${formatChange(value(year, metric.key), value(years[index], metric.key))}</td><td>${formatValue(value(year, metric.key), metric.unit)}</td>`).join('')
        : `<td>${formatValue(value(years[0], metric.key), metric.unit)}</td>` + years.slice(1).map(year => `<td class="annual-change annual-change-spacer" aria-hidden="true"></td><td>${formatValue(value(year, metric.key), metric.unit)}</td>`).join('');
      return `<tr data-metric="${metric.key}">${label}${cells}</tr>`;
    }).join('');
    return `<table class="annual-table ${tableClass}"><caption>${escapeHtml(caption)}</caption><colgroup>${columns}</colgroup><thead>${header}</thead><tbody>${rows}</tbody></table>`;
  };
  return `<div class="annual-financial-section">${renderTable(financialMetrics, true, `${company.name} · النتائج المالية السنوية ${years[0]}–${years.at(-1)}`, 'annual-financial-table')}</div><div class="annual-margin-section"><h3>الهوامش</h3>${renderTable(marginMetrics, false, `${company.name} · الهوامش السنوية ${years[0]}–${years.at(-1)}`, 'annual-margin-table')}</div>`;
}

export const METRIC_GROUPS = [
  { label: 'ملخص النتائج المالية', metrics: [
    { key: 'netFinancingIncome', label: 'صافي الدخل من التمويل والاستثمار', unit: 'million_sar' },
    { key: 'operatingIncome', label: 'دخل العمليات', unit: 'million_sar' },
    { key: 'provisions', label: 'المخصصات', unit: 'million_sar', missingInWorkbook: true },
    { key: 'netProfit', label: 'صافي الربح', unit: 'million_sar' },
    { key: 'averageShares', label: 'متوسط عدد الأسهم', unit: 'million_shares', missingInWorkbook: true },
    { key: 'recurringEps', label: 'ربح السهم قبل البنود الاستثنائية', unit: 'sar', missingInWorkbook: true },
    { key: 'eps', label: 'ربحية السهم', unit: 'sar', note: 'وفق أساس الملف، دون تعديل عدد الأسهم بين السنوات' },
    { key: 'dilutedEps', label: 'ربح السهم المخفض', unit: 'sar' }
  ] },
  { label: 'المركز المالي', metrics: [
    { key: 'assets', label: 'الموجودات', unit: 'million_sar' },
    { key: 'financing', label: 'التمويل / صافي القروض', unit: 'million_sar' },
    { key: 'deposits', label: 'ودائع العملاء', unit: 'million_sar' },
    { key: 'equity', label: 'حقوق المساهمين', unit: 'million_sar' }
  ] },
  { label: 'المؤشرات المالية', metrics: [
    { key: 'loansToDeposits', label: 'نسبة القروض إلى الودائع', unit: 'ratio', note: 'التمويل ÷ ودائع العملاء' },
    { key: 'returnOnEquity', label: 'العائد على حقوق المساهمين', unit: 'ratio', note: 'صافي الربح ÷ حقوق المساهمين في نهاية السنة' },
    { key: 'retailFinancingShare', label: 'نسبة تمويل الأفراد', unit: 'ratio' },
    { key: 'corporateFinancingShare', label: 'نسبة تمويل الشركات', unit: 'ratio' },
    { key: 'internationalFinancingShare', label: 'نسبة التمويل الدولي', unit: 'ratio', optional: true },
    { key: 'pe', label: 'مكرر الأرباح التاريخي', unit: 'times', note: 'كما ورد في الملف؛ ليس بسعر السهم الحالي' }
  ] }
];
const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
export function numericValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function annualChange(current, previous) {
  current = numericValue(current); previous = numericValue(previous);
  if (current === null || previous === null || previous === 0) return null;
  const value = (current - previous) / Math.abs(previous) * 100;
  return Number.isFinite(value) ? value : null;
}
export function formatValue(value, unit) {
  value = numericValue(value);
  if (value === null) return '<span class="missing" title="غير متاح في الجدول السنوي للملف">—</span>';
  const display = unit === 'ratio' ? value * 100 : value;
  const suffix = unit === 'ratio' ? '%' : '';
  return `<span class="num${display < 0 ? ' down' : ''}">${formatter.format(display)}${suffix}</span>`;
}
export function formatChange(current, previous) {
  const value = annualChange(current, previous);
  if (value === null) return '<span class="missing" title="لا يمكن حساب التغير: قيمة مفقودة أو سنة سابقة تساوي صفرًا">—</span>';
  const roundedZero = Math.abs(value) < 0.005;
  const trend = roundedZero ? 'flat' : value > 0 ? 'up' : 'down';
  return `<span class="num ${trend}">${!roundedZero && value > 0 ? '+' : ''}${formatter.format(roundedZero ? 0 : value)}%</span>`;
}
export function validateDataset(data) {
  const expectedYears = [2021, 2022, 2023, 2024, 2025];
  if (data?.schemaVersion !== 1 || JSON.stringify(data.years) !== JSON.stringify(expectedYears) || !Array.isArray(data.banks) || data.banks.length !== 10) throw new Error('invalid annual bank dataset');
  const symbols = new Set();
  for (const bank of data.banks) {
    if (!/^\d{4}$/.test(bank.symbol) || symbols.has(bank.symbol) || typeof bank.name !== 'string' || !Array.isArray(bank.years) || bank.years.length !== 5) throw new Error('invalid bank record');
    symbols.add(bank.symbol);
    if (JSON.stringify(bank.years.map(record => record.year)) !== JSON.stringify(expectedYears)) throw new Error('annual years missing or duplicated');
    for (const record of bank.years) {
      if (record.period !== 'FY' || !record.values || typeof record.values !== 'object') throw new Error('nonannual record');
      for (const value of Object.values(record.values)) if (value !== null && numericValue(value) === null) throw new Error('nonnumeric bank value');
    }
  }
  return data;
}
export function renderAnnualTable(bank, years = [2021, 2022, 2023, 2024, 2025]) {
  const records = new Map(bank.years.map(record => [record.year, record.values]));
  const value = (year, key) => records.get(year)?.[key] ?? null;
  const columns = '<col class="annual-col-label"><col class="annual-col-value">' + years.slice(1).map(() => '<col class="annual-col-value"><col class="annual-col-change">').join('');
  const firstRow = `<tr><th scope="col" rowspan="2" class="annual-label">البند</th><th scope="col" rowspan="2">${years[0]}</th>${years.slice(1).map(year => `<th scope="colgroup" colspan="2">${year}</th>`).join('')}</tr>`;
  const secondRow = `<tr>${years.slice(1).map((year, index) => `<th scope="col">القيمة</th><th scope="col">التغير عن ${years[index]}</th>`).join('')}</tr>`;
  const rows = METRIC_GROUPS.map(group => `<tr class="annual-group"><th colspan="10" scope="rowgroup">${escapeHtml(group.label)}</th></tr>` + group.metrics.filter(metric => !metric.optional || years.some(year => value(year, metric.key) !== null)).map(metric => {
    const suffix = metric.unit === 'sar' ? ' (ريال)' : metric.unit === 'times' ? ' (مرة)' : '';
    const note = metric.missingInWorkbook ? 'غير موجود في الملف' : metric.note;
    const label = `<th scope="row" class="annual-label">${escapeHtml(metric.label + suffix)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</th>`;
    const cells = `<td>${formatValue(value(years[0], metric.key), metric.unit)}</td>` + years.slice(1).map((year, index) => `<td>${formatValue(value(year, metric.key), metric.unit)}</td><td class="annual-change" title="${year} مقارنة بـ ${years[index]}؛ محسوب من القيم المخزنة">${formatChange(value(year, metric.key), value(years[index], metric.key))}</td>`).join('');
    return `<tr data-metric="${escapeHtml(metric.key)}">${label}${cells}</tr>`;
  }).join('')).join('');
  return `<table class="annual-table"><caption>${escapeHtml(bank.name)} · السنوات المالية 2021–2025</caption><colgroup>${columns}</colgroup><thead>${firstRow}${secondRow}</thead><tbody>${rows}</tbody></table>`;
}

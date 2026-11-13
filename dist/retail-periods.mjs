import { escapeHtml, numericValue, annualChange, METRICS } from './retail-metrics.mjs?v=retail-periods-20261113';

// Period views built from standalone quarters: one quarter across years, the last
// eight quarters in sequence, or year-to-date sums (6 months = Q1+Q2, 9 months = Q1..Q3).
export const PERIODS = {
  q: { label: 'ربع' },
  h1: { label: '6 أشهر', quarters: 2, range: 'يناير – يونيو', short: '6M' },
  m9: { label: '9 أشهر', quarters: 3, range: 'يناير – سبتمبر', short: '9M' },
  fy: { label: 'سنوي', range: 'السنة المالية كاملة' }
};
export const QUARTER_NAMES = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع'];
export const SEQUENCE_LENGTH = 8;
const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SUMMABLE = METRICS.filter(metric => metric.unit !== 'percent').map(metric => metric.key);
const MARGINS = { grossMargin: 'grossIncome', operatingMargin: 'operatingIncome', netMargin: 'netProfit' };

const hasData = values => !!values && Object.values(values).some(value => numericValue(value) !== null);
export const quarterLabel = key => `Q${key.slice(5)} ${key.slice(0, 4)}`;

export function withMargins(values) {
  if (!values) return null;
  const result = { ...values };
  for (const [key, numerator] of Object.entries(MARGINS)) {
    const top = numericValue(values[numerator]), revenue = numericValue(values.revenue);
    result[key] = top !== null && revenue ? top / revenue : null;
  }
  return result;
}

export function sumQuarters(company, year, count) {
  const quarters = [];
  for (let quarter = 1; quarter <= count; quarter += 1) {
    const values = company.quarters?.[`${year}Q${quarter}`];
    if (!hasData(values)) return null;
    quarters.push(values);
  }
  const totals = {};
  for (const key of SUMMABLE) {
    const parts = quarters.map(values => numericValue(values[key]));
    totals[key] = parts.includes(null) ? null : Number(parts.reduce((sum, value) => sum + value, 0).toFixed(6));
  }
  return hasData(totals) ? withMargins(totals) : null;
}

/** Columns for a non-annual period: [{ id, label, sub, values, previous }] oldest first. */
export function buildPeriodColumns(company, period, quarter = '3') {
  const keys = Object.keys(company?.quarters ?? {}).filter(key => hasData(company.quarters[key])).sort();
  const years = [...new Set(keys.map(key => Number(key.slice(0, 4))))].sort((a, b) => a - b);
  let columns;
  if (period === 'h1' || period === 'm9') {
    const { quarters, short, label } = PERIODS[period];
    columns = years.map(year => ({ id: String(year), label: String(year), chartLabel: `${short} ${year}`, sub: label, values: sumQuarters(company, year, quarters) }));
  } else if (period === 'q' && quarter === 'seq') {
    columns = keys.slice(-SEQUENCE_LENGTH).map(key => {
      const year = Number(key.slice(0, 4)), number = key.slice(5);
      return { id: key, label: quarterLabel(key), values: withMargins(company.quarters[key]), sameQuarterLastYear: withMargins(company.quarters[`${year - 1}Q${number}`]) };
    });
  } else if (period === 'q') {
    columns = years.map(year => ({ id: `${year}Q${quarter}`, label: quarterLabel(`${year}Q${quarter}`), values: withMargins(company.quarters[`${year}Q${quarter}`]) }));
  } else throw new Error(`unknown period ${period}`);
  return columns.filter(column => hasData(column.values));
}

/** Shape the columns like an annual company record so the existing bar chart can draw them. */
export function chartCompanyFor(company, columns) {
  return { symbol: company.symbol, name: company.name, years: columns.map(column => ({ year: column.chartLabel ?? column.label, period: 'FY', values: column.values })) };
}

function formatValue(value, unit) {
  value = numericValue(value);
  if (value === null) return '<span class="missing" title="غير متاح">—</span>';
  const display = unit === 'percent' ? value * 100 : value;
  return `<span class="num${value < 0 ? ' down' : ''}">${formatter.format(display)}${unit === 'percent' ? '%' : ''}</span>`;
}
function formatChange(current, previous) {
  const value = annualChange(current, previous);
  if (value === null) return '<span class="missing" title="لا يمكن حساب التغير">—</span>';
  const zero = Math.abs(value) < 0.005;
  return `<span class="num ${zero ? 'flat' : value > 0 ? 'up' : 'down'}">${!zero && value > 0 ? '+' : ''}${formatter.format(zero ? 0 : value)}%</span>`;
}

/**
 * Table for a period view. Each change compares with the same period a year earlier:
 * the previous column for year-over-year views, or the stored same-quarter-last-year
 * values in the sequential view (so seasonality does not distort the change).
 */
export function renderPeriodTable(company, columns, { sequential = false, caption = '' } = {}) {
  const latest = columns.at(-1)?.id;
  const fullLabel = column => column ? (column.sub ? `${column.sub} ${column.label}` : column.label) : '';
  const latestLabel = fullLabel(columns.at(-1));
  const compareLabel = sequential
    ? (columns.at(-1) ? quarterLabel(`${Number(columns.at(-1).id.slice(0, 4)) - 1}Q${columns.at(-1).id.slice(5)}`) : '')
    : fullLabel(columns.at(-2));
  const reference = (index, key) => sequential ? columns[index].sameQuarterLastYear?.[key] ?? null : columns[index - 1]?.values?.[key] ?? null;
  const hasChangeCell = index => sequential || index > 0;
  const headerCell = column => `<th scope="col"${column.id === latest ? ' class="period-latest"' : ''}><bdi dir="ltr">${escapeHtml(column.label)}</bdi>${column.sub ? `<span class="period-sub">${escapeHtml(column.sub)}</span>` : ''}</th>`;
  const render = (metrics, withChanges, tableCaption, tableClass) => {
    const colgroup = '<col class="annual-col-label">' + columns.map((_, index) => (hasChangeCell(index) ? '<col class="annual-col-change">' : '') + '<col class="annual-col-value">').join('');
    const header = `<tr><th scope="col" class="annual-label">البند</th>${columns.map((column, index) => (hasChangeCell(index) ? (withChanges ? `<th scope="col" class="annual-change-heading">${sequential ? 'تغير سنوي' : 'نسبة التغير'}</th>` : '<th scope="col" class="annual-change-heading annual-change-spacer" aria-label="فاصل محاذاة"></th>') : '') + headerCell(column)).join('')}</tr>`;
    const rows = metrics.map(metric => {
      const suffix = metric.unit === 'sar' ? ' (ريال)' : metric.unit === 'percent' ? ' (%)' : ' (مليون ريال)';
      const cells = columns.map((column, index) => {
        const value = column.values?.[metric.key] ?? null;
        const change = !hasChangeCell(index) ? '' : withChanges ? `<td class="annual-change">${formatChange(value, reference(index, metric.key))}</td>` : '<td class="annual-change annual-change-spacer" aria-hidden="true"></td>';
        return `${change}<td>${formatValue(value, metric.unit)}</td>`;
      }).join('');
      return `<tr data-metric="${metric.key}"><th scope="row" class="annual-label">${escapeHtml(metric.label + suffix)}</th>${cells}</tr>`;
    }).join('');
    return `<table class="annual-table period-table ${tableClass}" data-latest-label="${escapeHtml(latestLabel)}" data-compare-label="${escapeHtml(compareLabel)}"><caption>${escapeHtml(tableCaption)}</caption><colgroup>${colgroup}</colgroup><thead>${header}</thead><tbody>${rows}</tbody></table>`;
  };
  const financial = METRICS.filter(metric => metric.unit !== 'percent'), margins = METRICS.filter(metric => metric.unit === 'percent');
  return `<div class="annual-financial-section">${render(financial, true, `${company.name} · ${caption}`, 'annual-financial-table')}</div><div class="annual-margin-section"><h3>الهوامش</h3>${render(margins, false, `${company.name} · الهوامش · ${caption}`, 'annual-margin-table')}</div>`;
}

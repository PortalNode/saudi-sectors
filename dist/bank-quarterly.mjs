// Period views for the banks page (quarter, 6 months, 9 months), built from standalone quarters
// in banks-quarterly-financials.json. Banks report different items from the other sectors, so
// this module has its own items; the annual table (bank-metrics.mjs) is left untouched.
import { escapeHtml, numericValue, annualChange, PERIODS, QUARTER_NAMES, SEQUENCE_LENGTH, quarterLabel, validateQuarterly } from './quarterly-periods.mjs?v=quarterly-20261114b';
import { renderChartSvg } from './bank-charts.mjs?v=value-labels-20261106';

export { PERIODS, QUARTER_NAMES, quarterLabel, validateQuarterly };

/** The six items of the quarterly workbook, named as in the workbook. */
export const BANK_QUARTER_METRICS = [
  { key: 'netFinancingIncome', label: 'صافي الدخل من الاستثمارات والتمويل' },
  { key: 'operatingIncome', label: 'دخل العمليات' },
  { key: 'provisions', label: 'المخصصات' },
  { key: 'netProfit', label: 'صافي الدخل' },
  { key: 'eps', label: 'ربح السهم', unit: 'sar' },
  { key: 'dilutedEps', label: 'ربح السهم المخفض', unit: 'sar' }
];
const KEYS = BANK_QUARTER_METRICS.map(metric => metric.key);
const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hasData = values => !!values && KEYS.some(key => numericValue(values[key]) !== null);
const pick = values => values ? Object.fromEntries(KEYS.map(key => [key, numericValue(values[key])])) : null;

/** Year-to-date sum of the first `count` quarters; null when any of those quarters is missing. */
export function sumBankQuarters(bank, year, count) {
  const quarters = [];
  for (let quarter = 1; quarter <= count; quarter += 1) {
    const values = bank.quarters?.[`${year}Q${quarter}`];
    if (!hasData(values)) return null;
    quarters.push(values);
  }
  const totals = {};
  for (const key of KEYS) {
    const parts = quarters.map(values => numericValue(values[key]));
    totals[key] = parts.includes(null) ? null : Number(parts.reduce((sum, value) => sum + value, 0).toFixed(6));
  }
  return hasData(totals) ? totals : null;
}

/** Columns for a period view: [{ id, label, chartLabel?, sub?, values, sameQuarterLastYear? }] oldest first. */
export function buildBankPeriodColumns(bank, period, quarter = '3') {
  const keys = Object.keys(bank?.quarters ?? {}).filter(key => hasData(bank.quarters[key])).sort();
  const years = [...new Set(keys.map(key => Number(key.slice(0, 4))))].sort((a, b) => a - b);
  let columns;
  if (period === 'h1' || period === 'm9') {
    const { quarters, short, label } = PERIODS[period];
    columns = years.map(year => ({ id: String(year), label: String(year), chartLabel: `${short} ${year}`, sub: label, values: sumBankQuarters(bank, year, quarters) }));
  } else if (period === 'q' && quarter === 'seq') {
    columns = keys.slice(-SEQUENCE_LENGTH).map(key => ({
      id: key, label: quarterLabel(key), values: pick(bank.quarters[key]),
      sameQuarterLastYear: pick(bank.quarters[`${Number(key.slice(0, 4)) - 1}Q${key.slice(5)}`])
    }));
  } else if (period === 'q') {
    columns = years.map(year => ({ id: `${year}Q${quarter}`, label: quarterLabel(`${year}Q${quarter}`), values: pick(bank.quarters[`${year}Q${quarter}`]) }));
  } else throw new Error(`unknown period ${period}`);
  return columns.filter(column => hasData(column.values));
}

function formatValue(value, unit) {
  value = numericValue(value);
  if (value === null) return '<span class="missing" title="غير متوفر في ملف النتائج الربعية">—</span>';
  return `<span class="num${value < 0 ? ' down' : ''}">${formatter.format(value)}</span>`;
}
function formatChange(current, previous) {
  const value = annualChange(current, previous);
  if (value === null) return '<span class="missing" title="لا يمكن حساب التغير: قيمة مفقودة أو الفترة السابقة تساوي صفرًا">—</span>';
  const zero = Math.abs(value) < 0.005;
  return `<span class="num ${zero ? 'flat' : value > 0 ? 'up' : 'down'}">${!zero && value > 0 ? '+' : ''}${formatter.format(zero ? 0 : value)}%</span>`;
}

/**
 * Period table in the annual table's layout. Each change compares with the same period a year
 * earlier: the previous column (only when it is exactly one year before), or, in the sequential
 * view, the same quarter of the previous year.
 */
export function renderBankPeriodTable(bank, columns, { sequential = false, caption = '' } = {}) {
  const latest = columns.at(-1);
  const fullLabel = column => column ? (column.sub ? `${column.sub} ${column.label}` : column.label) : '';
  const compareLabel = sequential
    ? (latest ? quarterLabel(`${Number(latest.id.slice(0, 4)) - 1}Q${latest.id.slice(5)}`) : '')
    : fullLabel(columns.at(-2));
  const yearOf = column => Number(String(column?.id ?? '').slice(0, 4));
  const reference = (index, key) => {
    if (sequential) return columns[index].sameQuarterLastYear?.[key] ?? null;
    const previous = columns[index - 1];
    return previous && yearOf(previous) === yearOf(columns[index]) - 1 ? previous.values?.[key] ?? null : null;
  };
  const hasChangeCell = index => sequential || index > 0;
  const colgroup = '<col class="annual-col-label">' + columns.map((_, index) => (hasChangeCell(index) ? '<col class="annual-col-change">' : '') + '<col class="annual-col-value">').join('');
  const headerCell = column => `<th scope="col"${column.id === latest?.id ? ' class="period-latest"' : ''}><bdi dir="ltr">${escapeHtml(column.label)}</bdi>${column.sub ? `<span class="period-sub">${escapeHtml(column.sub)}</span>` : ''}</th>`;
  const header = `<tr><th scope="col" class="annual-label">البند</th>${columns.map((column, index) => (hasChangeCell(index) ? `<th scope="col" class="annual-change-heading">${sequential ? 'تغير سنوي' : 'نسبة التغير'}</th>` : '') + headerCell(column)).join('')}</tr>`;
  const span = 1 + columns.length + columns.filter((_, index) => hasChangeCell(index)).length;
  const rows = BANK_QUARTER_METRICS.map(metric => {
    const suffix = metric.unit === 'sar' ? ' (ريال)' : ' (مليون ريال)';
    const cells = columns.map((column, index) => {
      const value = column.values?.[metric.key] ?? null;
      const change = hasChangeCell(index) ? `<td class="annual-change">${formatChange(value, reference(index, metric.key))}</td>` : '';
      return `${change}<td>${formatValue(value, metric.unit)}</td>`;
    }).join('');
    return `<tr data-metric="${metric.key}"><th scope="row" class="annual-label">${escapeHtml(metric.label + suffix)}</th>${cells}</tr>`;
  }).join('');
  return `<table class="annual-table period-table${sequential ? ' period-table-seq' : ''}" data-latest-label="${escapeHtml(fullLabel(latest))}" data-compare-label="${escapeHtml(compareLabel)}"><caption>${escapeHtml(`${bank.name} · ${caption}`)}</caption><colgroup>${colgroup}</colgroup><thead>${header}</thead><tbody><tr class="annual-group"><th colspan="${span}" scope="rowgroup">النتائج المالية للفترة</th></tr>${rows}</tbody></table>`;
}

// ----- Bar chart of one item across the period columns (same SVG as the annual charts) -----
const GOLD = '#f59e0b';
function chartModel(bank, columns, key) {
  const metric = BANK_QUARTER_METRICS.find(item => item.key === key) || BANK_QUARTER_METRICS.find(item => item.key === 'netProfit');
  const money = metric.unit !== 'sar';
  const years = columns.map(column => column.chartLabel ?? column.label);
  return {
    key: metric.key, title: metric.label, group: 'النتائج الربعية', unit: money ? 'مليار ريال' : 'ريال', factor: money ? 1 / 1000 : 1,
    bankName: bank.name ?? '', years,
    series: [{ key: metric.key, title: metric.label, color: GOLD, points: columns.map((column, index) => {
      const rawValue = numericValue(column.values?.[metric.key]);
      return { year: years[index], rawValue, value: rawValue === null ? null : money ? rawValue / 1000 : rawValue };
    }) }]
  };
}
/** Chart choices for a period view; every item stays listed and missing ones are marked. */
export function getBankPeriodChartOptions(columns) {
  return BANK_QUARTER_METRICS.map(metric => ({
    key: metric.key, label: metric.label, group: 'النتائج الربعية',
    available: columns.some(column => numericValue(column.values?.[metric.key]) !== null)
  }));
}
export function renderBankPeriodChart(bank, columns, key) {
  const model = chartModel(bank, columns, key);
  return `<article class="bank-chart-card" data-chart-key="${escapeHtml(model.key)}" dir="rtl"><h4>${escapeHtml(model.title)}</h4><p class="bank-chart-unit">${escapeHtml(model.unit)}</p><div class="bank-chart-canvas" data-chart-canvas="${escapeHtml(model.key)}" data-plot-width="600">${renderChartSvg(model)}</div></article>`;
}
/** Redraw at the canvas width; call after rendering and from the page's ResizeObserver. */
export function fitBankPeriodChart(container, bank, columns, key) {
  if (!container?.querySelectorAll) return;
  for (const canvas of container.querySelectorAll('[data-chart-canvas]')) {
    const width = Math.max(300, Math.round(canvas.clientWidth > 0 ? canvas.clientWidth : 600));
    if (canvas.dataset.plotWidth === String(width)) continue;
    const svg = canvas.querySelector('svg'), html = renderChartSvg(chartModel(bank, columns, key), width);
    if (svg) svg.outerHTML = html; else canvas.insertAdjacentHTML('beforeend', html);
    canvas.dataset.plotWidth = String(width);
  }
}

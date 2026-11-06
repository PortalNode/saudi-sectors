import { escapeHtml, numericValue, METRIC_GROUPS } from './bank-metrics.mjs';

const DEFAULT_YEARS = [2021, 2022, 2023, 2024, 2025];
const HEIGHT = 280;
const GOLD = '#f59e0b';
const BLUE = '#8ab8ff';
const decimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Value labels above bars: SAR money shows billions with three decimals when >= 1 billion, else millions with one decimal.
const billionValue = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const millionValue = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const isMoneyModel = model => model.unit === 'مليار ريال';
const barLabel = (model, point) => !isMoneyModel(model) ? decimal.format(point.value) : Math.abs(point.rawValue) >= 1000 ? billionValue.format(point.rawValue / 1000) : millionValue.format(point.rawValue);
const barUnit = (model, point) => isMoneyModel(model) ? (Math.abs(point.rawValue) >= 1000 ? 'مليار ريال' : 'مليون ريال') : model.unit;


const compactPercent = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const CHART_UNITS = {
  million_sar: { unit: 'مليار ريال', factor: 1 / 1000 },
  sar: { unit: 'ريال', factor: 1 },
  times: { unit: 'مرة', factor: 1 },
  ratio: { unit: 'نسبة مئوية (%)', factor: 100, percentage: true }
};
const DEFINITIONS = [
  ...METRIC_GROUPS.flatMap(group => group.metrics.map(metric => ({
    key: metric.key, title: metric.label, group: group.label, note: metric.note,
    ...CHART_UNITS[metric.unit]
  }))),
  { key: 'financingMix', title: 'تمويل الأفراد والشركات معًا', group: 'مقارنة الفئات', unit: 'نسبة مئوية (%)', factor: 100, percentage: true }
];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const plotWidth = width => Math.max(300, Math.round(numericValue(width) > 0 ? width : 600));
// Round SVG coordinates only; source values and proportional calculations remain intact.
const coordinate = value => String(Number(value.toFixed(4)));

/** Immutable chart-unit projections; rawValue is always the original JSON number or null. */
export function getChartModels(bank, years = DEFAULT_YEARS) {
  const orderedYears = [...years].sort((a, b) => a - b);
  const records = new Map((bank.years ?? []).filter(record => record.period === 'FY').map(record => [record.year, record.values]));
  return DEFINITIONS.map(definition => {
    const series = definition.key === 'financingMix'
      ? [{ key: 'retailFinancingShare', title: 'الأفراد', color: GOLD }, { key: 'corporateFinancingShare', title: 'الشركات', color: BLUE }]
      : [{ key: definition.key, title: definition.title, color: GOLD }];
    return {
      ...definition,
      bankName: bank.name ?? '',
      years: orderedYears,
      series: series.map(item => ({
        ...item,
        points: orderedYears.map(year => {
          const rawValue = numericValue(records.get(year)?.[item.key]);
          return { year, rawValue, value: rawValue === null ? null : definition.factor === 1 / 1000 ? rawValue / 1000 : rawValue * definition.factor };
        })
      }))
    };
  });
}

/** Keep every table item available to select; missing data is disclosed, never invented. */
export function getChartOptions(bank, years = DEFAULT_YEARS) {
  return getChartModels(bank, years).map(model => ({
    key: model.key, label: model.title, group: model.group,
    available: model.series.some(series => series.points.some(point => point.rawValue !== null))
  }));
}

function niceQuantum(target) {
  const power = 10 ** Math.floor(Math.log10(target));
  const normalized = target / power;
  return [1, 2, 2.5, 5, 10].find(value => value >= normalized) * power;
}

function chartAxis(model) {
  // Shares are independent source fractions, NOT normalized or stacked.
  if (model.key === 'financingMix') return { min: 0, max: 100, step: 20, ticks: [0, 20, 40, 60, 80, 100] };
  const values = model.series.flatMap(series => series.points.map(point => point.value)).filter(value => value !== null);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const paddedLow = low < 0 ? low * 1.2 : 0;
  const paddedHigh = high > 0 ? high * 1.2 : low === 0 ? 1 : 0;
  const step = niceQuantum((paddedHigh - paddedLow) / 5);
  const min = Math.floor(paddedLow / step) * step;
  const max = Math.ceil(paddedHigh / step) * step;
  const intervals = Math.round((max - min) / step);
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => min + index * step);
  return { min, max, step, ticks };
}

function tickLabel(value, axis, percentage) {
  const places = Math.min(8, Math.max(0, -Math.floor(Math.log10(axis.step)) + 1));
  return `${Number(value.toFixed(places)).toLocaleString('en-US', { maximumFractionDigits: places })}${percentage ? '%' : ''}`;
}

function pointTitle(model, series, point) {
  if (point.value === null) return `${series.title} · ${point.year}: غير متاح (—)`;
  const display = isMoneyModel(model) ? barLabel(model, point) : `${decimal.format(point.value)}${model.percentage ? '%' : ''}`;
  return `${series.title} · ${point.year}: ${display} ${barUnit(model, point)}`;
}

/** Self-contained, inline SVG; widths are CSS pixels so text stays 12px on mobile. */
export function renderChartSvg(model, width = 600) {
  const W = plotWidth(width);
  const paired = model.key === 'financingMix';
  const axis = chartAxis(model);
  const axisLabels = axis.ticks.map(value => tickLabel(value, axis, model.percentage));
  const left = Math.max(paired ? 44 : 46, ...axisLabels.map(label => label.length * 6.6 + 12));
  const right = 16;
  const top = paired ? 54 : 36;
  const bottom = 236;
  const plotHeight = bottom - top;
  const scale = value => bottom - (value - axis.min) / (axis.max - axis.min) * plotHeight;
  const zero = scale(0);
  const groupWidth = (W - left - right) / Math.max(1, model.years.length);
  const gap = paired ? clamp(groupWidth * 0.1, 4, 8) : 0;
  const barWidth = paired ? clamp((groupWidth * 0.72 - gap) / 2, 12, 28) : clamp(groupWidth * 0.55, 20, 48);
  const description = `${model.bankName} — ${model.title} — ${model.unit} — ${model.years.join('، ')}`;
  const grid = axis.ticks.map((value, index) => {
    const y = coordinate(scale(value));
    return `<g class="chart-axis-tick"><line class="chart-grid" x1="${coordinate(left)}" x2="${W - right}" y1="${y}" y2="${y}" stroke="var(--line, #2a333e)" stroke-width="1"/><text class="chart-axis-label" x="${coordinate(left - 8)}" y="${coordinate(scale(value) + 4)}" text-anchor="end" fill="var(--muted, #98a4b3)">${escapeHtml(axisLabels[index])}</text></g>`;
  }).join('');
  const bars = [];
  const labels = [];
  const yearLabels = [];
  const occupied = [];
  for (let yearIndex = 0; yearIndex < model.years.length; yearIndex += 1) {
    const year = model.years[yearIndex];
    const center = left + groupWidth * (yearIndex + 0.5);
    const totalWidth = barWidth * model.series.length + gap * (model.series.length - 1);
    const tops = model.series.map(series => series.points[yearIndex].value).filter(value => value !== null).map(value => Math.min(zero, scale(value)));
    const pairLabelTop = Math.min(zero, ...tops) - 8;
    model.series.forEach((series, seriesIndex) => {
      const point = series.points[yearIndex];
      const x = center - totalWidth / 2 + seriesIndex * (barWidth + gap);
      const labelX = x + barWidth / 2;
      const title = escapeHtml(pointTitle(model, series, point));
      const attributes = `data-year="${escapeHtml(year)}" data-series="${escapeHtml(series.key)}" data-value="${point.rawValue === null ? 'null' : escapeHtml(point.rawValue)}"`;
      if (point.value === null) {
        labels.push(`<text class="chart-value chart-missing" ${attributes} x="${coordinate(labelX)}" y="${coordinate(zero - 8 - (paired ? seriesIndex * 16 : 0))}" text-anchor="middle" fill="var(--muted, #98a4b3)" aria-label="${title}">—<title>${title}</title></text>`);
        return;
      }
      const endpoint = scale(point.value);
      const y = Math.min(zero, endpoint);
      const height = Math.abs(endpoint - zero);
      bars.push(`<rect class="chart-bar" ${attributes} data-chart-value="${escapeHtml(point.value)}" x="${coordinate(x)}" y="${coordinate(y)}" width="${coordinate(barWidth)}" height="${coordinate(height)}" fill="${series.color}" aria-label="${title}"><title>${title}</title></rect>`);
      // Narrow paired charts use one decimal and staggered heights; tooltips always use two.
      const narrow = paired && groupWidth < 90;
      const label = isMoneyModel(model) ? barLabel(model, point) : `${(narrow ? compactPercent : decimal).format(point.value)}${model.percentage ? '%' : ''}`;
      let labelY = point.value < 0 ? endpoint + 16 : narrow ? pairLabelTop - seriesIndex * 16 : y - 8;
      const halfWidth = label.length * 3.3;
      if (point.value >= 0) {
        while (labelY > 26 && occupied.some(other => Math.abs(other.x - labelX) < other.halfWidth + halfWidth + 2 && Math.abs(other.y - labelY) < 15)) labelY -= 16;
      }
      labelY = clamp(labelY, 12, HEIGHT - 28);
      occupied.push({ x: labelX, y: labelY, halfWidth });
      labels.push(`<text class="chart-value" ${attributes} x="${coordinate(labelX)}" y="${coordinate(labelY)}" text-anchor="middle" fill="var(--ink, #f1f5f9)" aria-label="${title}">${escapeHtml(label)}<title>${title}</title></text>`);
    });
    yearLabels.push(`<text class="chart-year" data-year="${escapeHtml(year)}" x="${coordinate(center)}" y="260" text-anchor="middle" fill="var(--muted, #98a4b3)">${escapeHtml(year)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="bank-chart-svg" width="${W}" height="${HEIGHT}" viewBox="0 0 ${W} ${HEIGHT}" role="img" aria-label="${escapeHtml(description)}" data-axis-min="${escapeHtml(axis.min)}" data-axis-max="${escapeHtml(axis.max)}" data-axis-step="${escapeHtml(axis.step)}" data-zero-y="${coordinate(zero)}" style="width:100%;height:280px;display:block;font-family:inherit;font-size:12px;direction:ltr"><title>${escapeHtml(description)}</title><g font-family="inherit" font-size="12" direction="ltr" style="unicode-bidi:isolate">${grid}<line class="chart-zero-baseline" x1="${coordinate(left)}" x2="${W - right}" y1="${coordinate(zero)}" y2="${coordinate(zero)}" stroke="var(--muted, #98a4b3)" stroke-width="1.3"/>${bars.join('')}${labels.join('')}${yearLabels.join('')}</g></svg>`;
}

const signature = model => JSON.stringify(model);

/** One selected item, with a real 600×280 default plot inside its canvas. */
export function renderBankCharts(bank, years = DEFAULT_YEARS, selectedKey = 'netProfit') {
  const models = getChartModels(bank, years);
  const selected = models.find(model => model.key === selectedKey) || models.find(model => model.key === 'netProfit');
  return [selected].map(model => {
    const paired = model.key === 'financingMix';
    const unit = model.unit + (model.note ? ` · ${model.note}` : '');
    const legend = paired ? `<div class="bank-chart-legend" dir="rtl">${model.series.map(series => `<span><i class="bank-chart-key" style="--series-color: ${series.color}" aria-hidden="true"></i>${escapeHtml(series.title)}</span>`).join('')}</div>` : '';
    return `<article class="bank-chart-card${paired ? ' bank-chart-wide' : ''}" data-chart-key="${escapeHtml(model.key)}" dir="rtl"><h4>${escapeHtml(model.title)}</h4><p class="bank-chart-unit">${escapeHtml(unit)}</p>${legend}<div class="bank-chart-canvas" data-chart-canvas="${escapeHtml(model.key)}" data-plot-width="600" data-bank-symbol="${escapeHtml(bank.symbol)}" data-plot-signature="${escapeHtml(signature(model))}">${renderChartSvg(model)}</div></article>`;
  }).join('\n');
}

/** Call after the panel is shown, and again from the parent's ResizeObserver. */
export function fitBankCharts(container, bank, years = DEFAULT_YEARS) {
  if (!container?.querySelectorAll) return;
  const models = new Map(getChartModels(bank, years).map(model => [model.key, model]));
  for (const canvas of container.querySelectorAll('[data-chart-canvas]')) {
    const model = models.get(canvas.dataset.chartCanvas);
    if (!model) continue;
    const width = plotWidth(canvas.clientWidth);
    const bankSymbol = String(bank.symbol ?? '');
    const modelSignature = signature(model);
    if (canvas.dataset.plotWidth === String(width) && canvas.dataset.bankSymbol === bankSymbol && canvas.dataset.plotSignature === modelSignature) continue;
    const svg = canvas.querySelector('svg');
    if (svg) svg.outerHTML = renderChartSvg(model, width);
    else canvas.insertAdjacentHTML('beforeend', renderChartSvg(model, width));
    canvas.dataset.plotWidth = String(width);
    canvas.dataset.bankSymbol = bankSymbol;
    canvas.dataset.plotSignature = modelSignature;
  }
}

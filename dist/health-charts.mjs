import { escapeHtml, numericValue, METRICS } from './health-metrics.mjs?v=health-charts-20261106-v10';

const HEIGHT = 280;
const GOLD = '#f59e0b';
const DEFAULT_YEARS = [2021, 2022, 2023, 2024, 2025];
const decimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CHART_UNITS = {
  million_sar: { unit: 'مليار ريال', factor: 1 / 1000 },
  million_shares: { unit: 'مليون سهم', factor: 1 },
  sar: { unit: 'ريال', factor: 1 },
  percent: { unit: '%', factor: 100 }
};
const DEFINITIONS = METRICS.map(metric => ({
  key: metric.key,
  title: metric.label,
  group: metric.unit === 'sar' ? 'ربحية السهم' : metric.unit === 'percent' ? 'الهوامش' : 'ملخص النتائج المالية',
  ...(metric.unit === 'sar' ? CHART_UNITS.sar : metric.unit === 'percent' ? CHART_UNITS.percent : metric.unit === 'million_shares' ? CHART_UNITS.million_shares : { unit: 'مليار ريال', factor: 1 / 1000 })
}));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const plotWidth = width => Math.max(300, Math.round(numericValue(width) > 0 ? width : 600));
const coordinate = value => String(Number(value.toFixed(4)));

export function getChartModels(company, years = DEFAULT_YEARS) {
  const orderedYears = [...years].sort((a, b) => a - b);
  const records = new Map((company.years ?? []).filter(record => record.period === 'FY').map(record => [record.year, record.values]));
  return DEFINITIONS.map(definition => ({
    ...definition,
    companyName: company.name ?? '',
    years: orderedYears,
    series: [{
      key: definition.key,
      title: definition.title,
      color: GOLD,
      points: orderedYears.map(year => {
        const rawValue = numericValue(records.get(year)?.[definition.key]);
        return { year, rawValue, value: rawValue === null ? null : rawValue * definition.factor };
      })
    }]
  }));
}

export function getChartOptions(company, years = DEFAULT_YEARS) {
  return getChartModels(company, years).map(model => ({
    key: model.key,
    label: model.title,
    group: model.group,
    available: model.series.some(series => series.points.some(point => point.rawValue !== null))
  }));
}
function niceQuantum(target) {
  const power = 10 ** Math.floor(Math.log10(target));
  const normalized = target / power;
  return [1, 2, 2.5, 5, 10].find(value => value >= normalized) * power;
}
function chartAxis(model) {
  const values = model.series.flatMap(series => series.points.map(point => point.value)).filter(value => value !== null);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const paddedLow = low < 0 ? low * 1.2 : 0;
  const paddedHigh = high > 0 ? high * 1.2 : low === 0 ? 1 : 0;
  const step = niceQuantum((paddedHigh - paddedLow) / 5);
  const min = Math.floor(paddedLow / step) * step;
  const max = Math.ceil(paddedHigh / step) * step;
  const intervals = Math.round((max - min) / step);
  return { min, max, step, ticks: Array.from({ length: intervals + 1 }, (_, index) => min + index * step) };
}
function tickLabel(value, axis) {
  const places = Math.min(8, Math.max(0, -Math.floor(Math.log10(axis.step)) + 1));
  return Number(value.toFixed(places)).toLocaleString('en-US', { maximumFractionDigits: places });
}
function pointTitle(model, series, point) {
  if (point.value === null) return `${series.title} · ${point.year}: غير متاح (—)`;
  const display = decimal.format(point.value);
  const original = model.unit === 'مليار ريال' ? `؛ الأصل: ${decimal.format(point.rawValue)} مليون ريال` : '';
  return `${series.title} · ${point.year}: ${display} ${model.unit}${original}`;
}
export function renderChartSvg(model, width = 600) {
  const W = plotWidth(width), axis = chartAxis(model), axisLabels = axis.ticks.map(value => tickLabel(value, axis));
  const left = Math.max(46, ...axisLabels.map(label => label.length * 6.6 + 12));
  const right = 16, top = 36, bottom = 236, plotHeight = bottom - top;
  const scale = value => bottom - (value - axis.min) / (axis.max - axis.min) * plotHeight;
  const zero = scale(0), groupWidth = (W - left - right) / Math.max(1, model.years.length);
  const barWidth = clamp(groupWidth * 0.55, 20, 48);
  const description = `${model.companyName} — ${model.title} — ${model.unit} — ${model.years.join('، ')}`;
  const grid = axis.ticks.map((value, index) => {
    const y = coordinate(scale(value));
    return `<g class="chart-axis-tick"><line class="chart-grid" x1="${coordinate(left)}" x2="${W - right}" y1="${y}" y2="${y}" stroke="var(--line, #2a333e)" stroke-width="1"/><text class="chart-axis-label" x="${coordinate(left - 8)}" y="${coordinate(scale(value) + 4)}" text-anchor="end" fill="var(--muted, #98a4b3)">${escapeHtml(axisLabels[index])}</text></g>`;
  }).join('');
  const bars = [], labels = [], yearLabels = [], occupied = [];
  for (let yearIndex = 0; yearIndex < model.years.length; yearIndex += 1) {
    const year = model.years[yearIndex], center = left + groupWidth * (yearIndex + 0.5), point = model.series[0].points[yearIndex];
    const x = center - barWidth / 2, labelX = center, title = escapeHtml(pointTitle(model, model.series[0], point));
    const attributes = `data-year="${escapeHtml(year)}" data-series="${escapeHtml(model.series[0].key)}" data-value="${point.rawValue === null ? 'null' : escapeHtml(point.rawValue)}"`;
    if (point.value === null) {
      labels.push(`<text class="chart-value chart-missing" ${attributes} x="${coordinate(labelX)}" y="${coordinate(zero - 8)}" text-anchor="middle" fill="var(--muted, #98a4b3)" aria-label="${title}">—<title>${title}</title></text>`);
    } else {
      const endpoint = scale(point.value), y = Math.min(zero, endpoint), height = Math.abs(endpoint - zero);
      bars.push(`<rect class="chart-bar" ${attributes} data-chart-value="${escapeHtml(point.value)}" x="${coordinate(x)}" y="${coordinate(y)}" width="${coordinate(barWidth)}" height="${coordinate(height)}" fill="${GOLD}" aria-label="${title}"><title>${title}</title></rect>`);
      const label = decimal.format(point.value), halfWidth = label.length * 3.3;
      let labelY = point.value < 0 ? endpoint + 16 : y - 8;
      if (point.value >= 0) while (labelY > 26 && occupied.some(other => Math.abs(other.x - labelX) < other.halfWidth + halfWidth + 2 && Math.abs(other.y - labelY) < 15)) labelY -= 16;
      labelY = clamp(labelY, 12, HEIGHT - 28);
      occupied.push({ x: labelX, y: labelY, halfWidth });
      labels.push(`<text class="chart-value" ${attributes} x="${coordinate(labelX)}" y="${coordinate(labelY)}" text-anchor="middle" fill="var(--ink, #f1f5f9)" aria-label="${title}">${escapeHtml(label)}<title>${title}</title></text>`);
    }
    yearLabels.push(`<text class="chart-year" data-year="${escapeHtml(year)}" x="${coordinate(center)}" y="260" text-anchor="middle" fill="var(--muted, #98a4b3)">${escapeHtml(year)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="bank-chart-svg" width="${W}" height="${HEIGHT}" viewBox="0 0 ${W} ${HEIGHT}" role="img" aria-label="${escapeHtml(description)}" data-axis-min="${escapeHtml(axis.min)}" data-axis-max="${escapeHtml(axis.max)}" data-axis-step="${escapeHtml(axis.step)}" data-zero-y="${coordinate(zero)}" style="width:100%;height:280px;display:block;font-family:inherit;font-size:12px;direction:ltr"><title>${escapeHtml(description)}</title><g font-family="inherit" font-size="12" direction="ltr" style="unicode-bidi:isolate">${grid}<line class="chart-zero-baseline" x1="${coordinate(left)}" x2="${W - right}" y1="${coordinate(zero)}" y2="${coordinate(zero)}" stroke="var(--muted, #98a4b3)" stroke-width="1.3"/>${bars.join('')}${labels.join('')}${yearLabels.join('')}</g></svg>`;
}
const signature = model => JSON.stringify(model);
export function renderHealthCharts(company, years = DEFAULT_YEARS, selectedKey = 'netProfit') {
  const models = getChartModels(company, years);
  const selected = models.find(model => model.key === selectedKey) || models.find(model => model.key === 'netProfit');
  return `<article class="bank-chart-card" data-chart-key="${escapeHtml(selected.key)}" dir="rtl"><h4>${escapeHtml(selected.title)}</h4><p class="bank-chart-unit">${escapeHtml(selected.unit)}</p><div class="bank-chart-canvas" data-chart-canvas="${escapeHtml(selected.key)}" data-plot-width="600" data-company-symbol="${escapeHtml(company.symbol)}" data-plot-signature="${escapeHtml(signature(selected))}">${renderChartSvg(selected)}</div></article>`;
}
export function fitHealthCharts(container, company, years = DEFAULT_YEARS) {
  if (!container?.querySelectorAll) return;
  const models = new Map(getChartModels(company, years).map(model => [model.key, model]));
  for (const canvas of container.querySelectorAll('[data-chart-canvas]')) {
    const model = models.get(canvas.dataset.chartCanvas);
    if (!model) continue;
    const width = plotWidth(canvas.clientWidth), symbol = String(company.symbol ?? ''), modelSignature = signature(model);
    if (canvas.dataset.plotWidth === String(width) && canvas.dataset.companySymbol === symbol && canvas.dataset.plotSignature === modelSignature) continue;
    const svg = canvas.querySelector('svg');
    if (svg) svg.outerHTML = renderChartSvg(model, width);
    canvas.dataset.plotWidth = String(width); canvas.dataset.companySymbol = symbol; canvas.dataset.plotSignature = modelSignature;
  }
}

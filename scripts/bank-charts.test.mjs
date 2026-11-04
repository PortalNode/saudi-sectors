import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderBankCharts, fitBankCharts, getChartModels, renderChartSvg } from '../dist/bank-charts.mjs';

const data = JSON.parse(await readFile(new URL('../dist/banks-financials.json', import.meta.url), 'utf8'));
const keys = ['netProfit', 'eps', 'assets', 'equity', 'financingMix'];
const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const attrs = element => Object.fromEntries([...element.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const barsIn = svg => [...svg.matchAll(/<rect\b[^>]*class="chart-bar"[^>]*>[\s\S]*?<\/rect>/g)].map(match => ({ ...attrs(match[0].split('>')[0]), html: match[0] }));
const labelsIn = svg => [...svg.matchAll(/<text\b[^>]*class="chart-value(?: chart-missing)?"[^>]*>[\s\S]*?<\/text>/g)].map(match => ({ ...attrs(match[0].split('>')[0]), html: match[0] }));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.001, `${message}: ${actual} ≈ ${expected}`);

for (const bank of data.banks) {
  test(`${bank.symbol} ${bank.name}: five real charts, 30 bars, source data and proportional geometry`, () => {
    const original = JSON.stringify(bank);
    const html = renderBankCharts(bank, data.years);
    assert.equal((html.match(/<article\b/g) ?? []).length, 5);
    assert.equal((html.match(/<h4>/g) ?? []).length, 5);
    assert.equal((html.match(/class="bank-chart-unit"/g) ?? []).length, 5);
    assert.equal((html.match(/class="bank-chart-canvas"/g) ?? []).length, 5);
    assert.equal((html.match(/class="bank-chart-svg"/g) ?? []).length, 5);
    assert.equal(barsIn(html).length, 30);
    assert.equal(labelsIn(html).length, 30);
    assert.match(html, /class="bank-chart-card bank-chart-wide" data-chart-key="financingMix"/);
    assert.match(html, /class="bank-chart-legend" dir="rtl"/);
    assert.match(html, /class="bank-chart-key" style="--series-color: #f59e0b"/);
    assert.match(html, /class="bank-chart-key" style="--series-color: #8ab8ff"/);
    assert.match(html, /ريال للسهم/);
    assert.match(html, /دون تعديل أساس الأسهم/);
    const models = getChartModels(bank, data.years);
    assert.deepEqual(models.map(model => model.key), keys);
    for (const model of models) {
      assert.match(html, new RegExp(`data-chart-key="${model.key}"`));
      assert.ok(html.includes(`<h4>${model.title}</h4>`));
      assert.ok(html.includes(model.unit));
      const svg = renderChartSvg(model);
      const root = attrs(svg.split('>')[0]);
      const zero = Number(root['data-zero-y']);
      const min = Number(root['data-axis-min']);
      const max = Number(root['data-axis-max']);
      assert.equal(root.viewBox, '0 0 600 280');
      assert.match(svg, /class="chart-zero-baseline"/);
      assert.ok(min <= 0 && max > 0);
      assert.equal((svg.match(/class="chart-year"/g) ?? []).length, 5);
      const yearLabels = [...svg.matchAll(/class="chart-year"[^>]*>(\d{4})<\/text>/g)].map(match => Number(match[1]));
      assert.deepEqual(yearLabels, data.years);
      assert.match(svg, /font-family="inherit" font-size="12" direction="ltr"/);
      const bars = barsIn(svg);
      const valueLabels = labelsIn(svg);
      for (const series of model.series) {
        for (const point of series.points) {
          const source = bank.years.find(record => record.year === point.year).values[series.key];
          assert.equal(point.rawValue, source);
          const expected = model.key === 'financingMix' ? source * 100 : model.key === 'eps' ? source : source / 1000;
          assert.equal(point.value, expected);
          const bar = bars.find(item => item['data-series'] === series.key && item['data-year'] === String(point.year));
          const label = valueLabels.find(item => item['data-series'] === series.key && item['data-year'] === String(point.year));
          assert.ok(bar);
          assert.equal(Number(bar['data-value']), source);
          assert.equal(Number(bar['data-chart-value']), expected);
          assert.equal(bar.fill, series.color);
          assert.ok(Number(bar.height) >= 0);
          near(Number(bar.y) + Number(bar.height), zero, 'positive bars end at zero');
          // Y(max) is the plot top, and Y(0) the bottom for this positive dataset.
          const pixelsPerUnit = (zero - (model.key === 'financingMix' ? 54 : 36)) / max;
          near(Number(bar.height), expected * pixelsPerUnit, 'bar height represents its chart-unit value');
          assert.ok(bar.html.includes(`<title>${series.title} · ${point.year}: ${formatter.format(expected)}`));
          assert.ok(bar['aria-label'].includes(model.unit));
          assert.ok(label.html.includes(`>${formatter.format(expected)}${model.key === 'financingMix' ? '%' : ''}<title>`));
          assert.ok(Number(label.y) < Number(bar.y));
        }
      }
      if (model.key === 'financingMix') {
        assert.equal(min, 0);
        assert.equal(max, 100);
        assert.equal(Number(root['data-axis-step']), 20);
        for (const year of data.years) {
          const pair = bars.filter(bar => bar['data-year'] === String(year));
          assert.equal(pair.length, 2);
          assert.ok(Number(pair[0].x) + Number(pair[0].width) < Number(pair[1].x), 'finance bars are side-by-side, not stacked');
          near(Number(pair[0].y) + Number(pair[0].height), zero, 'retail has its own zero baseline');
          near(Number(pair[1].y) + Number(pair[1].height), zero, 'corporate has its own zero baseline');
        }
      }
    }
    assert.equal(JSON.stringify(bank), original, 'rendering must not mutate source data');
  });
}

test('SNB financing preserves non-100% sum and excludes international financing', () => {
  const bank = data.banks.find(bank => bank.symbol === '1180');
  const model = getChartModels(bank, data.years).at(-1);
  const retail = model.series[0].points.at(-1);
  const corporate = model.series[1].points.at(-1);
  near(retail.value, 48.13, 'retail 2025');
  near(corporate.value, 48.59, 'corporate 2025');
  assert.ok(Math.abs(retail.value + corporate.value - 100) > 1);
  assert.equal(barsIn(renderChartSvg(model)).length, 10);
  assert.ok(!renderChartSvg(model).includes('internationalFinancingShare'));
});

test('null is a retained missing record and em dash, never a zero bar', () => {
  const bank = structuredClone(data.banks[0]);
  bank.years[2].values.netProfit = null;
  const point = getChartModels(bank)[0].series[0].points[2];
  assert.deepEqual(point, { year: 2023, rawValue: null, value: null });
  const html = renderBankCharts(bank);
  assert.equal(barsIn(html).length, 29);
  assert.equal(labelsIn(html).length, 30);
  const missing = labelsIn(html).find(label => label['data-series'] === 'netProfit' && label['data-year'] === '2023');
  assert.equal(missing['data-value'], 'null');
  assert.match(missing.html, />—<title>/);
  assert.match(missing['aria-label'], /غير متاح/);
  assert.ok(!barsIn(html).some(bar => bar['data-series'] === 'netProfit' && bar['data-year'] === '2023'));
  bank.years.forEach(record => { record.values.netProfit = null; });
  const svg = renderChartSvg(getChartModels(bank)[0], 300);
  assert.equal(barsIn(svg).length, 0);
  assert.equal(labelsIn(svg).length, 5);
  assert.ok(!/NaN|Infinity/.test(svg));
});

test('zero is valid; future negative EPS values extend below a mandatory zero baseline', () => {
  const bank = structuredClone(data.banks[0]);
  bank.years[0].values.eps = -2;
  bank.years[1].values.eps = 0;
  const svg = renderChartSvg(getChartModels(bank)[1], 340);
  const root = attrs(svg.split('>')[0]);
  const zero = Number(root['data-zero-y']);
  assert.ok(Number(root['data-axis-min']) < -2);
  assert.ok(Number(root['data-axis-max']) > 4.17);
  const bars = barsIn(svg);
  assert.equal(bars.length, 5);
  near(Number(bars[0].y), zero, 'negative bar starts at zero');
  assert.ok(Number(bars[0].height) > 0);
  near(Number(bars[1].height), 0, 'zero bar has exactly zero height');
  const positives = bars.slice(2);
  positives.forEach(bar => near(Number(bar.y) + Number(bar.height), zero, 'positive bar ends at zero'));
  const step = Number(root['data-axis-step']);
  const normalized = step / 10 ** Math.floor(Math.log10(step));
  assert.ok([1, 2, 2.5, 5, 10].includes(normalized), 'nice axis quantum');
});

test('responsive SVG widths preserve 12px text, bounded bars and precise mobile tooltips', () => {
  const models = getChartModels(data.banks[0]);
  for (const width of [300, 340, 600, 1280]) {
    for (const model of models) {
      const svg = renderChartSvg(model, width);
      assert.match(svg, new RegExp(`viewBox="0 0 ${width} 280"`));
      assert.match(svg, /height:280px/);
      assert.match(svg, /font-size="12"/);
      const paired = model.key === 'financingMix';
      for (const bar of barsIn(svg)) {
        assert.ok(Number(bar.width) >= (paired ? 12 : 20));
        assert.ok(Number(bar.width) <= (paired ? 28 : 48));
        assert.ok(Number(bar.x) >= 0 && Number(bar.x) + Number(bar.width) <= width);
      }
      assert.ok(labelsIn(svg).every(label => Number(label.y) >= 12 && Number(label.y) <= 252));
    }
  }
  const svg = renderChartSvg(models.at(-1), 340);
  assert.match(svg, />52\.7%<title>الأفراد · 2021: 52\.65%/);
  assert.equal(labelsIn(svg).length, 10, 'mobile does not hide labels');
  assert.match(renderChartSvg(models[0], 20), /viewBox="0 0 300 280"/);
  assert.match(renderChartSvg(models[0], 0), /viewBox="0 0 600 280"/);
});

test('HTML, SVG title and ARIA content are escaped; only FY records are used', () => {
  const bank = structuredClone(data.banks[0]);
  bank.name = '<script>"&\'';
  bank.symbol = '" onload="bad';
  bank.years.push({ year: 2021, period: 'Q1', values: { eps: 999 } });
  const html = renderBankCharts(bank, [...data.years].reverse());
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;&quot;&amp;&#39;'));
  assert.ok(!html.includes('symbol="" onload='));
  assert.equal(getChartModels(bank)[1].series[0].points[0].value, data.banks[0].years[0].values.eps);
  assert.deepEqual(getChartModels(bank, [...data.years].reverse())[0].years, data.years);
});

function fakeCanvas(model, bank, width = 600) {
  const canvas = {
    dataset: { chartCanvas: model.key, plotWidth: '600', bankSymbol: bank.symbol, plotSignature: JSON.stringify(model) },
    clientWidth: width,
    writes: 0,
    content: renderChartSvg(model),
    unrelatedChild: { intact: true },
    querySelector(selector) { assert.equal(selector, 'svg'); return this.svg; },
    insertAdjacentHTML(position, html) { assert.equal(position, 'beforeend'); this.content = html; this.writes += 1; }
  };
  canvas.svg = { set outerHTML(value) { canvas.content = value; canvas.writes += 1; } };
  return canvas;
}

test('fit replaces SVG only for changed width, bank, years or data; repeated widths cause no writes', () => {
  const bank = data.banks[0];
  const canvases = getChartModels(bank).map(model => fakeCanvas(model, bank));
  const container = { querySelectorAll(selector) { assert.equal(selector, '[data-chart-canvas]'); return canvases; } };
  fitBankCharts(container, bank);
  assert.ok(canvases.every(canvas => canvas.writes === 0), 'unchanged default width skips SVG replacement');
  canvases.forEach((canvas, index) => { canvas.clientWidth = index === 0 ? 340 : 300; });
  fitBankCharts(container, bank);
  assert.ok(canvases.every(canvas => canvas.writes === 1));
  assert.match(canvases[0].content, /viewBox="0 0 340 280"/);
  assert.ok(canvases.every(canvas => canvas.unrelatedChild.intact), 'other canvas children survive');
  fitBankCharts(container, bank);
  assert.ok(canvases.every(canvas => canvas.writes === 1));
  fitBankCharts(container, data.banks[1]);
  assert.ok(canvases.every(canvas => canvas.writes === 2), 'bank change refreshes identical widths');
  assert.ok(canvases.every(canvas => canvas.dataset.bankSymbol === data.banks[1].symbol));
  const editedBank = structuredClone(data.banks[1]);
  editedBank.years[0].values.eps = null;
  fitBankCharts(container, editedBank);
  assert.equal(canvases[1].writes, 3, 'changed same-bank EPS data also refreshes');
  assert.equal(canvases[0].writes, 2, 'unaffected chart is not rewritten');
  canvases[0].clientWidth = 0;
  fitBankCharts(container, editedBank);
  assert.match(canvases[0].content, /viewBox="0 0 600 280"/);
  canvases[0].clientWidth = 200;
  fitBankCharts(container, editedBank);
  assert.match(canvases[0].content, /viewBox="0 0 300 280"/);
  fitBankCharts(container, editedBank, [2024, 2025]);
  assert.equal(barsIn(canvases[0].content).length, 2);
  fitBankCharts(null, bank);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  currentPEChartModel, renderCurrentPEComparison, fitCurrentPEComparison
} from '../dist/bank-current-pe-chart.mjs';

const records = () => Array.from({ length: 10 }, (_, index) => ({
  symbol: String(1100 + index), name: `Bank ${index + 1}`,
  pe: 7.123456789 + index * 1.23456789
}));
const freeze = items => Object.freeze(items.map(item => Object.freeze(item)));
const tags = (html, tag, className) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*class="${className}"[^>]*>`, 'g'))].map(match => match[0]);
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
let groups = 0;
function test(name, run) {
  run(); groups += 1; console.log(`PASS ${name}`);
}

test('ten banks produce ten observations and ten columns, not five annual observations', () => {
  const input = records();
  const model = currentPEChartModel(input);
  assert.equal(model.key, 'currentPE');
  assert.equal(model.factor, 1);
  assert.equal(model.unit, 'مرة');
  assert.deepEqual(model.years, input.map(record => record.name));
  assert.equal(model.series.length, 1);
  assert.equal(model.series[0].points.length, 10);
  assert.deepEqual(model.series[0].points.map(point => point.year), input.map(record => record.name));
  assert.deepEqual(model.series[0].points.map(point => point.rawValue), input.map(record => record.pe));
  assert.deepEqual(model.series[0].points.map(point => point.value), input.map(record => record.pe));

  const html = renderCurrentPEComparison(input);
  const bars = tags(html, 'rect', 'chart-bar');
  const labels = tags(html, 'text', 'chart-year');
  assert.equal(bars.length, 10);
  assert.equal(labels.length, 10);
  assert.deepEqual(labels.map(tag => attribute(tag, 'data-year')), input.map(record => record.name));
  assert.equal(new Set(bars.map(tag => attribute(tag, 'x'))).size, 10);
  assert.equal((html.match(/<svg\b/g) || []).length, 1);
  for (const year of [2021, 2022, 2023, 2024, 2025]) {
    assert.doesNotMatch(html, new RegExp(`data-year="${year}"`));
  }
  assert.match(html, /مقارنة حالية بين البنوك، وليست مقارنة السنوات 2021–2025/);
  assert.match(html, /10 من 10 بنوك/);
});

test('SVG preserves actual PE precision instead of rounded or synthetic values', () => {
  const input = records();
  input[0].pe = 40 / 3;
  input[9].pe = 0;
  const bars = tags(renderCurrentPEComparison(input), 'rect', 'chart-bar');
  for (let index = 0; index < input.length; index += 1) {
    assert.equal(attribute(bars[index], 'data-value'), String(input[index].pe));
    assert.equal(attribute(bars[index], 'data-chart-value'), String(input[index].pe));
  }
  assert.equal(attribute(bars[0], 'data-value'), '13.333333333333334');
  assert.equal(attribute(bars[9], 'height'), '0');
});

test('null PE retains its bank column and missing marker but never creates a bar', () => {
  const input = records();
  input[2].pe = null;
  input[7].pe = null;
  const model = currentPEChartModel(input);
  assert.equal(model.years.length, 10);
  for (const index of [2, 7]) {
    assert.equal(model.series[0].points[index].rawValue, null);
    assert.equal(model.series[0].points[index].value, null);
  }
  const html = renderCurrentPEComparison(input);
  const bars = tags(html, 'rect', 'chart-bar');
  const missing = tags(html, 'text', 'chart-value chart-missing');
  assert.equal(bars.length, 8);
  assert.equal(tags(html, 'text', 'chart-year').length, 10);
  assert.deepEqual(missing.map(tag => attribute(tag, 'data-year')), ['Bank 3', 'Bank 8']);
  for (const tag of missing) assert.equal(attribute(tag, 'data-value'), 'null');
  assert.ok(bars.every(tag => !['Bank 3', 'Bank 8'].includes(attribute(tag, 'data-year'))));
  assert.match(html, /8 من 10 بنوك/);
  assert.match(html, /class="chart-value chart-missing"[^>]*>—<title>/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);

  const unavailable = renderCurrentPEComparison(input.map(record => ({ ...record, pe: null })));
  assert.equal(tags(unavailable, 'rect', 'chart-bar').length, 0);
  assert.equal(tags(unavailable, 'text', 'chart-value chart-missing').length, 10);
  assert.match(unavailable, /0 من 10 بنوك/);
  assert.doesNotMatch(unavailable, /NaN|Infinity|undefined/);
});

test('model, rendering, and fitting do not mutate records, and bank names are escaped', () => {
  const items = records();
  items[0].name = '<img src=x onerror="alert(1)"> & \'bank\'';
  const input = freeze(items);
  const before = JSON.stringify(input);
  const model = currentPEChartModel(input);
  const html = renderCurrentPEComparison(input);
  assert.equal(model.years[0], input[0].name);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;bank&#39;'));
  assert.ok(!html.includes(input[0].name));
  assert.doesNotMatch(html, /<img\b|<script\b/);
  const canvas = { clientWidth: 1200, dataset: {}, innerHTML: '' };
  fitCurrentPEComparison({ querySelector: () => canvas }, input);
  assert.equal(JSON.stringify(input), before);
  model.years[0] = 'Changed model label';
  model.series[0].points[0].value = 999;
  assert.equal(JSON.stringify(input), before);
});

test('comparison uses accessible horizontal scrolling and a 1050px minimum plot', () => {
  const html = renderCurrentPEComparison(records());
  assert.match(html, /class="current-pe-chart-scroll"[^>]*tabindex="0"[^>]*aria-label="[^"]*مرر أفقيًا/);
  assert.match(html, /class="bank-chart-canvas" data-current-pe-canvas/);
  assert.match(html, /<svg[^>]*width="1050"[^>]*viewBox="0 0 1050 280"/);
  const css = readFileSync(new URL('../dist/bank-charts.css', import.meta.url), 'utf8');
  assert.match(css, /\.current-pe-chart-scroll\s*\{[^}]*overflow-x\s*:\s*auto\b/);
  assert.match(css, /\.current-pe-chart-scroll\s+\.bank-chart-canvas\s*\{[^}]*min-width\s*:\s*1050px\b/);
});

test('fit rerenders for width or record changes, skips unchanged plots, and handles absent canvas', () => {
  const input = records();
  let writes = 0, html = '';
  const canvas = {
    clientWidth: 375, dataset: {},
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; writes += 1; }
  };
  const container = { querySelector(selector) { assert.equal(selector, '[data-current-pe-canvas]'); return canvas; } };
  fitCurrentPEComparison(container, input);
  assert.equal(writes, 1);
  assert.equal(canvas.dataset.plotWidth, '1050');
  assert.match(html, /viewBox="0 0 1050 280"/);
  fitCurrentPEComparison(container, input);
  assert.equal(writes, 1);
  canvas.clientWidth = 1400.4;
  fitCurrentPEComparison(container, input);
  assert.equal(writes, 2);
  assert.equal(canvas.dataset.plotWidth, '1400');
  assert.match(html, /viewBox="0 0 1400 280"/);
  input[0].pe = 99.123456789;
  fitCurrentPEComparison(container, input);
  assert.equal(writes, 3);
  assert.match(html, /data-value="99\.123456789"/);
  input[0].name = 'Renamed bank';
  fitCurrentPEComparison(container, input);
  assert.equal(writes, 4);
  assert.match(html, /data-year="Renamed bank"/);
  canvas.clientWidth = 800;
  fitCurrentPEComparison(container, input);
  assert.equal(writes, 5);
  assert.equal(canvas.dataset.plotWidth, '1050');
  assert.doesNotThrow(() => fitCurrentPEComparison(null, input));
  assert.doesNotThrow(() => fitCurrentPEComparison({ querySelector: () => null }, input));
});

console.log(`Current bank PE chart tests passed: ${groups} groups (Node, no browser).`);

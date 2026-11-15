import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as metrics from '../dist/insurance-metrics.mjs';
import { getChartOptions, renderInsuranceCharts } from '../dist/insurance-charts.mjs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const annual = metrics.validateDataset(JSON.parse(read('insurance-financials.json')));
const site = JSON.parse(read('data.json'));
const ITEMS = ['gwp', 'insuranceRevenue', 'netProfit', 'epsBeforeExceptional', 'eps'];

test('insurance file covers the sector on the main table, 2022–2025, with the five workbook items', () => {
  const sector = site.sectors.find(item => item.name === 'التأمين');
  assert.deepEqual(annual.companies.map(company => company.symbol).sort(), sector.stocks.map(stock => stock.symbol).sort());
  assert.deepEqual(annual.years, [2022, 2023, 2024, 2025]);
  assert.deepEqual(metrics.METRICS.map(metric => metric.key), ITEMS);
  for (const company of annual.companies) for (const record of company.years) assert.deepEqual(Object.keys(record.values), ITEMS);
});

test('Tawuniya 2025 matches the workbook', () => {
  const values = annual.companies.find(company => company.symbol === '8010').years.find(record => record.year === 2025).values;
  assert.equal(values.gwp, 23841.61);
  assert.equal(values.insuranceRevenue, 21403.18);
  assert.equal(values.eps, 4.9);
});

test('annual table shows the five items with year-over-year changes and no margins section', () => {
  const company = annual.companies[0];
  const html = metrics.renderAnnualTable(company, annual.years);
  for (const key of ITEMS) assert.match(html, new RegExp(`data-metric="${key}"`));
  assert.doesNotMatch(html, /الهوامش|annual-margin/);
  const row = html.match(/<tr data-metric="gwp">.*?<\/tr>/)[0];
  assert.equal((row.match(/class="annual-change"/g) || []).length, 3);
});

test('charts offer every item and draw one bar per year', () => {
  const company = annual.companies[0];
  assert.deepEqual(getChartOptions(company, annual.years).map(option => option.key), ITEMS);
  const html = renderInsuranceCharts(company, annual.years, 'gwp');
  assert.equal((html.match(/class="chart-bar"/g) || []).length, 4);
});

test('main table links the insurance sector and its companies to the page', () => {
  const app = read('app.js');
  assert.match(app, /href="insurance\.html">النتائج السنوية 2022–2025/);
  assert.match(app, /href="insurance\.html\?symbol=/);
  assert.match(read('index.html'), /app\.js\?v=[^"]*insurance-20261115/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as metrics from '../dist/finance-metrics.mjs';
import { getChartOptions, renderFinanceCharts } from '../dist/finance-charts.mjs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const annual = metrics.validateDataset(JSON.parse(read('finance-financials.json')));
const site = JSON.parse(read('data.json'));
const ITEMS = ['netFinancingIncome', 'netProfit', 'epsBeforeExceptional', 'eps'];
const company = symbol => annual.companies.find(item => item.symbol === symbol);
const year = (symbol, value) => company(symbol).years.find(record => record.year === value).values;

test('finance file covers the sector on the main table, 2021–2025, with the four workbook items', () => {
  const sector = site.sectors.find(item => item.name === 'التمويل');
  assert.deepEqual(annual.companies.map(item => item.symbol).sort(), sector.stocks.map(stock => stock.symbol).sort());
  assert.deepEqual(annual.years, [2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(metrics.METRICS.map(metric => metric.key), ITEMS);
  for (const item of annual.companies) {
    assert.deepEqual(item.years.map(record => record.year), annual.years);
    for (const record of item.years) assert.deepEqual(Object.keys(record.values), ITEMS);
  }
});

test('figures match the workbook, and Tasheel has no 2021–2022 values', () => {
  assert.equal(year('4083', 2025).netFinancingIncome, 672.65);
  assert.equal(year('4083', 2025).netProfit, 273.64);
  assert.equal(year('4081', 2025).netProfit, -126.34);
  assert.equal(year('4081', 2025).epsBeforeExceptional, -0.18);
  assert.equal(year('4081', 2025).eps, -1.05);
  assert.equal(year('1183', 2022).eps, 0.96);
  for (const value of [2021, 2022]) assert.ok(Object.values(year('4083', value)).every(item => item === null));
});

test('annual table shows the four items with year-over-year changes and no margins section', () => {
  const html = metrics.renderAnnualTable(company('1182'), annual.years);
  for (const key of ITEMS) assert.match(html, new RegExp(`data-metric="${key}"`));
  assert.doesNotMatch(html, /الهوامش|annual-margin/);
  const row = html.match(/<tr data-metric="netProfit">.*?<\/tr>/)[0];
  assert.equal((row.match(/class="annual-change"/g) || []).length, 4);
});

test('charts offer every item and draw one bar per year', () => {
  assert.deepEqual(getChartOptions(company('1182'), annual.years).map(option => option.key), ITEMS);
  const html = renderFinanceCharts(company('1182'), annual.years, 'netProfit');
  assert.equal((html.match(/class="chart-bar"/g) || []).length, 5);
});

test('main table links the finance sector and its companies to the page', () => {
  const app = read('app.js');
  assert.match(app, /href="finance\.html">النتائج السنوية 2021–2025/);
  assert.match(app, /href="finance\.html\?symbol=/);
  assert.match(read('index.html'), /app\.js\?v=[^"]*finance-20261115/);
  assert.match(read('finance.html'), /src="finance\.js\?v=finance-20261115"/);
});

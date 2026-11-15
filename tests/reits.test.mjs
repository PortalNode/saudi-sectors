import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as metrics from '../dist/reits-metrics.mjs';
import { getChartOptions, renderReitsCharts } from '../dist/reits-charts.mjs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const annual = metrics.validateDataset(JSON.parse(read('reits-financials.json')));
const site = JSON.parse(read('data.json'));
const ITEMS = ['rentalIncome', 'ffo', 'netProfit', 'units', 'epsBeforeExceptional', 'ffoPerUnit', 'eps'];
const fund = symbol => annual.companies.find(item => item.symbol === symbol);
const year = (symbol, value) => fund(symbol).years.find(record => record.year === value).values;

test('REITs file covers the sector on the main table, 2021–2025, with the seven workbook items', () => {
  const sector = site.sectors.find(item => item.name === 'الصناديق العقارية المتداولة');
  assert.deepEqual(annual.companies.map(item => item.symbol).sort(), sector.stocks.map(stock => stock.symbol).sort());
  assert.deepEqual(annual.years, [2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(metrics.METRICS.map(metric => metric.key), ITEMS);
  for (const item of annual.companies) {
    assert.deepEqual(item.years.map(record => record.year), annual.years);
    for (const record of item.years) assert.deepEqual(Object.keys(record.values), ITEMS);
  }
});

test('figures match the workbook; «غير متوفر» and years before listing are empty', () => {
  assert.deepEqual(year('4330', 2025), { rentalIncome: 275.52, ffo: 12.01, netProfit: -13.46, units: 171.7, epsBeforeExceptional: null, ffoPerUnit: 0.07, eps: -0.08 });
  for (const item of annual.companies) for (const record of item.years) assert.equal(record.values.epsBeforeExceptional, null);
  for (const value of [2021, 2022]) assert.ok(Object.values(year('4349', value)).every(item => item === null));
  for (const value of [2021, 2022, 2023]) assert.ok(Object.values(year('4350', value)).every(item => item === null));
  assert.notEqual(year('4350', 2024).netProfit, null);
});

test('annual table labels units in millions and earnings per unit in riyals, with no margins section', () => {
  const html = metrics.renderAnnualTable(fund('4340'), annual.years);
  for (const key of ITEMS) assert.match(html, new RegExp(`data-metric="${key}"`));
  assert.match(html, /عدد الوحدات \(مليون وحدة\)/);
  assert.match(html, /ربح الوحدة \(ريال\)/);
  assert.doesNotMatch(html, /الهوامش|annual-margin/);
});

test('charts offer every item and draw one bar per year', () => {
  assert.deepEqual(getChartOptions(fund('4340'), annual.years).map(option => option.key), ITEMS);
  const html = renderReitsCharts(fund('4340'), annual.years, 'netProfit');
  assert.equal((html.match(/class="chart-bar"/g) || []).length, 5);
});

test('main table links the REITs sector and its funds to the page', () => {
  const app = read('app.js');
  assert.match(app, /href="reits\.html">النتائج السنوية 2021–2025/);
  assert.match(app, /href="reits\.html\?symbol=/);
  assert.match(read('index.html'), /app\.js\?v=[^"]*reits-20261115/);
  assert.match(read('reits.html'), /src="reits\.js\?v=reits-20261115"/);
});

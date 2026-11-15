import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as metrics from '../dist/reits-metrics.mjs';
import { getChartOptions, renderReitsCharts } from '../dist/reits-charts.mjs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const annual = metrics.validateDataset(JSON.parse(read('reits-financials.json')));
const site = JSON.parse(read('data.json'));
const ITEMS = ['rentalIncome', 'ffo', 'netProfit', 'units', 'ffoPerUnit', 'eps'];
const FIRST_YEAR = { 4349: 2023, 4350: 2024 }; // funds listed after 2021
const fund = symbol => annual.companies.find(item => item.symbol === symbol);
const year = (symbol, value) => fund(symbol).years.find(record => record.year === value).values;

test('REITs file covers the sector on the main table, 2021–2025, with six items and only the years each fund has', () => {
  const sector = site.sectors.find(item => item.name === 'الصناديق العقارية المتداولة');
  assert.deepEqual(annual.companies.map(item => item.symbol).sort(), sector.stocks.map(stock => stock.symbol).sort());
  assert.deepEqual(annual.years, [2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(metrics.METRICS.map(metric => metric.key), ITEMS);
  for (const item of annual.companies) {
    assert.deepEqual(item.years.map(record => record.year), annual.years.filter(value => value >= (FIRST_YEAR[item.symbol] ?? annual.years[0])));
    for (const record of item.years) assert.deepEqual(Object.keys(record.values), ITEMS);
  }
});

test('figures match the workbook; no empty item and no empty year is stored', () => {
  assert.deepEqual(year('4330', 2025), { rentalIncome: 275.52, ffo: 12.01, netProfit: -13.46, units: 171.7, ffoPerUnit: 0.07, eps: -0.08 });
  for (const item of annual.companies) for (const record of item.years) assert.ok(Object.values(record.values).some(value => value !== null), `${item.symbol} ${record.year}`);
  assert.notEqual(year('4350', 2024).netProfit, null);
});

test('annual table labels units in millions and earnings per unit in riyals, with no margins section', () => {
  const html = metrics.renderAnnualTable(fund('4340'), annual.years);
  for (const key of ITEMS) assert.match(html, new RegExp(`data-metric="${key}"`));
  assert.match(html, /عدد الوحدات \(مليون وحدة\)/);
  assert.match(html, /ربح الوحدة \(ريال\)/);
  assert.doesNotMatch(html, /الهوامش|annual-margin|قبل البنود الاستثنائية/);
});

test('a fund listed later shows only its own years in the table and charts', () => {
  const item = fund('4350'), years = item.years.map(record => record.year);
  const html = metrics.renderAnnualTable(item, years);
  assert.match(html, /<th scope="col">2024<\/th>/);
  assert.doesNotMatch(html, /<th scope="col">202[123]<\/th>/);
  assert.match(html, /النتائج المالية السنوية 2024–2025/);
  assert.equal((renderReitsCharts(item, years, 'netProfit').match(/class="chart-bar"/g) || []).length, 2);
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
  assert.match(read('reits.html'), /src="reits\.js\?v=reits-20261115b"/);
});

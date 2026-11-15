import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BANK_QUARTER_METRICS, buildBankPeriodColumns, renderBankPeriodTable, sumBankQuarters, getBankPeriodChartOptions, renderBankPeriodChart, validateQuarterly } from '../dist/bank-quarterly.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8'));
const quarterly = read('banks-quarterly-financials.json');
const annual = read('banks-financials.json');
const rajhi = quarterly.companies.find(bank => bank.symbol === '1120');
const riyad = quarterly.companies.find(bank => bank.symbol === '1010');

test('quarterly bank file is valid and covers the ten annual banks', () => {
  validateQuarterly(quarterly, 'البنوك');
  assert.deepEqual(quarterly.companies.map(bank => bank.symbol).sort(), annual.banks.map(bank => bank.symbol).sort());
  for (const bank of quarterly.companies) for (const values of Object.values(bank.quarters)) {
    assert.deepEqual(Object.keys(values), BANK_QUARTER_METRICS.map(metric => metric.key));
  }
});

test('Q4 is a standalone quarter: Al Rajhi quarters add up to the annual net profit', () => {
  const official = annual.banks.find(bank => bank.symbol === '1120').years.find(record => record.year === 2025).values.netProfit;
  const total = sumBankQuarters(rajhi, 2025, 4).netProfit;
  assert.ok(Math.abs(total - official) <= 1, `${total} ≈ ${official}`);
  assert.ok(rajhi.quarters['2025Q4'].netProfit < official / 2);
});

test('6 and 9 months sum every item, and a missing item stays null', () => {
  const m9 = buildBankPeriodColumns(rajhi, 'm9');
  assert.equal(m9.at(-1).label, '2026');
  const expected = [1, 2, 3].reduce((sum, n) => sum + rajhi.quarters[`2026Q${n}`].provisions, 0);
  assert.ok(Math.abs(m9.at(-1).values.provisions - expected) < 1e-6);
  const h1 = buildBankPeriodColumns(riyad, 'h1');
  assert.ok(h1.every(column => column.values.netFinancingIncome === null && column.values.netProfit !== null));
});

test('quarter views: one quarter across years and the last eight in sequence', () => {
  assert.deepEqual(buildBankPeriodColumns(rajhi, 'q', '3').map(column => column.label), ['Q3 2022', 'Q3 2023', 'Q3 2024', 'Q3 2025', 'Q3 2026']);
  assert.deepEqual(buildBankPeriodColumns(rajhi, 'q', '4').map(column => column.label), ['Q4 2022', 'Q4 2023', 'Q4 2024', 'Q4 2025']);
  const seq = buildBankPeriodColumns(rajhi, 'q', 'seq');
  assert.equal(seq.length, 8);
  const html = renderBankPeriodTable(rajhi, seq, { sequential: true, caption: 'x' });
  assert.match(html, /data-latest-label="Q3 2026" data-compare-label="Q3 2025"/);
});

test('period table lists the six workbook items, marks missing values and escapes names', () => {
  const html = renderBankPeriodTable({ ...riyad, name: '<b>"' }, buildBankPeriodColumns(riyad, 'q', '3'), { caption: 'Q3' });
  for (const metric of BANK_QUARTER_METRICS) assert.match(html, new RegExp(`data-metric="${metric.key}"`));
  assert.match(html, /<tr data-metric="netFinancingIncome">(?:(?!<\/tr>).)*غير متوفر/);
  assert.doesNotMatch(html, /<b>"/);
  const net = html.match(/<tr data-metric="netProfit">.*?<\/tr>/)[0];
  assert.equal((net.match(/class="annual-change"/g) || []).length, 4);
});

test('period chart draws the selected item and marks unavailable ones', () => {
  const columns = buildBankPeriodColumns(riyad, 'q', '3');
  const options = getBankPeriodChartOptions(columns);
  assert.equal(options.find(option => option.key === 'netFinancingIncome').available, false);
  assert.equal(options.find(option => option.key === 'provisions').available, true);
  const svg = renderBankPeriodChart(riyad, columns, 'provisions');
  assert.match(svg, /data-chart-key="provisions"/);
  assert.equal((svg.match(/class="chart-bar"/g) || []).length, columns.length);
});

test('banks page links the period styles and the annual file is untouched by the import', () => {
  const page = readFileSync(new URL('../dist/banks.html', import.meta.url), 'utf8');
  assert.match(page, /quarterly-periods\.css/);
  assert.match(page, /id="bank-period-bar" hidden/);
  assert.equal(annual.years.join(), '2021,2022,2023,2024,2025');
});

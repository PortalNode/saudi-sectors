import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestYearToDateColumns, YEAR_TO_DATE_LABELS } from '../dist/latest-results.mjs';
import { sumQuarters, renderPeriodTable } from '../dist/quarterly-periods.mjs';
import { sumBankQuarters, renderBankPeriodTable } from '../dist/bank-quarterly.mjs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const quarter = netProfit => ({ revenue: netProfit * 10, operatingIncome: netProfit * 2, netProfit, eps: netProfit / 100 });
const company = quarters => ({ symbol: '2222', name: 'شركة', quarters });

test('the latest quarter picks the year-to-date period: Q3 → 9 months, Q2 → 6 months', () => {
  const nine = latestYearToDateColumns(company({
    '2025Q1': quarter(10), '2025Q2': quarter(20), '2025Q3': quarter(30), '2025Q4': quarter(40),
    '2026Q1': quarter(11), '2026Q2': quarter(22), '2026Q3': quarter(33)
  }), sumQuarters);
  assert.deepEqual(nine.map(column => `${column.sub} ${column.label}`), ['9 أشهر 2025', '9 أشهر 2026']);
  assert.equal(nine[1].values.netProfit, 66);
  assert.equal(nine[0].values.netProfit, 60);
  const six = latestYearToDateColumns(company({ '2025Q1': quarter(1), '2025Q2': quarter(2), '2026Q1': quarter(3), '2026Q2': quarter(4) }), sumQuarters);
  assert.deepEqual(six.map(column => column.sub), ['6 أشهر', '6 أشهر']);
  assert.equal(six[1].values.netProfit, 7);
  assert.deepEqual(YEAR_TO_DATE_LABELS.slice(1), ['3 أشهر', '6 أشهر', '9 أشهر', '12 شهرًا']);
});

test('a missing earlier quarter gives no latest period; a missing previous year only blanks the comparison', () => {
  assert.equal(latestYearToDateColumns(company({ '2026Q1': quarter(1), '2026Q3': quarter(3) }), sumQuarters), null);
  assert.equal(latestYearToDateColumns(company({}), sumQuarters), null);
  assert.equal(latestYearToDateColumns(company({ '2026Q1': { netProfit: null } }), sumQuarters), null);
  const columns = latestYearToDateColumns(company({ '2025Q2': quarter(2), '2026Q1': quarter(3), '2026Q2': quarter(4) }), sumQuarters);
  assert.equal(columns[0].values, null);
  assert.equal(columns[1].values.netProfit, 7);
});

test('the rendered tables carry the labels the key figures strip reads', () => {
  const columns = latestYearToDateColumns(company({
    '2025Q1': quarter(10), '2025Q2': quarter(20), '2025Q3': quarter(30),
    '2026Q1': quarter(11), '2026Q2': quarter(22), '2026Q3': quarter(33)
  }), sumQuarters);
  const html = renderPeriodTable(company({}), columns, { caption: 'آخر النتائج' });
  assert.match(html, /data-latest-label="9 أشهر 2026" data-compare-label="9 أشهر 2025"/);
  assert.match(html, /data-metric="netProfit".*\+10\.00%/);
  const bank = { symbol: '1120', name: 'بنك', quarters: {
    '2025Q1': { netProfit: 100, eps: 1 }, '2025Q2': { netProfit: 100, eps: 1 },
    '2026Q1': { netProfit: 150, eps: 1.5 }, '2026Q2': { netProfit: 150, eps: 1.5 }
  } };
  const bankHtml = renderBankPeriodTable(bank, latestYearToDateColumns(bank, sumBankQuarters), { caption: 'آخر النتائج' });
  assert.match(bankHtml, /data-latest-label="6 أشهر 2026" data-compare-label="6 أشهر 2025"/);
  assert.match(bankHtml, /data-metric="netProfit".*\+50\.00%.*300\.00/);
});

test('both page drivers store the latest period for the strip before drawing the table', () => {
  for (const name of ['sector-results-page.mjs', 'banks.js']) {
    const source = read(name);
    assert.match(source, /latestYearToDateColumns\(/, name);
    assert.ok(source.indexOf('setLatestResults(') < source.indexOf("table-wrap').innerHTML"), name);
  }
  assert.match(read('layout.js'), /template\.latest-results/);
});

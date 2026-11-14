import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as metrics from '../dist/financial-services-metrics.mjs';
import { buildPeriodColumns, renderPeriodTable, validateQuarterly } from '../dist/quarterly-periods.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8'));
const annual = metrics.validateDataset(read('financial-services-financials.json'));
const quarterly = validateQuarterly(read('financial-services-quarterly-financials.json'), 'الخدمات المالية');
const SHARES = 249.74;
const close = (a, b, tolerance = 0.001) => Math.abs(a - b) <= tolerance;

test('Derayah figures reconcile and EPS uses 249.74 million shares', () => {
  const records = [...annual.companies[0].years.map(record => record.values), ...Object.values(quarterly.companies[0].quarters)];
  for (const values of records) {
    assert.ok(close(values.totalOperatingIncome + values.operatingExpenses, values.operatingIncome), 'total operating income + expenses = operating income');
    assert.ok(values.operatingExpenses < 0, 'expenses keep the statement sign');
    assert.ok(close(values.eps, values.netProfit / SHARES, 1e-6));
  }
});

test('period views use Derayah line items, not the standard nine', () => {
  const company = quarterly.companies[0];
  const columns = buildPeriodColumns(company, 'q', '2', metrics.PERIOD_SPEC);
  assert.deepEqual(columns.map(column => column.id), ['2025Q2', '2026Q2']);
  assert.ok(close(columns[0].values.costToIncome, 93.157319 / 235.279481, 1e-9));
  const html = renderPeriodTable(annual.companies[0], columns, { caption: 'Q2', metrics: metrics.PERIOD_SPEC.metrics });
  assert.match(html, /الإيرادات من العقود مع العملاء/);
  assert.match(html, /الربح قبل الزكاة/);
  assert.doesNotMatch(html, /هامش إجمالي الربح/);
});

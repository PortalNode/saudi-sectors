import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as metrics from '../dist/financial-services-metrics.mjs';
import { annualChange, buildPeriodColumns, renderPeriodTable, validateQuarterly } from '../dist/quarterly-periods.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8'));
const annual = metrics.validateDataset(read('financial-services-financials.json'));
const quarterly = validateQuarterly(read('financial-services-quarterly-financials.json'), 'الخدمات المالية');
const SHARES = 249.74;
const close = (a, b, tolerance = 0.001) => Math.abs(a - b) <= tolerance;

test('Derayah EPS uses 249.74 million shares and equals EPS before exceptional items', () => {
  const records = [...annual.companies[0].years.map(record => record.values), ...Object.values(quarterly.companies[0].quarters)];
  for (const values of records) {
    assert.ok(close(values.eps, values.netProfit / SHARES, 1e-6));
    assert.equal(values.epsBeforeExceptional, values.eps);
    assert.ok(values.operatingIncome < values.revenue && values.netProfit < values.revenue);
  }
});

test('Q3 2026 against Q3 2025 matches the reported changes', () => {
  const { quarters } = quarterly.companies[0];
  const change = key => Number(annualChange(quarters['2026Q3'][key], quarters['2025Q3'][key]).toFixed(1));
  assert.equal(change('revenue'), 1.8);
  assert.equal(change('operatingIncome'), 0.5);
  assert.equal(change('netProfit'), 5.7);
  assert.equal(change('eps'), 5.7);
});

test('period views use Derayah line items without average shares', () => {
  const columns = buildPeriodColumns(quarterly.companies[0], 'q', '3', metrics.PERIOD_SPEC);
  assert.deepEqual(columns.map(column => column.id), ['2025Q3', '2026Q3']);
  assert.ok(close(columns[1].values.netMargin, 105.37 / 242.23, 1e-9));
  const html = renderPeriodTable(annual.companies[0], columns, { caption: 'Q3', metrics: metrics.PERIOD_SPEC.metrics });
  for (const label of ['إجمالي الإيرادات', 'الربح التشغيلي', 'صافي الربح (الخسارة)', 'ربح السهم قبل البنود الاستثنائية', 'هامش صافي الربح']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /متوسط عدد الأسهم|هامش إجمالي الربح|المصروفات التشغيلية/);
});

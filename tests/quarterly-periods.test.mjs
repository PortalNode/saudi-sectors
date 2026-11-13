import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildPeriodColumns, renderPeriodTable, sumQuarters, validateQuarterly, quarterLabel } from '../dist/quarterly-periods.mjs';

const values = (revenue, netProfit) => ({ revenue, grossIncome: revenue / 2, operatingIncome: netProfit, netProfit, epsBeforeExceptional: 1, eps: 1 });
const company = {
  symbol: '1000', name: 'تجربة',
  quarters: {
    '2024Q1': values(100, 10), '2024Q2': values(110, 11), '2024Q3': values(120, 12), '2024Q4': values(130, 13),
    '2025Q1': values(200, 20), '2025Q2': values(220, 22), '2025Q3': values(240, 24)
  }
};

test('quarter labels use Q<n> <year>', () => {
  assert.equal(quarterLabel('2026Q3'), 'Q3 2026');
});

test('9 months sums Q1..Q3 and skips years without Q3', () => {
  const columns = buildPeriodColumns(company, 'm9');
  assert.deepEqual(columns.map(column => column.label), ['2024', '2025']);
  assert.equal(columns[1].values.revenue, 660);
  assert.equal(columns[1].values.netMargin, 66 / 660);
  assert.equal(sumQuarters(company, 2025, 4), null);
});

test('a single quarter is compared across years', () => {
  const columns = buildPeriodColumns(company, 'q', '4');
  assert.deepEqual(columns.map(column => column.label), ['Q4 2024']);
});

test('sequential view compares with the same quarter last year', () => {
  const columns = buildPeriodColumns(company, 'q', 'seq');
  assert.equal(columns.length, 7);
  const html = renderPeriodTable(company, columns, { sequential: true, caption: 'x' });
  // Q3 2025 revenue 240 vs Q3 2024 120 → +100%, not vs Q2 2025.
  assert.match(html, /\+100\.00%/);
  assert.match(html, /data-latest-label="Q3 2025" data-compare-label="Q3 2024"/);
});

test('every quarterly data file in dist is valid and matches its annual sector', () => {
  const files = readdirSync(new URL('../dist/', import.meta.url)).filter(name => name.endsWith('-quarterly-financials.json'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const slug = file.replace('-quarterly-financials.json', '');
    const quarterly = JSON.parse(readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8'));
    const annual = JSON.parse(readFileSync(new URL(`../dist/${slug}-financials.json`, import.meta.url), 'utf8'));
    validateQuarterly(quarterly, annual.sector);
    const symbols = new Set(annual.companies.map(item => item.symbol));
    for (const item of quarterly.companies) assert.ok(symbols.has(item.symbol), `${slug}: ${item.symbol} not in annual file`);
    const page = readFileSync(new URL(`../dist/${slug}.html`, import.meta.url), 'utf8');
    assert.match(page, /quarterly-periods\.css/, `${slug}.html must link quarterly-periods.css`);
  }
});

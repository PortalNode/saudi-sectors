import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { annualChange, formatValue, formatChange, renderAnnualTable, validateDataset } from '../dist/bank-metrics.mjs';

const bankData = () => JSON.parse(readFileSync(new URL('../dist/banks-financials.json', import.meta.url), 'utf8'));
test('annual change uses exact stored values, safe missing and zero handling', () => {
  assert.equal(annualChange(110, 100), 10);
  assert.equal(annualChange(80, 100), -20);
  assert.equal(annualChange(-50, -100), 50);
  assert.equal(annualChange(10, 0), null);
  assert.equal(annualChange(null, 100), null);
  assert.equal(annualChange(100, null), null);
  assert.equal(annualChange(Infinity, 100), null);
  assert.equal(annualChange('110', 100), null);
  assert.match(formatChange(110, 100), /up.*\+10\.00%/);
  assert.match(formatChange(80, 100), /down.*-20\.00%/);
  assert.match(formatChange(0, 0), /missing/);
  assert.match(formatChange(100.001, 100), /flat.*0\.00%/);
});
test('financial ratios are rendered as percent, EPS as SAR, historical PE as times', () => {
  assert.match(formatValue(0.2190824271, 'ratio'), /21\.91%/);
  assert.match(formatValue(1.128088621, 'ratio'), /112\.81%/);
  assert.match(formatValue(6.2, 'sar'), /6\.20<\/span>/);
  assert.match(formatValue(16.3, 'times'), /16\.30<\/span>/);
  assert.match(formatValue(null, 'sar'), /missing/);
});
test('all ten banks cover only FY 2021-2025; no invented screenshot fields', () => {
  const data = validateDataset(bankData());
  assert.equal(data.source.type, 'user_workbook');
  assert.equal(data.source.fileName, 'البنوك.xlsx');
  for (const bank of data.banks) for (const year of bank.years) {
    assert.equal(year.values.provisions, null);
    assert.equal(year.values.averageShares, null);
    assert.equal(year.values.recurringEps, null);
  }
  const rajhi = data.banks.find(bank => bank.symbol === '1120');
  assert.equal(rajhi.years.find(record => record.year === 2024).values.netProfit, 19731);
  assert.equal(rajhi.years.find(record => record.year === 2025).values.eps, 6.2);
  const html = renderAnnualTable(rajhi);
  const head = html.match(/<thead>([\s\S]*?)<\/thead>/)[1];
  const headings = [...head.matchAll(/<th\b[^>]*>([^<]*)<\/th>/g)].map(match => match[1]);
  assert.deepEqual(headings, ['البند','2021','نسبة التغير','2022','نسبة التغير','2023','نسبة التغير','2024','نسبة التغير','2025']);
  assert.equal((head.match(/<tr>/g) || []).length, 1);
  assert.match(html, /19,731\.00/); assert.match(html, /24,792\.00/);
  assert.doesNotMatch(html, /data-metric="(?:provisions|averageShares|recurringEps)"|المخصصات|متوسط عدد الأسهم|قبل البنود الاستثنائية/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.equal((html.match(/data-metric=/g) || []).length, 14);
  const profitCells = [...html.match(/<tr data-metric="netProfit">([\s\S]*?)<\/tr>/)[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].replace(/<[^>]*>/g,''));
  assert.deepEqual(profitCells, ['14,746.00','+16.30%','17,150.00','-3.08%','16,621.00','+18.71%','19,731.00','+25.65%','24,792.00']);
  const ahli = data.banks.find(bank => bank.symbol === '1180');
  assert.match(renderAnnualTable(ahli), /نسبة التمويل الدولي/);
  assert.equal(ahli.years.find(record => record.year === 2025).values.pe, 9.4);
  const invalid = structuredClone(data); invalid.banks[0].years[0].period = 'Q1';
  assert.throws(() => validateDataset(invalid));
});
test('bank results are local; file source and data limitations are disclosed', () => {
  const script = readFileSync(new URL('../dist/banks.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../dist/banks.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(script, /fetch\('banks-financials\.json/);
  assert.doesNotMatch(script, /argaam\.com|setInterval|OPENAI|invokeLLM/);
  assert.match(page, /لم تُراجع بمصدر خارجي/);
  assert.match(page, /ليس متوسط حقوق المساهمين/);
  assert.match(page, /لا تغيّر هذه الصفحة أسعار/);
  assert.match(app, /company-results-link.*banks\.html\?symbol=/);
  assert.match(app, /name==='البنوك'.*bank-results-link/);
});

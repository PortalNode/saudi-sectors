import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAnswer, inline, toLatinDigits } from '../dist/ai-format.mjs';

test('answers use English digits and keep each number left-to-right', () => {
  assert.equal(toLatinDigits('٥ شركات و٧٫٢٪ و۱۲'), '5 شركات و7.2% و12');
  assert.equal(inline('نمو +4.5% و-12.0% و10,410 في 2026-11-19'),
    'نمو <span class="n">+4.5%</span> و<span class="n">-12.0%</span> و<span class="n">10,410</span> في <span class="n">2026-11-19</span>');
  assert.equal(inline('عائد %4.5.'), 'عائد <span class="n">4.5%</span>.', 'percent moves after the number; the full stop stays outside');
});

test('stray quotes and footnote stars are dropped, bold stays', () => {
  assert.equal(inline('لـ «استثمار» و"مثال" و-91.2%* و**مهم**'), 'لـ استثمار ومثال و<span class="n">-91.2%</span> و<b>مهم</b>');
  assert.equal(renderAnswer('*١ صافولا: ملاحظة'), '<p>صافولا: ملاحظة</p>');
});

test('a markdown table becomes one real table even with blank lines between rows', () => {
  const html = renderAnswer('| # | الشركة | سنة% |\n|---|---|---|\n\n| 1 | بنك الرياض | +4.5% |\n\n| 2 | صافولا | -12.0% |\n\nبعد الجدول');
  assert.equal((html.match(/<table/g) || []).length, 1);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.match(html, /<th>الشركة<\/th>/);
  assert.match(html, /<td class="ai-num"><span class="n">-12\.0%<\/span><\/td>/);
  assert.doesNotMatch(html, /---/);
  assert.match(html, /<\/table><\/div><p>بعد الجدول<\/p>$/);
});

test('headings, bullets and numbered lists', () => {
  assert.equal(renderAnswer('## الخلاصة\n- أولى\n- ثانية\n\n1. واحد\n2. اثنان\n---'),
    '<h4>الخلاصة</h4><ul><li>أولى</li><li>ثانية</li></ul><ol><li value="1">واحد</li><li value="2">اثنان</li></ol>');
});

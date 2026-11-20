import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { keyPoints, parseBody } from '../dist/announcement-format.mjs';

const dir = new URL('../dist/announcements/', import.meta.url);
const items = readdirSync(dir).filter(n => /^\d{4}\.json$/.test(n))
  .flatMap(n => JSON.parse(readFileSync(new URL(n, dir), 'utf8')).items);
const first = re => items.find(i => re.test(i.title));

test('every stored announcement parses into something to show', () => {
  for (const item of items) {
    const parsed = parseBody(item.body);
    assert.ok(parsed.lead.length || parsed.fields.length || parsed.notes.length || parsed.tables.length, `${item.id} parsed empty`);
    assert.ok(keyPoints(parsed, item.title).length <= 4, `${item.id} has too many key points`);
  }
});

test('a dividend announcement yields per-share amount, total and both dates', () => {
  const item = first(/قرار مجلس الإدارة بتوزيع أرباح نقدية/);
  const tiles = keyPoints(parseBody(item.body), item.title);
  const labels = tiles.map(t => t.label);
  assert.ok(labels.includes('حصة السهم') && labels.includes('إجمالي التوزيع'), labels.join());
  const entitlement = tiles.find(t => t.label === 'تاريخ الأحقية');
  assert.match(entitlement.date.greg, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(entitlement.date.hijri, /^14\d\d-\d{2}-\d{2}$/);
});

test('preliminary results become tables and profit/revenue tiles with the change', () => {
  const item = first(/النتائج المالية الأولية/);
  const parsed = parseBody(item.body);
  assert.ok(parsed.tables.length >= 1 && parsed.tables[0].rows.length > 2);
  assert.deepEqual(parsed.tables[0].heads.slice(0, 3), ['الربع الحالي', 'الربع المماثل من العام السابق', 'التغير %']);
  const tiles = keyPoints(parsed, item.title);
  const profit = tiles.find(t => t.label === 'صافي الربح');
  assert.ok(profit && /مساهمي|الربح|الدخل/.test(profit.rowLabel));
  assert.ok(!tiles.some(t => /الشامل/.test(t.rowLabel || '')), 'comprehensive income must not be shown as revenue');
});

test('a clock time is a field, not a numeric table row', () => {
  const parsed = parseBody('وقت انعقاد الجمعية العامة: 18:30\n\nنسبة الحضور: 70.75%');
  assert.equal(parsed.tables.length, 0);
  assert.deepEqual(parsed.fields.map(f => f.value), ['18:30', '70.75%']);
});

test('bullets stay with their heading and web addresses are not split into fields', () => {
  const parsed = parseBody('أسماء الحاضرين:\n\n• الأول\n\n• الثاني\n\nالموقع: https://example.com/a');
  assert.deepEqual(parsed.notes[0].items, ['الأول', 'الثاني']);
  assert.ok(parsed.fields.some(f => f.key === 'الموقع' && f.value.startsWith('https://')));
});

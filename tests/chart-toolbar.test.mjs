import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dist/company-chart.js', import.meta.url), 'utf8');
const toolIds = [...source.match(/const TOOLS = \[(.*)\];/)[1].matchAll(/\['(\w+)',/g)].map(m => m[1]);
const groups = source.match(/const TOOL_GROUPS = \[([^]*?)\]\.map/)[1];
const grouped = [...groups.matchAll(/\['[^']*', \[([^\]]*)\]\]/g)].flatMap(m => [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1]));

test('every drawing tool sits in exactly one toolbar group and has an icon', () => {
  assert.deepEqual([...grouped].sort(), [...toolIds].sort());
  for (const id of toolIds) assert.match(source, new RegExp(`\\n    ${id}: icon\\(`), `icon for ${id}`);
});

test('the toolbar has group buttons with side menus, favourites, shortcuts and stay-in-drawing-mode', () => {
  for (const part of ['cc-grp-arrow', 'data-menu="grp:', 'data-fav', 'data-stay', 'data-favbar', 'SHORTCUTS', 'state.stay ? ']) assert.ok(source.includes(part), part);
});

test('the yellow drawing instructions stay removed', () => {
  assert.equal(source.includes('HINTS'), false);
  assert.equal(source.includes('Esc للإلغاء'), false);
});

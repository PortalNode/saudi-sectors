import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');

test('the home page has the «موعد النتائج» filter next to the table switches', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="stylesheet" href="earnings-filter\.css\?v=[^"]+">/);
  assert.match(html, /id="reported-mode"[^]*?<span class="table-tools-label">موعد النتائج<\/span>\s*<div id="earn-filter" class="col-switch earn-filter" role="group"/);
  assert.match(html, /<script src="app\.js\?v=[^"]*earnfilter[^"]*" defer><\/script>/, 'app.js cache key changed');
});

test('the filter reads the earnings calendar, filters rows and adds the date column only when active', () => {
  const app = read('app.js');
  assert.match(app, /fetch\('earnings-calendar\/index\.json',\{cache:'no-cache'\}\)/);
  for (const id of ['all', 'd7', 'd30', 'd90', 'upcoming', 'recent', 'late']) assert.match(app, new RegExp(`\\['${id}','`));
  assert.match(app, /&&earnMatch\(s\)\)/, 'rows pass through the filter');
  assert.match(app, /const viewColumns = \(\) => earnFilter==='all'\?columns:\[\.\.\.columns,EARN_COL\]/);
  assert.match(app, /\$\{earnFilter==='all'\?'':earnCell\(stock\)\}<\/tr>/);
  assert.match(app, /sort\.key==='earnDate'\?\(earnings\.get\(s\.symbol\)\?\.d\?\?null\)/, 'sorts by the expected date');
  const index = JSON.parse(read('earnings-calendar/index.json'));
  for (const c of index.companies.slice(0, 20)) for (const k of ['s', 'd', 'lo', 'hi', 'last', 'conf', 'fy', 'q']) assert.ok(c[k] != null, `${c.s} misses ${k}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const sectorPages = readdirSync(new URL('../dist/', import.meta.url))
  .filter(name => name.endsWith('.html') && !['index.html', 'comparison.html'].includes(name))
  .map(name => name.replace(/\.html$/, ''));
const layout = read('layout.js');
const listed = [...layout.matchAll(/\['([a-z-]+)', '([؀-ۿ][^']*)'\]/g)].map(match => ({ page: match[1], name: match[2] }));

test('the sector switcher lists every results page once, under its main-table sector name', () => {
  assert.deepEqual(listed.map(item => item.page).sort(), [...sectorPages].sort());
  const site = JSON.parse(read('data.json'));
  assert.deepEqual(listed.map(item => item.name).sort(), site.sectors.map(sector => sector.name).sort());
  for (const page of sectorPages) assert.match(read(`${page}.html`), /layout\.js\?v=latest-ytd-20261116/, page);
});

test('the top bar has a «نتائج الشركات» tab on every page, current on the results pages', () => {
  for (const page of [...sectorPages, 'index', 'comparison']) {
    const nav = read(`${page}.html`).match(/<nav class="site-nav"[^>]*>(.*?)<\/nav>/)[1];
    assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map(match => match[1]), ['الشركات', 'نتائج الشركات', 'مقارنة النتائج المالية'], page);
    const current = nav.match(/<a [^>]*aria-current="page"[^>]*>([^<]+)</)[1];
    assert.equal(current, page === 'index' ? 'الشركات' : page === 'comparison' ? 'مقارنة النتائج المالية' : 'نتائج الشركات', page);
    assert.match(nav, /<a href="banks\.html" data-results-link/, page);
  }
  assert.match(layout, /write\('saudi-sectors-results-page', currentPage\)/);
});

test('results pages drop the sector line under the site name and the «المصدر» status line', () => {
  for (const page of sectorPages) assert.doesNotMatch(read(`${page}.html`), /class="hero-date"/, page);
  const shared = read('sector-results-page.mjs');
  assert.doesNotMatch(shared, /hero-date|المصدر: /);
  assert.match(shared, /\$\('load-status'\)\.hidden = true/);
  assert.match(read('banks.js'), /element\('bank-load-status'\)\.hidden = true/);
  assert.doesNotMatch(read('banks.js'), /bank-load-status'\)\.textContent = quarterly/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const page = read('comparison-page.js');
const sectorPages = readdirSync(dist)
  .filter(name => name.endsWith('.html') && !['index.html', 'comparison.html'].includes(name))
  .map(name => name.replace(/\.html$/, ''));
const listed = [...page.match(/const SECTORS = \[([\s\S]*?)\n\];/)[1].matchAll(/\['[^']+','([a-z-]+)'\]/g)].map(match => match[1]);

test('the comparison page lists every sector results page once', () => {
  assert.deepEqual([...listed].sort(), [...sectorPages].sort());
  assert.equal(new Set(listed).size, listed.length);
});

test('the comparison page offers annual, quarter, sequential, 6 and 9 month periods', () => {
  for (const id of ['fy', 'q', 'seq', 'h1', 'm9']) assert.match(page, new RegExp(`\\['${id}','`), id);
  const html = read('comparison.html');
  for (const id of ['period-seg', 'quarter-seg', 'period-note', 'year-quick', 'years-label']) assert.match(html, new RegExp(`id="${id}"`), id);
});

test('every item in a sector data file has a label on the comparison page', () => {
  const labels = new Set([...page.matchAll(/\b([a-zA-Z]+):'/g)].map(match => match[1]));
  for (const slug of sectorPages) {
    const files = [`${slug}-financials.json`, `${slug}-quarterly-financials.json`].filter(name => existsSync(new URL(name, dist)));
    for (const name of files) {
      const data = JSON.parse(read(name));
      for (const company of data.companies ?? data.banks) {
        const records = company.years ? company.years.map(row => row.values) : Object.values(company.quarters);
        for (const values of records) for (const key of Object.keys(values ?? {})) assert.ok(labels.has(key), `${name}: ${key} has no label`);
      }
    }
  }
});

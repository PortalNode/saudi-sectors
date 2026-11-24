import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const page = read('comparison-page.js');
const sectorPages = readdirSync(dist)
  .filter(name => name.endsWith('.html') && !['index.html', 'comparison.html', 'technical-analysis.html', 'ai-analyst.html'].includes(name))
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

test('market valuation items come from data.json: P/E, book value, P/B, yield and market cap', async () => {
  const { MARKET_KEYS, marketIndex, marketDate } = await import(new URL('comparison-market.mjs', dist));
  assert.deepEqual(MARKET_KEYS, ['mktPe', 'mktBook', 'mktPb', 'mktYield', 'mktCap']);
  const idx = marketIndex({ asOf: '2026-11-22', sectors: [{ stocks: [
    { symbol: '1180', price: 36.8, eps: 4.314, pe: 8.53, bookValue: 31.86, pb: 1.155, dividendYield: 5.84, marketCap: 220800 },
    { symbol: '2', price: 10, eps: -1, pe: null, bookValue: 5, pb: null, dividendYield: null, marketCap: 50 },
  ] }] });
  assert.deepEqual(idx.get('1180'), { mktPe: 8.53, mktBook: 31.86, mktPb: 1.155, mktYield: 0.0584, mktCap: 220800 });
  // الخاسرة بلا مكرر، والمكرر الدفتري يُحسب من السعر والقيمة الدفترية إن غاب
  assert.equal(idx.get('2').mktPe, null);
  assert.equal(idx.get('2').mktPb, 2);
  assert.equal(marketDate({ asOf: '2026-11-22' }), '2026-11-22');
  for (const k of MARKET_KEYS) assert.match(page, new RegExp(`${k}:'`), k);
});

test('several items can be compared at once and saved as one image', () => {
  const html = read('comparison.html'), exp = read('comparison-export.mjs');
  for (const id of ['metric-multi', 'metric-picked', 'cx-multi', 'multi-grid', 'multi-legend']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(page, /const MAX_METRICS = 8/);
  assert.match(page, /m:state\.metrics\.join\(','\)/);
  assert.match(exp, /d\.multi \? layoutMulti/);
});

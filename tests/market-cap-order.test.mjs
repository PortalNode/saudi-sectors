import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marketCapMap, sortByMarketCap, loadMarketCaps } from '../dist/market-cap-order.mjs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const prices = { sectors: [{ stocks: [{ symbol: '1', marketCap: 50 }, { symbol: '2', marketCap: 900 }, { symbol: '3', marketCap: null }] }, { stocks: [{ symbol: '4', marketCap: 120 }] }] };
const list = ['1', '2', '3', '4', '5'].map(symbol => ({ symbol }));

test('companies run from the largest market cap down; unknown caps keep file order at the end', () => {
  assert.deepEqual(sortByMarketCap(list, marketCapMap(prices)).map(item => item.symbol), ['2', '4', '1', '3', '5']);
  assert.deepEqual(list.map(item => item.symbol), ['1', '2', '3', '4', '5'], 'the input is not mutated');
  assert.deepEqual(sortByMarketCap(list, new Map()).map(item => item.symbol), ['1', '2', '3', '4', '5']);
});

test('a failed price snapshot leaves the file order', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await loadMarketCaps(async () => ({ ok: false, status: 404 }))).size, 0);
    assert.equal((await loadMarketCaps(async () => { throw new Error('offline'); })).size, 0);
  } finally { console.warn = warn; }
});

test('results pages, banks and the comparison page order companies by market cap without showing it', () => {
  assert.match(read('sector-results-page.mjs'), /companies: sortByMarketCap\(dataset\.companies, caps\)/);
  assert.match(read('banks.js'), /dataset\.banks = sortByMarketCap\(dataset\.banks, marketCapMap\(/);
  const comparison = read('comparison-page.js');
  assert.match(comparison, /sortByMarketCap\(annual\.companies \|\| annual\.banks/);
  assert.match(comparison, /sortByMarketCap\(quarterly\.companies, caps\)/);
  for (const name of ['sector-results-page.mjs', 'banks.js', 'comparison-page.js']) assert.doesNotMatch(read(name).replace(/sortByMarketCap|marketCapMap|loadMarketCaps|market-cap-order/g, ''), /marketCap|القيمة السوقية/, name);
});

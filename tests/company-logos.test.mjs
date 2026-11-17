import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isSafeSvg } from '../scripts/fetch-logos.mjs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const manifest = JSON.parse(read('logos/manifest.json'));
const files = readdirSync(new URL('logos/', dist)).filter(name => name.endsWith('.svg')).map(name => name.slice(0, -4)).sort();

test('the logo manifest lists exactly the logo files, each a market symbol', () => {
  assert.deepEqual(manifest.symbols, files);
  const site = JSON.parse(read('data.json'));
  const symbols = new Set([...site.sectors.flatMap(sector => sector.stocks.map(stock => String(stock.symbol))), 'TASI']); // TASI: the market index
  for (const symbol of files) assert.ok(symbols.has(symbol), symbol);
});

test('every logo is a plain SVG with no scripts or outside links', () => {
  for (const symbol of files) assert.ok(isSafeSvg(read(`logos/${symbol}.svg`)), symbol);
  assert.equal(isSafeSvg('<svg onload="alert(1)"></svg>'), false);
  assert.equal(isSafeSvg('<svg><script>x</script></svg>'), false);
  assert.equal(isSafeSvg('<svg><image href="https://x.test/a.png"/></svg>'), false);
  assert.equal(isSafeSvg('<!-- by TradingView --><svg viewBox="0 0 56 56"><path d="M0 0h56v56H0z"/></svg>'), true);
});

test('layout.js adds logos to the heading, the home table and the chart search, with a letter fallback', () => {
  const layout = read('layout.js');
  assert.match(layout, /fetch\('logos\/manifest\.json/);
  assert.match(layout, /\.bank-heading h2/);
  assert.match(layout, /tbody td\.company-name/);
  assert.match(layout, /\.cc-search-btn/);
  assert.match(layout, /co-logo-letter/);
  assert.match(read('layout.css'), /\.co-logo\{/);
});

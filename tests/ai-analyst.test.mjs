import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildPack, SECTOR_SLUGS } from '../scripts/build-ai-packs.mjs';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');

test('every sector in data.json maps to its financial files', () => {
  const market = JSON.parse(read('data.json'));
  const files = new Set(readdirSync(dist));
  for (const sector of market.sectors) {
    const slug = SECTOR_SLUGS[sector.name];
    assert.ok(slug, sector.name);
    assert.ok(files.has(`${slug}-financials.json`), slug);
  }
});

test('a company pack is a short table with the key figures, not the raw files', () => {
  const sector = { name: 'الاسمنت', stocks: [
    { symbol: '3010', name: 'أ', pe: 10, dividendYield: 4, year1: 2 },
    { symbol: '3020', name: 'ب', pe: 20, dividendYield: 6, year1: -4 },
  ] };
  const pack = buildPack({
    stock: { ...sector.stocks[0], price: 25.5, priceDate: '2026-11-19', marketCap: 1234.5 },
    sector,
    profile: { activity: 'صناعة الإسمنت' },
    annual: { years: [1, 2, 3, 4, 5, 6].map(i => ({ year: 2019 + i, values: { revenue: 100 * i, netProfit: 10 * i, netMargin: 0.1, dilutedEps: 1 } })) },
    quarterly: { quarters: { '2026Q3': { netProfit: 30 }, '2026Q1': { netProfit: 10 }, '2026Q2': { netProfit: 20 } } },
    announcements: { items: [{ t: '2026-11-01', title: 'إعلان   نتائج' }] },
  });
  assert.equal(pack.symbol, '3010');
  assert.match(pack.text, /الشركة: أ \(3010\) \| القطاع: الاسمنت/);
  assert.match(pack.text, /وسيط القطاع \(عدد الشركات 2\): المكرر 15 · العائد 5%/);
  assert.match(pack.text, /السنة \| الإيرادات \| صافي الربح \| الهامش الصافي/);
  assert.doesNotMatch(pack.text, /2020 \|/, 'only the last five years');
  assert.match(pack.text, /2025 \| 600 \| 60 \| 10\.0%/);
  assert.doesNotMatch(pack.text, /dilutedEps/);
  assert.match(pack.text, /2026Q1[\s\S]*2026Q2[\s\S]*2026Q3/, 'quarters in order');
  assert.match(pack.text, /- 2026-11-01: إعلان نتائج/);
  assert.deepEqual(pack.facts.quarters.at(-1), ['2026Q3', 30]);
  assert.ok(pack.tokens < pack.rawTokens);
});

test('the analyst page talks only to the proxy and is in every top bar', () => {
  const page = read('ai-analyst.html');
  assert.doesNotMatch(page, /openrouter\.ai|sk-or-|type="password"/, 'no API key or direct OpenRouter call in the page');
  assert.match(page, /ai-config\.js/);
  assert.match(page, /`ai\/\$\{[^}]+\}\.json`/);
  const worker = readFileSync(new URL('../worker/ai-proxy.js', import.meta.url), 'utf8');
  assert.match(worker, /env\.OPENROUTER_API_KEY/);
  assert.match(worker, /max_tokens/);
  for (const name of readdirSync(dist).filter(n => n.endsWith('.html') && n !== 'preview-improvements.html')) {
    const nav = read(name).match(/<nav class="site-nav"[^>]*>(.*?)<\/nav>/)?.[1];
    if (nav) assert.match(nav, /<a href="ai-analyst\.html"[^>]*>المحلل الذكي<\/a>/, name);
  }
});

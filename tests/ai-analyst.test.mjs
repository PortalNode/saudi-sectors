import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildPack, technicalSection, SECTOR_SLUGS, SYSTEM_PROMPT } from '../scripts/build-ai-packs.mjs';

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
    annual: { years: [1, 2, 3, 4, 5, 6, 7].map(i => ({ year: 2019 + i, values: { revenue: 100 * i, netProfit: 10 * i, netMargin: 0.1, dilutedEps: 1 } })) },
    quarterly: { quarters: { '2026Q3': { netProfit: 30 }, '2026Q1': { netProfit: 10 }, '2026Q2': { netProfit: 20 } } },
    announcements: { items: [{ t: '2026-11-01', title: 'إعلان   نتائج' }] },
  });
  assert.equal(pack.symbol, '3010');
  assert.match(pack.text, /الشركة: أ \(3010\) \| القطاع: الاسمنت/);
  assert.match(pack.text, /وسيط القطاع \(عدد الشركات 2\): المكرر 15 · مضاعف الدفترية — · العائد 5%/);
  assert.match(pack.text, /السنة \| الإيرادات \| صافي الربح \| الهامش الصافي/);
  assert.doesNotMatch(pack.text, /2020 \|/, 'only the last six years');
  assert.match(pack.text, /2025 \| 600 \| 60 \| 10\.0%/);
  assert.doesNotMatch(pack.text, /dilutedEps/);
  assert.match(pack.text, /2026Q1[\s\S]*2026Q2[\s\S]*2026Q3/, 'quarters in order');
  assert.match(pack.text, /- 2026-11-01: إعلان نتائج/);
  assert.deepEqual(pack.facts.quarters.at(-1), ['2026Q3', 30]);
  assert.ok(pack.tokens > 0 && pack.rawTokens > 0);
  assert.equal(pack.system, SYSTEM_PROMPT);
  assert.match(SYSTEM_PROMPT, /محلل مالي وفني/);
  assert.doesNotMatch(pack.text, /التحليل الفني/, 'no candles, no technical section');
});

test('the technical section is built from dividend-adjusted candles and the scanner result', () => {
  const n = 260, d = [], c = [];
  for (let i = 0; i < n; i++) { d.push(`2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`); c.push(10 + i * 0.05); }
  const ohlc = { d, o: c, h: c.map(x => x + 0.1), l: c.map(x => x - 0.1), c, v: c.map(() => 1000), div: [] };
  const signal = { trend: 'up', levelPos: 'open', score: 4, supportZone: [20, 21, 5, '2026-03-01'], resistanceZone: null, keys: { trend: [1, 'اتجاه صاعد'] } };
  const tech = technicalSection(ohlc, { signal, tasi: { c: c.map(() => 100) }, tasiTrend: 'مؤشر السوق صاعد' });
  const text = tech.lines.join('\n');
  assert.match(text, /نتيجة ماسح الموقع: الاتجاه صاعد · موقع السعر فوق الدعم ولا مقاومة أعلاه · التقييم 4\/6/);
  assert.match(text, /SMA200 [\d.]+/);
  assert.match(text, /RSI14 100/, 'a straight climb has no losses');
  assert.match(text, /دعم 20–21 \(5 لمسات منذ 2026-03-01\) · لا مقاومة مؤكدة أعلاه/);
  assert.match(text, /- \[إيجابي\] اتجاه صاعد/);
  assert.equal(text.match(/^2026-\d\d-\d\d \|/gm).length, 10, 'last ten sessions');
  assert.equal(tech.facts.trend, 'up');
  assert.equal(technicalSection({ c: [1, 2, 3] }), null, 'too little history');
});

test('the analyst page keeps the key out of the site files and is in every top bar', () => {
  const page = read('ai-analyst.html');
  assert.doesNotMatch(page, /sk-or-v1-[0-9a-f]{8}/, 'no API key written into the page');
  assert.match(page, /store\.get\("ai-openrouter-key"\)/, 'the key lives only in the visitor\'s browser');
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

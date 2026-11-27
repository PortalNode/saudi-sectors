import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildPack, technicalSection, buildSectorPack, buildMarketPack, companySummary, coreProfit, forecastSection, earningsSection, calendarSection, sinceListingSection, SECTOR_SLUGS, SYSTEM_PROMPT, PICK_PROMPT, DEEP_PROMPT } from '../scripts/build-ai-packs.mjs';

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
  assert.deepEqual(pack.facts.quarters.at(-1), ['2026Q3', 30, 30]);
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
  const models = [...page.match(/const MODELS = \[([\s\S]*?)\n\];/)[1].matchAll(/\["([^"]+)","/g)].map(m => m[1]);
  assert.equal(models.length, 6, 'six models');
  for (const id of models) assert.match(id, /:free$/, `${id} is free`);
  const proxy = readFileSync(new URL('../worker/ai-proxy.js', import.meta.url), 'utf8');
  for (const id of proxy.match(/const DEFAULT_MODELS = '([^']+)'/)[1].split(',')) assert.match(id, /:free$/, `proxy: ${id}`);
  assert.match(page, /fetch\("https:\/\/openrouter\.ai\/api\/v1\/key"/, 'shows the free daily allowance');
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

test('sector and market packs list every company in one short row', () => {
  const stocks = [
    { symbol: '3010', name: 'أ', price: 10, marketCap: 500, pe: 10, pb: 1, dividendYield: 5, ytd: 1, year1: 2 },
    { symbol: '3020', name: 'ب', price: 20, marketCap: 1500, pe: 20, pb: 2, dividendYield: 3, ytd: -1, year1: -2, suspended: true },
  ];
  const sector = { name: 'الاسمنت', stocks };
  const facts = { years: [{ year: 2024, revenue: 100, netProfit: 10 }, { year: 2025, revenue: 120, netProfit: -5 }], quarters: [['2025Q3', 2], ['2025Q4', 2], ['2026Q1', 2], ['2026Q2', 2], ['2026Q3', 3]], tech: { trend: 'up', rsi: 61.4, sma200: 8, price: 10, score: 4 } };
  const rows = stocks.map(st => ({ st, pack: { facts, rawTokens: 1000 }, sum: companySummary(st, { facts }) }));
  assert.equal(rows[0].sum.profitGrowth, 'تحوّل لخسارة');
  assert.equal(rows[0].sum.lastQYoY, '+50.0%');
  const sec = buildSectorPack(sector, 'cement', rows, { asOf: '2026-11-19' });
  assert.equal(sec.scope, 'sector');
  assert.equal(sec.system, SYSTEM_PROMPT);
  assert.match(sec.text, /الاسمنت: عدد الشركات 2 · القيمة السوقية 2 مليار ريال · وسيط المكرر 15/);
  const lines = sec.text.split('\n').filter(l => /^30[12]0 \|/.test(l));
  assert.deepEqual(lines.map(l => l.slice(0, 4)), ['3020', '3010'], 'largest company first');
  assert.match(lines[0], /\| موقوف$/);
  assert.match(lines[1], /\| 2025 \| 120 \| \+20\.0% \| -5 \| تحوّل لخسارة \|/);
  const mkt = buildMarketPack({ asOf: '2026-11-19', sectors: [sector] }, [{ sector, slug: 'cement', rows }], { tasiLine: 'مؤشر تاسي: 10,000' });
  assert.equal(mkt.scope, 'market');
  assert.deepEqual(mkt.sectors, [['cement', 'الاسمنت', 2]]);
  assert.match(mkt.text, /## الاسمنت: عدد الشركات 2 .*\(100% من السوق\)/);
  assert.match(mkt.text, /3010 \| أ \| 10 \| 500 \| 10 \| — \| 1 \| 5 \| 1 \| 2 \| — \| -5 \(2025\) \| تحوّل لخسارة \| — \| \+50\.0% \| — \| — \| صاعد \| 61 \| \+25\.0% \| 4/);
  assert.doesNotMatch(mkt.digest, /^3010 \|/m, 'the digest has no company rows');
  assert.match(mkt.digest, /## الاسمنت/);
  assert.equal(mkt.pick, PICK_PROMPT);
  assert.equal(sec.deep, DEEP_PROMPT);
  assert.match(SYSTEM_PROMPT, /«الأرخص» تعني التقييم/);
  assert.match(SYSTEM_PROMPT, /الأرقام الإنجليزية 0123456789/);
  assert.match(SYSTEM_PROMPT, /بلا أسطر فارغة بين الصفوف/);
});

test('the analyst page asks about the market, a sector or a company, and attaches named companies', () => {
  const page = read('ai-analyst.html');
  for (const scope of ['market', 'sector', 'company']) assert.match(page, new RegExp(`data-scope="${scope}"`));
  assert.match(page, /getPack\("ai\/market\.json"\)/);
  assert.match(page, /getPack\(`ai\/sector-\$\{slug\}\.json`\)/);
  assert.match(page, /function mentionedStocks\(/);
  assert.match(page, /\.slice\(0, 3\)/, 'at most three attached companies');
  const proxy = readFileSync(new URL('../worker/ai-proxy.js', import.meta.url), 'utf8');
  assert.match(proxy, /scope === 'market' \? 'market' : scope === 'sector' \? `sector-\$\{id\}`/);
});

test('core profit drops one-off items, so a gain from selling an asset is not growth', () => {
  // نادك 2024: صافي 775 وربح السهم 2.57، وقبل البنود الاستثنائية 1.39.
  assert.equal(Math.round(coreProfit({ netProfit: 774.63, eps: 2.57, epsBeforeExceptional: 1.39 })), 419);
  assert.equal(Math.round(coreProfit({ netProfit: -285, eps: -1.34, epsBeforeExceptional: -0.48 })), -102, 'one-off losses are added back');
  assert.equal(coreProfit({ netProfit: 100, eps: 1, epsBeforeExceptional: 1 }), 100);
  assert.equal(coreProfit({ netProfit: 100 }), 100, 'no exceptional figure: net profit');
  assert.equal(coreProfit({ netProfit: 821.7, eps: 9.75, epsBeforeExceptional: 9.75 }), 821.7, 'EPS in halalas does not matter');
  assert.equal(coreProfit({ netProfit: -187, ffo: 21.8 }), 21.8, 'REITs use FFO');
});

test('forecasts grow core profit, not a year inflated by a one-off gain', () => {
  const v = (rev, op, np, eps, be) => ({ revenue: rev, operatingIncome: op, netProfit: np, eps, epsBeforeExceptional: be });
  const years = [
    { year: 2022, values: v(1000, 120, 100, 1, 1) },
    { year: 2023, values: v(1100, 130, 110, 1.1, 1.1) },
    { year: 2024, values: v(1200, 140, 400, 4, 1.2) },   // ربح بيع أصل 280
    { year: 2025, values: v(1300, 150, 130, 1.3, 1.3) },
  ];
  const quarters = ['2025Q1', '2025Q2', '2025Q3', '2025Q4'].map(q => [q, v(325, 37.5, 32.5, 0.325, 0.325)]);
  const st = { price: 20, shares: 100e6, pe: 15, dividendYield: 2, priceDate: '2026-11-19' };
  const { lines, facts } = forecastSection({ st, sectorPe: 15, years, quarters });
  const text = lines.join('\n');
  assert.match(text, /2024: 400 ← 120 \(استثنائي \+280\)/);
  assert.ok(Math.abs(facts.coreEps - 1.3) < 1e-9);
  assert.ok(facts.growth.base <= facts.revCagr3 + 0.03 + 1e-9, 'base growth capped by revenue growth');
  assert.ok(facts.growth.base < 0.15);
  assert.ok(facts.scenarios.bear.price3 < facts.scenarios.base.price3 && facts.scenarios.base.price3 < facts.scenarios.bull.price3);
  assert.match(text, /السيناريو \| ربح السهم الأساسي 2029/);

  // ربح أساسي يفوق التشغيلي: تنبيه دخل من خارج النشاط.
  const holding = forecastSection({ st, sectorPe: 15, years: years.map(y => ({ ...y, values: { ...y.values, operatingIncome: 50 } })), quarters });
  assert.ok(holding.facts.flags.includes('nonOperating'));
  // شركة خاسرة أساسيًا: لا توقع بالمكرر.
  const loss = forecastSection({ st, sectorPe: 15, years, quarters: quarters.map(([q]) => [q, v(300, -5, -10, -0.1, -0.1)]) });
  assert.equal(loss.facts.scenarios, null);
  assert.match(loss.lines.join('\n'), /لا توقع سعري/);
});

test('the analyst asks for depth, earnings quality and forecasts, and picks candidates in two stages', () => {
  assert.match(SYSTEM_PROMPT, /الربح الأساسي/);
  assert.match(SYSTEM_PROMPT, /لا يوجد محفز معلن في البيانات/);
  assert.doesNotMatch(SYSTEM_PROMPT, /اكتب بنقاط قصيرة/);
  assert.match(PICK_PROMPT, /CANDIDATES: 1234,5678/);
  assert.match(DEEP_PROMPT, /## المحفظة/);
  const page = read('ai-analyst.html');
  assert.match(page, /function parsePicks\(/);
  assert.match(page, /deep: packs\.map\(p => p\.symbol\)/);
  assert.match(page, /محفظة 3 سنوات/);
  const proxy = readFileSync(new URL('../worker/ai-proxy.js', import.meta.url), 'utf8');
  assert.match(proxy, /\.slice\(0, 8\)/, 'at most eight candidates');
  assert.match(proxy, /pack\.deep/);
});

// مواعيد إعلان النتائج (dist/earnings-calendar): يعرفها المحلل في ملف الشركة وجداول القطاع والسوق.
const cal = (s, n, next, recs, extra = {}) => ({ s, n, sec: 'الاسمنت', fye: 12, rel: -4, rank: 1, peers: 2, bt: { n: 6, w7: 83, med: 3 }, next, recs, ...extra });
const rec = (fy, q, pe, d, extra = {}) => ({ fy, q, pe, d, tm: '08:05', lag: Math.round((Date.parse(d) - Date.parse(pe)) / 864e5), src: 'tadawul', sp: '', rx: 1.5, yoy: 12, ...extra });
const nextQ4 = { fy: 2026, q: 4, pe: '2026-12-31', d: '2027-02-25', lo: '2027-02-22', hi: '2027-03-01', conf: 'عالية', n: 3, m: 'company' };

test('the company pack carries the expected results date, its range and the announcement history', () => {
  const c = cal('3010', 'أ', nextQ4, [rec(2025, 4, '2025-12-31', '2026-02-24', { rx: -2 , yoy: -5 }), rec(2026, 3, '2026-09-30', '2026-11-03')]);
  const ed = earningsSection(c, { today: '2026-11-22' });
  const text = ed.lines.join('\n');
  assert.match(text, /تقدير من سجل الشركة وليس موعدًا رسميًا/);
  assert.match(text, /الفترة القادمة: الربع الرابع والنتائج السنوية 2026 \(تنتهي 2026-12-31\)\. الموعد المتوقع 2027-02-25 \(بعد 95 يومًا\) · النطاق التاريخي 2027-02-22 إلى 2027-03-01 · الثقة عالية/);
  assert.match(text, /آخر إعلان نتائج: الربع الثالث 2026 في 2026-11-03 الساعة 08:05، بعد 34 يومًا/);
  assert.match(text, /أبكر من وسيط السوق بنحو 4 أيام · ترتيبها في سرعة الإعلان داخل القطاع 1 من 2/);
  assert.match(text, /عند نمو الربح سنويًا \+1\.5% · عند تراجعه -2\.0%/);
  assert.match(text, /^الربع الثالث 2026 \| 2026-11-03 \| 34 \| \+12\.0% \| \+1\.5%$/m);
  assert.equal(ed.facts.late, false);
  // موعد تجاوز نطاقه بلا إعلان
  assert.equal(earningsSection(c, { today: '2027-03-05' }).facts.late, true);
  assert.equal(earningsSection(null), null);

  const sector = { name: 'الاسمنت', stocks: [{ symbol: '3010', name: 'أ', pe: 10 }] };
  const pack = buildPack({ stock: sector.stocks[0], sector, earnings: c, today: '2026-11-22' });
  assert.match(pack.text, /مواعيد إعلان النتائج \(حتى 2026-11-22/);
  assert.ok(pack.sources.some(([name]) => name === 'مواعيد إعلان النتائج'));
  const sum = companySummary(sector.stocks[0], pack);
  assert.equal(sum.nextResults, '2027-02-25');
  assert.equal(sum.lastResults, '2026-11-03');
  const rows = [{ st: sector.stocks[0], pack, sum }];
  assert.match(buildSectorPack(sector, 'cement', rows, { asOf: '2026-11-19' }).text, /\| آخر إعلان نتائج \| النتائج القادمة \(متوقع\)[\s\S]*\| 2026-11-03 \| 2027-02-25$/m);
  const mkt = buildMarketPack({ asOf: '2026-11-19', sectors: [sector] }, [{ sector, slug: 'cement', rows }], { calendar: calendarSection([c], { today: '2026-11-22' }) });
  assert.match(mkt.text, /^3010 \| أ \|.*\| 2027-02-25$/m);
  assert.match(mkt.text, /روزنامة إعلان النتائج/);
});

test('the market calendar lists the season, recent, late and upcoming announcements', () => {
  const a = cal('3010', 'أ', nextQ4, [rec(2026, 3, '2026-09-30', '2026-11-12')]);
  const b = cal('3020', 'ب', { ...nextQ4, d: '2026-12-01', lo: '2026-11-15', hi: '2026-11-20', pe: '2026-09-30', q: 3 }, [rec(2026, 2, '2026-06-30', '2026-08-10')]);
  const c = cal('3030', 'ج', { ...nextQ4, d: '2026-12-20' }, [rec(2026, 3, '2026-09-30', '2026-10-25')]);
  const text = calendarSection([a, b, c], { today: '2026-11-22' }).lines.join('\n');
  assert.match(text, /موسم الفترة المنتهية 2026-09-30: أعلنت 2 من 3 شركة/);
  assert.match(text, /أعلنت خلال آخر 14 يومًا \(1\): أ \(3010\) 2026-11-12/);
  assert.match(text, /متأخرة عن نطاقها المعتاد ولم يصل إعلانها: ب \(3020\) \(الربع الثالث 2026، المعتاد 2026-11-15 إلى 2026-11-20\)/);
  // أول المتوقعين لكل فترة، ثم القائمة بالتاريخ مع اسم الفترة
  assert.match(text, /^  الربع 3 2026 \(1 شركة\): ب \(3020\) 2026-12-01 \[عالية\]$/m);
  assert.match(text, /^  الربع الرابع\/السنوية 2026 \(2 شركة\): ج \(3030\) 2026-12-20 \[عالية\] · أ \(3010\) 2027-02-25 \[عالية\]$/m);
  assert.match(text, /^  2026-12-20: ج \(3030\) \[الربع الرابع\/السنوية 2026، عالية\]$/m);
  assert.match(text, /المتوقع حسب التاريخ \(أول 3 من 3/);
  assert.equal(calendarSection([]), null);
});

test('the analyst is told how to answer results-date questions and offers them as quick questions', () => {
  assert.match(SYSTEM_PROMPT, /مواعيد النتائج: عند السؤال عن موعد إعلان نتائج شركة/);
  assert.match(SYSTEM_PROMPT, /تقدير من سجل الشركة لا موعد رسمي معلن/);
  assert.match(SYSTEM_PROMPT, /نتائج الربع الرابع تُعلن مع النتائج السنوية/);
  assert.match(read('ai-analyst.html'), /fetch\(path, \{ cache: "no-cache" \}\)/, 'packs are revalidated, never served stale');
  const page = read('ai-analyst.html');
  for (const label of ['روزنامة النتائج', 'مواعيد النتائج', 'موعد النتائج']) assert.match(page, new RegExp(`\\["${label}","`));
  const build = readFileSync(new URL('../scripts/build-ai-packs.mjs', import.meta.url), 'utf8');
  assert.match(build, /readJSON\(`earnings-calendar\/\$\{sym\}\.json`\)/);
  const mcp = readFileSync(new URL('../mcp/saudi_sectors_mcp.py', import.meta.url), 'utf8');
  assert.match(mcp, /fetch\(f"earnings-calendar\/\{sym\}\.json"\)/);
});

// الأداء منذ الإدراج (dist/since-listing.json): يعرفه المحلل في ملف الشركة وجداول القطاع والسوق.
test('the analyst knows each stock\'s performance since listing, with and without dividends', () => {
  const since = { listed: '2019-12-11', base: '2019-12-11', last: '2026-11-24', close: 26.3, years: 6.95, complete: true, priceReturn: -9.62, totalReturn: 23.75, priceCagr: -1.44, totalCagr: 3.11, priceValue: 904, totalValue: 1238, source: 'tradingview' };
  const sector = { name: 'الطاقة', stocks: [{ symbol: '2222', name: 'أرامكو', pe: 16, marketCap: 6e6 }] };
  const pack = buildPack({ stock: sector.stocks[0], sector, since });
  assert.match(pack.text, /الأداء منذ الإدراج \(من افتتاح أول جلسة 2019-12-11 حتى 2026-11-24، 7 سنة\): بدون التوزيعات -9\.6% \(سنويًا -1\.4%\) · مع إعادة استثمار التوزيعات \+23\.8% \(سنويًا \+3\.1%\)/);
  assert.match(pack.text, /الأساس سعر افتتاح أول جلسة \(في الغالب سعر الطرح/);
  assert.ok(pack.sources.some(([name]) => name === 'الأداء منذ الإدراج'));
  const sum = companySummary(sector.stocks[0], pack);
  const rows = [{ st: sector.stocks[0], pack, sum }];
  assert.match(buildSectorPack(sector, 'energy', rows, { asOf: '2026-11-24' }).text, /\| منذ الإدراج% سعري\/مع التوزيعات \|[\s\S]*\| -9\.6%\/\+23\.8% \|/);
  assert.match(buildMarketPack({ asOf: '2026-11-24', sectors: [sector] }, [{ sector, slug: 'energy', rows }], {}).text, /^2222 \| أرامكو \|.*\| -9\.6%\/\+23\.8% \|/m);
  // يبدأ بعد الإدراج: يقول ذلك صراحة ويعلّم الخلية بسنة البداية
  const old = sinceListingSection({ ...since, listed: '1988-12-01', base: '1999-01-10', complete: false });
  assert.match(old.line, /الأداء منذ 1999-01-10 \(أقدم جلسة متاحة، والإدراج 1988-12-01؛ ليس منذ الإدراج الفعلي/);
  assert.equal(sinceListingSection(null), null);
  assert.match(SYSTEM_PROMPT, /الأداء منذ الإدراج: عند السؤال عن أداء السهم التاريخي/);
  const page = read('ai-analyst.html');
  for (const label of ['الأداء منذ الإدراج', 'الأفضل منذ الإدراج']) assert.match(page, new RegExp(`\\["${label}","`));
  const build = readFileSync(new URL('../scripts/build-ai-packs.mjs', import.meta.url), 'utf8');
  assert.match(build, /readJSON\('since-listing\.json'\)/);
  const mcp = readFileSync(new URL('../mcp/saudi_sectors_mcp.py', import.meta.url), 'utf8');
  assert.match(mcp, /fetch\("since-listing\.json"\)/);
});

#!/usr/bin/env node
// يبني ملفًا مختصرًا لكل شركة في dist/ai/<الرمز>.json لصفحة «المحلل الذكي».
// الفكرة: النموذج لا يبحث ولا يستدعي أدوات؛ يصله مع كل سؤال جدول نصي قصير
// بالأرقام المهمة فقط (≈ 1000 توكن بدل ≈ 9000 للملفات الخام).
// يعمل بعد تحديث الأسعار وقبل رفع الموقع، والملفات لا تُحفظ في git.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECTOR_SLUGS = {
  'المنتجات الزجاجية': 'glass', 'الخدمات المالية': 'financial-services', 'الاتصالات': 'telecom',
  'السلع الاستهلاكية': 'consumer', 'التمويل': 'finance', 'أسواق الاوراق المالية': 'exchange',
  'خدمات الرعاية الصحية': 'healthservices', 'المواد الاساسية': 'materials', 'البنوك': 'banks',
  'البتروكيماويات': 'petrochem', 'النفط و الغاز': 'oilgas', 'الاسمنت': 'cement', 'تجارة و تجزئة': 'retail',
  'موردي الادوية': 'pharma', 'المراكز الرياضية': 'sports', 'الرعاية الصحية': 'health',
  'التعليم و التدريب': 'education', 'الأغذية والمشروبات': 'food', 'الزراعة': 'agriculture',
  'متعددة الأنشطة': 'multi', 'المرافق والطاقة': 'utilities', 'التأمين': 'insurance',
  'الصناعات التحويلية': 'industrial', 'التعدين والمعادن': 'mining', 'الصناديق العقارية المتداولة': 'reits',
  'العقارات': 'realestate', 'النقل': 'transport', 'وسائل الاعلام': 'media', 'الفنادق و السياحة': 'hotels-tourism',
  'تقنية المعلومات': 'information-technology', 'خدمات الاعمال': 'business-services',
};

const LABEL = {
  revenue: 'الإيرادات', grossIncome: 'مجمل الربح', operatingIncome: 'الربح التشغيلي', netProfit: 'صافي الربح',
  eps: 'ربح السهم', pe: 'المكرر', grossMargin: 'الهامش الإجمالي', operatingMargin: 'الهامش التشغيلي',
  netMargin: 'الهامش الصافي', assets: 'الأصول', financing: 'التمويل', deposits: 'الودائع',
  equity: 'حقوق المساهمين', netFinancingIncome: 'صافي دخل التمويل', provisions: 'المخصصات',
  loansToDeposits: 'القروض للودائع', returnOnEquity: 'العائد على حقوق المساهمين',
};
// أعمدة تكرر غيرها أو لا تفيد التحليل؛ حذفها يوفر توكنات.
const SKIP = /dilutedEps|epsBeforeExceptional|Share$|international|period|source/i;
const RATIO = /Margin|ToDeposits|returnOn/;

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const fmt = (v, d = 2) => (num(v) == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d }));
const pct = v => (num(v) == null ? '—' : `${(v * 100).toFixed(1)}%`);
export const estimateTokens = text => Math.round(String(text).length / 3.2);

const cell = (key, v) => (v == null ? '—' : RATIO.test(key) ? pct(v) : fmt(v, /eps/i.test(key) ? 2 : /^pe$/.test(key) ? 1 : 0));

function table(lines, title, labelHead, rows) {
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.values)))]
    .filter(k => !SKIP.test(k) && rows.some(r => num(r.values[k]) != null));
  if (!keys.length) return;
  lines.push('', `${title} (مليون ريال، الهوامش نسب):`, [labelHead, ...keys.map(k => LABEL[k] || k)].join(' | '));
  for (const r of rows) lines.push([r.label, ...keys.map(k => cell(k, num(r.values[k])))].join(' | '));
}

// الوسيط بدل المتوسط: مكرر شركة واحدة بأرباح ضئيلة لا يشوّه صورة القطاع.
function sectorMedian(stocks, key) {
  const v = stocks.map(s => num(s[key])).filter(x => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** يبني ملف الشركة من البيانات الخام. كل المدخلات اختيارية عدا stock و sector. */
export function buildPack({ stock: st, sector, profile, annual, quarterly, announcements }) {
  const lines = [];
  const sources = [];
  const stocks = sector.stocks || [];
  const avgPe = sectorMedian(stocks, 'pe');
  const avgDy = sectorMedian(stocks, 'dividendYield');

  lines.push(`الشركة: ${st.name} (${st.symbol}) | القطاع: ${sector.name}`);
  if (profile?.activity) { lines.push(`النشاط: ${profile.activity}`); sources.push(['نبذة الشركة', '']); }
  lines.push(`السعر ${fmt(st.price)} ريال بتاريخ ${st.priceDate || '—'} | التغير: يومي ${fmt(st.day)}% · منذ بداية السنة ${fmt(st.ytd)}% · 3 أشهر ${fmt(st.month3)}% · سنة ${fmt(st.year1)}% | نطاق 52 أسبوع ${fmt(st.week52Low)}–${fmt(st.week52High)}`);
  lines.push(`القيمة السوقية ${fmt(st.marketCap, 0)} مليون ريال | المكرر ${fmt(st.pe, 1)} | مضاعف القيمة الدفترية ${fmt(st.pb, 2)} | عائد التوزيع ${fmt(st.dividendYield)}% | ربح السهم (آخر 4 أرباع) ${fmt(st.eps, 3)}`);
  lines.push(`وسيط القطاع (عدد الشركات ${stocks.length}): المكرر ${fmt(avgPe, 1)} · العائد ${fmt(avgDy)}% · أداء سنة ${fmt(sectorMedian(stocks, 'year1'))}%`);
  if (st.suspended) lines.push('تنبيه: السهم موقوف عن التداول.');
  sources.push(['السعر والمكررات', st.priceDate || ''], ['وسيط القطاع', `${stocks.length} شركات`]);

  const years = (annual?.years || []).slice(-5);
  table(lines, 'النتائج السنوية', 'السنة', years.map(y => ({ label: y.year, values: y.values || {} })));
  if (years.length) sources.push(['النتائج السنوية', `${years.length} سنوات`]);

  const quarters = Object.entries(quarterly?.quarters || {}).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  table(lines, 'النتائج الربعية', 'الربع', quarters.map(([label, values]) => ({ label, values: values || {} })));
  if (quarters.length) sources.push(['النتائج الربعية', `آخر ${quarters.length} أرباع`]);

  const news = (announcements?.items || []).slice(0, 3);
  if (news.length) {
    lines.push('', 'آخر الإعلانات:');
    for (const it of news) lines.push(`- ${it.t}: ${String(it.title || '').replace(/\s+/g, ' ').slice(0, 140)}`);
    sources.push(['الإعلانات', `آخر ${news.length}`]);
  }

  const text = lines.join('\n');
  const rawTokens = estimateTokens(JSON.stringify({ stock: st, profile, annual, quarterly, announcements }));
  return {
    symbol: st.symbol, name: st.name, sector: sector.name, asOf: st.priceDate || null,
    text, tokens: estimateTokens(text), rawTokens, sources,
    // أرقام صغيرة للقراءة الآلية حين لا تتوفر خدمة الذكاء الاصطناعي.
    facts: {
      avgPe, avgDy,
      years: years.map(y => ({ year: y.year, revenue: num(y.values?.revenue), netProfit: num(y.values?.netProfit), netMargin: num(y.values?.netMargin) })),
      quarters: quarters.map(([q, v]) => [q, num(v?.netProfit)]),
    },
  };
}

function main() {
  const dist = new URL('../dist/', import.meta.url);
  const readJSON = name => {
    const file = new URL(name, dist);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  const market = readJSON('data.json');
  const profiles = readJSON('company-profiles.json') || {};
  const out = new URL('ai/', dist);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  let count = 0, tokens = 0;
  const missing = [];
  for (const sector of market.sectors) {
    const slug = SECTOR_SLUGS[sector.name];
    if (!slug) { missing.push(sector.name); continue; }
    const find = doc => (doc?.companies || doc?.banks || []);
    const annualDoc = find(readJSON(`${slug}-financials.json`));
    const quarterlyDoc = find(readJSON(`${slug}-quarterly-financials.json`));
    for (const stock of sector.stocks) {
      const sym = String(stock.symbol);
      const pack = buildPack({
        stock, sector, profile: profiles[sym],
        annual: annualDoc.find(c => String(c.symbol) === sym),
        quarterly: quarterlyDoc.find(c => String(c.symbol) === sym),
        announcements: readJSON(`announcements/${sym}.json`),
      });
      writeFileSync(new URL(`${sym}.json`, out), JSON.stringify(pack));
      count++; tokens += pack.tokens;
    }
  }
  if (missing.length) console.warn(`::warning::No financial files mapped for sectors: ${missing.join('، ')}`);
  console.log(`Wrote ${count} AI company packs (avg ≈ ${Math.round(tokens / Math.max(count, 1))} tokens each).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

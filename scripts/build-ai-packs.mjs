#!/usr/bin/env node
// يبني ملفًا مختصرًا لكل شركة في dist/ai/<الرمز>.json لصفحة «المحلل الذكي».
// الفكرة: النموذج لا يبحث ولا يستدعي أدوات؛ يصله مع كل سؤال جدول نصي قصير
// بالأرقام المهمة فقط (≈ 1000 توكن بدل ≈ 9000 للملفات الخام).
// يعمل بعد تحديث الأسعار وقبل رفع الموقع، والملفات لا تُحفظ في git.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sma, ema, rsi, macd, atr, adx, bollinger } from '../dist/scanner/indicators.mjs';
import { adjustCandles } from './adjust-dividends.mjs';

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

// دور النموذج: يُكتب داخل كل ملف حتى تستخدم الصفحة والخادم الوسيط النص نفسه.
export const SYSTEM_PROMPT = `أنت محلل مالي وفني محترف متخصص في السوق السعودي (تداول)، تكتب لمستثمر فرد بالعربية.
لديك ملف بيانات كامل عن الشركة: النشاط، السعر والمكررات، مقارنة بوسيط القطاع وأكبر المنافسين، النتائج السنوية والربعية، التوزيعات، آخر الإعلانات، والتحليل الفني (المتوسطات، الزخم، التذبذب، الدعوم والمقاومات، الأداء مقابل مؤشر تاسي، الإغلاقات الأسبوعية وآخر الجلسات).

قواعد العمل:
- اعتمد فقط على البيانات المرفقة. اذكر الأرقام وتواريخها، ولا تخترع رقمًا أو خبرًا. إذا نقصت معلومة فقل ذلك.
- اجمع بين التحليل الأساسي والفني، ووضّح هل يتفقان أم يتعارضان ولماذا.
- احسب ما تحتاجه من الأرقام المتاحة (نمو، هوامش، مقارنة ربع بربع وسنة بسنة، المسافة عن الدعم والمقاومة).
- التحليل الشامل يكون بهذه العناوين القصيرة: الخلاصة، الأداء المالي، التقييم مقارنة بالقطاع والمنافسين، التوزيعات، التحليل الفني (الاتجاه، المتوسطات، الزخم، الدعوم والمقاومات، السيولة)، المخاطر، السيناريوهات (إيجابي وسلبي مع مستويات السعر التي تؤكد كلًا منهما)، ما يجب مراقبته.
- السؤال المحدد تجيب عنه مباشرة أولًا، ثم تضيف باختصار ما يلزم من الزاوية الأخرى.
- اكتب بنقاط قصيرة واضحة وبلا مقدمات. الأرقام المالية بالمليون ريال ما لم يُذكر غير ذلك.
- يمكنك إعطاء نظرة (إيجابية أو محايدة أو سلبية) مع أسبابها، لكن لا تعطِ أمرًا مباشرًا بالشراء أو البيع.`;

const last = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
const change = (c, n) => (c.length > n && c[c.length - 1 - n] ? (c.at(-1) / c[c.length - 1 - n] - 1) * 100 : null);
const sgn = v => (num(v) == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

/** القسم الفني من الشموع اليومية (معدّلة للتوزيعات كما في الشارت) ونتيجة الماسح. */
export function technicalSection(ohlc, { signal, tasi, tasiTrend } = {}) {
  if (!ohlc?.c?.length || ohlc.c.length < 30) return null;
  const adj = adjustCandles(ohlc, ohlc.div || []);
  const { d, v } = ohlc, { o, h, l, c } = adj, n = c.length, price = c.at(-1);
  const s20 = last(sma(c, 20)), s50 = last(sma(c, 50)), s200 = last(sma(c, 200)), e20 = last(ema(c, 20));
  const r = last(rsi(c)), m = last(macd(c)), a = last(atr(h, l, c)), dx = adx(h, l, c), b = last(bollinger(c));
  const yr = Math.min(250, n - 1);
  const rets = []; for (let i = n - yr; i < n; i++) rets.push(Math.log(c[i] / c[i - 1]));
  const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((x, y) => x + (y - mean) ** 2, 0) / rets.length) * Math.sqrt(250) * 100;
  let peak = -Infinity, dd = 0; for (let i = n - yr - 1; i < n; i++) { peak = Math.max(peak, c[i]); dd = Math.min(dd, c[i] / peak - 1); }
  const hi = Math.max(...h.slice(-250)), lo = Math.min(...l.slice(-250));
  const avgV = k => { const x = v.slice(-k).filter(Number.isFinite); return x.length ? x.reduce((p, q) => p + q, 0) / x.length : null; };
  const rel = k => (tasi?.c?.length > k && change(c, k) != null ? change(c, k) - change(tasi.c, k) : null);
  const pos = (x, ref) => (ref ? `${x >= ref ? 'فوق' : 'تحت'} (${sgn((x / ref - 1) * 100)})` : '—');
  const L = [`التحليل الفني (شموع يومية معدّلة للتوزيعات حتى ${d.at(-1)}، عدد الجلسات ${n}):`];
  if (signal) L.push(`نتيجة ماسح الموقع: الاتجاه ${TREND[signal.trend] || '—'} · موقع السعر ${LEVEL[signal.levelPos] || '—'} · التقييم ${signal.score ?? '—'}/6`);
  L.push(`المتوسطات: SMA20 ${fmt(s20)} · EMA20 ${fmt(e20)} · SMA50 ${fmt(s50)} · SMA200 ${fmt(s200)} | السعر ${fmt(price)} ${pos(price, s50)} من 50 و${pos(price, s200)} من 200${s50 && s200 ? ` | 50 ${s50 > s200 ? 'فوق' : 'تحت'} 200` : ''}`);
  L.push(`الزخم: RSI14 ${fmt(r, 1)} · MACD ${fmt(m?.macd, 3)} / الإشارة ${fmt(m?.signal, 3)} / الهستوجرام ${fmt(m?.hist, 3)} · ADX14 ${fmt(last(dx.adx), 1)} (+DI ${fmt(last(dx.plusDI), 1)}، -DI ${fmt(last(dx.minusDI), 1)})`);
  if (b) L.push(`بولنجر 20: العلوي ${fmt(b.up)} · الأوسط ${fmt(b.mid)} · السفلي ${fmt(b.low)} · موقع السعر ${fmt(((price - b.low) / (b.up - b.low)) * 100, 0)}% من النطاق · العرض ${fmt(b.width * 100, 1)}%`);
  L.push(`التذبذب: ATR14 ${fmt(a)} (${fmt((a / price) * 100, 1)}% من السعر) · تذبذب سنوي ${fmt(vol, 0)}% · أقصى تراجع خلال سنة ${sgn(dd * 100)} · أعلى/أدنى سنة ${fmt(hi)}–${fmt(lo)}`);
  const sz = signal?.supportZone, rz = signal?.resistanceZone;
  if (sz || rz) L.push(`الدعوم والمقاومات (من الماسح): ${sz ? `دعم ${fmt(sz[0])}–${fmt(sz[1])} (${sz[2]} لمسات منذ ${sz[3]})` : 'لا دعم مؤكد'} · ${rz ? `مقاومة ${fmt(rz[0])}–${fmt(rz[1])} (${rz[2]} لمسات منذ ${rz[3]})` : 'لا مقاومة مؤكدة أعلاه'}`);
  L.push(`الأداء: أسبوع ${sgn(change(c, 5))} · شهر ${sgn(change(c, 21))} · 3 أشهر ${sgn(change(c, 63))} · 6 أشهر ${sgn(change(c, 126))} · سنة ${sgn(change(c, 250))} | مقابل تاسي: 3 أشهر ${sgn(rel(63))} · سنة ${sgn(rel(250))}${tasiTrend ? ` | اتجاه تاسي: ${tasiTrend}` : ''}`);
  L.push(`السيولة: متوسط الحجم 20 جلسة ${fmt(avgV(20), 0)} سهم مقابل ${fmt(avgV(60), 0)} لـ60 جلسة${signal?.avgVal20 ? ` · متوسط قيمة التداول 20 جلسة ${fmt(signal.avgVal20 / 1e6, 1)} مليون ريال` : ''}${signal?.volRatio != null ? ` · حجم آخر جلسة ÷ المتوسط ${fmt(signal.volRatio)}` : ''}`);
  if (signal?.keys) L.push('ملاحظات الماسح:', ...Object.values(signal.keys).map(([ok, text]) => `- [${ok ? 'إيجابي' : 'سلبي'}] ${text}`));
  const weeks = []; for (let i = n - 1; i >= 0 && weeks.length < 26; i -= 5) weeks.unshift(fmt(c[i]));
  L.push(`الإغلاقات الأسبوعية التقريبية (آخر 26 أسبوعًا، الأقدم أولًا): ${weeks.join('، ')}`);
  L.push('آخر 10 جلسات: التاريخ | فتح | أعلى | أدنى | إغلاق | الحجم');
  for (let i = Math.max(0, n - 10); i < n; i++) L.push([d[i], fmt(o[i]), fmt(h[i]), fmt(l[i]), fmt(c[i]), fmt(v[i], 0)].join(' | '));
  return {
    lines: L,
    facts: { sma50: s50, sma200: s200, rsi: r, macdHist: m?.hist ?? null, support: sz?.slice(0, 2) || null, resistance: rz?.slice(0, 2) || null, trend: signal?.trend || null },
  };
}
const TREND = { up: 'صاعد', side: 'عرضي / غير واضح', down: 'هابط' };
const LEVEL = { support: 'عند دعم', resistance: 'عند مقاومة', squeezed: 'بين دعم ومقاومة متقاربين', breakout: 'اختراق فوق مقاومة مكسورة', inside: 'داخل منطقة غير محسومة', open: 'فوق الدعم ولا مقاومة أعلاه', between: 'بين المستويين', none: 'بلا مستويات مؤكدة' };

/** يبني ملف الشركة من البيانات الخام. كل المدخلات اختيارية عدا stock و sector. */
export function buildPack({ stock: st, sector, profile, annual, quarterly, announcements, ohlc, signal, tasi, tasiTrend }) {
  const lines = [];
  const sources = [];
  const stocks = sector.stocks || [];
  const avgPe = sectorMedian(stocks, 'pe');
  const avgDy = sectorMedian(stocks, 'dividendYield');

  lines.push(`الشركة: ${st.name} (${st.symbol}) | القطاع: ${sector.name}`);
  if (profile?.activity) lines.push(`النشاط: ${profile.activity}`);
  if (profile?.founded || profile?.listed) lines.push(`التأسيس ${profile.founded || '—'} · الإدراج ${profile.listed || '—'}`);
  if (profile) sources.push(['نبذة الشركة', '']);
  lines.push(`السعر ${fmt(st.price)} ريال بتاريخ ${st.priceDate || '—'} | التغير: يومي ${fmt(st.day)}% · منذ بداية السنة ${fmt(st.ytd)}% · 3 أشهر ${fmt(st.month3)}% · 6 أشهر ${fmt(st.month6)}% · سنة ${fmt(st.year1)}% | نطاق 52 أسبوع ${fmt(st.week52Low)}–${fmt(st.week52High)}`);
  lines.push(`القيمة السوقية ${fmt(st.marketCap, 0)} مليون ريال | عدد الأسهم ${fmt(st.shares / 1e6, 1)} مليون | المكرر ${fmt(st.pe, 1)} | القيمة الدفترية للسهم ${fmt(st.bookValue)} | مضاعف القيمة الدفترية ${fmt(st.pb, 2)} | عائد التوزيع ${fmt(st.dividendYield)}% | ربح السهم (آخر 4 أرباع) ${fmt(st.eps, 3)} | قيمة تداول آخر جلسة ${fmt(st.tradedValue / 1e6, 1)} مليون ريال`);
  lines.push(`وسيط القطاع (عدد الشركات ${stocks.length}): المكرر ${fmt(avgPe, 1)} · مضاعف الدفترية ${fmt(sectorMedian(stocks, 'pb'), 2)} · العائد ${fmt(avgDy)}% · أداء سنة ${fmt(sectorMedian(stocks, 'year1'))}%`);
  const byCap = [...stocks].filter(s => num(s.marketCap) != null).sort((a, b) => b.marketCap - a.marketCap);
  const rank = byCap.findIndex(s => s.symbol === st.symbol);
  const peers = byCap.filter(s => s.symbol !== st.symbol).slice(0, 5);
  if (peers.length) {
    lines.push(`ترتيب الشركة بالقيمة السوقية في القطاع: ${rank + 1} من ${byCap.length}. أكبر المنافسين: الاسم | القيمة السوقية | المكرر | مضاعف الدفترية | العائد | أداء سنة`);
    for (const p of peers) lines.push(`${p.name} (${p.symbol}) | ${fmt(p.marketCap, 0)} | ${fmt(p.pe, 1)} | ${fmt(p.pb, 2)} | ${fmt(p.dividendYield)}% | ${fmt(p.year1)}%`);
  }
  if (st.suspended) lines.push('تنبيه: السهم موقوف عن التداول.');
  sources.push(['السعر والمكررات', st.priceDate || ''], ['القطاع والمنافسون', `${stocks.length} شركات`]);

  const years = (annual?.years || []).slice(-6);
  table(lines, 'النتائج السنوية', 'السنة', years.map(y => ({ label: y.year, values: y.values || {} })));
  if (years.length) sources.push(['النتائج السنوية', `${years.length} سنوات`]);

  const quarters = Object.entries(quarterly?.quarters || {}).sort(([a], [b]) => a.localeCompare(b)).slice(-8);
  table(lines, 'النتائج الربعية', 'الربع', quarters.map(([label, values]) => ({ label, values: values || {} })));
  if (quarters.length) sources.push(['النتائج الربعية', `آخر ${quarters.length} أرباع`]);

  const divs = (ohlc?.div || []).slice(-8);
  if (divs.length) {
    lines.push('', `التوزيعات النقدية (آخر ${divs.length}، ريال للسهم بتاريخ الاستحقاق): ${divs.map(([dt, amt]) => `${dt}: ${fmt(amt, 3)}`).join(' · ')}`);
    sources.push(['التوزيعات', `آخر ${divs.length}`]);
  }

  const news = (announcements?.items || []).slice(0, 5);
  if (news.length) {
    lines.push('', 'آخر الإعلانات (الأحدث أولًا):');
    news.forEach((it, i) => {
      lines.push(`- ${it.t}: ${String(it.title || '').replace(/\s+/g, ' ').slice(0, 160)}`);
      if (i < 2 && it.body) lines.push(`  مقتطف: ${String(it.body).replace(/\s+/g, ' ').slice(0, 350)}`);
    });
    sources.push(['الإعلانات', `آخر ${news.length}`]);
  }

  const tech = technicalSection(ohlc, { signal, tasi, tasiTrend });
  if (tech) { lines.push('', ...tech.lines); sources.push(['التحليل الفني', `${ohlc.c.length} جلسة`]); }

  const text = lines.join('\n');
  const rawTokens = estimateTokens(JSON.stringify({ stock: st, profile, annual, quarterly, announcements, ohlc, signal }));
  return {
    symbol: st.symbol, name: st.name, sector: sector.name, asOf: st.priceDate || null,
    system: SYSTEM_PROMPT, text, tokens: estimateTokens(SYSTEM_PROMPT + text), rawTokens, sources,
    // أرقام صغيرة للقراءة الآلية حين لا يكون الذكاء الاصطناعي مفعّلًا.
    facts: {
      avgPe, avgDy, tech: tech?.facts || null,
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
  const scanner = readJSON('scanner/signals.json');
  const tasi = readJSON('ohlc/TASI.json');
  const tasiTrend = scanner?.meta?.tasi?.detail || null;
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
        ohlc: readJSON(`ohlc/${sym}.json`), signal: scanner?.stocks?.[sym], tasi, tasiTrend,
      });
      writeFileSync(new URL(`${sym}.json`, out), JSON.stringify(pack));
      count++; tokens += pack.tokens;
    }
  }
  if (missing.length) console.warn(`::warning::No financial files mapped for sectors: ${missing.join('، ')}`);
  console.log(`Wrote ${count} AI company packs (avg ≈ ${Math.round(tokens / Math.max(count, 1))} tokens each).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

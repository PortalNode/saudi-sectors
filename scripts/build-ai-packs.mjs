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
تصلك البيانات بحسب نطاق السؤال: جدول السوق كاملًا (كل الشركات مجمعة حسب القطاع مع مؤشر تاسي)، أو جدول قطاع كامل، أو ملف شركة كامل (النشاط، المكررات، المنافسون، النتائج السنوية والربعية، التوزيعات، الإعلانات، والتحليل الفني). وقد تصلك ملفات إضافية لشركات ذكرها السائل.

قواعد العمل:
- اعتمد فقط على البيانات المرفقة. اذكر الأرقام وتواريخها، ولا تخترع رقمًا أو خبرًا. إذا نقصت معلومة أو كان السؤال خارج البيانات فقل ذلك، واقترح النطاق الأنسب (السوق أو القطاع أو الشركة).
- اجمع بين التحليل الأساسي والفني، ووضّح هل يتفقان أم يتعارضان ولماذا.
- احسب ما تحتاجه من الأرقام المتاحة (نمو، هوامش، مقارنات، متوسطات، المسافة عن الدعم والمقاومة).
- أسئلة الترتيب والبحث في السوق أو القطاع (الأرخص، الأعلى عائدًا، الأسرع نموًا، الأقوى فنيًا...): اذكر المعيار الذي رتّبت به، وأعطِ قائمة مرقمة أو جدولًا قصيرًا (عادة أفضل 5 إلى 10) مع الأرقام والقطاع، ثم تعليقًا قصيرًا على أبرزها وما يجب الحذر منه.
- «الأرخص» تعني التقييم (المكرر ومضاعف القيمة الدفترية) لا سعر السهم، ما لم يقصد السائل سعر السهم صراحة. استبعد من ترتيب المكرر الشركات الخاسرة أو بلا مكرر، واذكر أن المكرر المنخفض جدًا قد يكون بسبب أرباح غير متكررة أو تراجع متوقع.
- عند تحليل قطاع: الصورة العامة (التقييم، الأداء، النمو، الاتجاه الفني)، ثم الأفضل والأضعف وأسباب ذلك، ثم الفرص والمخاطر.
- التحليل الشامل لشركة يكون بهذه العناوين القصيرة: الخلاصة، الأداء المالي، التقييم مقارنة بالقطاع والمنافسين، التوزيعات، التحليل الفني (الاتجاه، المتوسطات، الزخم، الدعوم والمقاومات، السيولة)، المخاطر، السيناريوهات (إيجابي وسلبي مع مستويات السعر التي تؤكد كلًا منهما)، ما يجب مراقبته.
- السؤال المحدد تجيب عنه مباشرة أولًا، ثم تضيف باختصار ما يلزم من الزاوية الأخرى.
- اكتب بنقاط قصيرة واضحة وبلا مقدمات. الأرقام المالية بالمليون ريال ما لم يُذكر غير ذلك.
- يمكنك إعطاء نظرة (إيجابية أو محايدة أو سلبية) مع أسبابها، لكن لا تعطِ أمرًا مباشرًا بالشراء أو البيع.

تنسيق الإجابة (مهم):
- اكتب كل الأرقام بالأرقام الإنجليزية 0123456789، ولا تستخدم الأرقام العربية ٠١٢٣٤٥٦٧٨٩ أبدًا. علامة النسبة بعد الرقم مثل 12.5% و-3.2%.
- لا تستخدم علامات التنصيص « » أو " " إطلاقًا، ولا النجمة * للحواشي، ولا الرموز التعبيرية. للتأكيد استخدم **العريض** فقط وبقلة.
- العناوين تبدأ بـ ## والنقاط بـ - والقوائم المرتبة بـ 1. 2. 3. ولا تضع خطوطًا فاصلة.
- الجدول بصيغة Markdown صحيحة: سطر العناوين، ثم سطر |---|---|، ثم صف لكل عنصر مباشرة بلا أسطر فارغة بين الصفوف. لا يزيد عن 7 أعمدة بعناوين قصيرة، والرمز والاسم في عمودين منفصلين، وكل خلية فيها قيمة واحدة. ضع الملاحظات تحت الجدول في نقاط لا داخل الخلايا.
- اجعل الجمل قصيرة، وابدأ بالخلاصة.`;

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
    facts: { sma50: s50, sma200: s200, rsi: r, macdHist: m?.hist ?? null, support: sz?.slice(0, 2) || null, resistance: rz?.slice(0, 2) || null, trend: signal?.trend || null, score: signal?.score ?? null, price },
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
    scope: 'company', symbol: st.symbol, name: st.name, sector: sector.name, asOf: st.priceDate || null,
    system: SYSTEM_PROMPT, text, tokens: estimateTokens(SYSTEM_PROMPT + text), rawTokens, sources,
    // أرقام صغيرة للقراءة الآلية حين لا يكون الذكاء الاصطناعي مفعّلًا.
    facts: {
      avgPe, avgDy, tech: tech?.facts || null,
      years: years.map(y => ({ year: y.year, revenue: num(y.values?.revenue), netProfit: num(y.values?.netProfit), netMargin: num(y.values?.netMargin) })),
      quarters: quarters.map(([q, v]) => [q, num(v?.netProfit)]),
    },
  };
}

/* ---------- ملفات القطاع والسوق: صف مختصر لكل شركة ---------- */
const TREND_SHORT = { up: 'صاعد', side: 'عرضي', down: 'هابط' };
const growth = (x, y) => (num(x) == null || num(y) == null ? '—' : y > 0 && x < 0 ? 'تحوّل لخسارة' : y < 0 && x > 0 ? 'تحوّل لربح' : y < 0 && x < 0 ? (x > y ? 'خسارة أقل' : 'خسارة أكبر') : y === 0 ? '—' : sgn((x / y - 1) * 100));

/** أرقام صف الشركة في جداول القطاع والسوق، من ملف الشركة نفسه. */
export function companySummary(st, pack) {
  const f = pack?.facts || {}, ys = f.years || [], y1 = ys.at(-1) || {}, y0 = ys.at(-2) || {};
  const qs = f.quarters || [], q1 = qs.at(-1), q0 = qs.length >= 5 ? qs.at(-5) : null, t = f.tech || {};
  return {
    year: y1.year ?? '—', revenue: y1.revenue, netProfit: y1.netProfit, netMargin: y1.netMargin,
    profitGrowth: growth(y1.netProfit, y0.netProfit), revenueGrowth: growth(y1.revenue, y0.revenue),
    lastQ: q1?.[0] ?? '—', lastQProfit: q1?.[1], lastQYoY: q1 && q0 ? growth(q1[1], q0[1]) : '—',
    trend: TREND_SHORT[t.trend] || '—', rsi: t.rsi, vs200: t.sma200 && t.price ? (t.price / t.sma200 - 1) * 100 : null,
    score: t.score, support: t.support, resistance: t.resistance,
  };
}

function sectorHeader(sector, marketCapTotal) {
  const st = sector.stocks, cap = st.reduce((a, s) => a + (num(s.marketCap) || 0), 0);
  return `${sector.name}: عدد الشركات ${st.length} · القيمة السوقية ${fmt(cap / 1000, 1)} مليار ريال${marketCapTotal ? ` (${fmt((cap / marketCapTotal) * 100, 2)}% من السوق)` : ''} · وسيط المكرر ${fmt(sectorMedian(st, 'pe'), 1)} · وسيط مضاعف الدفترية ${fmt(sectorMedian(st, 'pb'), 2)} · وسيط العائد ${fmt(sectorMedian(st, 'dividendYield'))}% · وسيط الأداء منذ بداية السنة ${fmt(sectorMedian(st, 'ytd'))}% · وسيط أداء سنة ${fmt(sectorMedian(st, 'year1'))}%`;
}

export function buildSectorPack(sector, slug, rows, { asOf, tasiLine } = {}) {
  const L = [`جدول قطاع ${sector.name} كاملًا (الأسعار حتى ${asOf || '—'}). الأرقام المالية بالمليون ريال، والنسب المئوية للأداء.`, sectorHeader(sector)];
  if (tasiLine) L.push(tasiLine);
  L.push('', 'الرمز | الشركة | السعر | القيمة السوقية | المكرر | مضاعف الدفترية | العائد% | يومي% | منذ بداية السنة% | سنة% | السنة المالية | الإيرادات | نمو الإيرادات | صافي الربح | نمو الربح | الهامش الصافي | آخر ربع | ربح آخر ربع | تغيره عن نفس الربع | الاتجاه | RSI | مقابل متوسط 200 | تقييم الماسح من 6 | الدعم | المقاومة');
  for (const { st, sum } of [...rows].sort((a, b) => (b.st.marketCap || 0) - (a.st.marketCap || 0))) {
    L.push([st.symbol, st.name, fmt(st.price), fmt(st.marketCap, 0), fmt(st.pe, 1), fmt(st.pb, 2), fmt(st.dividendYield), fmt(st.day), fmt(st.ytd), fmt(st.year1),
      sum.year, fmt(sum.revenue, 0), sum.revenueGrowth, fmt(sum.netProfit, 0), sum.profitGrowth, num(sum.netMargin) == null ? '—' : pct(sum.netMargin),
      sum.lastQ, fmt(sum.lastQProfit, 0), sum.lastQYoY, sum.trend, fmt(sum.rsi, 0), sgn(sum.vs200), sum.score ?? '—',
      sum.support ? `${fmt(sum.support[0])}–${fmt(sum.support[1])}` : '—', sum.resistance ? `${fmt(sum.resistance[0])}–${fmt(sum.resistance[1])}` : '—'].join(' | ') + (st.suspended ? ' | موقوف' : ''));
  }
  const text = L.join('\n');
  return { scope: 'sector', id: slug, name: sector.name, asOf, system: SYSTEM_PROMPT, text, tokens: estimateTokens(SYSTEM_PROMPT + text),
    rawTokens: rows.reduce((n, r) => n + (r.pack?.rawTokens || 0), 0), sources: [['جدول القطاع', `${rows.length} شركة`], ['النتائج والتحليل الفني', 'لكل شركة']] };
}

export function buildMarketPack(market, groups, { tasiLine, tasiTech } = {}) {
  const total = market.sectors.reduce((a, s) => a + s.stocks.reduce((b, x) => b + (num(x.marketCap) || 0), 0), 0);
  const all = groups.flatMap(g => g.rows.length ? g.rows : []);
  const L = [`جدول السوق السعودي كاملًا (الأسعار حتى ${market.asOf || '—'}، ${all.length} شركة في ${groups.length} قطاعًا). القيمة السوقية وصافي الربح بالمليون ريال، والأداء بالنسبة المئوية.`];
  if (tasiLine) L.push(tasiLine);
  L.push(`القيمة السوقية للسوق ${fmt(total / 1e6, 2)} تريليون ريال · وسيط المكرر ${fmt(sectorMedian(all.map(r => r.st), 'pe'), 1)} · وسيط العائد ${fmt(sectorMedian(all.map(r => r.st), 'dividendYield'))}%`);
  L.push('', 'الأعمدة: الرمز | الشركة | السعر | القيمة السوقية | المكرر | مضاعف الدفترية | العائد% | يومي% | منذ بداية السنة% | سنة% | صافي ربح آخر سنة (السنة) | نمو الربح | تغير ربح آخر ربع عن نفس الربع | الاتجاه | RSI | مقابل متوسط 200 | تقييم الماسح من 6');
  for (const { sector, rows } of groups) {
    L.push('', `## ${sectorHeader(sector, total)}`);
    for (const { st, sum } of [...rows].sort((a, b) => (b.st.marketCap || 0) - (a.st.marketCap || 0))) {
      L.push([st.symbol, st.name, fmt(st.price), fmt(st.marketCap, 0), fmt(st.pe, 1), fmt(st.pb, 2), fmt(st.dividendYield), fmt(st.day), fmt(st.ytd), fmt(st.year1),
        `${fmt(sum.netProfit, 0)} (${sum.year})`, sum.profitGrowth, sum.lastQYoY, sum.trend, fmt(sum.rsi, 0), sgn(sum.vs200), sum.score ?? '—'].join(' | ') + (st.suspended ? ' | موقوف' : ''));
    }
  }
  if (tasiTech) L.push('', 'مؤشر تاسي فنيًا:', ...tasiTech.lines.filter(l => !/^\d{4}-\d\d-\d\d \|/.test(l) && !l.startsWith('آخر 10 جلسات')).map(l => l.replace(/ \| مقابل تاسي:[^|]*/, '')));
  const text = L.join('\n');
  return { scope: 'market', id: 'market', name: 'السوق كامل', asOf: market.asOf, sectors: groups.map(g => [g.slug, g.sector.name, g.rows.length]), system: SYSTEM_PROMPT, text, tokens: estimateTokens(SYSTEM_PROMPT + text),
    rawTokens: all.reduce((n, r) => n + (r.pack?.rawTokens || 0), 0), sources: [['كل الشركات', `${all.length} شركة`], ['القطاعات', `${groups.length}`], ['مؤشر تاسي', market.asOf || '']] };
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
  const missing = [], groups = [];
  const ms = market.marketSummary || {};
  const tasiLine = `مؤشر تاسي: ${fmt(ms.value)} نقطة (${fmt(ms.day)}% اليوم) · منذ بداية السنة ${fmt(ms.ytd)}% · 3 أشهر ${fmt(ms.month3)}% · 6 أشهر ${fmt(ms.month6)}% · سنة ${fmt(ms.year1)}% · قيمة التداول ${fmt((ms.turnover || 0) / 1e9, 2)} مليار ريال${tasiTrend ? ` · ${tasiTrend}` : ''}`;
  for (const sector of market.sectors) {
    const slug = SECTOR_SLUGS[sector.name];
    if (!slug) { missing.push(sector.name); continue; }
    const find = doc => (doc?.companies || doc?.banks || []);
    const annualDoc = find(readJSON(`${slug}-financials.json`));
    const quarterlyDoc = find(readJSON(`${slug}-quarterly-financials.json`));
    const rows = [];
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
      rows.push({ st: stock, pack, sum: companySummary(stock, pack) });
    }
    groups.push({ sector, slug, rows });
    writeFileSync(new URL(`sector-${slug}.json`, out), JSON.stringify(buildSectorPack(sector, slug, rows, { asOf: market.asOf, tasiLine })));
  }
  const marketPack = buildMarketPack(market, groups, { tasiLine, tasiTech: technicalSection(tasi) });
  writeFileSync(new URL('market.json', out), JSON.stringify(marketPack));
  console.log(`Market pack ≈ ${marketPack.tokens} tokens; ${groups.length} sector packs.`);
  if (missing.length) console.warn(`::warning::No financial files mapped for sectors: ${missing.join('، ')}`);
  console.log(`Wrote ${count} AI company packs (avg ≈ ${Math.round(tokens / Math.max(count, 1))} tokens each).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

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
  coreProfit: 'الربح الأساسي', gwp: 'الأقساط المكتتبة', insuranceRevenue: 'إيرادات التأمين',
  rentalIncome: 'إيرادات الإيجار', ffo: 'الأموال من العمليات FFO', ffoPerUnit: 'FFO للوحدة', units: 'عدد الوحدات',
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
const median = arr => { const v = arr.filter(x => num(x) != null).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* ---------- الربح الأساسي: صافي الربح بعد استبعاد البنود الاستثنائية ----------
   أرباح بيع أصل أو تعويض أو عكس مخصص تضخّم صافي الربح سنة واحدة، فيبدو النمو والمكرر
   أفضل مما هما. نأخذ «ربح السهم قبل البنود الاستثنائية» من أرقام (والربح المتكرر للبنوك
   وFFO للصناديق العقارية) ونحوّله إلى مبلغ بنسبة الصافي إلى ربح السهم، فلا تهم وحدة
   ربح السهم في الملف (ريال أو هللة). */
export function coreProfit(v = {}) {
  if (num(v.ffo) != null) return v.ffo;
  const np = num(v.netProfit); if (np == null) return null;
  const eps = num(v.eps), be = num(v.epsBeforeExceptional ?? v.recurringEps);
  if (eps == null || be == null || eps === be || Math.abs(eps) < 0.005) return np;
  const shares = np / eps;
  return shares > 0 ? be * shares : np;
}
const cagr = (a, b, n) => (num(a) > 0 && num(b) > 0 && n > 0 ? (b / a) ** (1 / n) - 1 : null);
const qIndex = label => { const m = /^(\d{4})Q([1-4])$/.exec(label); return m ? m[1] * 4 + (m[2] - 1) : null; };
const mn = v => `${v > 0 ? '+' : ''}${fmt(v, 0)}`;

/** جودة الأرباح والتوقعات لثلاث سنوات، محسوبة آليًا من الربح الأساسي لا الصافي المعلن. */
export function forecastSection({ st, sectorPe, years, quarters, isReit = false }) {
  const L = ['', 'جودة الأرباح والتوقعات (محسوبة آليًا من الربح الأساسي بعد استبعاد البنود الاستثنائية؛ تقديرات لا ضمانات):'];
  const facts = { coreEps: null, corePe: null, revCagr3: null, coreCagr3: null, opCagr3: null, exceptionalShare: null, growth: null, scenarios: null, flags: [] };
  const ys = years.map(y => ({ year: y.year, v: y.values || {}, core: coreProfit(y.values || {}) }));

  // سنوات فيها بنود استثنائية كبيرة (أكثر من 10% من الصافي).
  const odd = ys.filter(y => num(y.v.netProfit) != null && num(y.core) != null && Math.abs(y.v.netProfit - y.core) > Math.max(1, 0.1 * Math.abs(y.v.netProfit)));
  if (odd.length) L.push(`- سنوات فيها بنود استثنائية (الصافي المعلن ← الأساسي): ${odd.map(y => `${y.year}: ${fmt(y.v.netProfit, 0)} ← ${fmt(y.core, 0)} (استثنائي ${mn(y.v.netProfit - y.core)})`).join(' · ')}`);
  // ربح أساسي يفوق الربح التشغيلي: جزء منه من خارج النشاط (زميلة، استثمارات، عوائد ودائع).
  const nonOp = ys.filter(y => num(y.v.revenue) != null && num(y.v.operatingIncome) > 0 && y.core > y.v.operatingIncome * 1.15);
  if (nonOp.length) { facts.flags.push('nonOperating'); L.push(`- تنبيه: الربح الأساسي أعلى من الربح التشغيلي في ${nonOp.map(y => y.year).join('، ')}؛ جزء من الربح من خارج النشاط الرئيسي (شركات زميلة أو استثمارات أو عوائد ودائع) وقد لا يتكرر بالوتيرة نفسها.`); }

  // آخر 4 أرباع متتالية، وإلا آخر سنة.
  const qs = quarters.map(([label, v]) => ({ label, v: v || {}, core: coreProfit(v || {}) })).filter(q => qIndex(q.label) != null);
  const last4 = qs.slice(-4);
  const consecutive = last4.length === 4 && qIndex(last4[3].label) - qIndex(last4[0].label) === 3 && last4.every(q => num(q.core) != null && num(q.v.netProfit) != null);
  const lastYear = ys.at(-1);
  let ttmCore = null, ttmNet = null, period = '';
  if (consecutive) { ttmCore = last4.reduce((a, q) => a + q.core, 0); ttmNet = last4.reduce((a, q) => a + q.v.netProfit, 0); period = `آخر 4 أرباع ${last4[0].label}–${last4[3].label}`; }
  else if (lastYear && num(lastYear.core) != null) { ttmCore = lastYear.core; ttmNet = num(lastYear.v.netProfit); period = `سنة ${lastYear.year}`; }
  const shares = num(st.shares) > 0 ? st.shares / 1e6 : null, price = num(st.price);
  if (ttmCore != null) {
    facts.exceptionalShare = ttmNet ? (ttmNet - ttmCore) / Math.abs(ttmNet) : 0;
    L.push(`- الربح الأساسي (${period}): ${fmt(ttmCore, 0)} مليون مقابل صافي معلن ${fmt(ttmNet, 0)} مليون${Math.abs(facts.exceptionalShare) > 0.05 ? ` (بنود استثنائية ${mn(ttmNet - ttmCore)} مليون${ttmNet > 0 ? `، ${fmt(facts.exceptionalShare * 100, 0)}% من الصافي` : ''})` : ' (لا بنود استثنائية تُذكر)'}`);
    if (shares && price) {
      facts.coreEps = ttmCore / shares;
      facts.corePe = facts.coreEps > 0 ? price / facts.coreEps : null;
      L.push(`- ربح السهم الأساسي ${fmt(facts.coreEps, 3)} ريال · المكرر الأساسي ${facts.corePe ? fmt(facts.corePe, 1) : 'سالب (خسارة أساسية)'} مقابل المكرر المعلن ${fmt(st.pe, 1)} ووسيط القطاع ${fmt(sectorPe, 1)}`);
    }
  }

  // النمو المركب لثلاث سنوات (أو أقصى مدة متاحة حتى 3).
  if (ys.length >= 3) {
    const n = Math.min(3, ys.length - 1), a = ys.at(-1 - n), b = ys.at(-1);
    facts.revCagr3 = cagr(a.v.revenue ?? a.v.insuranceRevenue ?? a.v.netFinancingIncome ?? a.v.rentalIncome, b.v.revenue ?? b.v.insuranceRevenue ?? b.v.netFinancingIncome ?? b.v.rentalIncome, n);
    facts.coreCagr3 = cagr(a.core, b.core, n);
    facts.opCagr3 = num(b.v.revenue) != null ? cagr(a.v.operatingIncome, b.v.operatingIncome, n) : null;
    const s = v => (v == null ? 'غير قابل للحساب (خسارة في أحد الطرفين)' : sgn(v * 100));
    L.push(`- النمو المركب السنوي (${a.year}→${b.year}): الإيرادات ${s(facts.revCagr3)} · الربح الأساسي ${s(facts.coreCagr3)}${facts.opCagr3 != null || num(b.v.revenue) != null ? ` · الربح التشغيلي ${s(facts.opCagr3)}` : ''} · الصافي المعلن ${s(cagr(a.v.netProfit, b.v.netProfit, n))}`);
    if (lastYear && ttmCore != null && consecutive && num(lastYear.core) > 0) L.push(`- الزخم: الربح الأساسي لآخر 4 أرباع ${sgn((ttmCore / lastYear.core - 1) * 100)} عن سنة ${lastYear.year}`);
  }

  if (isReit) { L.push('- الصناديق العقارية تُقيَّم بعائد التوزيع والأموال من العمليات (FFO) لا بالمكرر، فلا توقع سعري بالمكرر هنا.'); return { lines: L, facts }; }
  if (!(facts.coreEps > 0) || !price) { L.push('- لا توقع سعري: الربح الأساسي سالب أو غير متاح، والمكرر لا يصلح لشركة خاسرة.'); return { lines: L, facts }; }

  // الفرضية الأساسية = وسيط معدلات النمو المتاحة، فلا تقودها سنة شاذة واحدة.
  const rates = [facts.revCagr3, facts.coreCagr3, facts.opCagr3].filter(x => x != null);
  if (!rates.length) { L.push('- لا توقع: لا تكفي السنوات لحساب نمو موثوق.'); return { lines: L, facts }; }
  // نمو الربح من قاعدة منخفضة (تحسّن هوامش) لا يتكرر: الأساسي لا يتجاوز نمو الإيرادات + 3 نقاط،
  // ويُخفض 4 نقاط إن تراجع الربح الأساسي لآخر 4 أرباع أكثر من 20% عن آخر سنة.
  let g = median(rates);
  if (facts.revCagr3 != null) g = Math.min(g, facts.revCagr3 + 0.03);
  const momentum = consecutive && num(lastYear?.core) > 0 ? ttmCore / lastYear.core - 1 : null;
  if (momentum != null && momentum < -0.2) g -= 0.04;
  g = clamp(g, -0.08, 0.15);
  const bear = Math.max(g - 0.08, -0.2), bull = Math.min(g + 0.06, 0.25);
  facts.growth = { bear, base: g, bull };
  const peNow = clamp(facts.corePe, 5, 40), peSec = clamp(num(sectorPe) || peNow, 6, 30);
  const multiples = { bear: Math.min(peNow, peSec) * 0.85, base: Math.sqrt(peNow * peSec), bull: Math.max(peNow, peSec) };
  const dy = (num(st.dividendYield) || 0) / 100, year = Number(String(st.priceDate || '').slice(0, 4)) || new Date().getFullYear();
  L.push(`- فرضيات النمو السنوي للربح الأساسي: متحفظ ${sgn(bear * 100)} · أساسي ${sgn(g * 100)} · متفائل ${sgn(bull * 100)} (الأساسي = وسيط نمو الإيرادات والتشغيلي والأساسي، بحد أقصى نمو الإيرادات + 3 نقاط${momentum != null && momentum < -0.2 ? '، مخفوض 4 نقاط لتراجع آخر 4 أرباع' : ''}، ومحصور بين -8% و15%)`);
  L.push(`- المكرر المفترض بعد 3 سنوات: متحفظ ${fmt(multiples.bear, 1)} (الأقل بين الحالي ووسيط القطاع مخصومًا 15%) · أساسي ${fmt(multiples.base, 1)} (بين المكرر الأساسي الحالي ووسيط القطاع) · متفائل ${fmt(multiples.bull, 1)}`);
  L.push(`السيناريو | ربح السهم الأساسي ${year + 3} | المكرر | السعر المتوقع | التغير عن ${fmt(price)} | العائد السنوي مع التوزيع`);
  facts.scenarios = {};
  for (const [k, name] of [['bear', 'متحفظ'], ['base', 'أساسي'], ['bull', 'متفائل']]) {
    const eps3 = facts.coreEps * (1 + facts.growth[k]) ** 3, p3 = eps3 * multiples[k];
    const annual = (p3 > 0 ? (p3 / price) ** (1 / 3) - 1 : -1) + dy;
    facts.scenarios[k] = { eps3, pe: multiples[k], price3: p3, annual };
    L.push(`${name} | ${fmt(eps3, 2)} | ${fmt(multiples[k], 1)} | ${fmt(p3)} | ${sgn((p3 / price - 1) * 100)} | ${sgn(annual * 100)}`);
  }
  return { lines: L, facts };
}

// دور النموذج: يُكتب داخل كل ملف حتى تستخدم الصفحة والخادم الوسيط النص نفسه.
export const SYSTEM_PROMPT = `أنت محلل مالي وفني محترف متخصص في السوق السعودي (تداول)، تكتب لمستثمر فرد بالعربية تقريرًا بمستوى محلل في بيت أبحاث.
تصلك البيانات بحسب نطاق السؤال: جدول السوق كاملًا (كل الشركات مجمعة حسب القطاع مع مؤشر تاسي)، أو جدول قطاع كامل، أو ملف شركة كامل (النشاط، المكررات، المنافسون، النتائج السنوية والربعية، جودة الأرباح والتوقعات، التوزيعات، الإعلانات، والتحليل الفني). وقد تصلك ملفات إضافية لشركات ذكرها السائل أو رُشّحت للتحليل.

قواعد العمل:
- اعتمد فقط على البيانات المرفقة. اذكر الأرقام وتواريخها، ولا تخترع رقمًا أو خبرًا أو مشروعًا أو محفزًا. إذا نقصت معلومة فقل ذلك صراحة، واقترح النطاق الأنسب (السوق أو القطاع أو الشركة).
- جودة الأرباح أولًا: احكم على النمو والتقييم بالربح الأساسي (بعد استبعاد البنود الاستثنائية) لا بصافي الربح المعلن. إذا كان نمو الصافي أو انخفاض المكرر ناتجًا عن ربح استثنائي (بيع أصل، تعويض، عكس مخصص) أو عن دخل من خارج النشاط فقل ذلك صراحة ولا تعدّه نموًا. المكرر المعلن في السوق مبني على الربح المعلن، فقارنه بالمكرر الأساسي.
- التوقعات: استخدم قسم جودة الأرباح والتوقعات المحسوب (فرضيات النمو والمكرر وسيناريوهات 3 سنوات)، واشرح افتراضاته، وقل هل تراه واقعيًا في ضوء اتجاه الأرباع الأخيرة والهوامش والإعلانات. يجوز أن تعدّل التقدير إذا ذكرت السبب من البيانات والرقم الذي اعتمدته. التوقعات تقديرات لا ضمانات.
- المحفزات تأتي فقط من نشاط الشركة وإعلاناتها المرفقة مع تاريخ الإعلان. إن لم يوجد محفز معلن فاكتب: لا يوجد محفز معلن في البيانات.
- اجمع بين التحليل الأساسي والفني، ووضّح هل يتفقان أم يتعارضان ولماذا.
- احسب ما تحتاجه من الأرقام المتاحة (نمو، هوامش، مقارنات، متوسطات، المسافة عن الدعم والمقاومة).
- أسئلة الترتيب بمعيار واضح في السوق أو القطاع (الأرخص، الأعلى عائدًا، الأسرع نموًا، الأقوى فنيًا...): اذكر المعيار، وأعطِ جدولًا (عادة أفضل 5 إلى 10) مع الأرقام والقطاع، ثم فقرة لكل من أبرز 3 فيها تشرح لماذا تستحق المكان وما يجب الحذر منه.
- «الأرخص» تعني التقييم (المكرر الأساسي ومضاعف القيمة الدفترية) لا سعر السهم، ما لم يقصد السائل سعر السهم صراحة. استبعد من ترتيب المكرر الشركات الخاسرة أو بلا مكرر، ونبّه حين يكون المكرر المعلن منخفضًا بسبب أرباح استثنائية.
- عند تحليل قطاع: الصورة العامة (التقييم، الأداء، النمو الأساسي، الاتجاه الفني)، ثم الأفضل والأضعف وأسباب ذلك، ثم الفرص والمخاطر والتوقعات.
- التحليل الشامل لشركة يكون بهذه العناوين: الخلاصة والنظرة، النشاط ومصادر الربح، الأداء المالي، جودة الأرباح، التقييم مقارنة بالقطاع والمنافسين، التوزيعات، المحفزات، التوقعات لـ3 سنوات (جدول السيناريوهات مع تعليقك)، التحليل الفني (الاتجاه، المتوسطات، الزخم، الدعوم والمقاومات، السيولة)، المخاطر وما يُبطل الفكرة، ما يجب مراقبته.
- السؤال المحدد تجيب عنه مباشرة أولًا، ثم تضيف ما يلزم من الزوايا الأخرى.
- اكتب بعمق: فسّر الأرقام ولا تكتفِ بسردها، واشرح السبب والنتيجة. لا حشو ولا مقدمات عامة. الأرقام المالية بالمليون ريال ما لم يُذكر غير ذلك.
- يمكنك إعطاء نظرة (إيجابية أو محايدة أو سلبية) مع أسبابها، لكن لا تعطِ أمرًا مباشرًا بالشراء أو البيع.

تنسيق الإجابة (مهم):
- اكتب كل الأرقام بالأرقام الإنجليزية 0123456789، ولا تستخدم الأرقام العربية ٠١٢٣٤٥٦٧٨٩ أبدًا. علامة النسبة بعد الرقم مثل 12.5% و-3.2%.
- لا تستخدم علامات التنصيص « » أو " " إطلاقًا، ولا النجمة * للحواشي، ولا الرموز التعبيرية. للتأكيد استخدم **العريض** فقط وبقلة.
- العناوين تبدأ بـ ## أو ### والنقاط بـ - والقوائم المرتبة بـ 1. 2. 3. ولا تضع خطوطًا فاصلة.
- الجدول بصيغة Markdown صحيحة: سطر العناوين، ثم سطر |---|---|، ثم صف لكل عنصر مباشرة بلا أسطر فارغة بين الصفوف. لا يزيد عن 7 أعمدة بعناوين قصيرة، والرمز والاسم في عمودين منفصلين، وكل خلية فيها قيمة واحدة. ضع الملاحظات تحت الجدول في نقاط لا داخل الخلايا.
- ابدأ بالخلاصة.`;

// المرحلة الأولى لأسئلة السوق والقطاع: إن كان السؤال ترشيحًا يرد النموذج برموز المرشحين فقط،
// فتجلب الصفحة ملفاتهم الكاملة وتعيد السؤال (المرحلة الثانية).
export const PICK_PROMPT = `مرحلة الترشيح (مهم جدًا):
إذا طلب السائل ترشيح شركات للاستثمار، أو بناء محفظة، أو أفضل شركات لفترة قادمة، أو توقعات لعدة شركات، فلا تكتب الإجابة الآن. اكتب سطرًا واحدًا فقط بهذه الصيغة ثم توقف:
CANDIDATES: 1234,5678,9012
- ضع من 6 إلى 8 رموز من الجدول، أكثر قليلًا مما طلبه السائل لتختار منها بعد قراءة ملفاتها.
- نوّع القطاعات إن طلب التنويع أو المحفظة.
- فضّل نموًا أساسيًا مركبًا متصلًا، وعائدًا متوقعًا أعلى، ومكررًا أساسيًا معقولًا، واتجاهًا فنيًا غير منهار. استبعد ما كانت جودة ربحه استثنائي إلا إذا بقي جيدًا بعد الاستبعاد.
- سيصلك بعدها الملف الكامل لكل مرشح لتكتب التحليل.
أما أسئلة الترتيب بمعيار رقمي واضح (الأرخص، الأعلى توزيعًا، الأقوى فنيًا، الأكثر تراجعًا) والأسئلة العامة عن السوق أو القطاع فأجب مباشرة دون هذا السطر.`;

export const DEEP_PROMPT = `المرحلة الثانية: رشّحتَ هذه الشركات من جدول السوق، وهذه ملفاتها الكاملة. اختر منها ما يجيب عن السؤال واكتب تقرير محلل مفصلًا:
## الخلاصة
فقرة تذكر الشركات المختارة وفكرة الاختيار والعائد السنوي المتوقع للمجموعة في السيناريو الأساسي.
ثم لكل شركة مختارة عنوان ### اسم الشركة (الرمز) وتحته:
- **الأطروحة:** لماذا هي، في سطرين أو ثلاثة.
- **النشاط ومصادر الربح:** من النشاط والنتائج.
- **جودة الأرباح:** الربح الأساسي مقابل المعلن، والبنود الاستثنائية، والدخل من خارج النشاط إن وجد.
- **النمو والهوامش:** النمو المركب للإيرادات والربح الأساسي، واتجاه آخر الأرباع.
- **التقييم:** المكرر الأساسي مقابل المعلن ووسيط القطاع والمنافسين، ومضاعف الدفترية والعائد.
- **المحفزات:** من الإعلانات المرفقة بتاريخها فقط، وإلا: لا يوجد محفز معلن في البيانات.
- **توقع 3 سنوات:** جدول السيناريوهات (السيناريو | ربح السهم | المكرر | السعر المتوقع | العائد السنوي)، ثم رأيك في واقعيته وأي تعديل مع سببه.
- **فنيًا:** الاتجاه، المتوسطات، أقرب دعم ومقاومة، ومنطقة سعرية معقولة للمراقبة.
- **المخاطر وما يُبطل الفكرة:** رقم أرباح أو مستوى سعر محدد.
## المحفظة
جدول (الشركة | القطاع | وزن توضيحي | العائد المتوقع | المخاطرة) مع سبب الأوزان، ومدى التنويع، والعائد المتوقع المرجّح، وما يجب مراقبته كل ربع.
## لماذا استُبعد الباقون
سطر لكل مرشح لم تختره.`;
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
  // عمود «الربح الأساسي» بجوار صافي الربح حين يختلف عنه في أي فترة.
  const withCore = rows => {
    const differs = rows.some(r => num(r.values.netProfit) != null && num(coreProfit(r.values)) != null && Math.abs(coreProfit(r.values) - r.values.netProfit) > 0.5);
    if (!differs) return rows;
    return rows.map(r => {
      const out = {};
      for (const [k, v] of Object.entries(r.values)) { out[k] = v; if (k === 'netProfit') out.coreProfit = coreProfit(r.values); }
      return { ...r, values: out };
    });
  };
  table(lines, 'النتائج السنوية', 'السنة', withCore(years.map(y => ({ label: y.year, values: y.values || {} }))));
  if (years.length) sources.push(['النتائج السنوية', `${years.length} سنوات`]);

  const quarters = Object.entries(quarterly?.quarters || {}).sort(([a], [b]) => a.localeCompare(b)).slice(-8);
  table(lines, 'النتائج الربعية', 'الربع', withCore(quarters.map(([label, values]) => ({ label, values: values || {} }))));
  if (quarters.length) sources.push(['النتائج الربعية', `آخر ${quarters.length} أرباع`]);

  const fc = years.length ? forecastSection({ st, sectorPe: avgPe, years, quarters, isReit: SECTOR_SLUGS[sector.name] === 'reits' }) : null;
  if (fc) { lines.push(...fc.lines); sources.push(['جودة الأرباح والتوقعات', 'محسوبة']); }

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
      avgPe, avgDy, tech: tech?.facts || null, forecast: fc?.facts || null,
      years: years.map(y => ({ year: y.year, revenue: num(y.values?.revenue), netProfit: num(y.values?.netProfit), core: num(coreProfit(y.values || {})), netMargin: num(y.values?.netMargin) })),
      quarters: quarters.map(([q, v]) => [q, num(v?.netProfit), num(coreProfit(v || {}))]),
    },
  };
}

/* ---------- ملفات القطاع والسوق: صف مختصر لكل شركة ---------- */
const TREND_SHORT = { up: 'صاعد', side: 'عرضي', down: 'هابط' };
const activityShort = a => (a ? String(a).replace(/\s+/g, ' ').split(/[؛;.،,]/)[0].slice(0, 60).trim() : '—');
const growth = (x, y) => (num(x) == null || num(y) == null ? '—' : y > 0 && x < 0 ? 'تحوّل لخسارة' : y < 0 && x > 0 ? 'تحوّل لربح' : y < 0 && x < 0 ? (x > y ? 'خسارة أقل' : 'خسارة أكبر') : y === 0 ? '—' : sgn((x / y - 1) * 100));

/** أرقام صف الشركة في جداول القطاع والسوق، من ملف الشركة نفسه. */
export function companySummary(st, pack) {
  const f = pack?.facts || {}, ys = f.years || [], y1 = ys.at(-1) || {}, y0 = ys.at(-2) || {};
  const qs = f.quarters || [], q1 = qs.at(-1), q0 = qs.length >= 5 ? qs.at(-5) : null, t = f.tech || {}, fc = f.forecast || {};
  // النمو يُقاس على الربح الأساسي، فلا يظهر ربح استثنائي (بيع أصل مثلًا) كأنه نمو.
  const core = x => x?.core ?? x?.netProfit, qCore = q => (q ? q[2] ?? q[1] : null);
  return {
    year: y1.year ?? '—', revenue: y1.revenue, netProfit: y1.netProfit, core: core(y1), netMargin: y1.netMargin,
    profitGrowth: growth(core(y1), core(y0)), revenueGrowth: growth(y1.revenue, y0.revenue),
    lastQ: q1?.[0] ?? '—', lastQProfit: qCore(q1), lastQYoY: q1 && q0 ? growth(qCore(q1), qCore(q0)) : '—',
    corePe: fc.corePe ?? null, coreCagr3: fc.coreCagr3 ?? null, exceptional: Math.abs(fc.exceptionalShare || 0) > 0.2,
    baseReturn: fc.scenarios?.base?.annual ?? null, nonOperating: (fc.flags || []).includes('nonOperating'),
    trend: TREND_SHORT[t.trend] || '—', rsi: t.rsi, vs200: t.sma200 && t.price ? (t.price / t.sma200 - 1) * 100 : null,
    score: t.score, support: t.support, resistance: t.resistance,
  };
}
// ملاحظة جودة الأرباح في صف الجدول.
const quality = sum => [sum.exceptional && 'استثنائي', sum.nonOperating && 'من خارج النشاط'].filter(Boolean).join('+') || '—';
const pctOrDash = v => (num(v) == null ? '—' : sgn(v * 100));

function sectorHeader(sector, marketCapTotal) {
  const st = sector.stocks, cap = st.reduce((a, s) => a + (num(s.marketCap) || 0), 0);
  return `${sector.name}: عدد الشركات ${st.length} · القيمة السوقية ${fmt(cap / 1000, 1)} مليار ريال${marketCapTotal ? ` (${fmt((cap / marketCapTotal) * 100, 2)}% من السوق)` : ''} · وسيط المكرر ${fmt(sectorMedian(st, 'pe'), 1)} · وسيط مضاعف الدفترية ${fmt(sectorMedian(st, 'pb'), 2)} · وسيط العائد ${fmt(sectorMedian(st, 'dividendYield'))}% · وسيط الأداء منذ بداية السنة ${fmt(sectorMedian(st, 'ytd'))}% · وسيط أداء سنة ${fmt(sectorMedian(st, 'year1'))}%`;
}

export function buildSectorPack(sector, slug, rows, { asOf, tasiLine, profiles } = {}) {
  const L = [`جدول قطاع ${sector.name} كاملًا (الأسعار حتى ${asOf || '—'}). الأرقام المالية بالمليون ريال، والنسب المئوية للأداء.`, sectorHeader(sector)];
  if (tasiLine) L.push(tasiLine);
  L.push('الربح الأساسي = صافي الربح بعد استبعاد البنود الاستثنائية، وعليه يُحسب النمو والمكرر الأساسي. العائد المتوقع = تقدير آلي للعائد السنوي لـ3 سنوات (السيناريو الأساسي مع التوزيع).');
  L.push('', 'الرمز | الشركة | النشاط | السعر | القيمة السوقية | المكرر المعلن | المكرر الأساسي | مضاعف الدفترية | العائد% | يومي% | منذ بداية السنة% | سنة% | السنة المالية | الإيرادات | نمو الإيرادات | الربح الأساسي | نمو الربح الأساسي | نمو أساسي مركب 3 سنوات | الهامش الصافي | جودة الربح | آخر ربع | ربح آخر ربع الأساسي | تغيره عن نفس الربع | العائد المتوقع سنويًا | الاتجاه | RSI | مقابل متوسط 200 | تقييم الماسح من 6 | الدعم | المقاومة');
  for (const { st, sum } of [...rows].sort((a, b) => (b.st.marketCap || 0) - (a.st.marketCap || 0))) {
    L.push([st.symbol, st.name, activityShort(profiles?.[st.symbol]?.activity), fmt(st.price), fmt(st.marketCap, 0), fmt(st.pe, 1), fmt(sum.corePe, 1), fmt(st.pb, 2), fmt(st.dividendYield), fmt(st.day), fmt(st.ytd), fmt(st.year1),
      sum.year, fmt(sum.revenue, 0), sum.revenueGrowth, fmt(sum.core, 0), sum.profitGrowth, pctOrDash(sum.coreCagr3), num(sum.netMargin) == null ? '—' : pct(sum.netMargin), quality(sum),
      sum.lastQ, fmt(sum.lastQProfit, 0), sum.lastQYoY, pctOrDash(sum.baseReturn), sum.trend, fmt(sum.rsi, 0), sgn(sum.vs200), sum.score ?? '—',
      sum.support ? `${fmt(sum.support[0])}–${fmt(sum.support[1])}` : '—', sum.resistance ? `${fmt(sum.resistance[0])}–${fmt(sum.resistance[1])}` : '—'].join(' | ') + (st.suspended ? ' | موقوف' : ''));
  }
  const text = L.join('\n');
  const digest = L.slice(0, tasiLine ? 3 : 2).join('\n');
  return { scope: 'sector', id: slug, name: sector.name, asOf, system: SYSTEM_PROMPT, pick: PICK_PROMPT, deep: DEEP_PROMPT, digest, text, tokens: estimateTokens(SYSTEM_PROMPT + text),
    rawTokens: rows.reduce((n, r) => n + (r.pack?.rawTokens || 0), 0), sources: [['جدول القطاع', `${rows.length} شركة`], ['النتائج والتحليل الفني', 'لكل شركة']] };
}

export function buildMarketPack(market, groups, { tasiLine, tasiTech } = {}) {
  const total = market.sectors.reduce((a, s) => a + s.stocks.reduce((b, x) => b + (num(x.marketCap) || 0), 0), 0);
  const all = groups.flatMap(g => g.rows.length ? g.rows : []);
  const L = [`جدول السوق السعودي كاملًا (الأسعار حتى ${market.asOf || '—'}، ${all.length} شركة في ${groups.length} قطاعًا). القيمة السوقية وصافي الربح بالمليون ريال، والأداء بالنسبة المئوية.`];
  if (tasiLine) L.push(tasiLine);
  L.push(`القيمة السوقية للسوق ${fmt(total / 1e6, 2)} تريليون ريال · وسيط المكرر ${fmt(sectorMedian(all.map(r => r.st), 'pe'), 1)} · وسيط العائد ${fmt(sectorMedian(all.map(r => r.st), 'dividendYield'))}%`);
  L.push('الربح الأساسي = صافي الربح بعد استبعاد البنود الاستثنائية، وعليه يُحسب النمو والمكرر الأساسي. جودة الربح: استثنائي = أكثر من 20% من ربح آخر 4 أرباع بنود استثنائية، من خارج النشاط = الربح الأساسي يفوق التشغيلي. العائد المتوقع = تقدير آلي للعائد السنوي لـ3 سنوات (السيناريو الأساسي مع التوزيع).');
  L.push('', 'الأعمدة: الرمز | الشركة | السعر | القيمة السوقية | المكرر المعلن | المكرر الأساسي | مضاعف الدفترية | العائد% | منذ بداية السنة% | سنة% | الربح الأساسي آخر سنة (السنة) | نموه | نمو أساسي مركب 3 سنوات | تغير ربح آخر ربع الأساسي عن نفس الربع | جودة الربح | العائد المتوقع سنويًا | الاتجاه | RSI | مقابل متوسط 200 | تقييم الماسح من 6');
  for (const { sector, rows } of groups) {
    L.push('', `## ${sectorHeader(sector, total)}`);
    for (const { st, sum } of [...rows].sort((a, b) => (b.st.marketCap || 0) - (a.st.marketCap || 0))) {
      L.push([st.symbol, st.name, fmt(st.price), fmt(st.marketCap, 0), fmt(st.pe, 1), fmt(sum.corePe, 1), fmt(st.pb, 2), fmt(st.dividendYield), fmt(st.ytd), fmt(st.year1),
        `${fmt(sum.core, 0)} (${sum.year})`, sum.profitGrowth, pctOrDash(sum.coreCagr3), sum.lastQYoY, quality(sum), pctOrDash(sum.baseReturn), sum.trend, fmt(sum.rsi, 0), sgn(sum.vs200), sum.score ?? '—'].join(' | ') + (st.suspended ? ' | موقوف' : ''));
    }
  }
  if (tasiTech) L.push('', 'مؤشر تاسي فنيًا:', ...tasiTech.lines.filter(l => !/^\d{4}-\d\d-\d\d \|/.test(l) && !l.startsWith('آخر 10 جلسات')).map(l => l.replace(/ \| مقابل تاسي:[^|]*/, '')));
  const text = L.join('\n');
  // ملخص بلا صفوف الشركات للمرحلة الثانية: رؤوس القطاعات ومؤشر تاسي فقط.
  const digest = L.filter(l => !/^\d{4} \|/.test(l) && !l.startsWith('الأعمدة:')).join('\n');
  return { scope: 'market', id: 'market', name: 'السوق كامل', asOf: market.asOf, sectors: groups.map(g => [g.slug, g.sector.name, g.rows.length]), system: SYSTEM_PROMPT, pick: PICK_PROMPT, deep: DEEP_PROMPT, digest, text, tokens: estimateTokens(SYSTEM_PROMPT + text),
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
    writeFileSync(new URL(`sector-${slug}.json`, out), JSON.stringify(buildSectorPack(sector, slug, rows, { asOf: market.asOf, tasiLine, profiles })));
  }
  const marketPack = buildMarketPack(market, groups, { tasiLine, tasiTech: technicalSection(tasi) });
  writeFileSync(new URL('market.json', out), JSON.stringify(marketPack));
  console.log(`Market pack ≈ ${marketPack.tokens} tokens; ${groups.length} sector packs.`);
  if (missing.length) console.warn(`::warning::No financial files mapped for sectors: ${missing.join('، ')}`);
  console.log(`Wrote ${count} AI company packs (avg ≈ ${Math.round(tokens / Math.max(count, 1))} tokens each).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

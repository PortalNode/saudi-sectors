// «مفاتيح جودة السهم»: ستة مفاتيح، كل مفتاح 1 (إيجابي) أو 0. السهم يظهر في الماسح إذا بلغ مجموعه 5 أو 6.
// دوال نقية بلا I/O (عدا loadFinancials) حتى تُختبر بأرقام صغيرة. غياب بيانات مفتاح = 0 مع بيان السبب، ولا يُخمَّن.
import { readFileSync, readdirSync } from 'node:fs';
import { sma, macd } from '../dist/scanner/indicators.mjs';

export const KEY_IDS = ['trend', 'fin', 'tasi', 'levels', 'sma55', 'macd'];
export const KEY_LABELS = { trend: 'اتجاه السهم', fin: 'التحليل المالي', tasi: 'جودة السوق TASI', levels: 'مستويات الأسعار', sma55: 'المتوسط 55 يوم', macd: 'مؤشر MACD' };
export const MIN_SCORE = 5;
export const DIVIDEND_MIN = 2.5; // نسبة التوزيعات المفضلة (%): وسم فقط ولا تدخل في العدّ

const fin = x => x != null && Number.isFinite(x);
const f2 = (x, d = 2) => fin(x) ? x.toFixed(d) : '—';
const key = (ok, detail) => ({ ok: ok ? 1 : 0, detail });

// صاعد: الإغلاق فوق متوسط 50 وهو فوق متوسط 200 ومتوسط 50 صاعد (20 جلسة). هابط: العكس. وإلا عرضي.
// pre (اختياري): سلاسل محسوبة مسبقاً من precompute(close) لتفادي إعادة الحساب عند الفحص التاريخي لعشرات الشموع
export const precompute = close => ({ s50: sma(close, 50), s200: sma(close, 200), s55: sma(close, 55), macd: macd(close) });
export function trendAt(close, i, pre) {
  const s50 = pre?.s50 || sma(close, 50), s200 = pre?.s200 || sma(close, 200);
  const a = s50[i], b = s200[i], p = i >= 20 ? s50[i - 20] : null;
  if (![a, b, p].every(fin) || !p) return { trend: 'na', sma50: a, sma200: b };
  const up = close[i] > a && a > b && a / p - 1 > 0, down = close[i] < a && a < b;
  return { trend: up ? 'up' : down ? 'down' : 'side', sma50: a, sma200: b };
}

// مفتاح السوق: اتجاه TASI الرسمي (شموع TASI.json) بنفس تعريف مفتاح السهم، قيمة واحدة لكل الأسهم.
export function tasiKey(tasiClose, i = tasiClose ? tasiClose.length - 1 : -1, pre) {
  if (!tasiClose || i < 220) return { ...key(false, 'شموع TASI غير كافية'), trend: 'na' };
  const { trend } = trendAt(tasiClose, i, pre);
  return { ...key(trend === 'up', trend === 'up' ? 'مؤشر السوق في اتجاه صاعد' : trend === 'down' ? 'مؤشر السوق في اتجاه هابط' : 'مؤشر السوق عرضي / غير واضح'), trend };
}

// [قديمة، تبقى كمرجع في scripts/backtest/sr-eval.mjs؛ الماسح يستعمل sr-levels.mjs] دعم ومقاومة من قمم وقيعان الحركة السعرية (لا من المتوسطات): قاع/قمة محورية = أدنى/أعلى سعر بين k شموع قبلها وk بعدها،
// ومعها أدنى/أعلى سعر للجلسات السابقة (20 و60، و120 و252 للقمم) دون جلسة اليوم، فالإغلاق عند قمة جديدة لا مقاومة فوقه. الدعم = أعلى قاع تحت السعر، والمقاومة = أدنى قمة فوقه.
export function swingLevels(high, low, close, i, { k = 4, lookback = 252 } = {}) {
  const price = close[i], from = Math.max(0, i - lookback), lows = [], highs = [];
  for (let j = Math.max(k, from); j <= i - k; j++) {
    let isLow = true, isHigh = true;
    for (let m = j - k; m <= j + k; m++) { if (low[m] < low[j]) isLow = false; if (high[m] > high[j]) isHigh = false; }
    if (isLow) lows.push(low[j]);
    if (isHigh) highs.push(high[j]);
  }
  for (const n of [20, 60]) lows.push(Math.min(...low.slice(Math.max(0, i - n), i)));
  for (const n of [20, 60, 120, 252]) highs.push(Math.max(...high.slice(Math.max(0, i - n), i)));
  const below = lows.filter(x => x < price), above = highs.filter(x => x > price);
  return { support: below.length ? Math.max(...below) : null, resistance: above.length ? Math.min(...above) : null };
}

// منطقة دعم/مقاومة كما تخرج من sr-levels.mjs: { low, high, center, touches }. المسافة بوحدة ATR من حافة المنطقة (صفر داخلها).
const zoneText = (z, label) => `${label} ${f2(z.low)}–${f2(z.high)} (${z.touches} لمسات)`;
export const AT_SUPPORT_ATR = 0.5; // «عند الدعم»: داخل المنطقة أو فوق حافتها العليا بأقل من 0.5×ATR (السعر يختبر المنطقة فعلاً)
export const NEAR_RESISTANCE_ATR = 1.0; // «عند المقاومة»: داخل المنطقة أو تحت حافتها السفلى بأقل من 1×ATR
export const MIN_ROOM_ATR = 2.0; // أقل مسافة حرة إلى أقرب مقاومة ليُحسب السهم عند دعم (دون ذلك يضيق المجال بين المستويين)
export const BREAKOUT_ATR = 3.0; // اختراق «حديث»: السعر فوق منطقة كانت مقاومة (قمم فقط) بما لا يزيد عن 3×ATR

// موقع السعر بين المستويين:
//  support: يختبر دعماً وأمامه مجال إلى المقاومة (يتحقق به المفتاح) · resistance: عند مقاومة ·
//  squeezed: قريب من دعم لكن المقاومة قريبة أيضاً فلا مجال (مفتاح 0) ·
//  breakout: فوق منطقة كانت مقاومة وكُسرت، لم يعد إليها بعد (اختراق، ليس اختباراً للدعم) ·
//  open: فوق دعم بعيداً عنه ولا مقاومة أعلاه · between: بين مستويين بعيداً عنهما · none: لا مستويات مؤكدة
// ctx: { fresh, inside } من nearestZones. fresh = منطقة اخترقها السعر قبل جلسات قليلة ولم يبتعد (لا دعم مؤكد بعد)؛
// inside = منطقة داخلها السعر بلا اتجاه اقتراب واضح (غير محسوم): في الحالتين المفتاح 0.
export function levelPosition(price, support, resistance, atr, ctx = {}) {
  if (!fin(price) || !(atr > 0) || (!support && !resistance && !ctx.fresh && !ctx.inside)) return 'none';
  if (ctx.inside) return 'inside';
  const dS = support ? Math.max(0, price - support.high) / atr : Infinity, dR = resistance ? Math.max(0, resistance.low - price) / atr : Infinity;
  const nearS = dS <= AT_SUPPORT_ATR, nearR = dR <= NEAR_RESISTANCE_ATR;
  if (ctx.fresh) return nearR ? 'resistance' : 'breakout';
  if (nearS && dR >= MIN_ROOM_ATR) return 'support';
  if (nearS) return 'squeezed';
  if (nearR) return 'resistance';
  if (support && support.lows === 0 && dS <= BREAKOUT_ATR) return 'breakout';
  if (support && !resistance) return 'open';
  return 'between';
}

// 1+ فقط إذا كان السهم يختبر منطقة دعم (داخلها أو ضمن 0.5×ATR فوقها) ويفصله عن أقرب مقاومة 2×ATR فأكثر (أو لا مقاومة فوقه: قمة جديدة).
// أي سهم عند مقاومة، أو بين دعم ومقاومة متقاربين، أو مخترق لمنطقة ومبتعد عنها = 0، فلا يظهر سهم «عند دعم» وهو ملاصق لمقاومة أو مبتعد عن الدعم.
export function levelsKey(price, support, resistance, atr, ctx = {}) {
  if (!fin(price) || !(atr > 0)) return key(false, 'لا بيانات كافية لتحديد المستويات');
  if (ctx.inside) return key(false, `${zoneText(ctx.inside, 'السعر داخل منطقة')} دون اتجاه اقتراب واضح فلا يُحسم دعم أم مقاومة`);
  if (ctx.fresh) return key(false, `${zoneText(ctx.fresh, 'اخترق السعر منطقة')} حديثاً ولم يبتعد عنها ولم يعد لاختبارها، فلا دعم مؤكد بعد`);
  if (!support) return key(false, resistance ? `لا توجد منطقة دعم مؤكدة تحت السعر · ${zoneText(resistance, 'مقاومة')}` : 'لا توجد مناطق دعم أو مقاومة مؤكدة');
  const dS = Math.max(0, price - support.high) / atr, dR = resistance ? Math.max(0, resistance.low - price) / atr : Infinity;
  const detail = `${zoneText(support, 'دعم')} يبعد ${f2(dS, 1)}×ATR${resistance ? ` · ${zoneText(resistance, 'مقاومة')} تبعد ${f2(dR, 1)}×ATR` : ' · لا مقاومة فوق السعر'}`;
  const pos = levelPosition(price, support, resistance, atr, ctx);
  const why = { support: '', resistance: ' — السعر عند مقاومة', squeezed: ' — المقاومة قريبة (أقل من 2×ATR) فلا مجال كافٍ', breakout: ' — اختراق: السعر فوق مقاومة مكسورة ولم يعد لاختبارها', inside: '', open: ' — بعيد عن الدعم', between: ' — بعيد عن الدعم' }[pos] ?? '';
  return key(pos === 'support', detail + why);
}

export function sma55Key(close, i, pre) {
  const m = (pre?.s55 || sma(close, 55))[i];
  return fin(m) ? key(close[i] > m, `الإغلاق ${f2(close[i])} · متوسط 55: ${f2(m)}`) : key(false, 'تاريخ أقصر من 55 جلسة');
}

export function macdKey(close, i, pre) {
  const m = (pre?.macd || macd(close))[i];
  return m && fin(m.signal) ? key(m.macd > m.signal, `MACD ${f2(m.macd, 3)} · الإشارة ${f2(m.signal, 3)}`) : key(false, 'بيانات MACD غير كافية');
}

/* ---------- التحليل المالي ---------- */
// تاريخ إتاحة نتائج ربع للمستثمر تقريباً: نهاية الربع + 45 يوماً (الأرباع الأولى والثانية والثالثة) أو + 100 يوم (السنوي).
// قاعدة تقريبية للفحص التاريخي فقط (لا نعرف يوم النشر الفعلي)، ومحافظة حتى لا نسبق الواقع.
const QUARTER_END = ['03-31', '06-30', '09-30', '12-31'];
export function quarterAvailable(k) {
  const m = /^(\d{4})Q([1-4])$/.exec(k); if (!m) return null;
  const d = new Date(`${m[1]}-${QUARTER_END[+m[2] - 1]}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + (m[2] === '4' ? 100 : 45));
  return d.toISOString().slice(0, 10);
}
// المفتاح المالي كما كان يُرى في تاريخ معيّن: الأرباع المتاحة وقتها فقط (بلا نظر للمستقبل)
export function financialKeyAsOf(fin_, date) {
  if (!fin_) return financialKey(fin_);
  const q = Object.fromEntries(Object.entries(fin_.quarters || {}).filter(([k]) => { const a = quarterAvailable(k); return a && a <= date; }));
  return financialKey({ quarters: q, years: (fin_.years || []).filter(y => `${y.year + 1}-04-10` <= date) });
}

const qIndex = k => { const m = /^(\d{4})Q([1-4])$/.exec(k); return m ? +m[1] * 4 + +m[2] - 1 : null; };

// نتيجة المفتاح لسهم من مجموع صافي ربح آخر 4 أرباع متتالية؛ وإن لم تتوفر فآخر سنة مالية؛ وإلا 0 مع السبب.
export function financialKey(fin_) {
  const q = fin_?.quarters || {};
  const have = Object.keys(q).map(k => [qIndex(k), k]).filter(([i, k]) => i != null && fin(q[k]?.netProfit)).sort((a, b) => a[0] - b[0]);
  const last4 = have.slice(-4);
  if (last4.length === 4 && last4[3][0] - last4[0][0] === 3) {
    const sum = last4.reduce((s, [, k]) => s + q[k].netProfit, 0);
    return { ...key(sum > 0, `صافي ربح آخر 4 أرباع (${last4[0][1]} إلى ${last4[3][1]}): ${f2(sum, 1)} مليون`), basis: 'ttm', netProfit: sum };
  }
  const years = (fin_?.years || []).filter(y => fin(y.netProfit)).sort((a, b) => a.year - b.year);
  const y = years.at(-1);
  if (y) return { ...key(y.netProfit > 0, `صافي ربح سنة ${y.year}: ${f2(y.netProfit, 1)} مليون (لا أرباع كافية)`), basis: 'fy', netProfit: y.netProfit };
  return { ...key(false, 'لا تتوفر بيانات صافي الربح'), basis: 'none', netProfit: null };
}

// يقرأ كل ملفات الأرباح (ربعية وسنوية) إلى خريطة رمز → { quarters, years }
export function loadFinancials(distUrl) {
  const out = new Map();
  const slot = sym => { if (!out.has(sym)) out.set(sym, { quarters: {}, years: [] }); return out.get(sym); };
  for (const file of readdirSync(distUrl).filter(f => /-financials\.json$/.test(f)).sort()) {
    let json; try { json = JSON.parse(readFileSync(new URL(file, distUrl), 'utf8')); } catch { continue; }
    const quarterly = file.includes('-quarterly-');
    for (const c of json.companies || json.banks || []) {
      const e = slot(String(c.symbol));
      if (quarterly) for (const [k, v] of Object.entries(c.quarters || {})) { if (!(k in e.quarters) || e.quarters[k]?.netProfit == null) e.quarters[k] = { netProfit: v?.netProfit ?? null }; }
      else for (const y of c.years || []) if (y.period === 'FY' && !e.years.some(z => z.year === y.year)) e.years.push({ year: y.year, netProfit: y.values?.netProfit ?? null });
    }
  }
  return out;
}

/* ---------- التجميع ---------- */
// الأسهم 5/6 وما فوق تظهر. input: { close[], i, support, resistance, financial, tasi (نتيجة tasiKey), dividendYield }
export function computeKeys({ close, i, support, resistance, atr, financial, tasi, dividendYield, pre, ctx }) {
  const { trend, sma50, sma200 } = trendAt(close, i, pre);
  const keys = {
    trend: key(trend === 'up', trend === 'up' ? 'الإغلاق فوق متوسط 50 وهو فوق متوسط 200 وصاعد' : trend === 'down' ? 'اتجاه هابط (الإغلاق تحت متوسط 50 وهو تحت 200)' : trend === 'side' ? 'اتجاه عرضي / غير واضح' : 'تاريخ أقصر من 200 جلسة'),
    fin: financial, tasi: { ok: tasi.ok, detail: tasi.detail },
    levels: levelsKey(close[i], support, resistance, atr, ctx), sma55: sma55Key(close, i, pre), macd: macdKey(close, i, pre),
  };
  const bits = KEY_IDS.map(id => keys[id].ok);
  return {
    trend, sma50, sma200, keys,
    score: bits.reduce((a, b) => a + b, 0),
    bits: bits.join(''),
    dividendOk: fin(dividendYield) && dividendYield > DIVIDEND_MIN,
  };
}

/* ---------- تاريخ ظهور الإشارة ---------- */
// scores: مجموع مفاتيح كل جلسة (الأقدم أولاً، والأخيرة هي اليوم)، dates بنفس الطول. يعيد بداية الفترة المتصلة الحالية التي بلغ فيها المجموع
// العتبة، أو null إذا لم يبلغها اليوم. capped = بلغت الفترة أقدم جلسة مفحوصة فالبداية الحقيقية أقدم من التاريخ المعروض.
export function runStart(scores, dates, threshold) {
  const last = scores.length - 1;
  if (last < 0 || !(scores[last] >= threshold)) return null;
  let j = last; while (j > 0 && scores[j - 1] >= threshold) j--;
  return { date: dates[j], sessions: last - j + 1, capped: j === 0 };
}

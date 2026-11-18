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
export function trendAt(close, i) {
  const s50 = sma(close, 50), s200 = sma(close, 200);
  const a = s50[i], b = s200[i], p = i >= 20 ? s50[i - 20] : null;
  if (![a, b, p].every(fin) || !p) return { trend: 'na', sma50: a, sma200: b };
  const up = close[i] > a && a > b && a / p - 1 > 0, down = close[i] < a && a < b;
  return { trend: up ? 'up' : down ? 'down' : 'side', sma50: a, sma200: b };
}

// مفتاح السوق: اتجاه TASI الرسمي (شموع TASI.json) بنفس تعريف مفتاح السهم، قيمة واحدة لكل الأسهم.
export function tasiKey(tasiClose) {
  if (!tasiClose || tasiClose.length < 221) return { ...key(false, 'شموع TASI غير كافية'), trend: 'na' };
  const { trend } = trendAt(tasiClose, tasiClose.length - 1);
  return { ...key(trend === 'up', trend === 'up' ? 'مؤشر السوق في اتجاه صاعد' : trend === 'down' ? 'مؤشر السوق في اتجاه هابط' : 'مؤشر السوق عرضي / غير واضح'), trend };
}

// دعم ومقاومة من قمم وقيعان الحركة السعرية (لا من المتوسطات): قاع/قمة محورية = أدنى/أعلى سعر بين k شموع قبلها وk بعدها،
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

// 1+ إذا كان السعر أقرب إلى أقرب دعم منه إلى أقرب مقاومة، أو لا مقاومة فوقه (اخترق قمته). 0 إذا أقرب للمقاومة.
export function levelsKey(price, support, resistance) {
  if (!fin(price)) return key(false, 'لا سعر');
  if (!fin(resistance)) return key(true,'لا توجد مقاومة فوق السعر (عند قمة الفترة)');
  if (!fin(support)) return key(false, `لا يوجد دعم تحت السعر · المقاومة ${f2(resistance)}`);
  const toS = price - support, toR = resistance - price;
  return key(toS < toR, `دعم ${f2(support)} (يبعد ${f2(100 * toS / price, 1)}%) · مقاومة ${f2(resistance)} (تبعد ${f2(100 * toR / price, 1)}%)`);
}

export function sma55Key(close, i) {
  const m = sma(close, 55)[i];
  return fin(m) ? key(close[i] > m, `الإغلاق ${f2(close[i])} · متوسط 55: ${f2(m)}`) : key(false, 'تاريخ أقصر من 55 جلسة');
}

export function macdKey(close, i) {
  const m = macd(close)[i];
  return m && fin(m.signal) ? key(m.macd > m.signal, `MACD ${f2(m.macd, 3)} · الإشارة ${f2(m.signal, 3)}`) : key(false, 'بيانات MACD غير كافية');
}

/* ---------- التحليل المالي ---------- */
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
export function computeKeys({ close, i, support, resistance, financial, tasi, dividendYield }) {
  const { trend, sma50, sma200 } = trendAt(close, i);
  const keys = {
    trend: key(trend === 'up', trend === 'up' ? 'الإغلاق فوق متوسط 50 وهو فوق متوسط 200 وصاعد' : trend === 'down' ? 'اتجاه هابط (الإغلاق تحت متوسط 50 وهو تحت 200)' : trend === 'side' ? 'اتجاه عرضي / غير واضح' : 'تاريخ أقصر من 200 جلسة'),
    fin: financial, tasi: { ok: tasi.ok, detail: tasi.detail },
    levels: levelsKey(close[i], support, resistance), sma55: sma55Key(close, i), macd: macdKey(close, i),
  };
  const bits = KEY_IDS.map(id => keys[id].ok);
  return {
    trend, sma50, sma200, keys,
    score: bits.reduce((a, b) => a + b, 0),
    bits: bits.join(''),
    dividendOk: fin(dividendYield) && dividendYield > DIVIDEND_MIN,
  };
}

// دعم ومقاومة بطريقة المحللين المحترفين: مناطق (نطاقات سعرية) لا خطوط، تُبنى من القمم والقيعان المحورية المؤكَّدة،
// وتُدمج بتسامح مبني على ATR، وتُرتَّب بعدد اللمسات وقوة الارتداد عندها وحداثتها. المصادر العامة للمنهج: تجميع المحاور بتسامح ATR،
// اشتراط لمستين فأكثر، وزن الحداثة، جودة الارتداد، وانقلاب الدور (المقاومة المكسورة تصبح دعماً) — راجع docs/support-resistance.md.
//
// دالة نقية: الشمعة i تعتمد على الشموع 0..i فقط (لا نظر للمستقبل)، فيصح اختبارها تاريخياً.
import { atr as atrSeries } from '../dist/scanner/indicators.mjs';

export const SR_DEFAULTS = {
  lookback: 500,        // جلسات (نحو سنتين)
  k: 5,                 // محور مؤكَّد: أعلى/أدنى سعر بين 5 شموع قبله و5 بعده
  reactionAtr: 1.5,     // لا يُعدّ المحور إلا إذا ارتد السعر عنه 1.5×ATR خلال reactionBars جلسة
  reactionBars: 15,
  zoneAtr: 1.0,         // أقصى عرض للمنطقة = 1×ATR الحالي
  minTouches: 2,        // لمستان (محوران) على الأقل لتُقبل المنطقة
  halfLife: 250,        // نصف عمر الوزن بالجلسات
};

// المحاور المؤكدة وما ارتدّ عنها. كل عنصر: { j, price, type: 'high'|'low', reaction (بوحدة ATR) }
export function pivots(high, low, atr, i, p = SR_DEFAULTS) {
  const out = [], from = Math.max(p.k, i - p.lookback);
  for (let j = from; j <= i - p.k; j++) {
    const a = atr[j]; if (!(a > 0)) continue;
    let isLow = true, isHigh = true;
    for (let m = j - p.k; m <= j + p.k; m++) { if (low[m] < low[j]) isLow = false; if (high[m] > high[j]) isHigh = false; if (!isLow && !isHigh) break; }
    const end = Math.min(i, j + p.reactionBars);
    if (isHigh) { let lo = Infinity; for (let m = j + 1; m <= end; m++) lo = Math.min(lo, low[m]); const rx = (high[j] - lo) / a; if (rx >= p.reactionAtr) out.push({ j, price: high[j], type: 'high', reaction: rx }); }
    if (isLow) { let hi = -Infinity; for (let m = j + 1; m <= end; m++) hi = Math.max(hi, high[m]); const rx = (hi - low[j]) / a; if (rx >= p.reactionAtr) out.push({ j, price: low[j], type: 'low', reaction: rx }); }
  }
  return out;
}

// تجميع المحاور (قمم وقيعان معاً، فتنقلب الأدوار طبيعياً) في مناطق بعرض لا يتجاوز zoneAtr × ATR.
export function zonesAt(high, low, close, i, atr, p = SR_DEFAULTS) {
  const a = atr[i]; if (!(a > 0)) return [];
  const pv = pivots(high, low, atr, i, p).sort((x, y) => x.price - y.price);
  const zones = []; let cur = null;
  const flush = () => { if (cur) zones.push(cur); cur = null; };
  for (const v of pv) {
    if (cur && v.price - cur.items[0].price <= p.zoneAtr * a) cur.items.push(v); else { flush(); cur = { items: [v] }; }
  }
  flush();
  const out = [];
  for (const z of zones) {
    const prices = z.items.map(x => x.price);
    // لمستان مستقلتان: محوران بينهما 5 شموع على الأقل (مضمون بشرط المحور المؤكَّد)
    if (z.items.length < p.minTouches) continue;
    let w = 0, wp = 0;
    for (const x of z.items) { const wt = 0.5 ** ((i - x.j) / p.halfLife) * Math.min(x.reaction, 6); w += wt; wp += wt * x.price; }
    const lo = Math.min(...prices), hi = Math.max(...prices), pad = Math.max(0, 0.25 * a - (hi - lo) / 2);
    out.push({ low: lo - pad, high: hi + pad, center: wp / w, touches: z.items.length, score: w, last: Math.max(...z.items.map(x => x.j)), highs: z.items.filter(x => x.type === 'high').length, lows: z.items.filter(x => x.type === 'low').length });
  }
  return out;
}

// أقرب منطقة دعم تحت السعر وأقرب منطقة مقاومة فوقه. السعر داخل المنطقة: دعم إن أغلق فوق مركزها، وإلا مقاومة.
export function nearestZones(high, low, close, i, p = SR_DEFAULTS, atrArr = null) {
  const atr = atrArr || atrSeries(high, low, close, 14), price = close[i];
  const zs = zonesAt(high, low, close, i, atr, p);
  const supports = zs.filter(z => z.center <= price && !(price < z.high && price < z.center));
  const resistances = zs.filter(z => z.center > price);
  const support = supports.length ? supports.reduce((m, z) => z.center > m.center ? z : m) : null;
  const resistance = resistances.length ? resistances.reduce((m, z) => z.center < m.center ? z : m) : null;
  return { support, resistance, atr: atr[i], zones: zs };
}

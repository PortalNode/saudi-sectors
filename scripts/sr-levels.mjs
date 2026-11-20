// دعم ومقاومة بطريقة المحللين المحترفين: مناطق (نطاقات سعرية) لا خطوط، تُبنى من القمم والقيعان المحورية المؤكَّدة،
// وتُدمج بتسامح مبني على ATR، وتُرتَّب بعدد اللمسات وقوة الارتداد عندها وحداثتها. المصادر العامة للمنهج: تجميع المحاور بتسامح ATR،
// اشتراط لمستين فأكثر، وزن الحداثة، جودة الارتداد، وانقلاب الدور (المقاومة المكسورة تصبح دعماً) — راجع docs/support-resistance.md.
//
// النافذة: آخر سنتين فقط (المستويات الأقدم قد تضلّل). دالة نقية: الشمعة i تعتمد على الشموع 0..i فقط (لا نظر للمستقبل)، فيصح اختبارها تاريخياً.
import { atr as atrSeries } from '../dist/scanner/indicators.mjs';

export const SR_DEFAULTS = {
  lookback: 500,        // جلسات (نحو سنتين) إذا لم تُمرَّر التواريخ؛ ومع التواريخ تُقصّ النافذة بسنتين تقويميتين بالضبط
  years: 2,             // عمر أقدم محور مقبول: آخر سنتين فقط، فالمستويات الأقدم قد تضلّل
  k: 5,                 // محور مؤكَّد: أعلى/أدنى سعر بين 5 شموع قبله و5 بعده
  reactionAtr: 1.5,     // لا يُعدّ المحور إلا إذا ارتد السعر عنه 1.5×ATR خلال reactionBars جلسة
  reactionBars: 15,
  zoneAtr: 1.0,         // أقصى عرض للمنطقة = 1×ATR الحالي
  minTouches: 2,        // لمستان (محوران) على الأقل لتُقبل المنطقة
  halfLife: 250,        // نصف عمر الوزن بالجلسات
  mergeGapAtr: 0.5,     // منطقتان بينهما فراغ أقل من 0.5×ATR (أو متداخلتان) حزمة واحدة لا دعم ومقاومة متجاورين
  mergeMaxAtr: 2.0,     // لا يتجاوز عرض الحزمة المدمجة 2×ATR
};

// المحاور المؤكدة وما ارتدّ عنها. كل عنصر: { j, price, type: 'high'|'low', reaction (بوحدة ATR) }
export function pivots(high, low, atr, i, p = SR_DEFAULTS) {
  const out = [], from = Math.max(p.k, p.fromIndex ?? i - p.lookback);
  for (let j = from; j <= i - p.k; j++) {
    const a = atr[j]; if (!(a > 0)) continue;
    // شمعة مقدَّرة (أعلى/أدنى مصطنعان) أو مُعلَّمة بقفزة غير مفسَّرة قرب المحور تجعله غير موثوق: لا يُقبل محور يعتمد على أسعار مصطنعة
    if (p.bad) { let dirty = false; for (let m = j - p.k; m <= j + p.k; m++) if (p.bad[m]) { dirty = true; break; } if (dirty) continue; }
    let isLow = true, isHigh = true;
    for (let m = j - p.k; m <= j + p.k; m++) { if (low[m] < low[j]) isLow = false; if (high[m] > high[j]) isHigh = false; if (!isLow && !isHigh) break; }
    const end = Math.min(i, j + p.reactionBars);
    if (isHigh) { let lo = Infinity; for (let m = j + 1; m <= end; m++) lo = Math.min(lo, low[m]); const rx = (high[j] - lo) / a; if (rx >= p.reactionAtr) add({ j, price: high[j], type: 'high', reaction: rx }); }
    if (isLow) { let hi = -Infinity; for (let m = j + 1; m <= end; m++) hi = Math.max(hi, high[m]); const rx = (hi - low[j]) / a; if (rx >= p.reactionAtr) add({ j, price: low[j], type: 'low', reaction: rx }); }
  }
  return out;
  // قمتان (أو قاعان) متساويتان في شمعتين متجاورتين هما محور واحد لا لمستان: يُبقى الأقصى منهما
  function add(v) {
    const prev = out.findLast(x => x.type === v.type);
    if (prev && v.j - prev.j <= p.k) { if (v.type === 'high' ? v.price > prev.price : v.price < prev.price) Object.assign(prev, v); return; }
    out.push(v);
  }
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
    out.push({ low: lo - pad, high: hi + pad, center: wp / w, touches: z.items.length, score: w, first: Math.min(...z.items.map(x => x.j)), last: Math.max(...z.items.map(x => x.j)), highs: z.items.filter(x => x.type === 'high').length, lows: z.items.filter(x => x.type === 'low').length });
  }
  return mergeZones(out, a, p);
}

// التجميع بحدّ عرض 1×ATR يقطع الحزمة السعرية الواحدة إلى منطقتين متلاصقتين (قمم أعلى الحزمة وقيعان أسفلها)، فيرى الماسح السهم
// «عند دعم» و«عند مقاومة» معاً. هنا تُدمج المناطق المتداخلة أو المتقاربة (فراغ ≤ mergeGapAtr×ATR) في حزمة واحدة ما لم يتجاوز عرضها mergeMaxAtr×ATR.
export function mergeZones(zones, a, p = SR_DEFAULTS) {
  const out = [];
  for (const q of [...zones].sort((x, y) => x.low - y.low)) {
    const cur = out.at(-1);
    if (cur && q.low - cur.high <= p.mergeGapAtr * a && Math.max(cur.high, q.high) - cur.low <= p.mergeMaxAtr * a) {
      const w = cur.score + q.score;
      cur.center = (cur.center * cur.score + q.center * q.score) / w; cur.score = w;
      cur.low = Math.min(cur.low, q.low); cur.high = Math.max(cur.high, q.high);
      cur.touches += q.touches; cur.highs += q.highs; cur.lows += q.lows;
      cur.first = Math.min(cur.first, q.first); cur.last = Math.max(cur.last, q.last);
    } else out.push({ ...q });
  }
  return out;
}

// علاقة السعر الحالي بمنطقة، وهي ما يحدد دورها (دعم أم مقاومة) لا موضعها من مركزها:
//  above: أغلق فوقها وابتعد عنها ≥ 1×ATR ثم عاد (أو بقي فوقها 5 جلسات فأكثر): المنطقة تحته، دعم (انقلاب دور إن كانت قمماً)
//  fresh: أغلق فوقها قبل جلسات قليلة ولم يبتعد بعد: اختراق حديث، لا دعم مؤكد ولا مقاومة
//  below: أغلق تحتها: المنطقة فوقه، مقاومة
//  inside-from-above / inside-from-below: داخلها، والدور بجهة وصوله إليها (آخر إغلاق خارجها): من فوق = يختبر دعماً، من تحت = يختبر مقاومة
//  inside-flat: داخلها ولا إغلاق خارجها خلال المدة: لا اتجاه اقتراب، غير محسوم
export function zoneRelation(close, i, z, a, lookback = 120) {
  const lo = Math.max(0, i - lookback), p = close[i];
  if (p > z.high) {
    let j = i, top = p; while (j >= lo && close[j] > z.high) { if (close[j] > top) top = close[j]; j--; }
    return (top - z.high) / a >= 1 || j < lo || i - j >= 5 ? 'above' : 'fresh';
  }
  if (p < z.low) return 'below';
  for (let j = i - 1; j >= lo; j--) { if (close[j] > z.high) return 'inside-from-above'; if (close[j] < z.low) return 'inside-from-below'; }
  return 'inside-flat';
}

// أقرب منطقة دعم وأقرب منطقة مقاومة بحسب علاقة السعر بكل منطقة (zoneRelation). fresh: منطقة اخترقها السعر حديثاً، inside: منطقة داخلها
// السعر بلا اتجاه اقتراب. كلتاهما ليست دعماً ولا مقاومة.
// أول شمعة ضمن آخر `years` سنة تقويمية قبل تاريخ الشمعة i (التواريخ بصيغة YYYY-MM-DD تُقارن نصياً)
export function windowStart(dates, i, years = SR_DEFAULTS.years) {
  const cut = `${+dates[i].slice(0, 4) - years}${dates[i].slice(4)}`;
  let j = i; while (j > 0 && dates[j - 1] >= cut) j--;
  return j;
}

export function nearestZones(high, low, close, i, p = SR_DEFAULTS, atrArr = null, dates = null) {
  const atr = atrArr || atrSeries(high, low, close, 14), a = atr[i];
  const zs = zonesAt(high, low, close, i, atr, dates ? { ...p, fromIndex: windowStart(dates, i, p.years) } : p);
  const rel = zs.map(z => ({ z, r: a > 0 ? zoneRelation(close, i, z, a) : 'inside-flat' }));
  const sup = rel.filter(x => x.r === 'above' || x.r === 'inside-from-above').map(x => x.z);
  const res = rel.filter(x => x.r === 'below' || x.r === 'inside-from-below').map(x => x.z);
  const near = (list, pick) => list.length ? list.reduce(pick) : null;
  const fresh = near(rel.filter(x => x.r === 'fresh').map(x => x.z), (m, z) => z.high > m.high ? z : m);
  const inside = near(rel.filter(x => x.r === 'inside-flat').map(x => x.z), (m, z) => z.center > m.center ? z : m);
  return { support: near(sup, (m, z) => z.center > m.center ? z : m), resistance: near(res, (m, z) => z.center < m.center ? z : m), fresh, inside, atr: a, zones: zs };
}

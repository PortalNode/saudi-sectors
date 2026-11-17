// Live scanner rules. Each strategy is written as a list of named conditions so the page can say which
// ones held and which did not. The conditions are the SAME rules that were backtested in
// scripts/backtest/strategies.mjs (tests/scanner-engine.test.mjs proves they agree on every bar of real
// stocks). Reversal ("buy the support") is not offered: the backtest showed it loses.
//
// Nothing here is evidence that a signal will make money: no strategy passed the acceptance criteria in
// docs/scanner-research.md. The scanner describes what the chart looks like; it does not forecast.
import { DEFAULTS } from './backtest/strategies.mjs';

const ok = (...xs) => xs.every(x => x != null && Number.isFinite(x));
const fmt = (x, d = 2) => x == null || !Number.isFinite(x) ? '—' : x.toFixed(d);
const cond = (id, label, pass, detail = '') => ({ id, label, ok: !!pass, detail });

// Conditions for the strategy `id` at bar i. A missing number makes its condition fail, never pass.
export const RULES = {
  breakout: (s, f, i, p = DEFAULTS.breakout) => {
    const hh = p.n === 55 ? f.hh55[i] : f.hh60[i];
    return [
      cond('close_above_high', `الإغلاق فوق أعلى إغلاق ${p.n} جلسة سابقة`, ok(hh) && s.c[i] > hh, `الإغلاق ${fmt(s.c[i])} · القمة ${fmt(hh)}`),
      cond('sma50_above_200', 'متوسط 50 يوماً فوق متوسط 200', ok(f.sma50[i], f.sma200[i]) && f.sma50[i] > f.sma200[i], `${fmt(f.sma50[i])} / ${fmt(f.sma200[i])}`),
      cond('close_above_50', 'الإغلاق فوق متوسط 50', ok(f.sma50[i]) && s.c[i] > f.sma50[i], `متوسط 50: ${fmt(f.sma50[i])}`),
    ];
  },
  pullback: (s, f, i, p = DEFAULTS.pullback) => [
    cond('sma50_above_200', 'متوسط 50 فوق متوسط 200', ok(f.sma50[i], f.sma200[i]) && f.sma50[i] > f.sma200[i], `${fmt(f.sma50[i])} / ${fmt(f.sma200[i])}`),
    cond('sma50_rising', 'متوسط 50 صاعد (20 جلسة)', ok(f.sma50Slope[i]) && f.sma50Slope[i] > 0, `${fmt(100 * f.sma50Slope[i], 1)}%`),
    cond('touched_20', 'لامس الحد الأدنى متوسط 20 (ضمن 1%)', ok(f.sma20[i]) && s.l[i] <= f.sma20[i] * (1 + p.touch), `الأدنى ${fmt(s.l[i])} · متوسط 20: ${fmt(f.sma20[i])}`),
    cond('close_above_20', 'الإغلاق فوق متوسط 20', ok(f.sma20[i]) && s.c[i] > f.sma20[i]),
    cond('bullish_candle', 'شمعة صاعدة (إغلاق فوق الافتتاح)', s.c[i] > s.o[i]),
    cond('higher_close', 'إغلاق أعلى من إغلاق أمس', s.c[i] > s.c[i - 1]),
    cond('close_above_50', 'الإغلاق فوق متوسط 50', ok(f.sma50[i]) && s.c[i] > f.sma50[i]),
  ],
  squeeze: (s, f, i, p = DEFAULTS.squeeze) => {
    let squeezed = false;
    for (let k = 1; k <= p.lookback; k++) if (f.bbRank[i - k] != null && f.bbRank[i - k] <= p.rank) squeezed = true;
    return [
      cond('was_squeezed', `انكماش التذبذب خلال آخر ${p.lookback} جلسات`, squeezed, `عرض بولنجر في أدنى ${p.rank}% من آخر 120 جلسة`),
      cond('close_above_20high', 'الإغلاق فوق أعلى إغلاق 20 جلسة', ok(f.hh20[i]) && s.c[i] > f.hh20[i], `الإغلاق ${fmt(s.c[i])} · القمة ${fmt(f.hh20[i])}`),
      cond('close_above_200', 'الإغلاق فوق متوسط 200', ok(f.sma200[i]) && s.c[i] > f.sma200[i], `متوسط 200: ${fmt(f.sma200[i])}`),
    ];
  },
  rs: (s, f, i, p = DEFAULTS.rs) => [
    cond('rank', `ضمن أقوى ${100 - p.minRank}% عائداً خلال 126 جلسة`, ok(f.rsRank[i]) && f.rsRank[i] >= p.minRank, `الترتيب المئوي ${fmt(f.rsRank[i], 0)}`),
    cond('beats_market', 'أقوى من السوق خلال 63 جلسة', ok(f.rsVsMarket63[i]) && f.rsVsMarket63[i] > 0, `${fmt(f.rsVsMarket63[i], 1)} نقطة مئوية`),
    cond('sma50_above_200', 'متوسط 50 فوق متوسط 200', ok(f.sma50[i], f.sma200[i]) && f.sma50[i] > f.sma200[i]),
    cond('close_above_20high', 'إغلاق فوق أعلى إغلاق 20 جلسة', ok(f.hh20[i]) && s.c[i] > f.hh20[i], `القمة ${fmt(f.hh20[i])}`),
  ],
  cross: (s, f, i, p = DEFAULTS.cross) => {
    const a = p.fast === 20 ? f.sma20 : f.sma50, b = p.slow === 50 ? f.sma50 : f.sma200;
    return [
      cond('crossed_up', `تقاطع متوسط ${p.fast} فوق متوسط ${p.slow} اليوم`, ok(a[i], b[i], a[i - 1], b[i - 1]) && a[i - 1] <= b[i - 1] && a[i] > b[i], `${fmt(a[i])} / ${fmt(b[i])}`),
      cond('close_above_200', 'الإغلاق فوق متوسط 200', ok(f.sma200[i]) && s.c[i] > f.sma200[i], `متوسط 200: ${fmt(f.sma200[i])}`),
      cond('sma200_rising', 'متوسط 200 صاعد (20 جلسة)', ok(f.sma200Slope[i]) && f.sma200Slope[i] > 0, `${fmt(100 * f.sma200Slope[i], 1)}%`),
    ];
  },
  base: (s, f, i, p = DEFAULTS.base) => {
    const hh = f.hh60[i];
    let lo = Infinity; if (i >= p.n + 1) for (let k = i - p.n; k < i; k++) lo = Math.min(lo, s.c[k]);
    const width = ok(hh) && Number.isFinite(lo) ? (hh - lo) / hh : null;
    return [
      cond('long_base', `قاعدة سعرية ضيقة: آخر ${p.n} إغلاقاً ضمن نطاق ${100 * p.maxWidth}%`, i >= p.n + 1 && ok(f.sma200[i], width) && width <= p.maxWidth, `عرض النطاق ${fmt(100 * width, 1)}%`),
      cond('close_above_base', `الإغلاق فوق أعلى إغلاق ${p.n} جلسة`, ok(hh) && s.c[i] > hh, `الإغلاق ${fmt(s.c[i])} · القمة ${fmt(hh)}`),
    ];
  },
  volume: (s, f, i, p = DEFAULTS.volume) => {
    const ratio = ok(f.avgVol20Prev[i]) && f.avgVol20Prev[i] > 0 ? s.v[i] / f.avgVol20Prev[i] : null;
    return [...RULES.breakout(s, f, i, { n: p.n }), cond('volume_surge', `الحجم ${p.mult} أضعاف متوسط 20 جلسة فأكثر`, ratio != null && ratio >= p.mult, `${fmt(ratio, 1)}× المتوسط`)];
  },
};

export const STRATEGY_INFO = {
  breakout: { name: 'اختراق المقاومة', invalidation: 'إغلاق دون مستوى الاختراق أو دون الوقف المرجعي.' },
  pullback: { name: 'ارتداد من المتوسط', invalidation: 'إغلاق دون متوسط 50 أو دون الوقف المرجعي.' },
  squeeze: { name: 'انكماش التذبذب ثم اختراق', invalidation: 'عودة الإغلاق إلى داخل نطاق الانكماش أو دون الوقف المرجعي.' },
  rs: { name: 'القوة النسبية', invalidation: 'فقدان التفوق على السوق أو إغلاق دون الوقف المرجعي.' },
  cross: { name: 'تقاطع المتوسطات', invalidation: 'عودة متوسط 20 تحت متوسط 50 أو إغلاق دون الوقف المرجعي.' },
  base: { name: 'اختراق قاعدة سعرية', invalidation: 'عودة الإغلاق إلى داخل القاعدة أو دون الوقف المرجعي.' },
  volume: { name: 'اختراق بحجم مرتفع', invalidation: 'إغلاق دون مستوى الاختراق، فالاختراق ضعيف الحجم لاحقاً لا يُعتد به.' },
};
export const SCAN_IDS = Object.keys(RULES);
export const evaluate = (id, s, f, i) => RULES[id](s, f, i);
export const fires = (id, s, f, i) => i >= 1 && evaluate(id, s, f, i).every(c => c.ok);

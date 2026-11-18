// هل مناطق الدعم والمقاومة تتنبأ فعلاً بارتداد السعر؟ يقارن طريقتين وخطاً مرجعياً عشوائياً بنفس قاعدة الاختبار.
//   node scripts/backtest/sr-eval.mjs [--step=5] [--limit=0]
// الحدث: السعر (إغلاق اليوم i) على بعد ≤ 1×ATR فوق مستوى الدعم (أو تحت المقاومة). النجاح: خلال 10 جلسات يتحرك السعر 1.5×ATR
// في الاتجاه المتوقع قبل أن يغلق 0.5×ATR خلف المستوى. حدث واحد لكل سهم كل 10 جلسات. المعايير ثُبّتت قبل التشغيل ولم تُضبط على النتائج.
import { loadStocks } from './data.mjs';
import { atr as atrSeries } from '../../dist/scanner/indicators.mjs';
import { nearestZones } from '../sr-levels.mjs';
import { swingLevels } from '../quality-keys.mjs';

const arg = (n, d) => { const m = process.argv.find(a => a.startsWith(`--${n}=`)); return m ? +m.split('=')[1] : d; };
const STEP = arg('step', 5), LIMIT = arg('limit', 0), HOLD = 10, MOVE = 1.5, BREAK = 0.5, NEAR = 1.0;
const { stocks } = await loadStocks();
// مولّد عشوائي مُبذَّر ليكون الخط المرجعي قابلاً للإعادة
let seed = 12345; const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

function outcome(s, i, level, a, side) {
  const c0 = s.c[i];
  for (let m = i + 1; m <= Math.min(s.c.length - 1, i + HOLD); m++) {
    if (side === 'support') { if (s.c[m] < level - BREAK * a) return 0; if (s.h[m] >= c0 + MOVE * a) return 1; }
    else { if (s.c[m] > level + BREAK * a) return 0; if (s.l[m] <= c0 - MOVE * a) return 1; }
  }
  return null; // لم يحسم خلال المهلة: يُستبعد
}

const stats = {};
const add = (method, side, window, r, bin = 'all') => { const k = `${method}|${side}|${window}|${bin}`; const e = (stats[k] ||= { n: 0, win: 0 }); e.n++; e.win += r; };
let used = 0;
for (const s of LIMIT ? stocks.slice(0, LIMIT) : stocks) {
  if (s.d.length < 600) continue;
  used++;
  const atr = atrSeries(s.h, s.l, s.c, 14), last = { new: {}, old: {}, ctl: {} };
  for (let i = 500; i < s.d.length - HOLD - 1; i += STEP) {
    if (s.d[i] < '2015-01-01') continue;
    const a = atr[i]; if (!(a > 0) || s.v[i] <= 0 || s.est[i]) continue;
    const win = s.d[i] < '2022-01-01' ? 'dev' : 'hold', c = s.c[i];
    const nz = nearestZones(s.h, s.l, s.c, i, undefined, atr), old = swingLevels(s.h, s.l, s.c, i);
    const cands = {
      new: { support: nz.support?.center, resistance: nz.resistance?.center },
      old: { support: old.support, resistance: old.resistance },
      ctl: { support: c - rand() * NEAR * a, resistance: c + rand() * NEAR * a },
    };
    for (const [method, lv] of Object.entries(cands)) {
      for (const side of ['support', 'resistance']) {
        const level = lv[side]; if (level == null) continue;
        const dist = side === 'support' ? c - level : level - c;
        if (dist < 0 || dist > NEAR * a) continue;
        if (last[method][side] != null && i - last[method][side] < HOLD) continue;
        const r = outcome(s, i, level, a, side); if (r == null) continue;
        last[method][side] = i; add(method, side, win, r); const bin = dist < NEAR * a / 3 ? 'd1' : dist < 2 * NEAR * a / 3 ? 'd2' : 'd3'; add(method, side, win, r, bin);
        if (method === 'new') { const z = nz[side]; if (z.touches >= 3) add('new3', side, win, r); if (z.touches >= 3) add('new3', side, win, r, bin); }
      }
    }
  }
}
console.log(`stocks ${used}, step ${STEP}`);
for (const side of ['support', 'resistance']) for (const win of ['dev', 'hold']) for (const bin of ['all', 'd1', 'd2', 'd3']) {
  const line = ['new', 'new3', 'old', 'ctl'].map(m => { const e = stats[`${m}|${side}|${win}|${bin}`] || { n: 0, win: 0 }; return `${m}: ${(100 * e.win / Math.max(1, e.n)).toFixed(1)}% (n=${e.n})`; }).join('   ');
  console.log(`${side.padEnd(10)} ${win.padEnd(4)} ${bin.padEnd(3)} ${line}`);
}

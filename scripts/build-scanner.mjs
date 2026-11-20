// «مفاتيح جودة السهم»: يحسب المفاتيح الستة لكل سهم مرة لكل جلسة رسمية ويكتب dist/scanner/signals.json.
// يعمل بعد update-ohlc.mjs و update-tasi.mjs:  node scripts/build-scanner.mjs
//
// قواعد يفرضها هذا الملف (الصفحة لا تحسب شيئاً بنفسها):
//  * لا نتيجة لسهم إلا إذا كانت آخر شمعة له هي الإغلاق الرسمي لأحدث جلسة
//  * التحقق من الإغلاق الرسمي: تاريخ lastOfficialClose يطابق أحدث شمعة وسعره يطابق إغلاقها (لا نشترط حالة السعر اللحظية،
//    فهي «متأخر» طوال الجلسة التالية بينما شمعة الأمس رسمية)
//  * الموقوف والقديم وغير المتحقق منه والقصير التاريخ وضعيف جودة البيانات وسيولته دون مليون ريال يومياً
//    يُسجَّل سببه في meta.excluded ولا تُحسب له مفاتيح
//  * إذا لم يطابق تاريخ الإغلاق الرسمي أحدث شمعة لا يُنشر شيء (meta.valid = false)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadStocks, loadMarket, OHLC_DIR, DIST } from './backtest/data.mjs';
import { readCandles } from './ohlc-files.mjs';
import { sma, atr as atrSeries } from '../dist/scanner/indicators.mjs';
import { nearestZones, SR_DEFAULTS } from './sr-levels.mjs';
import { adjustCandles } from './adjust-dividends.mjs';
import { KEY_IDS, KEY_LABELS, MIN_SCORE, DIVIDEND_MIN, computeKeys, financialKey, financialKeyAsOf, tasiKey, levelPosition, precompute, runStart, loadFinancials } from './quality-keys.mjs';

const OUT = new URL('../dist/scanner/signals.json', import.meta.url);
const WARMUP = 250; // جلسات لازمة قبل الحكم (متوسط 200 مع هامش)
const HISTORY = 120; // جلسات تُفحص للخلف لتحديد تاريخ بدء الإشارة (نحو ستة أشهر)
const THRESHOLDS = [4, 5, 6]; // العتبات التي يختارها المستخدم في الواجهة
const r = (x, d = 2) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

const { stocks } = await loadStocks();
const { data } = loadMarket();
const official = new Map(data.sectors.flatMap(sec => sec.stocks).map(s => [s.symbol, s]));
const ohlcIndex = JSON.parse(readFileSync(new URL('../dist/ohlc/index.json', import.meta.url), 'utf8'));
const newest = stocks.map(s => s.d.at(-1)).sort().at(-1);
const meta = { valid: true, dataDate: newest, officialDate: ohlcIndex.officialDate, generatedAt: new Date().toISOString(), universe: stocks.length, scanned: 0, minScore: MIN_SCORE, historySessions: HISTORY, dividendMin: DIVIDEND_MIN, excluded: {}, reasonInvalid: null };
const keys = Object.fromEntries(KEY_IDS.map(id => [id, KEY_LABELS[id]]));

const publish = payload => {
  // لا commit في كل تشغيل إن لم يتغير شيء سوى الساعة
  if (existsSync(OUT)) { try { const old = JSON.parse(readFileSync(OUT, 'utf8')); const strip = ({ meta: m, ...rest }) => JSON.stringify({ ...rest, meta: { ...m, generatedAt: 0 } }); if (strip(old) === strip(payload)) { console.log('scanner: unchanged'); return; } } catch { /* rewrite */ } }
  writeFileSync(OUT, JSON.stringify(payload) + '\n');
  console.log(`scanner: wrote ${Object.keys(payload.stocks).length} stocks (${newest})`);
};

if (ohlcIndex.officialDate !== newest) {
  meta.valid = false; meta.reasonInvalid = `آخر إغلاق رسمي ${ohlcIndex.officialDate} لا يطابق أحدث شمعة ${newest}`;
  publish({ meta, keys, stocks: {} });
  process.exit(0);
}

// مؤشر السوق الرسمي TASI
const tasiFile = await readCandles(OHLC_DIR, 'TASI');
const tasi = tasiKey(tasiFile?.c);
const tasiPre = tasiFile?.c ? precompute(tasiFile.c) : null;
// مفتاح السوق كما كان في تاريخ ما: آخر شمعة TASI بتاريخ ≤ تاريخ الشمعة (المؤشر مرجع واحد لكل الأسهم)
const tasiAt = date => { const d = tasiFile?.d; if (!d) return false; let lo = 0, hi = d.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m] <= date) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 ? tasiKey(tasiFile.c, k, tasiPre) : tasiKey(null); };
const tasiCache = new Map(); const tasiOn = date => { if (!tasiCache.has(date)) tasiCache.set(date, tasiAt(date)); return tasiCache.get(date); };
meta.tasi = { trend: tasi.trend, date: tasiFile?.d?.at(-1) ?? null, stale: tasiFile?.d?.at(-1) !== newest, detail: tasi.detail };
const financials = loadFinancials(DIST);

const skip = (reason, symbol) => (meta.excluded[reason] ||= []).push(symbol);
const outStocks = {};
const count = (flags, from) => { let n = 0; for (let k = from; k < flags.length; k++) if (flags[k]) n++; return n; };

for (const s of stocks) {
  const i = s.d.length - 1, o = official.get(s.symbol);
  if (s.suspended || o?.suspended) { skip('suspended', s.symbol); continue; }
  if (s.d[i] !== newest) { skip('stale', s.symbol); continue; }
  if (!o || o.lastOfficialClose?.date !== newest || Math.abs(o.lastOfficialClose.price / s.c[i] - 1) > 0.005) { skip('unverified', s.symbol); continue; }
  if (i < WARMUP) { skip('shortHistory', s.symbol); continue; }
  if (s.est[i] || s.flag[i] || count(s.flag, i - 19) > 0 || count(s.est, i - 19) > 3) { skip('dataQuality', s.symbol); continue; }
  const avgVal20 = sma(s.val, 20)[i];
  if (!(avgVal20 >= 1e6)) { skip('illiquid', s.symbol); continue; }
  meta.scanned += 1;

  // كل المفاتيح والمناطق على السلسلة المعدّلة للتوزيعات النقدية (كما يعرضها الشارت افتراضياً)، فتنطبق المناطق على الشموع المعروضة.
  // السعر المعروض في الجدول هو الإغلاق الرسمي (آخر شمعة لا يمسّها التعديل). الشموع المقدَّرة أو المُعلَّمة لا تُبنى عليها محاور.
  const adj = adjustCandles(s, s.div), H = adj.h, L = adj.l, C = adj.c;
  const sr = { ...SR_DEFAULTS, bad: s.d.map((_, k) => s.est[k] || s.flag[k]) };
  const c = s.c[i];
  const sma50 = sma(C, 50)[i], sma200 = sma(C, 200)[i];
  const atrArr = atrSeries(H, L, C, 14), pre = precompute(C);
  const { support, resistance, atr } = nearestZones(H, L, C, i, sr, atrArr, s.d);
  const avgVol20Prev = sma(s.v, 20)[i - 1], volRatio = avgVol20Prev > 0 ? s.v[i] / avgVol20Prev : null;

  const k = computeKeys({ close: C, i, support, resistance, atr, financial: financialKey(financials.get(s.symbol)), tasi, dividendYield: o.dividendYield, pre });

  // مجموع المفاتيح في كل جلسة من آخر HISTORY جلسة بما كان معلوماً وقتها (مناطق الدعم من شموع حتى ذلك اليوم، TASI بتاريخه، والأرباع
  // المتاحة وقتها بقاعدة تأخير تقريبية). الجلسة الأخيرة هي نتيجة اليوم نفسها فلا تختلف عمّا يُعرض.
  const scores = [], dates = [];
  for (let j = Math.max(WARMUP, i - HISTORY + 1); j <= i; j++) {
    dates.push(s.d[j]);
    if (j === i) { scores.push(k.score); continue; }
    const z = nearestZones(H, L, C, j, sr, atrArr, s.d);
    scores.push(computeKeys({ close: C, i: j, support: z.support, resistance: z.resistance, atr: z.atr, financial: financialKeyAsOf(financials.get(s.symbol), s.d[j]), tasi: tasiOn(s.d[j]), dividendYield: null, pre }).score);
  }
  const since = Object.fromEntries(THRESHOLDS.map(th => [th, runStart(scores, dates, th)]).filter(([, v]) => v));
  outStocks[s.symbol] = {
    name: s.name, sector: s.sector, price: r(c), tradedValue: r(c * s.v[i], 0), avgVal20: r(avgVal20, 0), volRatio: r(volRatio),
    score: k.score, bits: k.bits, trend: k.trend, dividendYield: r(o.dividendYield), dividendOk: k.dividendOk,
    levelPos: levelPosition(c, support, resistance, atr), since, hist: scores.slice(-30).join(''),
    support: r(support?.center), resistance: r(resistance?.center), supportZone: support ? [r(support.low), r(support.high), support.touches, s.d[support.first]] : null, resistanceZone: resistance ? [r(resistance.low), r(resistance.high), resistance.touches, s.d[resistance.first]] : null, atr: r(atr), sma50: r(sma50), sma200: r(sma200),
    keys: Object.fromEntries(KEY_IDS.map(id => [id, [k.keys[id].ok, k.keys[id].detail]])),
  };
}

const scores = Object.values(outStocks).map(x => x.score);
meta.counts = { six: scores.filter(x => x === 6).length, five: scores.filter(x => x === 5).length };
publish({ meta, keys, stocks: outStocks });

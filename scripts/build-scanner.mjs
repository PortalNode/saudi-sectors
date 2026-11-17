// Scans every stock once per official session and writes dist/scanner/signals.json for the technical page.
// Run after update-ohlc.mjs:  node scripts/build-scanner.mjs
//
// Rules this file enforces (the page never recomputes them):
//  * no signal unless the last candle of the stock is the official close of the newest session
//  * stocks that are suspended, stale, illiquid, too young or whose last bar is estimated/flagged are listed
//    under meta.excluded with the reason and produce no signal
//  * a signal fired today is "new"; one that fired earlier in the last 10 sessions and is still above its
//    reference stop is "continuing" and keeps its first date (so it is not repeated as new every day)
//  * if the official date does not match the newest candle date, nothing is published (meta.valid = false)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadStocks, loadMarket } from './backtest/data.mjs';
import { buildIndex, buildSectorIndices } from './backtest/market.mjs';
import { marketContext, computeFeatures, addRsRank } from './backtest/features.mjs';
import { eligible, WARMUP } from './backtest/engine.mjs';
import { RULES, STRATEGY_INFO, SCAN_IDS, fires } from './scanner-engine.mjs';

const OUT = new URL('../dist/scanner/signals.json', import.meta.url);
const WINDOW = 10, STOP_ATR = 2;
const r = (x, d = 2) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

const { stocks } = await loadStocks();
const { data } = loadMarket();
const official = new Map(data.sectors.flatMap(sec => sec.stocks).map(s => [s.symbol, s]));
const ohlcIndex = JSON.parse(readFileSync(new URL('../dist/ohlc/index.json', import.meta.url), 'utf8'));
const newest = stocks.map(s => s.d.at(-1)).sort().at(-1);
const meta = { valid: true, dataDate: newest, officialDate: ohlcIndex.officialDate, generatedAt: new Date().toISOString(), universe: stocks.length, scanned: 0, excluded: {}, reasonInvalid: null };

const publish = payload => {
  // avoid a commit every run when nothing but the clock changed
  if (existsSync(OUT)) { try { const old = JSON.parse(readFileSync(OUT, 'utf8')); const strip = ({ meta: m, ...rest }) => JSON.stringify({ ...rest, meta: { ...m, generatedAt: 0 } }); if (strip(old) === strip(payload)) { console.log('scanner: unchanged'); return; } } catch { /* rewrite */ } }
  writeFileSync(OUT, JSON.stringify(payload) + '\n');
  console.log(`scanner: wrote ${payload.items.length} signals for ${Object.keys(payload.stocks).length} stocks (${newest})`);
};
const strategies = Object.fromEntries(SCAN_IDS.map(id => [id, { name: STRATEGY_INFO[id].name, invalidation: STRATEGY_INFO[id].invalidation, conditions: RULES[id]({ c: [0, 0], o: [0, 0], l: [0, 0], v: [0, 0] }, new Proxy({}, { get: () => [null, null] }), 1).map(c => c.label) }]));

if (ohlcIndex.officialDate !== newest) {
  meta.valid = false; meta.reasonInvalid = `آخر إغلاق رسمي ${ohlcIndex.officialDate} لا يطابق أحدث شمعة ${newest}`;
  publish({ meta, strategies, items: [], stocks: {} });
  process.exit(0);
}

const market = buildIndex(stocks, { cap: 0.1, start: '2010-01-01' }), mkt = marketContext(market);
const sectorIdx = buildSectorIndices(stocks, { cap: 0.1, start: '2010-01-01' });
const sectorCtx = new Map([...sectorIdx].map(([name, idx]) => [name, marketContext(idx)]));
const feats = stocks.map(s => computeFeatures(s, mkt, sectorIdx.get(s.sector) || null));
addRsRank(stocks, feats);
const last = a => a.at(-1);
meta.market = { regime: last(mkt.regime), roc63: r(last(mkt.roc63)), note: 'مؤشر سوق تقريبي مبني من الأسهم، لا مؤشر تاسي الرسمي' };

const skip = (reason, symbol) => (meta.excluded[reason] ||= []).push(symbol);
const outStocks = {}, items = [];

stocks.forEach((s, k) => {
  const f = feats[k], i = s.d.length - 1, o = official.get(s.symbol);
  if (s.suspended || o?.suspended) return skip('suspended', s.symbol);
  if (s.d[i] !== newest) return skip('stale', s.symbol);
  if (!o || o.priceStatus !== 'official_close' || o.lastOfficialClose?.date !== newest || Math.abs(o.lastOfficialClose.price / s.c[i] - 1) > 0.005) return skip('unverified', s.symbol);
  if (i < WARMUP) return skip('shortHistory', s.symbol);
  if (s.est[i] || s.flag[i] || f.nFlag20[i] > 0 || f.nEst20[i] > 3) return skip('dataQuality', s.symbol);
  if (!(f.avgVal20[i] >= 1e6)) return skip('illiquid', s.symbol);
  meta.scanned += 1;

  const c = s.c[i], atr = f.atr[i], mh = f.macd[i]?.hist ?? null;
  const trend = f.sma50[i] != null && f.sma200[i] != null && c > f.sma50[i] && f.sma50[i] > f.sma200[i] && f.sma50Slope[i] > 0 ? 'up' : f.sma50[i] != null && f.sma200[i] != null && c < f.sma50[i] && f.sma50[i] < f.sma200[i] ? 'down' : 'side';
  const sec = sectorCtx.get(s.sector), secPos = sec?.pos.get(s.d[i]);
  const sectorTrend = sec && secPos != null ? sec.regime[secPos] : 'na';
  const below = [f.ll20[i], f.ll60[i], f.sma20[i], f.sma50[i], f.sma200[i]].filter(x => x != null && x < c), support = below.length ? Math.max(...below) : null;
  const above = [20, 60, 120, 252].map(n => Math.max(...s.h.slice(Math.max(0, i - n + 1), i + 1))).filter(x => x > c), resistance = above.length ? Math.min(...above) : null;
  const volRatio = f.avgVol20Prev[i] > 0 ? s.v[i] / f.avgVol20Prev[i] : null;
  const stop = c - STOP_ATR * atr, risk = c - stop;
  const supporting = [], opposing = [], add = (cond, yes, no) => (cond ? supporting : opposing).push(cond ? yes : no);
  add(c > f.sma20[i], 'الإغلاق فوق متوسط 20', 'الإغلاق دون متوسط 20');
  add(trend === 'up', 'اتجاه السهم صاعد (50 فوق 200 والإغلاق فوق 50)', trend === 'down' ? 'اتجاه السهم هابط' : 'اتجاه السهم غير واضح');
  add(f.rsi[i] >= 50 && f.rsi[i] <= 70, 'RSI بين 50 و70 (زخم إيجابي دون تشبّع)', f.rsi[i] > 70 ? 'RSI فوق 70 (تشبّع شرائي)' : 'RSI دون 50 (زخم ضعيف)');
  add(mh != null && mh > 0, 'هيستوغرام MACD موجب', 'هيستوغرام MACD سالب');
  add(f.adx.adx[i] != null && f.adx.adx[i] >= 20, 'ADX فوق 20 (اتجاه ذو قوة)', 'ADX دون 20 (اتجاه ضعيف)');
  add(f.rsVsMarket63[i] > 0, 'أقوى من السوق خلال 63 جلسة', 'أضعف من السوق خلال 63 جلسة');
  if (f.rsVsSector63?.[i] != null) add(f.rsVsSector63[i] > 0, 'أقوى من قطاعه خلال 63 جلسة', 'أضعف من قطاعه خلال 63 جلسة');
  add(sectorTrend === 'up', 'القطاع في اتجاه صاعد', sectorTrend === 'down' ? 'القطاع في اتجاه هابط' : 'اتجاه القطاع غير صاعد');
  add(last(mkt.regime) === 'up', 'السوق في اتجاه صاعد', last(mkt.regime) === 'down' ? 'السوق في اتجاه هابط' : 'اتجاه السوق غير صاعد');
  if (volRatio != null) add(volRatio >= 1.5, 'حجم اليوم مرتفع عن المتوسط', volRatio < 0.8 ? 'حجم اليوم أضعف من المتوسط' : 'حجم اليوم عادي');
  if (risk / c > 0.08) opposing.push('المسافة إلى الوقف المرجعي واسعة (أكثر من 8%)');
  if (c > f.sma20[i] * 1.1) opposing.push('السعر ممتد أكثر من 10% فوق متوسط 20');

  const stratBits = {};
  for (const id of SCAN_IDS) {
    stratBits[id] = RULES[id](s, f, i).map(x => (x.ok ? 1 : 0)).join('');
    // fired within the last WINDOW sessions? take the first such bar and test it is still valid
    let first = -1;
    for (let j = i - WINDOW + 1; j <= i; j++) if (j >= WARMUP && eligible(s, f, j) && fires(id, s, f, j)) { first = j; break; }
    if (first < 0) continue;
    const sigStop = s.c[first] - STOP_ATR * f.atr[first];
    if (c <= sigStop) continue; // the reference stop was already hit: the idea is invalid, not "continuing"
    const rr = s.c[first] - sigStop;
    items.push({
      symbol: s.symbol, strategy: id, status: first === i ? 'new' : 'continuing', signalDate: s.d[first], ageSessions: i - first,
      entryRef: r(s.c[first]), stop: r(sigStop), target1: r(s.c[first] + rr), target2: r(s.c[first] + 2 * rr), riskPct: r(100 * rr / s.c[first], 1),
      conds: RULES[id](s, f, first).map(x => [x.ok ? 1 : 0, x.detail]),
    });
  }
  outStocks[s.symbol] = {
    name: s.name, sector: s.sector, price: r(c), tradedValue: r(o.tradedValue, 0), volRatio: r(volRatio), avgVal20: r(f.avgVal20[i], 0), avgVal60: r(f.avgVal60[i], 0),
    trend, sectorTrend, rsi: r(f.rsi[i], 1), adx: r(f.adx.adx[i], 1), macdHist: r(mh, 3), roc63: r(f.roc63[i], 1), rsVsMarket63: r(f.rsVsMarket63[i], 1), rsVsSector63: r(f.rsVsSector63?.[i], 1),
    atr: r(atr), atrPct: r(100 * atr / c, 1), sma20: r(f.sma20[i]), sma50: r(f.sma50[i]), sma200: r(f.sma200[i]), support: r(support), resistance: r(resistance),
    levels: { entryRef: r(c), stop: r(stop), target1: r(c + risk), target2: r(c + 2 * risk), riskPct: r(100 * risk / c, 1) },
    supporting, opposing, strat: stratBits,
  };
});

items.sort((a, b) => a.ageSessions - b.ageSessions || (outStocks[b.symbol].avgVal20 - outStocks[a.symbol].avgVal20));
publish({ meta, strategies, items, stocks: outStocks });

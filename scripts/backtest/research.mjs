// Runs the eight strategies and their baseline through the backtest engine.
//   node scripts/backtest/research.mjs               development window only (2014-2021)
//   node scripts/backtest/research.mjs --holdout     ALSO the held-out window (2022-) and the acceptance verdicts
// Parameters are the pre-registered defaults in strategies.mjs; the hold-out is read once, after the dev review.
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadStocks } from './data.mjs';
import { buildIndex, buildSectorIndices } from './market.mjs';
import { marketContext, computeFeatures, addRsRank } from './features.mjs';
import { STRATEGIES, DEFAULTS, NAMES } from './strategies.mjs';
import { simulateStock, COSTS, EXITS } from './engine.mjs';
import { runPortfolio, ACCOUNT } from './portfolio.mjs';
import { summarize, groupBy, tStat, tStatClustered, curveStats, pct, num } from './stats.mjs';

const HOLDOUT = process.argv.includes('--holdout');
const START = '2014-01-01', DEV_END = '2021-12-31', HOLD_START = '2022-01-01';
const { stocks } = await loadStocks();
const market = buildIndex(stocks, { cap: 0.1, start: '2010-01-01' });
const mkt = marketContext(market);
const sectors = buildSectorIndices(stocks, { cap: 0.1, start: '2010-01-01' });
const feats = stocks.map(s => computeFeatures(s, mkt, sectors.get(s.sector) || null));
addRsRank(stocks, feats);
const bySymbol = new Map(stocks.map(s => [s.symbol, s]));
const lastDate = stocks.map(s => s.d.at(-1)).sort().at(-1);

const VARIANTS = {
  breakout: [{ n: 20 }, { n: 40 }, { n: 55 }], pullback: [{ touch: 0.005 }, { touch: 0.01 }, { touch: 0.02 }],
  squeeze: [{ rank: 10, lookback: 5 }, { rank: 20, lookback: 5 }, { rank: 30, lookback: 5 }], reversal: [{ n: 60, near: 0.01, rsiBelow: 40 }, { n: 60, near: 0.02, rsiBelow: 40 }, { n: 60, near: 0.04, rsiBelow: 40 }],
  rs: [{ minRank: 70, n: 20 }, { minRank: 80, n: 20 }, { minRank: 90, n: 20 }], cross: [{ fast: 20, slow: 50 }, { fast: 50, slow: 200 }],
  base: [{ n: 60, maxWidth: 0.15 }, { n: 60, maxWidth: 0.25 }, { n: 60, maxWidth: 0.35 }], volume: [{ n: 55, mult: 1.5 }, { n: 55, mult: 2 }, { n: 55, mult: 3 }],
};
const DEFAULT_VARIANT = { breakout: 2, pullback: 1, squeeze: 1, reversal: 1, rs: 1, cross: 0, base: 1, volume: 1 };
const ok = x => x != null && Number.isFinite(x);
const signalFor = (name, params) => name === 'baseline' ? (s, f, i) => ok(f.sma50[i]) && ok(f.sma200[i]) && f.sma50[i] > f.sma200[i] : (s, f, i) => STRATEGIES[name](s, f, i, params);

const cache = new Map();
function tradesFor(name, params, exitKey, costs = COSTS, costTag = 'x1') {
  const key = JSON.stringify([name, params, exitKey, costTag]);
  if (!cache.has(key)) {
    const sig = signalFor(name, params), all = [];
    stocks.forEach((s, k) => all.push(...simulateStock(s, feats[k], sig, { exit: EXITS[exitKey], costs, from: START })));
    cache.set(key, all);
  }
  return cache.get(key);
}
const inWin = (trades, a, b) => trades.filter(t => t.signalDate >= a && t.signalDate <= b);
const row = (label, trades) => { const s = summarize(trades); return `${label.padEnd(26)} n=${String(s.n).padStart(5)}  win ${pct(s.winRate).padStart(6)}  avgW ${pct(s.avgWin).padStart(6)}  avgL ${pct(s.avgLoss).padStart(7)}  PF ${num(s.profitFactor).padStart(5)}  expR ${num(s.expectancyR).padStart(6)}  avgRet ${pct(s.avgRet, 2).padStart(7)}  t=${num(tStat(trades), 1).padStart(5)} tM=${num(tStatClustered(trades), 1).padStart(5)}`; };
const years = (a, b) => { const out = []; for (let y = +a.slice(0, 4); y <= +b.slice(0, 4); y++) out.push(y); return out; };
const yearTable = (trades, a, b) => years(a, b).map(y => { const t = trades.filter(x => x.signalDate.startsWith(String(y))); return t.length >= 15 ? `${y}:${num(summarize(t).expectancyR, 2)}(${t.length})` : `${y}:·`; }).join(' ');

const SEEDS = [1, 2, 3, 4, 5];
// Average of five random-priority runs: which signals fill the limited cash/slots is chance, not skill.
function portfolioFor(trades, a, b) {
  const dates = market.dates.filter(d => d >= a && d <= b), t = inWin(trades, a, b).filter(x => x.exitDate <= b);
  const runs = SEEDS.map(seed => runPortfolio(t, bySymbol, dates, { ...ACCOUNT, seed }));
  const avg = k => runs.reduce((x, r) => x + r[k], 0) / runs.length;
  return { totalReturn: avg('totalReturn'), cagr: avg('cagr'), maxDrawdown: avg('maxDrawdown'), taken: Math.round(avg('taken')), skipped: Math.round(avg('skipped')), worstCagr: Math.min(...runs.map(r => r.cagr)), bestCagr: Math.max(...runs.map(r => r.cagr)) };
}
function benchmark(a, b) {
  const idx = market.dates.map((d, i) => ({ date: d, equity: market.level[i] })).filter(p => p.date >= a && p.date <= b);
  return curveStats(idx);
}

function window(label, a, b) {
  console.log(`\n================ ${label}: signals ${a} → ${b} ================`);
  const bm = benchmark(a, b);
  console.log(`مؤشر السوق التقريبي (احتفاظ): عائد ${pct(bm.totalReturn)}  سنوي ${pct(bm.cagr)}  أقصى تراجع ${pct(bm.maxDrawdown)}`);
  const result = {};
  for (const exitKey of Object.keys(EXITS)) {
    console.log(`\n--- exit: ${exitKey} ---`);
    const base = inWin(tradesFor('baseline', {}, exitKey), a, b);
    console.log(row('baseline (sma50>sma200)', base));
    result[exitKey] = { baseline: summarize(base) };
    for (const name of Object.keys(STRATEGIES)) {
      const params = VARIANTS[name][DEFAULT_VARIANT[name]], t = inWin(tradesFor(name, params, exitKey), a, b);
      console.log(row(`${name} ${NAMES[name]}`.slice(0, 26), t));
      result[exitKey][name] = summarize(t);
    }
  }
  return result;
}

const out = { generated: new Date().toISOString(), lastDate, costs: COSTS, exits: EXITS, dev: window('DEVELOPMENT', START, DEV_END) };

// ---- development detail for the default variants under the better exit ----
console.log('\n=========== development detail (per strategy, better exit chosen on dev expectancy) ===========');
const exitChoice = {};
for (const name of Object.keys(STRATEGIES)) {
  const params = VARIANTS[name][DEFAULT_VARIANT[name]];
  const score = k => { const t = inWin(tradesFor(name, params, k), START, DEV_END); return t.length >= 100 ? summarize(t).expectancyR : -9; };
  exitChoice[name] = score('trail') > score('target') ? 'trail' : 'target';
  const t = inWin(tradesFor(name, params, exitChoice[name]), START, DEV_END);
  console.log(`\n${name} (${NAMES[name]}) exit=${exitChoice[name]}`);
  console.log('  by year  ', yearTable(t, START, DEV_END));
  console.log('  by regime', [...groupBy(t, x => x.regime)].map(([k, v]) => `${k}:${num(summarize(v).expectancyR, 2)}(${v.length})`).join(' '));
  const pf = portfolioFor(tradesFor(name, params, exitChoice[name]), START, DEV_END);
  console.log(`  portfolio: return ${pct(pf.totalReturn)}  annual ${pct(pf.cagr)}  max drawdown ${pct(pf.maxDrawdown)}  (taken ${pf.taken}, skipped ${pf.skipped}; annual range over seeds ${pct(pf.worstCagr)}..${pct(pf.bestCagr)})`);
}
out.exitChoice = exitChoice;

if (HOLDOUT) {
  out.holdout = window('HOLD-OUT (read once)', HOLD_START, lastDate);
  console.log('\n=========== ACCEPTANCE VERDICTS (criteria fixed in docs/scanner-research.md) ===========');
  const double = { ...COSTS, commission: COSTS.commission * 2, slipTiers: COSTS.slipTiers.map(([m, s]) => [m, s * 2]) };
  out.verdicts = {};
  for (const name of Object.keys(STRATEGIES)) {
    const params = VARIANTS[name][DEFAULT_VARIANT[name]], ex = exitChoice[name];
    const hold = inWin(tradesFor(name, params, ex), HOLD_START, lastDate), s = summarize(hold);
    const base = summarize(inWin(tradesFor('baseline', {}, ex), HOLD_START, lastDate));
    // calendar years 2015..last with >= 15 trades, whole period (dev + hold)
    const allT = tradesFor(name, params, ex), ys = years('2015', lastDate).map(y => allT.filter(t => t.signalDate.startsWith(String(y)))).filter(t => t.length >= 15);
    const posYears = ys.filter(t => summarize(t).expectancyR > 0).length;
    const dbl = summarize(inWin(tradesFor(name, params, ex, double, 'x2'), HOLD_START, lastDate));
    // walk-forward: choose the variant on the previous 3 years, trade the next year
    const wf = [];
    for (let y = 2017; y <= +lastDate.slice(0, 4); y++) {
      let best = null;
      for (const v of VARIANTS[name]) {
        const tr = inWin(tradesFor(name, v, ex), `${y - 3}-01-01`, `${y - 1}-12-31`), sm = summarize(tr);
        if (sm.n >= 30 && (!best || sm.expectancyR > best.e)) best = { v, e: sm.expectancyR };
      }
      if (best) wf.push(...inWin(tradesFor(name, best.v, ex), `${y}-01-01`, `${y}-12-31`));
    }
    const wfS = summarize(wf);
    const pfH = portfolioFor(allT, HOLD_START, lastDate);
    const checks = {
      trades100: s.n >= 100, expR: s.expectancyR > 0.1 && s.profitFactor > 1.3, beatsBaseline: s.expectancyR > base.expectancyR,
      yearsPositive: ys.length > 0 && posYears / ys.length >= 0.6, doubledCosts: dbl.expectancyR > 0, walkForward: wfS.n >= 30 && wfS.expectancyR > 0, portfolioPositive: pfH.cagr > 0,
    };
    const pass = Object.values(checks).every(Boolean);
    out.verdicts[name] = { pass, checks, hold: s, baseline: base, doubled: dbl, walkForward: wfS, positiveYears: `${posYears}/${ys.length}`, portfolio: { totalReturn: pfH.totalReturn, cagr: pfH.cagr, maxDrawdown: pfH.maxDrawdown } };
    console.log(`\n${pass ? '✔ مثبتة ' : '✘ غير مثبتة'}  ${name} (${NAMES[name]}) exit=${ex}`);
    console.log('  ' + row('hold-out', hold)); console.log('  ' + row('baseline hold-out', inWin(tradesFor('baseline', {}, ex), HOLD_START, lastDate)));
    console.log('  ' + row('doubled costs', inWin(tradesFor(name, params, ex, double, 'x2'), HOLD_START, lastDate)));
    console.log('  ' + row('walk-forward OOS', wf));
    console.log(`  positive years ${posYears}/${ys.length} | by year ${yearTable(allT, '2015', lastDate)}`);
    console.log(`  portfolio hold-out: return ${pct(pfH.totalReturn)}  annual ${pct(pfH.cagr)}  max drawdown ${pct(pfH.maxDrawdown)}`);
    console.log('  checks', Object.entries(checks).map(([k, v]) => `${v ? '✓' : '✗'}${k}`).join(' '));
  }
  mkdirSync(new URL('../../docs/research/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../../docs/research/results.json', import.meta.url), JSON.stringify(out, null, 1));
}

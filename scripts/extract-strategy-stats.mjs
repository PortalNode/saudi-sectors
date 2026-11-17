// Copies the published backtest numbers from docs/research/results.json into dist/scanner/strategy-stats.json,
// the file the scanner page shows next to every signal. Run after `node scripts/backtest/research.mjs --holdout`.
import { readFileSync, writeFileSync } from 'node:fs';
import { STRATEGY_INFO, SCAN_IDS } from './scanner-engine.mjs';

const results = JSON.parse(readFileSync(new URL('../docs/research/results.json', import.meta.url), 'utf8'));
const pick = s => ({ trades: s.n, winRate: s.winRate, avgWin: s.avgWin, avgLoss: s.avgLoss, profitFactor: s.profitFactor, expectancyR: s.expectancyR });
const stats = {
  note: 'نتائج اختبار تاريخي بعد العمولة والانزلاق. لا توجد استراتيجية اجتازت معايير القبول، فكلها غير مثبتة.',
  generatedFrom: 'docs/scanner-research.md', dataThrough: results.lastDate,
  windows: { development: '2014-01-01 → 2021-12-31', holdOut: `2022-01-01 → ${results.lastDate}` },
  strategies: {},
};
for (const id of SCAN_IDS) {
  const exit = results.exitChoice[id], v = results.verdicts[id];
  stats.strategies[id] = {
    name: STRATEGY_INFO[id].name, verdict: v.pass ? 'proven' : 'unproven', exit,
    development: pick(results.dev[exit][id]), holdOut: pick(v.hold), walkForward: pick(v.walkForward),
    positiveYears: v.positiveYears, failed: Object.entries(v.checks).filter(([, ok]) => !ok).map(([k]) => k),
    portfolioHoldOut: v.portfolio,
  };
}
stats.baseline = { holdOut: pick(results.verdicts.breakout.baseline), description: 'أي سهم في اتجاه صاعد (متوسط 50 فوق 200) بنفس المخرج والتكاليف' };
writeFileSync(new URL('../dist/scanner/strategy-stats.json', import.meta.url), JSON.stringify(stats, null, 1) + '\n');
console.log('wrote dist/scanner/strategy-stats.json');

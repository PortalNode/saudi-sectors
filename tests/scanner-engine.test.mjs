import test from 'node:test';
import assert from 'node:assert/strict';
import { readCandles } from '../scripts/ohlc-files.mjs';
import { computeFeatures, marketContext } from '../scripts/backtest/features.mjs';
import { buildIndex } from '../scripts/backtest/market.mjs';
import { STRATEGIES } from '../scripts/backtest/strategies.mjs';
import { RULES, SCAN_IDS, fires, STRATEGY_INFO } from '../scripts/scanner-engine.mjs';

// The live scanner must fire on exactly the bars the backtest fired on, otherwise the published
// statistics would describe a different rule from the one on screen.
test('every scanner rule equals its backtested strategy on every bar of real stocks', async () => {
  const dir = new URL('../dist/ohlc/', import.meta.url);
  let compared = 0, fired = 0;
  for (const symbol of ['2222', '1120', '2010', '4030', '7010']) {
    const file = await readCandles(dir, symbol);
    if (!file) continue;
    const s = { symbol, sector: 'x', d: file.d, o: file.o, h: file.h, l: file.l, c: file.c, v: file.v, est: file.d.map(() => false), flag: file.d.map(() => false), val: file.c.map((c, i) => c * file.v[i]), shares: 1 };
    const f = computeFeatures(s, marketContext(buildIndex([s], { cap: 1 })));
    f.rsRank = f.rsRank.map((_, i) => (i * 37) % 100); // the real rank needs every stock; any fixed series exercises the rule
    for (const id of SCAN_IDS) for (let i = 250; i < s.d.length; i++) {
      const a = !!STRATEGIES[id](s, f, i), b = fires(id, s, f, i);
      compared += 1; if (a) fired += 1;
      assert.equal(b, a, `${symbol} ${id} ${s.d[i]}`);
    }
  }
  assert.ok(compared > 20000 && fired > 100, `compared ${compared}, fired ${fired}`);
});

test('every rule exposes labelled conditions, and a missing number can never pass', () => {
  const n = 300, flat = Array(n).fill(10);
  const s = { d: flat.map((_, i) => `d${i}`), o: flat, h: flat, l: flat, c: flat, v: flat };
  const nulls = new Proxy({}, { get: () => Array(n).fill(null) });
  for (const id of SCAN_IDS) {
    const conds = RULES[id](s, nulls, 280);
    assert.ok(conds.length >= 2 && conds.every(c => typeof c.label === 'string' && c.label.length > 5), id);
    assert.equal(conds.every(c => c.ok), false, `${id} must not fire on missing data`);
    assert.ok(STRATEGY_INFO[id].name && STRATEGY_INFO[id].invalidation);
  }
  assert.ok(!('reversal' in RULES), 'the losing reversal strategy is not offered');
});

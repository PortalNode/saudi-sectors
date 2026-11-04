import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyWeek52Range } from './week52-range.mjs';

const candidate = (low, high, referencePrice = 50) => ({ low, high, referencePrice });

test('selects real valid source values and does not synthesize new extremes', () => {
  const stock = { price: 50 };
  assert.equal(applyWeek52Range(stock, [candidate(null, 80), candidate(40, 80)]), 'updated');
  assert.deepEqual(stock, { price: 50, week52Low: 40, week52High: 80 });
});

test('retains old valid values on failed fetch, but does not show an incompatible range', () => {
  const stock = { price: 50, week52Low: 40, week52High: 80, week52Source:'TradingView', week52CheckedAt:'2026-11-04T09:00:00Z' };
  assert.equal(applyWeek52Range(stock, []), 'retained');
  assert.deepEqual([stock.week52Low, stock.week52High], [40, 80]);
  assert.equal(stock.week52Source, 'TradingView');
  assert.equal(stock.week52CheckedAt, '2026-11-04T09:00:00Z');
  stock.price = 90;
  assert.equal(applyWeek52Range(stock, []), 'incompatible');
  assert.deepEqual([stock.week52Low, stock.week52High], [null, null]);
  assert.equal(stock.week52CheckedAt, undefined);
});

test('rejects missing, zero, reversed, string and divergent-provider values', () => {
  const stock = { price: 50 };
  assert.equal(applyWeek52Range(stock, [
    candidate(null, 80), candidate(0, 80), candidate(80, 40),
    candidate('40', 80), candidate(40, 80, 90), candidate(51, 80, 60),
  ]), 'unavailable');
  assert.deepEqual([stock.week52Low, stock.week52High], [null, null]);
});

test('accepts a real zero-width range for a thinly traded or new stock', () => {
  const stock = { price: 20 };
  assert.equal(applyWeek52Range(stock, [candidate(20, 20, 20)]), 'updated');
  assert.deepEqual([stock.week52Low, stock.week52High], [20, 20]);
});

const mockFetch = `
const values = {
  A: {close:50, currency:'SAR', ytd:5, low:40, high:80},
  B: {close:10, currency:'SAR', ytd:3, low:null, high:null},
  C: {close:25, currency:'SAR', ytd:4, low:20, high:24},
  D: {close:20, currency:'SAR', ytd:0, low:20, high:20},
  E: {close:30, currency:'USD', ytd:1, low:20, high:40},
};
globalThis.fetch = async (address, options = {}) => {
  const url = String(address);
  if (process.env.MOCK_MUTATE_DATA) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.MOCK_MUTATE_DATA, ' ');
    delete process.env.MOCK_MUTATE_DATA;
  }
  if (url === 'https://fc.yahoo.com') {
    if (process.env.MOCK_YAHOO !== '1') throw Error('blocked');
    return { headers: { getSetCookie: () => ['A=x; Path=/'] } };
  }
  if (url.includes('/v1/test/getcrumb')) return new Response('crumb');
  if (url.includes('/v7/finance/quote')) {
    return Response.json({quoteResponse:{result:Object.entries(values).map(([symbol, x]) => ({
      symbol:symbol+'.SR', currency:x.currency, regularMarketPrice:x.close,
      regularMarketPreviousClose:x.close, regularMarketTime:1793779200,
      fiftyTwoWeekLow: symbol === 'A' ? 42 : null, fiftyTwoWeekHigh: symbol === 'A' ? 70 : null,
    }))}});
  }
  if (url.includes('/v8/finance/chart/')) {
    if (process.env.MOCK_YAHOO_CHART !== '1') throw Error('Yahoo temporarily blocked');
    const symbol = url.split('/chart/')[1].split('.')[0];
    const x = values[symbol];
    return Response.json({chart:{result:[{
      meta:{currency:x.currency, chartPreviousClose:x.close,
        fiftyTwoWeekLow:symbol === 'A' ? 43 : null, fiftyTwoWeekHigh:symbol === 'A' ? 71 : null},
      timestamp:[1793779200], indicators:{quote:[{close:[x.close]}]},
    }]}});
  }
  if (url.includes('scanner.tradingview.com')) {
    const body = JSON.parse(options.body);
    if (process.env.MOCK_REJECT_TV === '1') return new Response('blocked', {status:429});
    if (process.env.MOCK_REJECT_52 === '1' && body.columns.includes('price_52_week_low'))
      return new Response('unsupported', {status:400});
    const rows = (body.symbols?.tickers || []).map(ticker => {
      const symbol = ticker.split(':')[1];
      const x = values[symbol] || {close:100, currency:'SAR', ytd:2, low:90, high:110};
      const d = body.columns.map(column => ({
        close:x.close, change:0, change_abs:0, currency:x.currency,
        'Perf.YTD':x.ytd, price_52_week_low:x.low, price_52_week_high:x.high,
        'Perf.3M':1, 'Perf.6M':2, 'Perf.Y':3,
      })[column] ?? null);
      return {s:ticker,d};
    });
    return Response.json({data:rows});
  }
  if (url.includes('saudiexchange.sa')) return new Response('<html></html>');
  throw Error('Unexpected URL '+url);
};
`;

const fixture = () => ({
  asOf: '2026-11-04', priceDate: '04.11.2026',
  sectors: [{ name: 'test', stocks: [
    { symbol:'A', price:50, marker:'unchanged' },
    { symbol:'B', price:10, week52Low:8, week52High:12 },
    { symbol:'C', price:25, week52Low:10, week52High:20 },
    { symbol:'D', price:20 },
    { symbol:'E', price:30 },
  ] }],
});
const scriptDir = fileURLToPath(new URL('.', import.meta.url));

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'week52-test-'));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'dist'));
  for (const name of ['update-prices.mjs', 'week52-range.mjs', 'backfill-week52-only.mjs']) {
    await copyFile(join(scriptDir, name), join(root, 'scripts', name));
  }
  await writeFile(join(root, 'mock.mjs'), mockFetch);
  await writeFile(join(root, 'dist', 'data.json'), JSON.stringify(fixture()));
  await writeFile(join(root, 'dist', 'financial-map.json'), JSON.stringify({companyIds:{}}));
  return root;
}
function execute(root, script, extra = [], env = {}) {
  const result = spawnSync(process.execPath, ['--import', join(root, 'mock.mjs'), join(root, 'scripts', script), ...extra], {
    cwd:root, encoding:'utf8', env:{...process.env, YAHOO_CONCURRENCY:'1', YAHOO_DELAY_MS:'0',
      YAHOO_MAX_RETRIES:'0', YAHOO_FAIL_FAST:'1', ...env}, timeout:15000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
  return result.stdout;
}
async function dataAt(root) { return JSON.parse(await readFile(join(root, 'dist', 'data.json'), 'utf8')); }

test('full updater uses live-equivalent fallback, retains old data and nulls incompatible ranges', async () => {
  const root = await sandbox();
  try {
    const out = execute(root, 'update-prices.mjs');
    const stocks = (await dataAt(root)).sectors[0].stocks;
    assert.deepEqual(stocks.map(s => [s.week52Low, s.week52High]), [[40,80],[8,12],[null,null],[20,20],[null,null]]);
    assert.equal(stocks[0].ytd, 5);
    assert.match(out, /TradingView: 4\/5 remaining symbols/);
    assert.match(out, /52-week ranges: 2 updated, 1 retained, 1 incompatible with price, 1 unavailable/);
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('Yahoo range takes priority and TradingView supplies fallback without corrupting other quotes', async () => {
  const root = await sandbox();
  try {
    execute(root, 'update-prices.mjs', [], {MOCK_YAHOO:'1'});
    const stocks = (await dataAt(root)).sectors[0].stocks;
    assert.deepEqual([stocks[0].week52Low, stocks[0].week52High], [42,70]);
    assert.deepEqual([stocks[1].week52Low, stocks[1].week52High], [8,12]);
    assert.deepEqual([stocks[3].week52Low, stocks[3].week52High], [20,20]);
    assert.deepEqual([stocks[4].week52Low, stocks[4].week52High], [null,null]);
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('unsupported extra scanner fields fall back to old price and YTD requests', async () => {
  const root = await sandbox();
  try {
    const out = execute(root, 'update-prices.mjs', [], {MOCK_REJECT_52:'1'});
    const stocks = (await dataAt(root)).sectors[0].stocks;
    assert.equal(stocks[0].price, 50);
    assert.equal(stocks[0].ytd, 5);
    assert.deepEqual([stocks[0].week52Low, stocks[0].week52High], [null,null]);
    assert.deepEqual([stocks[1].week52Low, stocks[1].week52High], [8,12]);
    assert.match(out, /retrying original fields/);
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('backfill preview never writes, and explicit write only changes 52-week fields', async () => {
  const root = await sandbox();
  try {
    const path = join(root, 'dist', 'data.json');
    const before = await readFile(path, 'utf8');
    execute(root, 'backfill-week52-only.mjs');
    assert.equal(await readFile(path, 'utf8'), before);
    execute(root, 'backfill-week52-only.mjs', ['--write']);
    const after = await dataAt(root);
    assert.deepEqual(after.sectors[0].stocks.map(s => [s.week52Low, s.week52High]), [[40,80],[8,12],[null,null],[20,20],[null,null]]);
    assert.equal(after.sectors[0].stocks[0].week52Source, 'TradingView');
    assert.ok(!Number.isNaN(Date.parse(after.sectors[0].stocks[0].week52CheckedAt)));
    for (const stock of after.sectors[0].stocks) { delete stock.week52Low; delete stock.week52High; delete stock.week52Source; delete stock.week52CheckedAt; }
    const original = JSON.parse(before);
    for (const stock of original.sectors[0].stocks) { delete stock.week52Low; delete stock.week52High; }
    assert.deepEqual(after, original);
  } finally { await rm(root, {recursive:true, force:true}); }
});


test('Yahoo daily chart metadata supplies a range without a one-year history request', async () => {
  const root = await sandbox();
  try {
    execute(root, 'update-prices.mjs', [], {MOCK_YAHOO_CHART:'1'});
    const stocks = (await dataAt(root)).sectors[0].stocks;
    assert.deepEqual([stocks[0].week52Low, stocks[0].week52High], [43,71]);
    assert.deepEqual([stocks[3].week52Low, stocks[3].week52High], [20,20]);
    assert.deepEqual([stocks[4].week52Low, stocks[4].week52High], [null,null]);
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('price failures do not overwrite the original data file', async () => {
  const root = await sandbox();
  try {
    const path = join(root, 'dist', 'data.json');
    const before = await readFile(path, 'utf8');
    const result = spawnSync(process.execPath, ['--import', join(root, 'mock.mjs'), join(root, 'scripts', 'update-prices.mjs')], {
      cwd:root, encoding:'utf8', timeout:15000, env:{...process.env, MOCK_REJECT_TV:'1', YAHOO_CONCURRENCY:'1',
        YAHOO_DELAY_MS:'0', YAHOO_MAX_RETRIES:'0', YAHOO_FAIL_FAST:'1'},
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /data.json left untouched/);
    assert.equal(await readFile(path, 'utf8'), before);
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('backfill refuses to overwrite a file changed while it was fetching', async () => {
  const root = await sandbox();
  try {
    const path = join(root, 'dist', 'data.json');
    const before = await readFile(path, 'utf8');
    const result = spawnSync(process.execPath, ['--import', join(root, 'mock.mjs'), join(root, 'scripts', 'backfill-week52-only.mjs'), '--write'], {
      cwd:root, encoding:'utf8', timeout:15000, env:{...process.env, MOCK_MUTATE_DATA:path},
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Data changed during fetch/);
    assert.equal(await readFile(path, 'utf8'), before + ' ');
  } finally { await rm(root, {recursive:true, force:true}); }
});

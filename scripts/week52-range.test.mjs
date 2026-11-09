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
test('retains compatible old ranges, otherwise clears both extremes', () => {
  const stock = { price: 50, week52Low: 40, week52High: 80, week52Source: 'TradingView', week52CheckedAt: '2026-11-04T09:00:00Z' };
  assert.equal(applyWeek52Range(stock, []), 'retained');
  assert.equal(stock.week52CheckedAt, '2026-11-04T09:00:00Z');
  stock.price = 90;
  assert.equal(applyWeek52Range(stock, []), 'incompatible');
  assert.deepEqual([stock.week52Low, stock.week52High], [null, null]);
});
test('rejects missing, zero, reversed, string and divergent-provider values', () => {
  const stock = { price: 50 };
  assert.equal(applyWeek52Range(stock, [candidate(null, 80), candidate(0, 80), candidate(80, 40),
    candidate('40', 80), candidate(40, 80, 90), candidate(51, 80, 60)]), 'unavailable');
});
test('accepts a real zero-width range', () => {
  const stock = { price: 20 };
  assert.equal(applyWeek52Range(stock, [candidate(20, 20, 20)]), 'updated');
});

const mockFetch = `
const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : ['2026-11-04T18:00:00Z'])); }
  static now() { return new NativeDate('2026-11-04T18:00:00Z').getTime(); }
};
const values = {
  '1001': {close:50, ytd:5, low:40, high:80},
  '1002': {close:10, ytd:3, low:null, high:null},
  '1003': {close:25, ytd:4, low:20, high:24},
  '1004': {close:20, ytd:0, low:20, high:20},
  '1005': {close:30, ytd:1, low:null, high:null},
};
const cells = values => '<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
globalThis.fetch = async (address, options = {}) => {
  const url = String(address);
  if (process.env.MOCK_MUTATE_DATA) {
    const path = process.env.MOCK_MUTATE_DATA;
    delete process.env.MOCK_MUTATE_DATA;
    const {appendFile} = await import('node:fs/promises');
    await appendFile(path, ' ');
  }
  if (url.includes('saudiexchange.sa')) {
    if (process.env.MOCK_OFFICIAL !== '1') return new Response('Access Denied', {status:403});
    const header = ['Symbol','Company','Open (SAR)','High (SAR)','Low (SAR)','Close (SAR)','% Change','Volume Traded','Value Traded (SAR)','No. of Trades','Market Cap (SAR)'];
    const summary = [['Close','100'],['Change','0'],['% Change','0 %'],['Value Traded (SAR)','10000']];
    const rows = Object.entries(values).map(([symbol,x])=>cells([symbol,'Company',x.close,x.close,x.close,x.close,0,100,10000,10,x.close*1e6]));
    const date = process.env.MOCK_OFFICIAL_DATE || '2026/11/04';
    return new Response('<h1>Market Date '+date+'</h1><table>'+summary.map(cells).join('')+'</table><table>'+cells(header)+rows.join('')+'</table>');
  }
  if (url.includes('scanner.tradingview.com')) {
    const body = JSON.parse(options.body);
    if (process.env.MOCK_REJECT_TV === '1') return new Response('blocked',{status:429});
    if (process.env.MOCK_REJECT_52 === '1' && body.columns.includes('price_52_week_low')) return new Response('unsupported',{status:400});
    const rows = (body.symbols?.tickers || []).map(ticker => {
      const symbol = ticker.split(':')[1], x = values[symbol] || {close:100,ytd:2,low:90,high:110};
      const fields = {close:x.close,change:0,change_abs:0,currency:process.env.MOCK_BAD_CURRENCY==='1'&&symbol==='1005'?'USD':'SAR',
        time:process.env.MOCK_OLD_DATE==='1'?1793689200:1793775600,update_mode:'delayed_streaming_900',market_cap_basic:x.close*1e6,
        'Perf.YTD':x.ytd,'Perf.3M':1,'Perf.6M':2,'Perf.Y':3,price_52_week_low:x.low,price_52_week_high:x.high};
      return {s:ticker,d:body.columns.map(column=>fields[column]??null)};
    });
    return Response.json({data:rows});
  }
  throw Error('Unexpected URL '+url);
};
`;
const fixture = () => ({ asOf: '2026-11-04', priceDate: '04.11.2026', sectors: [{ name: 'test', stocks: [
  { symbol: '1001', price: 50, marker: 'unchanged' },
  { symbol: '1002', price: 10, week52Low: 8, week52High: 12 },
  { symbol: '1003', price: 25, week52Low: 10, week52High: 20 },
  { symbol: '1004', price: 20 }, { symbol: '1005', price: 30 },
] }] });
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'week52-test-'));
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'dist'));
  for (const name of ['update-prices.mjs', 'price-integrity.mjs', 'week52-range.mjs', 'backfill-week52-only.mjs']) {
    await copyFile(join(scriptDir, name), join(root, 'scripts', name));
  }
  await writeFile(join(root, 'mock.mjs'), mockFetch);
  await writeFile(join(root, 'dist', 'data.json'), JSON.stringify(fixture()));
  await writeFile(join(root, 'dist', 'financial-map.json'), JSON.stringify({ companyIds: {} }));
  return root;
}
function run(root, script, extra = [], env = {}) {
  return spawnSync(process.execPath, ['--import', join(root, 'mock.mjs'), join(root, 'scripts', script), ...extra], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 15000,
  });
}
function execute(root, script, extra = [], env = {}) {
  const result = run(root, script, extra, env);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
  return result.stdout;
}
async function dataAt(root) { return JSON.parse(await readFile(join(root, 'dist', 'data.json'), 'utf8')); }
test('dated fallback refreshes prices, preserves compatible ranges and clears incompatible ones', async () => {
  const root = await sandbox();
  try {
    execute(root, 'update-prices.mjs');
    const data = await dataAt(root), stocks = data.sectors[0].stocks;
    assert.deepEqual(stocks.map(s => [s.week52Low, s.week52High]), [[40,80],[8,12],[null,null],[20,20],[null,null]]);
    assert.equal(stocks[0].ytd, 5);
    assert.equal(stocks[0].priceDate, '2026-11-04');
    assert.equal(data.priceSource.mode, 'delayed');
    assert.equal(data.priceSource.officialDate, null);
    assert.equal(data.marketSummary.source, 'TradingView');
    assert.equal(data.marketSummary.turnover, null, 'after-hours fallback must not show a provisional value as official');
    assert.equal(data.marketSummary.turnoverEstimated, false);
    assert.ok(stocks.every(stock => stock.priceSource === 'TradingView'));
    assert.ok(stocks.every(stock => stock.tradedValue == null), 'undated aggregator turnover must not be attached to the dated snapshot');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('official completed same-day report wins and has an unmixed index summary', async () => {
  const root = await sandbox();
  try {
    execute(root, 'update-prices.mjs', [], { MOCK_OFFICIAL: '1' });
    const data = await dataAt(root);
    assert.equal(data.priceSource.mode, 'close');
    assert.equal(data.priceSource.officialSymbols, 5);
    assert.equal(data.marketSummary.source, 'Saudi Exchange');
    assert.equal(data.marketSummary.isIntraday, false);
    assert.equal(data.marketSummary.turnover, 10000);
    assert.equal(data.sectors[0].stocks[0].lastOfficialClose.date, '2026-11-04');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('unsupported range fields do not prevent dated prices or YTD', async () => {
  const root = await sandbox();
  try {
    execute(root, 'update-prices.mjs', [], { MOCK_REJECT_52: '1' });
    const stocks = (await dataAt(root)).sectors[0].stocks;
    assert.equal(stocks[0].price, 50); assert.equal(stocks[0].ytd, 5);
    assert.deepEqual([stocks[0].week52Low, stocks[0].week52High], [null,null]);
    assert.deepEqual([stocks[1].week52Low, stocks[1].week52High], [8,12]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('failed, wrong-currency or older-date observations never overwrite the data file', async () => {
  for (const env of [{ MOCK_REJECT_TV: '1' }, { MOCK_BAD_CURRENCY: '1' }, { MOCK_OLD_DATE: '1' }]) {
    const root = await sandbox();
    try {
      const path = join(root, 'dist', 'data.json'), before = await readFile(path, 'utf8');
      const result = run(root, 'update-prices.mjs', [], env);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /data.json left untouched/);
      assert.equal(await readFile(path, 'utf8'), before);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
test('backfill preview never writes; explicit write only changes range fields', async () => {
  const root = await sandbox();
  try {
    const path = join(root, 'dist', 'data.json'), before = await readFile(path, 'utf8');
    execute(root, 'backfill-week52-only.mjs'); assert.equal(await readFile(path, 'utf8'), before);
    execute(root, 'backfill-week52-only.mjs', ['--write']);
    const after = await dataAt(root), original = JSON.parse(before);
    assert.deepEqual(after.sectors[0].stocks.map(s => [s.week52Low,s.week52High]), [[40,80],[8,12],[null,null],[20,20],[null,null]]);
    for (const item of [after, original]) for (const stock of item.sectors[0].stocks) {
      delete stock.week52Low; delete stock.week52High; delete stock.week52Source; delete stock.week52CheckedAt;
    }
    assert.deepEqual(after, original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('both update tools refuse to overwrite concurrent file changes', async () => {
  for (const script of ['backfill-week52-only.mjs', 'update-prices.mjs']) {
    const root = await sandbox();
    try {
      const path = join(root, 'dist', 'data.json'), before = await readFile(path, 'utf8');
      const result = run(root, script, script.startsWith('backfill') ? ['--write'] : [], { MOCK_MUTATE_DATA: path });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Data changed during fetch/);
      assert.equal(await readFile(path, 'utf8'), before + ' ');
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('a transient official-report failure never downgrades a saved official same-session close', async () => {
  const root = await sandbox();
  try {
    execute(root, 'update-prices.mjs', [], { MOCK_OFFICIAL: '1' });
    const before = await dataAt(root);
    execute(root, 'update-prices.mjs');
    const after = await dataAt(root);
    assert.equal(after.priceSource.mode, 'close');
    assert.equal(after.priceSource.officialDate, '2026-11-04');
    assert.ok(after.priceSource.warning);
    assert.equal(after.marketSummary.source, 'Saudi Exchange');
    assert.equal(after.marketSummary.turnover, before.marketSummary.turnover);
    assert.deepEqual(after.sectors[0].stocks.map(s=>s.price), before.sectors[0].stocks.map(s=>s.price));
  } finally { await rm(root, {recursive:true,force:true}); }
});

test('an older non-null official report cannot hide the saved current-session official close', async () => {
  const root = await sandbox();
  try {
    execute(root, 'update-prices.mjs', [], { MOCK_OFFICIAL: '1' });
    execute(root, 'update-prices.mjs', [], { MOCK_OFFICIAL: '1', MOCK_OFFICIAL_DATE: '2026/11/03' });
    const data = await dataAt(root);
    assert.equal(data.priceSource.mode, 'close');
    assert.equal(data.priceSource.officialDate, '2026-11-04');
    assert.equal(data.priceSource.officialSymbols, 5);
    assert.equal(data.marketSummary.source, 'Saudi Exchange');
    assert.equal(data.marketSummary.date, '04.11.2026');
    assert.ok(data.priceSource.warning);
    assert.ok(data.sectors[0].stocks.every(s=>s.priceStatus==='official_close'&&s.priceDate==='2026-11-04'));
  } finally { await rm(root, {recursive:true,force:true}); }
});

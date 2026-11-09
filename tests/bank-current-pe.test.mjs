import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { buildCurrentBankPE, renderCurrentBankPECard } from '../dist/bank-current-pe.mjs';
import { renderAnnualTable } from '../dist/bank-metrics.mjs';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
const annual = JSON.parse(read('banks-financials.json'));
const prices = JSON.parse(read('data.json'));
const financialMap = JSON.parse(read('financial-map.json'));
const now = new Date('2026-11-05T00:00:00Z');
const clone = value => structuredClone(value);
const fields = [
  'symbol', 'name', 'price', 'eps', 'pe', 'status', 'epsKind', 'epsSource',
  'epsPeriod', 'epsDateKind', 'priceDate', 'priceStatus', 'priceSource', 'checkedAt'
];
const bank = { symbol: '1030', name: 'الإستثمار', years: [{ year: 2025, period: 'FY', values: { eps: 987, pe: 654 } }] };
function fixture(stock = {}, record = undefined) {
  return {
    annualBanks: [clone(bank)],
    priceData: {
      financialPeriod: 'آخر أربعة أرباع حتى الربع الثاني 2026',
      priceDate: '04.11.2026',
      priceSource: { provider: 'Saudi Exchange', mode: 'close', officialDate: '2026-11-04', checkedAt: '2026-11-04T18:20:15Z' },
      sectors: [{ name: 'البنوك', stocks: [{ symbol: '1030', name: 'اسم مختلف في ملف الأسعار', price: 20, eps: 2, pe: 999, ...stock }] }]
    },
    map: record === undefined ? null : { snapshot: { '1030': record } }
  };
}
function build(f, clock = now) {
  return buildCurrentBankPE(f.annualBanks, f.priceData, f.map, clock)[0];
}
const snapshot = (extra = {}) => ({ period: '2026-09-30', dateKind: 'sector', recurring: 3, reported: 4, ...extra });
const peText = html => html.match(/data-metric="currentPE">([^<]*)<\/strong>/)?.[1];

// Run the actual app's default hierarchy, without DOM/network initialization.
function appDefaultRecords() {
  const source = read('app.js');
  const boundary = source.indexOf("document.addEventListener('click'");
  assert.ok(boundary > 0);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
  }
  const context = vm.createContext({ Date: FixedDate, Intl, priceFixture: clone(prices), mapFixture: clone(financialMap) });
  vm.runInContext(source.slice(0, boundary), context);
  vm.runInContext(`
    data = priceFixture;
    for (const [symbol, record] of Object.entries(mapFixture.snapshot)) {
      if (periodValid(record.period)) financials.set(symbol, record);
    }
    stats = () => {};
    render = () => {};
    applyFinancials();
  `, context);
  return JSON.parse(vm.runInContext('JSON.stringify(allStocks())', context));
}

test('all 10 repository banks match the real app default recurring hierarchy and formula', () => {
  const result = buildCurrentBankPE(annual.banks, prices, financialMap, now);
  const appStocks = appDefaultRecords();
  assert.equal(result.length, 10);
  assert.deepEqual(result.map(record => record.symbol), annual.banks.map(record => record.symbol));
  for (const [index, record] of result.entries()) {
    const stock = prices.sectors.flatMap(sector => sector.stocks).find(stock => stock.symbol === record.symbol);
    const expected = appStocks.find(stock => stock.symbol === record.symbol);
    assert.deepEqual(Object.keys(record), fields);
    assert.equal(record.name, annual.banks[index].name);
    assert.equal(record.price, stock.price);
    assert.equal(record.eps, financialMap.snapshot[record.symbol].recurring);
    assert.equal(record.eps, expected.eps);
    assert.equal(record.pe, stock.price / record.eps);
    assert.equal(record.pe, expected.pe);
    assert.equal(record.status, 'available');
    assert.equal(record.epsKind, 'متكررة');
    assert.equal(record.epsSource, 'أرقام');
    assert.equal(record.epsPeriod, '2026-09-30');
    assert.equal(record.epsDateKind, 'sector');
    assert.equal(record.priceDate, stock.priceDate);
    assert.equal(record.priceStatus, stock.priceStatus);
    // The price source label follows whatever provider the snapshot used.
    assert.equal(record.priceSource,
      prices.priceSource?.provider === 'Argaam' ? 'أرقام'
        : prices.priceSource?.provider === 'Saudi Exchange' ? 'تداول السعودية' : 'تريدينغ فيو');
    assert.equal(record.checkedAt, stock.priceCheckedAt);
    assert.equal(peText(renderCurrentBankPECard(record)), `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(record.pe)} مرة`);
  }
  const investment = result.find(record => record.symbol === '1030');
  assert.equal(investment.eps, 1.279737);
  assert.notEqual(investment.eps, 1.6365566666666667);
  assert.notEqual(investment.pe, prices.sectors.flatMap(sector => sector.stocks).find(stock => stock.symbol === '1030').pe);
});

test('map omission and unavailable map EPS fall back to stock EPS, never annual EPS or stored PE', () => {
  for (const map of [null, {}, { snapshot: {} }, { snapshot: { '1030': snapshot({ recurring: null, reported: null, book: 99 }) } }]) {
    const f = fixture();
    f.map = map;
    const result = build(f);
    assert.equal(result.eps, 2);
    assert.equal(result.pe, 10);
    assert.equal(result.epsKind, 'ملف الأسعار');
    assert.equal(result.epsSource, 'تداول السعودية');
    assert.equal(result.epsPeriod, f.priceData.financialPeriod);
    assert.equal(result.epsDateKind, null);
  }
  const f = fixture({ eps: null });
  assert.equal(build(f).eps, null);
  assert.equal(build(f).pe, null);
  assert.equal(build(f).status, 'missing-eps');
  assert.equal(buildCurrentBankPE(f.annualBanks, f.priceData)[0].epsKind, 'ملف الأسعار');
});

test('recurring has priority including zero/negative, then reported, then stock EPS', () => {
  for (const [recurring, reported, expected, kind, status] of [
    [3, 4, 3, 'متكررة', 'available'],
    [0, 4, 0, 'متكررة', 'zero-eps'],
    [-3, 4, -3, 'متكررة', 'loss'],
    [null, 4, 4, 'معلنة', 'available'],
    [undefined, 0, 0, 'معلنة', 'zero-eps'],
    ['bad', -4, -4, 'معلنة', 'loss'],
    [Infinity, '4', 4, 'معلنة', 'available'],
    [null, null, 2, 'ملف الأسعار', 'available'],
    ['0', 4, 0, 'متكررة', 'zero-eps'],
    ['-3', 4, -3, 'متكررة', 'loss']
  ]) {
    const result = build(fixture({}, snapshot({ recurring, reported })));
    assert.equal(result.eps, expected);
    assert.equal(result.epsKind, kind);
    assert.equal(result.status, status);
    assert.equal(result.pe, expected > 0 ? 20 / expected : null);
  }
});

test('numeric safety accepts finite strings without turning null/empty/invalid values into zero', () => {
  const valid = build(fixture({ price: ' 20.50 ', eps: '2.5' }));
  assert.equal(valid.price, 20.5);
  assert.equal(valid.eps, 2.5);
  assert.equal(valid.pe, 20.5 / 2.5);
  for (const value of [null, undefined, '', ' ', '\t', 'bad', 'NaN', 'Infinity', NaN, Infinity, -Infinity, true, false, [], {}, ['2']]) {
    const result = build(fixture({ eps: value }));
    assert.equal(result.eps, null, `EPS: ${String(value)}`);
    assert.equal(result.status, 'missing-eps');
    assert.equal(result.pe, null);
    const invalidMap = build(fixture({}, snapshot({ recurring: value, reported: value })));
    assert.equal(invalidMap.eps, 2, `map EPS: ${String(value)}`);
    assert.equal(invalidMap.epsKind, 'ملف الأسعار');
  }
});

test('invalid prices take precedence over missing, zero, and negative denominators', () => {
  for (const price of [null, undefined, '', ' ', 'bad', 'Infinity', NaN, Infinity, 0, '0', -1, '-1', true, false, [], {}]) {
    for (const eps of [null, 0, -2, 2]) {
      const result = build(fixture({ price, eps }));
      assert.equal(result.price, null);
      assert.equal(result.pe, null);
      assert.equal(result.status, 'missing-price');
      assert.equal(result.priceStatus, 'unavailable');
    }
  }
  for (const [eps, status] of [[null, 'missing-eps'], [-2, 'loss'], [0, 'zero-eps'], [2, 'available']]) {
    assert.equal(build(fixture({ eps })).status, status);
  }
});

test('malformed, impossible, future, and pre-2020 periods fall back without borrowing map metadata', () => {
  for (const period of [null, undefined, '', 'bad', '2026-9-30', '2026-09-30T00:00:00Z', '2026-02-30', '2025-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2019-12-31', '2026-11-06', '2099-01-01']) {
    const result = build(fixture({}, snapshot({ period, dateKind: 'checked' })));
    assert.equal(result.eps, 2, String(period));
    assert.equal(result.epsKind, 'ملف الأسعار');
    assert.equal(result.epsDateKind, null);
  }
  for (const period of ['2020-01-01', '2024-02-29', '2026-11-05']) {
    assert.equal(build(fixture({}, snapshot({ period }))).eps, 3, period);
  }
  const f = fixture({}, snapshot({ period: '2026-09-30' }));
  assert.equal(build(f, new Date('2026-09-29T23:59:59Z')).eps, 2);
  assert.equal(build(f, new Date('2026-09-30T00:00:00Z')).eps, 3);
  assert.equal(build(f, new Date('invalid')).eps, 2);
});

test('only exact symbols match; all annual banks retain their own name and order', () => {
  const f = fixture();
  f.annualBanks = [clone(bank), { symbol: '1111', name: 'غير موجود', years: bank.years }, clone(bank)];
  f.priceData.sectors[0].stocks[0].symbol = 'TADAWUL:1030';
  f.priceData.sectors[0].stocks.push({ symbol: 1030, name: bank.name, price: 99, eps: 9 });
  f.map = { snapshot: { 'TADAWUL:1030': snapshot() } };
  const missing = buildCurrentBankPE(f.annualBanks, f.priceData, f.map, now);
  assert.deepEqual(missing.map(record => record.symbol), ['1030', '1111', '1030']);
  assert.ok(missing.every(record => record.price === null && record.eps === null && record.status === 'missing-price'));
  assert.deepEqual(missing.map(record => record.name), f.annualBanks.map(record => record.name));
  f.priceData.sectors[0].stocks.push({ symbol: '1030', name: 'اسم من الأسعار', price: 20, eps: 2 });
  const found = buildCurrentBankPE(f.annualBanks, f.priceData, f.map, now);
  assert.equal(found[0].pe, 10);
  assert.equal(found[2].pe, 10);
  assert.equal(found[1].pe, null);
  assert.notEqual(found[0], found[2]);
  assert.deepEqual(buildCurrentBankPE([], f.priceData, f.map, now), []);
});

test('duplicate exact stocks fail closed only for that bank, including an otherwise valid map', () => {
  for (const acrossSectors of [false, true]) {
    const f = fixture({}, snapshot());
    f.annualBanks.push({ symbol: '1180', name: 'الأهلي' });
    const duplicate = clone(f.priceData.sectors[0].stocks[0]);
    if (acrossSectors) f.priceData.sectors.push({ stocks: [duplicate] });
    else f.priceData.sectors[0].stocks.push(duplicate);
    f.priceData.sectors[0].stocks.push({ symbol: '1180', price: 40, eps: 4 });
    const [ambiguous, unaffected] = buildCurrentBankPE(f.annualBanks, f.priceData, f.map, now);
    for (const key of ['price', 'eps', 'pe', 'epsKind', 'epsSource', 'epsPeriod', 'epsDateKind']) assert.equal(ambiguous[key], null, key);
    assert.equal(ambiguous.status, 'missing-price');
    assert.equal(ambiguous.priceStatus, 'unavailable');
    assert.equal(unaffected.pe, 10);
  }
});

test('missing price sectors do not prevent snapshot EPS and never read annual values', () => {
  for (const priceData of [null, {}, { sectors: null }, { sectors: [null, {}, { stocks: null }] }]) {
    const result = buildCurrentBankPE([bank], priceData, { snapshot: { '1030': snapshot() } }, now)[0];
    assert.equal(result.price, null);
    assert.equal(result.eps, 3);
    assert.equal(result.pe, null);
    assert.equal(result.status, 'missing-price');
  }
  const result = buildCurrentBankPE([bank], null, null, now)[0];
  assert.equal(result.eps, null);
  const inherited = Object.create({ '1030': snapshot() });
  assert.equal(buildCurrentBankPE([bank], null, { snapshot: inherited }, now)[0].eps, null);
});

test('current metadata preserves per-stock dates/status/check time and labels both providers', () => {
  const f = fixture({ priceDate: '2026-11-03', priceStatus: 'delayed', priceSource: 'TradingView', priceCheckedAt: '2026-11-04T19:00:00Z' }, snapshot({ dateKind: 'checked' }));
  let result = build(f);
  assert.equal(result.priceDate, '2026-11-03');
  assert.equal(result.priceStatus, 'delayed');
  assert.equal(result.priceSource, 'تريدينغ فيو');
  assert.equal(result.checkedAt, '2026-11-04T19:00:00Z');
  assert.equal(result.epsDateKind, 'checked');
  let html = renderCurrentBankPECard(result);
  assert.match(html, /فُحصت بيانات الشركة في 2026-09-30/);
  assert.match(html, /ليس تاريخ نهاية الفترة المالية أو تحديث القطاع/);
  assert.match(html, /سعر متأخر · غير مؤكد رسميًا/);
  assert.doesNotMatch(html, /آخر تحديث للقطاع:/);
  delete f.priceData.sectors[0].stocks[0].priceDate;
  delete f.priceData.sectors[0].stocks[0].priceStatus;
  delete f.priceData.sectors[0].stocks[0].priceSource;
  delete f.priceData.sectors[0].stocks[0].priceCheckedAt;
  result = build(f);
  assert.equal(result.priceDate, '2026-11-04');
  assert.equal(result.priceStatus, 'official_close');
  assert.equal(result.priceSource, 'تداول السعودية');
  assert.equal(result.checkedAt, f.priceData.priceSource.checkedAt);
  delete f.priceData.priceSource.officialDate;
  assert.equal(build(f).priceDate, '04.11.2026');
  f.priceData.priceSource.provider = 'TradingView';
  f.priceData.priceSource.mode = 'delayed';
  assert.equal(build(f).priceSource, 'تريدينغ فيو');
  assert.equal(build(f).priceStatus, 'delayed');
  f.priceData.priceSource.provider = 'Custom source';
  assert.equal(build(f).priceSource, 'Custom source');
  f.map.snapshot['1030'].dateKind = 'custom';
  assert.equal(build(f).epsDateKind, 'custom');
  html = renderCurrentBankPECard(build(f));
  assert.match(html, /نوع التاريخ: custom/);
});

test('builder and renderer do not mutate any inputs or original annual table output', () => {
  const input = clone({ annual, prices, financialMap });
  const before = clone(input);
  const tables = input.annual.banks.map(bank => renderAnnualTable(bank));
  function freeze(value) {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  freeze(input);
  const result = buildCurrentBankPE(input.annual.banks, input.prices, input.financialMap, now);
  const records = clone(result);
  for (const record of result) renderCurrentBankPECard(freeze(record));
  assert.deepEqual(input, before);
  assert.deepEqual(result, records);
  assert.deepEqual(input.annual.banks.map(bank => renderAnnualTable(bank)), tables);
});

test('card exposes formula, current metadata, EPS kind and snapshot/not-live disclaimer', () => {
  for (const [record, kind] of [[snapshot(), 'متكررة'], [snapshot({ recurring: null }), 'معلنة'], [undefined, 'ملف الأسعار']]) {
    const result = build(fixture({}, record));
    const html = renderCurrentBankPECard(result);
    assert.match(html, /^<article class="bank-current-pe-card"/);
    assert.match(html, /مكرر الربح الحالي/);
    assert.ok(html.includes(kind));
    assert.match(html, /سعر السهم ÷ ربحية السهم/);
    assert.match(html, /أحدث لقطة بيانات متاحة/);
    assert.match(html, /ليس سعرًا لحظيًا/);
    assert.match(html, /تاريخ السعر/);
    assert.match(html, /آخر فحص لنسخة الأسعار/);
    assert.ok(html.includes(result.priceDate));
    assert.ok(html.includes(result.checkedAt));
    assert.ok(html.includes(result.epsPeriod));
    assert.match(html.replace(/<[^>]*>/g, ''), /20\.00 ريال/);
    assert.match(html, /<time datetime=/);
    assert.match(html, /بتوقيت الرياض/);
  }
});

test('nonavailable statuses never display stale numeric PE; loss and zero are explained', () => {
  for (const [stock, status, text] of [
    [{ eps: -2 }, 'loss', 'خاسرة'], [{ eps: 0 }, 'zero-eps', '—'],
    [{ eps: null }, 'missing-eps', '—'], [{ price: null }, 'missing-price', '—']
  ]) {
    const record = build(fixture(stock));
    assert.equal(record.status, status);
    record.pe = 999; // A stale externally supplied ratio must not leak into the card.
    const html = renderCurrentBankPECard(record);
    assert.equal(peText(html), text);
    assert.doesNotMatch(html, /999|NaN|Infinity/);
    if (status === 'zero-eps') assert.match(html, /القسمة على صفر/);
    if (status === 'loss') assert.match(html, /ربحية السهم سالبة/);
  }
  const extreme = build(fixture({ price: 1e308, eps: 1e-308 }));
  assert.equal(extreme.pe, null);
  assert.equal(peText(renderCurrentBankPECard(extreme)), '—');
  assert.doesNotMatch(renderCurrentBankPECard(extreme), /NaN|Infinity/);
});

test('renderer escapes arbitrary names, symbol/status attributes and every source/date field', () => {
  const payload = '<img src=x onerror="alert(1)"> & \' <script>alert(2)</script>';
  const record = build(fixture({}, snapshot({ dateKind: payload })));
  for (const key of ['symbol', 'name', 'epsKind', 'epsSource', 'epsPeriod', 'epsDateKind', 'priceDate', 'priceStatus', 'priceSource', 'checkedAt']) record[key] = payload;
  record.status = payload;
  const html = renderCurrentBankPECard(record);
  assert.doesNotMatch(html, /<img|<script|data-symbol="<|data-status="</);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;/);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.equal(peText(html), '—');
  const f = fixture({ priceSource: payload }, snapshot({ dateKind: payload }));
  f.annualBanks[0].name = payload;
  const built = build(f);
  assert.equal(built.name, payload);
  assert.equal(built.priceSource, payload);
  assert.equal(built.epsDateKind, payload);
  assert.doesNotMatch(renderCurrentBankPECard(built), /<img|<script/);
});

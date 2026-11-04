import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const stock = (symbol, name, extra = {}) => ({
  symbol, name, price: 20, eps: 2, pe: 777, bookValue: 4, pb: 888,
  marketCap: 100, day: 10, ytd: 4, month3: 1, month6: 2, year1: 3,
  dividendYield: 3.5, dividendYieldSource: 'Argaam Dividend Yield (%) (Last Year)',
  ...extra
});
function fixture(mode = 'delayed', checkedAt = '2026-11-04T09:20:00Z') {
  const official = mode === 'close';
  return {
    asOf: '2026-11-04', priceDate: official ? '03.11.2026' : '04.11.2026',
    financialPeriod: 'آخر أربعة أرباع حتى الربع الثالث 2026',
    priceSource: {
      provider: official ? 'Saudi Exchange' : 'TradingView', mode, checkedAt,
      observedDate: official ? '2026-11-03' : '2026-11-04', delayMinutes: null,
      officialDate: official ? '2026-11-03' : null, warning: null, unavailableSymbols: 0
    },
    sectors: [
      { name: 'القطاع الأول', stocks: [
        stock('1111', 'Alpha', { priceDate: '2026-11-03', priceSource: official ? 'Saudi Exchange' : 'TradingView', priceStatus: official ? 'official_close' : 'delayed', priceTimestamp: '2026-11-03T07:00:00Z', performanceDate: '2026' }),
        stock('1112', 'Beta', { marketCap: 300, day: -10, eps: -2, bookValue: 0, dividendYield: null, priceDate: '2026-11-02', priceSource: 'TradingView', priceStatus: 'delayed' })
      ] },
      { name: 'القطاع الثاني', stocks: [stock('2222', 'Gamma', { price: null, marketCap: null, day: null, priceDate: null, priceSource: 'TradingView', priceStatus: 'unavailable', priceTimestamp: null })] }
    ],
    marketSummary: { value: 10000, day: 1, pointChange: 99, turnover: 1234, date: '2026-11-02', isIntraday: false, source: 'Saudi Exchange', updatedAt: '2026-11-04T09:18:00Z', mode: 'close', performanceDate: '2026-11-01', ytd: 5, month3: 2, month6: 3, year1: -1 }
  };
}
const response = value => ({ ok: true, status: 200, json: async () => clone(value) });
async function settle() { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); }
function harness(initial = fixture(), { map = { snapshot: {}, companyIds: {}, sectorIds: [] } } = {}) {
  const nodes = new Map(), documentListeners = new Map(), intervals = [], calls = [], queue = [initial];
  let clock = Date.parse('2026-11-04T10:00:00Z');
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  function node(id) {
    if (!nodes.has(id)) {
      const listeners = new Map(), classes = new Set(), children = new Map();
      nodes.set(id, {
        textContent: '', innerHTML: '', hidden: id === 'empty', value: '', attributes: {}, listeners, classes,
        classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, listener) { listeners.set(type, listener); },
        querySelector(selector) { if (!children.has(selector)) children.set(selector, { textContent: '', scrollLeft: 0 }); return children.get(selector); },
        focus() {}, scrollIntoView() {}
      });
    }
    return nodes.get(id);
  }
  const document = {
    hidden: false, getElementById: node,
    addEventListener(type, listener) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(listener); }
  };
  const context = vm.createContext({
    document, Intl, Date: ClockDate, Map, Number, String, Math, Promise,
    setInterval(callback, milliseconds) { intervals.push({ callback, milliseconds }); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith('financial-map.json')) { if (map instanceof Error) throw map; return response(map); }
      assert.match(url, /^data\.json\?v=\d+$/);
      if (!queue.length) throw new Error('No queued price response');
      const item = queue.shift();
      if (item instanceof Error) throw item;
      return typeof item === 'function' ? await item() : response(item);
    }
  });
  const evaluate = expression => vm.runInContext(expression, context);
  vm.runInContext(source, context);
  return {
    node, document, intervals, calls, queue, evaluate,
    setClock(value) { clock = Date.parse(value); },
    event(type) { for (const listener of documentListeners.get(type) || []) listener({}); },
    async refresh(item) { queue.push(item); const accepted = await evaluate('refreshPrices()'); await settle(); return accepted; }
  };
}
const groups = [];
async function test(name, run) { await run(); groups.push(name); console.log(`PASS ${name}`); }

await test('legacy and new source labels, individual dates, safe unavailable values', async () => {
  const legacy = fixture('intraday');
  legacy.priceSource.delayMinutes = 15;
  delete legacy.priceSource.observedDate;
  for (const sector of legacy.sectors) for (const item of sector.stocks) { delete item.priceDate; delete item.priceStatus; }
  delete legacy.marketSummary.mode;
  legacy.marketSummary.isIntraday = true;
  legacy.marketSummary.quoteSource = 'TradingView';
  const h = harness(legacy); await settle();
  assert.match(h.node('price-mode').textContent, /أسعار متأخرة.*15 دقيقة/);
  assert.doesNotMatch(h.node('price-mode').textContent, /إغلاق|الآن/);
  assert.equal(h.node('price-source').textContent, 'تريدينغ فيو');
  assert.match(h.evaluate('stockPriceLabel(allStocks()[0])'), /تاريخ السعر غير متاح/);
  assert.doesNotMatch(h.evaluate('stockPriceLabel(allStocks()[0])'), /04\.11\.2026|إغلاق|آخر صفقة/);
  assert.match(h.node('market-date').textContent, /بيانات متأخرة.*02\.11\.2026.*تريدينغ فيو/);
  assert.doesNotMatch(h.node('market-date').textContent, /الآن|إغلاق|04\.11\.2026.*تداول السعودية/);
  const next = fixture('close', '2026-11-04T10:00:00Z');
  assert.equal(await h.refresh(next), true);
  assert.equal(h.node('price-mode').textContent, 'إغلاق رسمي');
  assert.equal(h.node('price-date').textContent, '03.11.2026');
  assert.equal(h.node('price-source').textContent, 'تداول السعودية');
  const firstRow = h.evaluate('row(allStocks()[0])');
  assert.match(firstRow, /<td title="إغلاق رسمي · 03\.11\.2026 · المصدر: تداول السعودية">/);
  assert.match(firstRow, /القيمة السوقية · إغلاق رسمي · 03\.11\.2026/);
  assert.match(firstRow, /تاريخ بيانات الأداء: 2026/);
  const delayedRow = h.evaluate('row(allStocks()[1])');
  assert.match(delayedRow, /سعر متأخر · غير مؤكد رسميًا · 02\.11\.2026 · المصدر: تريدينغ فيو/);
  assert.doesNotMatch(delayedRow, /إغلاق|آخر صفقة/);
  assert.match(h.evaluate('stockPriceLabel(allStocks()[2])'), /السعر غير متاح.*تاريخ السعر غير متاح/);
  assert.doesNotMatch(h.node('sectors').innerHTML, /NaN|Infinity/);
  assert.match(h.node('market-date').textContent, /إغلاق رسمي · 02\.11\.2026 · تداول السعودية/);
  assert.match(h.node('market-stats').innerHTML, /تاريخ بيانات الأداء: 2026-11-01/);
});

await test('daily index change uses direction triangles and absolute separated values', async () => {
  const h = harness(); await settle();
  const up = h.evaluate('marketDailyChange({day:1.65,pointChange:162.76})');
  assert.match(up, /▲/);
  assert.match(up, /market-points[^>]*>162\.76<\/bdi>/);
  assert.match(up, /<bdi>1\.65<\/bdi> %/);
  assert.doesNotMatch(up, /\+|\(|\)|▼/);
  const down = h.evaluate('marketDailyChange({day:-1.65,pointChange:-162.76})');
  assert.match(down, /▼/);
  assert.match(down, /انخفاض/);
  assert.match(down, /162\.76/);
  assert.doesNotMatch(down, /▲|-162\.76|-1\.65/);
  assert.doesNotMatch(h.evaluate('marketDailyChange({day:0,pointChange:0})'), /▲|▼/);
  assert.equal(h.evaluate('marketDailyChange({day:null,pointChange:null})'), '—');
  assert.match(h.evaluate('marketDailyChange({day:1,pointChange:null})'), /التغيير بالنقاط غير متاح/);
  h.evaluate('data.marketSummary.day=-1.65;data.marketSummary.pointChange=-162.76;paintMarketSummary()');
  assert.match(h.node('market-stats').innerHTML, /التغيير اليومي<\/span><strong class="down">/);
  h.evaluate('data.marketSummary.day=1.65;data.marketSummary.pointChange=162.76;paintMarketSummary()');
  assert.match(h.node('market-stats').innerHTML, /التغيير اليومي<\/span><strong class="up">/);
});

await test('warning, checkedAt, 35-minute threshold only in usual market hours', async () => {
  const initial = fixture(); initial.priceSource.warning = 'تحذير المصدر <نص>';
  initial.priceSource.unavailableSymbols = 1;
  const h = harness(initial); await settle();
  assert.match(h.node('price-status').textContent, /تحذير المصدر <نص>.*السعر غير متاح لـ 1 سهمًا.*آخر فحص.*نسخة الأسعار قديمة/);
  assert.match(h.node('price-status').textContent, /04\/11\/2026/);
  assert.doesNotMatch(h.node('price-mode').textContent, /15 دقيقة|إغلاق/);
  h.setClock('2026-11-04T09:55:00Z'); h.evaluate('paintSnapshot()');
  assert.doesNotMatch(h.node('price-status').textContent, /نسخة الأسعار قديمة/);
  h.setClock('2026-11-04T09:55:01Z'); h.evaluate('paintSnapshot()');
  assert.match(h.node('price-status').textContent, /نسخة الأسعار قديمة/);
  for (const time of ['2026-11-04T06:59:00Z', '2026-11-04T12:20:00Z', '2026-11-06T10:00:00Z', '2026-11-07T10:00:00Z']) {
    h.setClock(time); h.evaluate('paintSnapshot()');
    assert.doesNotMatch(h.node('price-status').textContent, /نسخة الأسعار قديمة/, time);
  }
  h.setClock('2026-11-08T07:00:00Z'); h.evaluate('paintSnapshot()');
  assert.match(h.node('price-status').textContent, /نسخة الأسعار قديمة/);
  h.evaluate("data.priceSource.mode='close';data.priceSource.officialDate=null;data.priceDate=null;paintSnapshot()");
  assert.equal(h.node('price-date').textContent, '—');
  assert.match(h.node('price-mode').textContent, /آخر إغلاق متاح/);
  assert.doesNotMatch(h.node('price-mode').textContent, /2026|15 دقيقة/);
  h.evaluate('data.priceSource.checkedAt=null;paintSnapshot()');
  assert.match(h.node('price-status').textContent, /وقت آخر فحص.*غير متاح/);
  assert.doesNotMatch(h.node('price-status').textContent, /نسخة الأسعار قديمة/);
});

await test('PE/PB always recomputed; sector dividend ratios never replace last-year yield', async () => {
  const h = harness(); await settle();
  assert.equal(h.evaluate('allStocks()[0].pe'), 10);
  assert.equal(h.evaluate('allStocks()[0].pb'), 5);
  assert.equal(h.evaluate('allStocks()[1].pe'), null);
  assert.equal(h.evaluate('allStocks()[1].pb'), null);
  h.evaluate("financials.set('1111',{reported:5,recurring:3,book:6,dividendYield:88,period:'2026-10-01',dateKind:'sector'});financials.set('1112',{reported:-1,book:-2,dividendYield:99,period:'2026-10-01'});applyFinancials()");
  assert.equal(h.evaluate('allStocks()[0].pe'), 20 / 3);
  assert.equal(h.evaluate('allStocks()[0].pb'), 20 / 6);
  assert.equal(h.evaluate('allStocks()[0].dividendYield'), 3.5);
  assert.equal(h.evaluate('allStocks()[1].dividendYield'), null);
  assert.match(h.evaluate('row(allStocks()[0])'), /أرقام: عائد التوزيع \(%\) \(آخر سنة\)/);
  assert.match(h.evaluate('row(allStocks()[0])'), /<span class="num dividend-yield">3\.50%<\/span>/);
  assert.equal(h.evaluate('percent(0,false)'), '<span class="num dividend-yield">0.00%</span>');
  assert.equal(h.evaluate('percent(null,false)'), '<span class="missing">—</span>');
  assert.equal(h.evaluate('percent(3.5)'), '<span class="num up">+3.50%</span>');
  assert.equal(h.evaluate('percent(-3.5)'), '<span class="num down">-3.50%</span>');
  h.evaluate("updateMode('reported')");
  assert.equal(h.evaluate('allStocks()[0].pe'), 4);
  h.evaluate('allStocks()[0].price=30;applyFinancials()');
  assert.equal(h.evaluate('allStocks()[0].pe'), 6);
  assert.equal(h.evaluate('allStocks()[0].pb'), 5);
  h.evaluate('allStocks()[0].price=null;applyFinancials()');
  assert.equal(h.evaluate('allStocks()[0].pe'), null);
  assert.equal(h.evaluate('allStocks()[0].pb'), null);
  const next = fixture('delayed', '2026-11-04T10:01:00Z');
  next.sectors[0].stocks[0].price = 40;
  next.sectors[0].stocks[0].dividendYield = 4.5;
  await h.refresh(next);
  assert.equal(h.evaluate('allStocks()[0].pe'), 8);
  assert.equal(h.evaluate('allStocks()[0].pb'), 40 / 6);
  assert.equal(h.evaluate('allStocks()[0].dividendYield'), 4.5);
});

await test('successful refresh repaints all sections while preserving search, sector, sort and EPS mode', async () => {
  const h = harness(); await settle();
  h.node('search').value = 'Alpha';
  h.evaluate("activeSector=0;query='alpha';sortBySector.set(0,{key:'price',dir:1});updateMode('reported')");
  const beforeState = h.evaluate('JSON.stringify({activeSector,query,sort:[...sortBySector],epsMode})');
  const next = fixture('close', '2026-11-04T10:01:00Z');
  next.sectors[0].stocks[0].price = 30;
  next.marketSummary.value = 11000;
  next.marketSummary.date = '2026-11-03';
  assert.equal(await h.refresh(next), true);
  assert.equal(h.evaluate('JSON.stringify({activeSector,query,sort:[...sortBySector],epsMode})'), beforeState);
  assert.equal(h.node('search').value, 'Alpha');
  assert.equal(h.node('reported-mode').attributes['aria-pressed'], 'true');
  assert.equal(h.node('view-title').textContent, 'القطاع الأول');
  assert.match(h.node('result-count').textContent, /^1 شركة/);
  assert.match(h.node('sectors').innerHTML, /30\.00/);
  assert.doesNotMatch(h.node('sectors').innerHTML, /Beta/);
  assert.match(h.node('stats').innerHTML, /03\.11\.2026/);
  assert.match(h.node('market-stats').innerHTML, /11,000\.00/);
  assert.match(h.node('market-date').textContent, /03\.11\.2026/);
  assert.match(h.node('sector-nav').innerHTML, /aria-pressed="true"/);
  assert.equal(h.evaluate('allStocks()[0].pe'), 15);
  assert.equal(h.evaluate('allStocks()[0].pb'), 7.5);
  assert.match(h.node('sectors').innerHTML, /تغير مرجح محسوب <strong>\-5\.00%/);
  assert.match(h.node('sectors').innerHTML, /لجميع شركات القطاع؛ ليس مؤشر قطاع رسميًا/);
});

await test('older/missing timestamps, HTTP/network/JSON failures retain displayed values and state', async () => {
  const h = harness(fixture('close', '2026-11-04T10:00:00Z')); await settle();
  h.evaluate("activeSector=0;query='alpha';sortBySector.set(0,{key:'eps',dir:-1});updateMode('reported')");
  const capture = () => JSON.stringify(['sectors', 'stats', 'market-stats', 'market-date', 'price-mode', 'price-date', 'price-source', 'result-count'].map(id => [h.node(id).innerHTML, h.node(id).textContent]));
  const displayed = capture(), state = h.evaluate('JSON.stringify({activeSector,query,sort:[...sortBySector],epsMode})');
  const older = fixture('delayed', '2026-11-04T09:59:59Z'); older.sectors[0].stocks[0].price = 999;
  assert.equal(await h.refresh(older), false);
  assert.match(h.node('price-status').textContent, /رُفضت نسخة أسعار أقدم.*احتُفظ بالقيم/);
  for (const checkedAt of [null, 'invalid']) {
    const item = fixture('delayed', checkedAt);
    assert.equal(await h.refresh(item), false);
  }
  const failures = [
    new Error('offline'),
    () => ({ ok: false, status: 503 }),
    () => ({ ok: true, json: async () => { throw new SyntaxError('broken JSON'); } }),
    { sectors: null }
  ];
  for (const failure of failures) {
    assert.equal(await h.refresh(failure), false);
    assert.match(h.node('price-status').textContent, /تعذر تحديث الأسعار.*احتُفظ بالقيم المعروضة/);
    assert.equal(capture(), displayed);
    assert.equal(h.node('empty').hidden, true);
    assert.equal(h.evaluate('JSON.stringify({activeSector,query,sort:[...sortBySector],epsMode})'), state);
    assert.equal(h.evaluate('pricesRefreshRunning'), false);
  }
  assert.equal(h.evaluate('allStocks()[0].price'), 20);
  const next = fixture('delayed', '2026-11-04T10:02:00Z');
  assert.equal(await h.refresh(next), true);
  assert.doesNotMatch(h.node('price-status').textContent, /تعذر تحديث|رُفضت/);
});

await test('60-second no-store refresh, visibility, and independent price semaphore', async () => {
  const h = harness(); await settle();
  const priceCalls = () => h.calls.filter(call => call.url.startsWith('data.json'));
  assert.equal(h.intervals.filter(timer => timer.milliseconds === 60000).length, 1);
  assert.equal(h.intervals.filter(timer => timer.milliseconds === 3600000).length, 1);
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  h.queue.push(() => pending);
  h.evaluate('refreshRunning=true');
  const before = priceCalls().length;
  const first = h.evaluate('refreshPrices()');
  assert.equal(h.evaluate('pricesRefreshRunning'), true);
  assert.equal(await h.evaluate('refreshPrices()'), false);
  assert.equal(priceCalls().length, before + 1);
  resolve(response(fixture('close', '2026-11-04T10:01:00Z')));
  assert.equal(await first, true);
  assert.equal(h.evaluate('pricesRefreshRunning'), false);
  assert.equal(h.evaluate('refreshRunning'), true);
  h.evaluate('refreshRunning=false');
  h.document.hidden = true; h.event('visibilitychange'); await settle();
  assert.equal(priceCalls().length, before + 1);
  h.queue.push(fixture('delayed', '2026-11-04T10:02:00Z'));
  h.document.hidden = false; h.event('visibilitychange'); await settle();
  assert.equal(priceCalls().length, before + 2);
  h.queue.push(fixture('close', '2026-11-04T10:03:00Z'));
  await h.intervals.find(timer => timer.milliseconds === 60000).callback();
  assert.equal(priceCalls().length, before + 3);
  for (const call of priceCalls()) {
    assert.match(call.url, /^data\.json\?v=\d+$/);
    assert.equal(call.options.cache, 'no-store');
  }
});

await test('initial-load recovery and financial-map failure do not take down available prices', async () => {
  const h = harness(new Error('offline')); await settle();
  assert.equal(h.node('result-count').textContent, 'تعذر تحميل البيانات');
  assert.equal(h.node('empty').hidden, false);
  assert.match(h.node('price-status').textContent, /تعذر تحميل الأسعار.*ستُعاد المحاولة/);
  assert.equal(await h.refresh(fixture()), true);
  assert.equal(h.node('empty').hidden, true);
  assert.equal(h.node('empty').querySelector('h3').textContent, 'لا توجد نتائج مطابقة');
  assert.match(h.node('result-count').textContent, /3 شركة/);
  const noMap = harness(fixture(), { map: new Error('map offline') }); await settle();
  assert.match(noMap.node('financial-status').textContent, /تعذر تحميل بيانات الأرباح المحدثة/);
  assert.match(noMap.node('sectors').innerHTML, /Alpha/);
  assert.equal(noMap.node('empty').hidden, true);
  assert.equal(noMap.evaluate('allStocks()[0].pe'), 10);
});

await test('HTML retains existing structure and adds accessible status with cache-busted script', async () => {
  assert.match(index, /<p id="price-status" class="financial-status" role="status" aria-live="polite">/);
  assert.match(index, /id="price-source"/);
  assert.match(index, /app\.js\?v=price-status-20261104/);
  assert.match(index, /styles\.css\?v=sticky-page-20261105/);
  assert.match(index, /sticky-header\.js\?v=20261105/);
  assert.doesNotMatch(index, /15 دقيقة|تُحدَّث أسعار الأسهم والمؤشر آليًا أثناء جلسة التداول/);
  assert.match(index, /حتى خارج ساعات السوق/);
});

console.log(`Price UI tests passed: ${groups.length} groups (Node vm, no browser).`);

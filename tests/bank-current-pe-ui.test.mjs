import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Test banks.js orchestration only; do not import the concurrently maintained ratio module.
const source = readFileSync(new URL('../dist/banks.js', import.meta.url), 'utf8')
  .replace(/^import\s+.*\s+from\s+['"][^'"]+['"];?\r?\n/gm, '');
assert.doesNotMatch(source, /^\s*import\s/m, 'All ESM imports must be replaced with injected mocks');
const clone = value => JSON.parse(JSON.stringify(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const annualFixture = () => ({
  years: [2021, 2022, 2023, 2024, 2025], source: { importedAt: '2026-11-04T08:00:00Z' },
  banks: Array.from({ length: 10 }, (_, index) => ({
    symbol: index === 0 ? '1120' : String(1200 + index), name: `Bank ${index + 1}`,
    years: [2021, 2022, 2023, 2024, 2025].map(year => ({ year, period: 'FY', values: { pe: 5000, netProfit: year } }))
  }))
});
function priceFixture(checkedAt = '2026-11-04T09:00:00Z', firstPrice = 20) {
  return {
    priceSource: { checkedAt, mode: 'delayed' },
    sectors: [{ name: 'البنوك', stocks: annualFixture().banks.map((bank, index) => ({
      symbol: bank.symbol, name: bank.name, price: index === 0 ? firstPrice : 30 + index, eps: 2
    })) }]
  };
}
const response = value => ({ ok: true, status: 200, json: async () => clone(value) });
async function settle() {
  for (let index = 0; index < 3; index += 1) await new Promise(resolve => setImmediate(resolve));
}
function harness(initial = priceFixture(), { map = { snapshot: {} } } = {}) {
  const nodes = new Map(), documentListeners = new Map(), windowListeners = new Map();
  const intervals = [], fetchCalls = [], priceQueue = [initial], warnings = [], errors = [];
  const calls = { annual: [], options: [], historical: [], historicalFit: [], build: [], card: [], comparison: [], comparisonFit: [] };
  let financialMap = map;
  let clock = Date.parse('2026-11-04T10:00:00Z');
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  function node(id) {
    if (!nodes.has(id)) {
      let html = '';
      const listeners = new Map();
      nodes.set(id, {
        textContent: '', value: '', hidden: false, scrollLeft: 0, scrollTop: 0, writes: 0, listeners,
        get innerHTML() { return html; },
        set innerHTML(value) {
          html = value; this.writes += 1;
          // Model the select's value after options are replaced, including its selected option.
          if (id === 'bank-chart-metric') {
            const options = [...value.matchAll(/<option value="([^"]+)"([^>]*)>/g)];
            const selected = options.find(option => /\bselected\b/.test(option[2])) || options[0];
            this.value = selected?.[1] || '';
          }
        },
        addEventListener(type, listener) { listeners.set(type, listener); }
      });
    }
    return nodes.get(id);
  }
  function listen(collection, type, listener) {
    if (!collection.has(type)) collection.set(type, []);
    collection.get(type).push(listener);
  }
  const document = {
    hidden: false, title: '', getElementById: node,
    addEventListener(type, listener) { listen(documentListeners, type, listener); }
  };
  const window = {
    location: new URL('https://example.test/banks.html?symbol=1120'),
    addEventListener(type, listener) { listen(windowListeners, type, listener); },
    history: {
      replaceState(_state, _title, next) { window.location = new URL(next, window.location.href); },
      pushState(_state, _title, next) { window.location = new URL(next, window.location.href); }
    }
  };
  const context = vm.createContext({
    document, window, URL, URLSearchParams, Intl, Date: ClockDate, Map, Number, String, Math, Promise,
    console: { warn(...args) { warnings.push(args); }, error(...args) { errors.push(args); } },
    setInterval(callback, milliseconds) { intervals.push({ callback, milliseconds }); return intervals.length; },
    escapeHtml,
    validateDataset(value) { assert.equal(value.banks.length, 10); return value; },
    renderAnnualTable(bank, years) {
      calls.annual.push({ bank, years });
      return `<table data-annual-bank="${bank.symbol}"><caption>${years.join('–')}</caption><td>5000</td></table>`;
    },
    getChartOptions(bank, years) {
      calls.options.push({ bank, years });
      return [
        { key: 'netProfit', label: 'صافي الربح', group: 'النتائج السنوية', available: true },
        { key: 'historicalPE', label: 'المكرر التاريخي', group: 'النتائج السنوية', available: false }
      ];
    },
    renderBankCharts(bank, years, key) {
      calls.historical.push({ bank, years, key });
      return `<article data-historical="${key}" data-bank="${bank.symbol}">${years.join('–')}</article>`;
    },
    fitBankCharts(container, bank, years) { calls.historicalFit.push({ container, bank, years }); },
    buildCurrentBankPE(banks, prices, financials) {
      calls.build.push({ banks, prices, financials });
      const stocks = new Map(prices.sectors.flatMap(sector => sector.stocks).map(stock => [stock.symbol, stock]));
      // A minimal, deterministic stand-in: these tests verify wiring, not financial math.
      return banks.map(bank => {
        const quote = stocks.get(bank.symbol);
        return {
          symbol: bank.symbol, name: bank.name, price: quote?.price ?? null,
          pe: quote?.price != null && quote?.eps > 0 ? quote.price / quote.eps : null,
          checkedAt: prices.priceSource.checkedAt, source: financials ? 'financial-map' : 'price-file'
        };
      });
    },
    renderCurrentBankPECard(record) {
      calls.card.push(record);
      return `<article data-current-card="${record.symbol}" data-checked-at="${record.checkedAt}">${record.pe ?? '—'} | ${record.source}</article>`;
    },
    renderCurrentPEComparison(records) {
      calls.comparison.push(records);
      return `<article data-crossbank-chart="currentPE">${records.map(record => record.symbol).join(',')}</article>`;
    },
    fitCurrentPEComparison(container, records) { calls.comparisonFit.push({ container, records }); },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.startsWith('banks-financials.json')) return response(annualFixture());
      if (url.startsWith('financial-map.json')) {
        if (financialMap instanceof Error) throw financialMap;
        return response(financialMap);
      }
      assert.match(url, /^data\.json\?v=\d+$/);
      assert.ok(priceQueue.length, 'A price response must be queued for each refresh');
      const item = priceQueue.shift();
      if (item instanceof Error) throw item;
      return typeof item === 'function' ? await item() : response(item);
    }
  });
  const evaluate = expression => vm.runInContext(expression, context);
  vm.runInContext(source, context);
  return {
    node, document, intervals, fetchCalls, calls, priceQueue, warnings, errors, evaluate,
    setMap(value) { financialMap = value; },
    setClock(value) { clock = Date.parse(value); },
    event(type) { for (const listener of documentListeners.get(type) || []) listener({}); },
    windowEvent(type) { for (const listener of windowListeners.get(type) || []) listener({}); },
    selectChart(key) { node('bank-chart-metric').value = key; node('bank-chart-metric').listeners.get('change')({}); },
    async refresh(item) { priceQueue.push(item); await evaluate('refreshCurrentPE()'); await settle(); }
  };
}
const groups = [];
async function test(name, run) { await run(); groups.push(name); console.log(`PASS ${name}`); }

await test('successful initial and later current refresh paint card/options without rewriting annual data', async () => {
  const h = harness(); await settle();
  assert.equal(h.errors.length, 0);
  assert.equal(h.node('bank-panel').hidden, false);
  assert.equal(h.evaluate('currentRatios.length'), 10);
  assert.equal(h.evaluate('currentRatios[0].pe'), 10);
  assert.match(h.node('bank-current-pe').innerHTML, /data-current-card="1120".*>10 \| financial-map/);
  assert.match(h.node('bank-current-pe-status').textContent, /ليس سعرًا مباشرًا.*2025.*الجدول السنوي/);
  assert.match(h.node('bank-chart-metric').innerHTML, /optgroup label="المؤشرات الحالية"/);
  assert.match(h.node('bank-chart-metric').innerHTML, /option value="currentPE">مكرر الربح الحالي — جميع البنوك<\/option>/);
  assert.equal(h.node('bank-chart-metric').value, 'netProfit');
  assert.equal(h.calls.build.length, 1);
  assert.equal(h.calls.build[0].banks.length, 10);
  assert.deepEqual(h.calls.build[0].financials, { snapshot: {} });
  const annualHTML = h.node('bank-table-wrap').innerHTML;
  const annualWrites = h.node('bank-table-wrap').writes;
  const dataset = h.evaluate('JSON.stringify(dataset)');
  const historicalHTML = h.node('bank-charts-grid').innerHTML;
  const optionWrites = h.node('bank-chart-metric').writes;
  await h.refresh(priceFixture('2026-11-04T09:30:00Z', 40));
  assert.equal(h.evaluate('currentRatios[0].pe'), 20);
  assert.equal(h.evaluate('currentPriceTime'), Date.parse('2026-11-04T09:30:00Z'));
  assert.equal(h.evaluate('currentRefreshRunning'), false);
  assert.equal(h.evaluate('currentPEError'), '');
  assert.match(h.node('bank-current-pe').innerHTML, />20 \| financial-map/);
  assert.equal(h.node('bank-table-wrap').innerHTML, annualHTML);
  assert.equal(h.node('bank-table-wrap').writes, annualWrites);
  assert.equal(h.calls.annual.length, 1);
  assert.equal(h.evaluate('JSON.stringify(dataset)'), dataset);
  assert.equal(h.node('bank-charts-grid').innerHTML, historicalHTML);
  assert.equal(h.calls.historical.length, 1);
  assert.equal(h.calls.comparison.length, 0);
  assert.ok(h.node('bank-chart-metric').writes > optionWrites);
  assert.equal(h.evaluate('selectedChartKey'), 'netProfit');
  assert.equal(h.fetchCalls.filter(call => call.url.startsWith('banks-financials.json')).length, 1);
});

await test('older, missing, invalid, and future timestamps retain the prior snapshot and show a warning', async () => {
  const h = harness(); await settle(); h.selectChart('currentPE');
  const ratios = h.evaluate('currentRatios');
  const saved = h.evaluate('JSON.stringify(currentRatios)');
  const priceTime = h.evaluate('currentPriceTime');
  const card = h.node('bank-current-pe').innerHTML;
  const comparison = h.node('bank-charts-grid').innerHTML;
  const annual = h.node('bank-table-wrap').innerHTML;
  const annualWrites = h.node('bank-table-wrap').writes;
  for (const checkedAt of ['2026-11-04T08:59:59Z', null, undefined, '', 'not-a-date', '2026-11-04T10:00:01Z']) {
    const incoming = priceFixture(checkedAt, 999);
    if (checkedAt === undefined) delete incoming.priceSource.checkedAt;
    await h.refresh(incoming);
    assert.equal(h.evaluate('currentRatios'), ratios);
    assert.equal(h.evaluate('JSON.stringify(currentRatios)'), saved);
    assert.equal(h.evaluate('currentPriceTime'), priceTime);
    assert.equal(h.calls.build.length, 1);
    assert.equal(h.node('bank-current-pe').innerHTML, card);
    assert.equal(h.node('bank-charts-grid').innerHTML, comparison);
    assert.equal(h.node('bank-table-wrap').innerHTML, annual);
    assert.equal(h.node('bank-table-wrap').writes, annualWrites);
    assert.equal(h.evaluate('selectedChartKey'), 'currentPE');
    assert.equal(h.evaluate('currentRefreshRunning'), false);
    assert.match(h.node('bank-current-pe-status').textContent, /تعذر تحديث المكرر الحالي.*احتُفظ باللقطة المعروضة وتاريخها/);
    assert.match(h.node('bank-chart-selection-status').textContent, /آخر فحص للأسعار.*احتُفظ باللقطة المعروضة وتاريخها/);
  }
  assert.equal(h.warnings.length, 6);
  await h.refresh(priceFixture('2026-11-04T09:45:00Z', 50));
  assert.equal(h.evaluate('currentRatios[0].pe'), 25);
  assert.equal(h.evaluate('currentPEError'), '');
  assert.doesNotMatch(h.node('bank-current-pe-status').textContent, /تعذر تحديث|احتُفظ/);
  assert.doesNotMatch(h.node('bank-chart-selection-status').textContent, /تعذر تحديث|احتُفظ/);
});

await test('network, HTTP, JSON, and malformed price failures retain usable current and annual data', async () => {
  const h = harness(); await settle();
  const saved = h.evaluate('JSON.stringify({currentRatios,currentPriceTime,dataset})');
  const card = h.node('bank-current-pe').innerHTML;
  const annualWrites = h.node('bank-table-wrap').writes;
  for (const failure of [
    new Error('offline'),
    () => ({ ok: false, status: 503 }),
    () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }),
    { sectors: null },
    { sectors: [{ stocks: null }], priceSource: { checkedAt: '2026-11-04T09:30:00Z' } }
  ]) {
    await h.refresh(failure);
    assert.equal(h.evaluate('JSON.stringify({currentRatios,currentPriceTime,dataset})'), saved);
    assert.equal(h.node('bank-current-pe').innerHTML, card);
    assert.equal(h.node('bank-table-wrap').writes, annualWrites);
    assert.equal(h.node('bank-panel').hidden, false);
    assert.equal(h.evaluate('currentRefreshRunning'), false);
    assert.match(h.node('bank-current-pe-status').textContent, /احتُفظ باللقطة المعروضة وتاريخها/);
  }
});

await test('missing financial-map falls back successfully to prices, including initial load', async () => {
  const h = harness(priceFixture(), { map: new Error('financial map offline') }); await settle();
  assert.equal(h.errors.length, 0);
  assert.equal(h.warnings.length, 0);
  assert.equal(h.node('bank-panel').hidden, false);
  assert.equal(h.evaluate('currentRatios.length'), 10);
  assert.equal(h.evaluate('currentRatios[0].pe'), 10);
  assert.equal(h.calls.build[0].financials, null);
  assert.match(h.node('bank-current-pe').innerHTML, />10 \| price-file/);
  assert.match(h.node('bank-current-pe-status').textContent, /تعذر تحميل لقطة ربحية أرقام.*استُخدمت ربحية ملف الأسعار.*مصدرها/);
  assert.match(h.node('bank-chart-metric').innerHTML, /option value="currentPE">/);
  const annualWrites = h.node('bank-table-wrap').writes;
  await h.refresh(priceFixture('2026-11-04T09:30:00Z', 44));
  assert.equal(h.evaluate('currentRatios[0].pe'), 22);
  assert.equal(h.calls.build[1].financials, null);
  assert.match(h.node('bank-current-pe').innerHTML, />22 \| price-file/);
  assert.equal(h.node('bank-table-wrap').writes, annualWrites);
  h.setMap({ snapshot: {} });
  await h.refresh(priceFixture('2026-11-04T09:45:00Z', 46));
  assert.equal(h.evaluate('currentPEError'), '');
  assert.match(h.node('bank-current-pe').innerHTML, />23 \| financial-map/);
});

await test('currentPE selection uses all-bank comparison while historical rendering stays unchanged', async () => {
  const h = harness(); await settle();
  const annual = h.node('bank-table-wrap').innerHTML;
  const historical = h.node('bank-charts-grid').innerHTML;
  assert.equal(h.calls.historical[0].bank.symbol, '1120');
  assert.deepEqual(clone(h.calls.historical[0].years), [2021, 2022, 2023, 2024, 2025]);
  assert.equal(h.calls.historical[0].key, 'netProfit');
  h.selectChart('currentPE');
  assert.equal(h.evaluate('selectedChartKey'), 'currentPE');
  assert.match(h.node('bank-charts-grid').innerHTML, /data-crossbank-chart="currentPE"/);
  assert.match(h.node('bank-charts-context').textContent, /مقارنة حالية بين البنوك، وليست سلسلة سنوية/);
  assert.equal(h.calls.historical.length, 1);
  assert.equal(h.calls.comparison.length, 1);
  assert.equal(h.calls.comparison[0].length, 10);
  assert.equal(h.calls.comparison[0], h.evaluate('currentRatios'));
  assert.equal(h.calls.comparisonFit[0].container, h.node('bank-charts-grid'));
  assert.equal(h.calls.comparisonFit[0].records, h.evaluate('currentRatios'));
  const historicalFitCalls = h.calls.historicalFit.length;
  h.windowEvent('resize');
  assert.equal(h.calls.comparisonFit.length, 2);
  assert.equal(h.calls.historicalFit.length, historicalFitCalls);
  await h.refresh(priceFixture('2026-11-04T09:30:00Z', 60));
  assert.equal(h.evaluate('selectedChartKey'), 'currentPE');
  assert.equal(h.node('bank-chart-metric').value, 'currentPE');
  assert.equal(h.calls.comparison.at(-1)[0].pe, 30);
  assert.equal(h.node('bank-table-wrap').innerHTML, annual);
  assert.equal(h.calls.historical.length, 1);
  h.selectChart('netProfit');
  assert.equal(h.node('bank-charts-grid').innerHTML, historical);
  assert.match(h.node('bank-charts-context').textContent, /Bank 1 · 2021–2025 · من بيانات الملف المحفوظ/);
  assert.equal(h.calls.historical.at(-1).key, 'netProfit');
  assert.equal(h.node('bank-table-wrap').innerHTML, annual);
  h.windowEvent('resize');
  assert.equal(h.calls.historicalFit.length, historicalFitCalls + 2);
  h.selectChart('historicalPE');
  assert.equal(h.calls.historical.at(-1).key, 'historicalPE');
  assert.match(h.node('bank-chart-selection-status').textContent, /غير متاح.*—.*دون أرقام افتراضية/);
});

await test('initial price failure leaves historical data available and current selection never fabricates annual PE', async () => {
  const h = harness(new Error('initial prices offline')); await settle();
  assert.equal(h.node('bank-panel').hidden, false);
  assert.equal(h.evaluate('currentRatios.length'), 0);
  assert.match(h.node('bank-table-wrap').innerHTML, /5000/);
  assert.equal(h.node('bank-current-pe').innerHTML, '');
  assert.match(h.node('bank-current-pe-status').textContent, /لم تُستخدم قيم المكرر التاريخي بدلًا منه/);
  assert.match(h.node('bank-chart-metric').innerHTML, /value="currentPE"[^>]*>[^<]*غير متاح حاليًا/);
  h.selectChart('currentPE');
  assert.match(h.node('bank-charts-grid').innerHTML, /المكرر الحالي غير متاح بعد.*المقارنات التاريخية متاحة/);
  assert.equal(h.calls.comparison.length, 0);
  assert.equal(h.calls.historical.length, 1);
  const annualWrites = h.node('bank-table-wrap').writes;
  await h.refresh(priceFixture('2026-11-04T09:30:00Z', 40));
  assert.equal(h.calls.comparison.length, 1);
  assert.equal(h.evaluate('currentRatios[0].pe'), 20);
  assert.equal(h.evaluate('selectedChartKey'), 'currentPE');
  assert.match(h.node('bank-current-pe').innerHTML, />20 \|/);
  assert.equal(h.node('bank-table-wrap').writes, annualWrites);
});

await test('60-second no-store polling, visibility recovery, and semaphore only refresh current snapshots', async () => {
  const h = harness(); await settle();
  const priceCalls = () => h.fetchCalls.filter(call => call.url.startsWith('data.json'));
  assert.equal(h.intervals.length, 1);
  assert.equal(h.intervals[0].milliseconds, 60000);
  const annualWrites = h.node('bank-table-wrap').writes;
  h.priceQueue.push(priceFixture('2026-11-04T09:10:00Z', 24));
  await h.intervals[0].callback(); await settle();
  assert.equal(h.evaluate('currentRatios[0].pe'), 12);
  assert.equal(priceCalls().length, 2);
  h.document.hidden = true; h.event('visibilitychange'); await settle();
  assert.equal(priceCalls().length, 2);
  h.priceQueue.push(priceFixture('2026-11-04T09:20:00Z', 26));
  h.document.hidden = false; h.event('visibilitychange'); await settle();
  assert.equal(priceCalls().length, 3);
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  h.priceQueue.push(() => pending);
  const first = h.evaluate('refreshCurrentPE()');
  assert.equal(h.evaluate('currentRefreshRunning'), true);
  await h.evaluate('refreshCurrentPE()');
  assert.equal(priceCalls().length, 4);
  resolve(response(priceFixture('2026-11-04T09:30:00Z', 28)));
  await first; await settle();
  assert.equal(h.evaluate('currentRefreshRunning'), false);
  assert.equal(h.evaluate('currentRatios[0].pe'), 14);
  assert.equal(h.node('bank-table-wrap').writes, annualWrites);
  assert.equal(h.calls.annual.length, 1);
  assert.equal(h.fetchCalls.filter(call => call.url.startsWith('banks-financials.json')).length, 1);
  for (const call of h.fetchCalls.filter(call => /^(data|financial-map)\.json/.test(call.url))) {
    assert.match(call.url, /\?v=\d+$/);
    assert.equal(call.options.cache, 'no-store');
  }
});

console.log(`Current bank PE UI tests passed: ${groups.length} groups (Node vm, mocked imports, no browser).`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { strictNumber, validDate, marketSession, parseOfficialDaily, parseOfficialMarketPage, normalizeTradingView,
  selectQuote, applyQuote, TV_COLUMNS } from './price-integrity.mjs';
const now = new Date('2026-11-04T18:00:00Z');
const timestamp = new Date('2026-11-04T07:00:00Z').getTime() / 1000;
const official = { close: 61.5, day: 2.24, marketCap: 369000, date: '2026-11-04', status: 'official_close', source: 'Saudi Exchange', timestamp: null };
const row = { s: 'TADAWUL:1120', d: [61.5, 2.24, 'SAR', timestamp, 'delayed_streaming_900', 369e9, 2, 3, 4, 5, 50, 70] };
const cells = row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`;
const headers = ['Symbol', 'Company', 'Open (SAR)', 'High (SAR)', 'Low (SAR)', 'Close (SAR)', '% Change', 'Volume Traded', 'Value Traded (SAR)', 'No. of Trades', 'Market Cap (SAR)'];
function report(extra = '') {
  const summary = [['Close', '10,038.89'], ['Change', '162.76'], ['% Change', '1.65 %'], ['Value Traded (SAR)', '4,000,000,000.00']];
  return `<h1>Detailed Daily Report</h1><h2>Market Date 2026/11/04</h2><table>${summary.map(cells).join('')}</table><table>${cells(headers)}${cells(['1120', 'ALRAJHI', '60.3', '61.8', '60.2', '61.50', '2.24 %', '100', '6150', '12', '369,000,000,000.00'])}${extra}</table>`;
}
test('Missing values stay missing, not numeric zero', () => {
  for (const value of [null, undefined, '', ' ', '-', 'M', 'N/A', 'abc', 'SAR 12']) assert.equal(strictNumber(value), null);
  assert.equal(strictNumber('0.00'), 0);
  assert.equal(strictNumber('-1,200.35 %'), -1200.35);
});
test('Validate real calendar dates and Riyadh closing auction boundary', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2026-11-04'), true);
  assert.equal(marketSession(new Date('2026-11-04T12:19:00Z')).active, true);
  assert.equal(marketSession(new Date('2026-11-04T12:20:00Z')).beforeClose, false);
  assert.equal(marketSession(new Date('2026-11-06T08:00:00Z')).active, false);
});
test('Parse official prices and SAR market cap units by named columns', () => {
  const parsed = parseOfficialDaily(report(), now);
  assert.equal(parsed.date, '2026-11-04');
  assert.equal(parsed.quotes.get('1120').close, 61.5);
  assert.equal(parsed.quotes.get('1120').marketCap, 369000);
  assert.equal(parsed.summary.turnover, 4e9);
  assert.equal(parsed.summary.isIntraday, false);
  assert.throws(() => parseOfficialDaily(report().replace('2026/11/04', '2026/11/05'), now), /date/);
  assert.throws(() => parseOfficialDaily(report().replace('Market Date 2026/11/04', ''), now), /date/);
  assert.throws(() => parseOfficialDaily(report().replace(cells(['Change', '162.76']), ''), now), /summary/);
  assert.throws(() => parseOfficialDaily('<h1>Access Denied</h1>', now), /date/);
});
test('Duplicate symbols fail closed; invalid prices and missing day are not accepted', () => {
  const duplicated = cells(['1120', 'ALRAJHI', '60', '62', '59', '61.5', '2.24 %', '100', '6150', '12', '369000000000']);
  assert.throws(() => parseOfficialDaily(report(duplicated), now), /Duplicate/);
  assert.throws(() => parseOfficialDaily(report().replace('61.50', '0.00'), now), /no usable/);
});
test('Parse dated official market-page turnover fallback', () => {
  const html = `<script>var main_market_graph=JSON.parse('[{"dateTime":"2026-11-04 12:00:00","indexPrice":10038.89}]');</script><span class="valueTradedMain">4,484,633,652.75</span>`;
  const parsed = parseOfficialMarketPage(html, now);
  assert.equal(parsed.date, '2026-11-04');
  assert.equal(parsed.turnover, 4484633652.75);
  assert.throws(() => parseOfficialMarketPage('<span class="valueTradedMain">1</span>', now), /dated/);
});
test('Dated TradingView fallback does not invent a trade timestamp or official close', () => {
  const quote = normalizeTradingView(row, now);
  assert.equal(quote.date, '2026-11-04');
  assert.equal(quote.delayMinutes, 15);
  assert.equal(quote.status, 'delayed');
  assert.equal(quote.timestamp, null);
  assert.equal(quote.marketCap, 369000);
  assert.equal(TV_COLUMNS[3], 'time');
  for (const changed of [ { 2: 'USD' }, { 3: null }, { 3: timestamp + 86400 }, { 0: 0 }, { 1: null } ]) {
    const values = [...row.d];
    for (const [i, value] of Object.entries(changed)) values[i] = value;
    assert.equal(normalizeTradingView({ ...row, d: values }, now), null);
  }
});
test('Official same-session close wins, but never before closing or over newer observations', () => {
  const delayed = normalizeTradingView(row, now);
  assert.equal(selectQuote(official, delayed, '2026-11-04', now), official);
  assert.equal(selectQuote(official, delayed, '2026-11-04', new Date('2026-11-04T10:00:00Z')), delayed);
  assert.equal(selectQuote({ ...official, date: '2026-11-03' }, delayed, '2026-11-04', now), delayed);
  assert.equal(selectQuote(null, { ...delayed, date: '2026-11-03' }, '2026-11-04', now), null);
});
test('Price-dependent values refreshed together; unavailable rows do not carry old day/performance', () => {
  const stock = { price: 60, day: 9, eps: 3, pe: 100, bookValue: 20, pb: 100, shares: 10, marketCap: 600, year1: 20 };
  applyQuote(stock, official, normalizeTradingView(row, now), now.toISOString());
  assert.equal(stock.pe, 20.5);
  assert.equal(stock.pb, 3.075);
  assert.equal(stock.marketCap, 369000);
  assert.equal(stock.shares, 6e9);
  assert.equal(stock.year1, 5);
  applyQuote(stock, official, { ...normalizeTradingView(row, now), date: '2026-11-03' }, now.toISOString());
  assert.equal(stock.year1, null);
  applyQuote(stock, null, null, now.toISOString());
  for (const field of ['price', 'day', 'marketCap', 'pe', 'pb', 'year1', 'priceDate']) assert.equal(stock[field], null);
  assert.equal(stock.priceStatus, 'unavailable');
});

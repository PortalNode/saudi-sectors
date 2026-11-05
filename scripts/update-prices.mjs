#!/usr/bin/env node
/**
 * Static-site refresh. Official Saudi Exchange daily report is authoritative for
 * a completed closing session. TradingView daily-bar quotes are a dated delayed
 * fallback, NEVER relabelled as an official close. No server or database needed.
 * Usage: node scripts/update-prices.mjs [--prices-only] [--dry-run]
 */
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { applyWeek52Range } from './week52-range.mjs';
import { OFFICIAL_URL, OFFICIAL_HOME_URL, TV_COLUMNS, isoDate, displayDate, round, validDate, parseOfficialDaily, parseOfficialMarketPage,
  normalizeTradingView, selectQuote, applyQuote } from './price-integrity.mjs';

const DATA_FILE = new URL('../dist/data.json', import.meta.url);
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const now = new Date(), checkedAt = now.toISOString();
const dryRun = process.argv.includes('--dry-run');
const pricesOnly = process.argv.includes('--prices-only');
const originalText = await readFile(DATA_FILE, 'utf8');
const data = JSON.parse(originalText);
const financialMap = JSON.parse(await readFile(new URL('../dist/financial-map.json', import.meta.url), 'utf8'));
const stocks = data.sectors.flatMap(sector => sector.stocks);
const requested = new Set(stocks.map(stock => stock.symbol));
if (requested.size !== stocks.length) throw new Error('Duplicate stock symbols in data.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(url, { body, accept = 'application/json', timeout = 20000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', body,
      headers: { 'User-Agent': USER_AGENT, Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return accept === 'application/json' ? response.json() : response.text();
  } finally { clearTimeout(timer); }
}

async function officialReport() {
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return parseOfficialDaily(await request(OFFICIAL_URL, { accept: 'text/html' }), now); }
    catch (failure) { error = failure; if (attempt === 0 && !/HTTP 403/.test(failure.message)) await sleep(1000); }
  }
  console.warn(`Official close unavailable: ${error.message}`);
  return null;
}
async function officialMarketPage() {
  try { return parseOfficialMarketPage(await request(OFFICIAL_HOME_URL, { accept: 'text/html' }), now); }
  catch (error) { console.warn(`Official market summary unavailable: ${error.message}`); return null; }
}
async function delayedQuotes() {
  const found = new Map();
  const tickers = [...stocks.map(stock => `TADAWUL:${stock.symbol}`), 'TADAWUL:TASI'];
  for (let index = 0; index < tickers.length; index += 100) {
    const batch = tickers.slice(index, index + 100);
    const scan = columns => request('https://scanner.tradingview.com/ksa/scan', {
      body: JSON.stringify({ symbols: { tickers: batch, query: { types: [] } }, columns }),
    });
    let payload;
    try {
      try { payload = await scan([...TV_COLUMNS, 'change_abs']); }
      catch (error) {
        console.warn(`Optional TV fields rejected: ${error.message}; retrying dated base fields.`);
        // Preserve performance when only ranges fail. If performance also fails,
        // date/currency/update mode remain mandatory and missing returns stay null.
        try { payload = await scan(TV_COLUMNS.slice(0, 10)); }
        catch { payload = await scan(TV_COLUMNS.slice(0, 6)); }
      }
      for (const row of payload?.data || []) {
        const symbol = String(row.s).replace(/^TADAWUL:/, '');
        if (!batch.includes(row.s) || (!requested.has(symbol) && symbol !== 'TASI')) continue;
        const quote = normalizeTradingView(row, now, symbol === 'TASI');
        if (!quote) continue;
        quote.pointChange = Number.isFinite(row.d?.[12]) ? row.d[12] : null;
        found.set(symbol, quote);
      }
    } catch (error) { console.warn(`TV batch unavailable: ${error.message}`); }
    await sleep(250);
  }
  return found;
}
const [official, officialMarket, delayed] = await Promise.all([officialReport(), officialMarketPage(), delayedQuotes()]);
const observedDates = stocks.map(stock => delayed.get(stock.symbol)?.date).filter(validDate);
if (official) observedDates.push(official.date);
const targetDate = observedDates.sort().at(-1);
if (!targetDate) throw new Error('No dated market observation; data.json left untouched');
// An old successful download must not overwrite a newer persisted observation.
if (validDate(data.asOf) && targetDate < data.asOf) {
  throw new Error(`Refusing date regression ${data.asOf} -> ${targetDate}; data.json left untouched`);
}
function cachedOfficial(stock) {
  if (stock.priceStatus !== 'official_close' || stock.priceSource !== 'Saudi Exchange' ||
      stock.priceDate !== targetDate || stock.lastOfficialClose?.date !== targetDate ||
      stock.lastOfficialClose?.price !== stock.price || !(stock.price > 0) || !Number.isFinite(stock.day)) return null;
  return { close: stock.price, day: stock.day, marketCap: stock.marketCap, date: stock.priceDate,
    status: 'official_close', source: 'Saudi Exchange', timestamp: null, suspended: stock.suspended || false };
}
const selected = new Map(stocks.map(stock => [stock.symbol,
  selectQuote((official?.date === targetDate ? official.quotes.get(stock.symbol) : null) || cachedOfficial(stock),
    delayed.get(stock.symbol), targetDate, now)]));
const resolved = [...selected.values()].filter(Boolean).length;
// A partial result is explicitly unavailable, never a silently retained old price.
// Permit at most 2% unavailable rows, with their price and day cleared and labelled.
const minimum = Math.ceil(stocks.length * 0.98);
if (resolved < minimum) throw new Error(`Only ${resolved}/${stocks.length} same-session prices; data.json left untouched`);
const officialCount = [...selected.values()].filter(quote => quote?.status === 'official_close').length;
const delayedCount = resolved - officialCount;
const mode = officialCount === stocks.length ? 'close' : 'delayed';
const provider = mode === 'close' ? 'Saudi Exchange' : 'TradingView';
const week52Counts = { updated: 0, retained: 0, incompatible: 0, unavailable: 0 };
for (const stock of stocks) {
  const quote = selected.get(stock.symbol), supplemental = delayed.get(stock.symbol);
  applyQuote(stock, quote, supplemental, checkedAt);
  if (quote?.status === 'official_close') {
    stock.lastOfficialClose = { price: stock.price, date: quote.date, source: OFFICIAL_URL };
  }
  week52Counts[applyWeek52Range(stock, supplemental?.date === quote?.date ? supplemental?.week52Candidates || [] : [])]++;
}
const delays = [...selected.values()].filter(q => q?.source === 'TradingView').map(q => q.delayMinutes);
const delayMinutes = delays.length && delays.every(n => n != null) ? Math.max(...delays) : null;
let warning = mode === 'close' ? null : 'الأسعار المتأخرة مؤرخة بجلسة المصدر، ولم تُعتمد كإغلاق رسمي. ' +
  (official ? `آخر تقرير رسمي متاح: ${displayDate(official.date)}.` : 'تعذر الوصول إلى تقرير الإغلاق الرسمي؛ ستُعاد المحاولة تلقائيًا.');
if (mode === 'close' && (!official || official.date < targetDate)) {
  warning = 'تعذر إعادة جلب تقرير بنفس تاريخ الجلسة؛ يُعرض الإغلاق الرسمي المحفوظ بنفس تاريخ جلسته.';
}
if (resolved < stocks.length) warning = `${warning || ''} ${stocks.length - resolved} أسعار غير متاحة لهذه الجلسة.`.trim();
data.asOf = targetDate;
data.priceDate = displayDate(targetDate);
data.priceSource = { provider, mode, checkedAt, observedDate: targetDate, delayMinutes,
  officialDate: mode === 'close' ? targetDate : official?.date || null, officialSymbols: officialCount, tradingViewSymbols: delayedCount,
  unavailableSymbols: stocks.length - resolved, warning, officialReportUrl: OFFICIAL_URL };

// The index has independent provenance. Never stamp it with a date from stocks.
const previousIndex = data.marketSummary;
const savedOfficialIndex = previousIndex?.source === 'Saudi Exchange' && previousIndex?.mode === 'close' &&
  previousIndex?.date === displayDate(targetDate) && previousIndex.value > 0 && Number.isFinite(previousIndex.day)
  ? { ...previousIndex, date: targetDate } : null;
const indexQuote = selectQuote(official ? { ...official.summary, date: official.date } : null,
  delayed.get('TASI'), targetDate, now);
const indexPerformance = delayed.get('TASI');
if (indexQuote && indexQuote.source === 'Saudi Exchange') {
  data.marketSummary = { ...official.summary, updatedAt: checkedAt };
} else if (savedOfficialIndex) {
  data.marketSummary = { ...previousIndex, updatedAt: checkedAt };
} else if (indexQuote) {
  data.marketSummary = { value: round(indexQuote.close), day: round(indexQuote.day),
    pointChange: indexQuote.pointChange == null ? null : round(indexQuote.pointChange), turnover: null,
    date: displayDate(indexQuote.date), source: 'TradingView', mode: 'delayed',
    isIntraday: true, updatedAt: checkedAt };
} else {
  data.marketSummary = { value: null, day: null, pointChange: null, turnover: null, date: null,
    source: null, mode: 'unavailable', isIntraday: false, updatedAt: checkedAt };
}
if (data.marketSummary.turnover == null && officialMarket?.date === targetDate) {
  data.marketSummary.turnover = round(officialMarket.turnover);
  data.marketSummary.turnoverSource = officialMarket.source;
}
for (const field of ['ytd', 'month3', 'month6', 'year1']) {
  const value = indexPerformance?.performance?.[field];
  data.marketSummary[field] = indexPerformance?.date === targetDate && Number.isFinite(value) ? round(value) : null;
}
data.marketSummary.performanceDate = indexPerformance?.date === targetDate ? targetDate : null;
data.marketSummary.performanceSource = data.marketSummary.performanceDate ? 'TradingView' : null;
data.sources ??= {};
data.sources.closingPrices = OFFICIAL_URL;
data.sources.delayedPrices = 'https://www.tradingview.com/markets/stocks-ksa/market-movers-all-stocks/';

// Keep the existing Argaam last-year dividend-yield definition and update path.
async function argaamHtml(url) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await request(url, { accept: 'text/html', headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.argaam.com/en/tadawul/tasi/saudi-energy',
    } }); }
    catch (failure) { error = failure; if (attempt < 2) await sleep(700 * (attempt + 1)); }
  }
  throw error;
}
async function pool(items, limit, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { await worker(items[i]); }
      catch (error) { console.warn(`Argaam fetch failed: ${error.message}`); }
    }
  }));
}
if (!pricesOnly) {
  const companyIds = new Map(Object.entries(financialMap.companyIds).map(([id, symbol]) => [symbol, id]));
  let yieldCount = 0;
  await pool(stocks, 4, async stock => {
    const companyId = companyIds.get(stock.symbol);
    if (!companyId) return;
    const html = await argaamHtml(`https://www.argaam.com/en/companies/latest-quarter-financial-ratios?companyID=${companyId}&marketID=3&headingWithMoreLink=true`);
    const row = html.match(/<tr\b[^>]*data-fieldid=["']CurrentDividendYield["'][^>]*>[\s\S]*?<\/tr>/i)?.[0];
    if (!row) return;
    const raw = row.match(/(?:currency-current-value|data-order)=["']\s*([^"']+?)\s*["']/i)?.[1];
    const value = raw == null || raw.trim() === '' ? null : Number(raw.replace(/,/g, ''));
    if (Number.isFinite(value) && value >= 0) {
      stock.dividendYield = round(value);
      stock.dividendYieldSource = 'Argaam Dividend Yield (%) (Last Year)';
      stock.dividendYieldCheckedAt = checkedAt;
      yieldCount++;
    } else { stock.dividendYield = null; delete stock.dividendYieldSource; }
  });
  console.log(`Argaam dividend yields: ${yieldCount}/${stocks.length}`);
}
if (!dryRun) {
  const temp = new URL(`../dist/.data-${process.pid}.tmp`, import.meta.url);
  if (await readFile(DATA_FILE, 'utf8') !== originalText) {
    throw new Error('Data changed during fetch; data.json left untouched');
  }
  try { await writeFile(temp, JSON.stringify(data) + '\n'); await rename(temp, DATA_FILE); }
  finally { await unlink(temp).catch(() => {}); }
}
console.log(`${dryRun ? 'Dry run' : 'Snapshot'} ${targetDate}: ${officialCount} official, ${delayedCount} delayed, ${stocks.length - resolved} unavailable`);
console.log(`52-week ranges: ${JSON.stringify(week52Counts)}`);

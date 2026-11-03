#!/usr/bin/env node
/**
 * Refreshes the Tadawul closing prices in dist/data.json.
 *
 * Primary source : Yahoo Finance  (SYMBOL.SR, daily chart series)
 * Fallback source: TradingView   (TADAWUL:SYMBOL scanner, when Yahoo throttles)
 *
 * It updates price, day change and market cap (via the share count derived from
 * the original Tadawul snapshot), then stamps the snapshot date used by the page.
 * Data is written only when the run resolves most symbols, so a failed run never
 * replaces good prices with partial ones.
 *
 * Local run: node scripts/update-prices.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const DATA_FILE = new URL('../dist/data.json', import.meta.url);
const YAHOO_CONCURRENCY = Number(process.env.YAHOO_CONCURRENCY || 3);
const YAHOO_DELAY_MS = Number(process.env.YAHOO_DELAY_MS || 400);
const YAHOO_TIMEOUT_MS = Number(process.env.YAHOO_TIMEOUT_MS || 20000);
const YAHOO_MAX_RETRIES = Number(process.env.YAHOO_MAX_RETRIES || 3);
const YAHOO_FAIL_FAST = Number(process.env.YAHOO_FAIL_FAST || 15);
const MIN_SUCCESS_RATIO = Number(process.env.MIN_SUCCESS_RATIO || 0.7);
const TV_BATCH = 100;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const RIYADH = 'Asia/Riyadh';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const riyadhIso = date =>
  new Intl.DateTimeFormat('en-CA', { timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const riyadhFromUnix = seconds => riyadhIso(new Date(seconds * 1000));
const displayDate = isoDate => isoDate.split('-').reverse().join('.');

const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
const stocks = data.sectors.flatMap(sector => sector.stocks);

// Share counts come from the original Tadawul snapshot (market cap ÷ price) and
// are persisted once, so the market cap follows the price without drifting.
for (const stock of stocks) {
  if (stock.shares == null && stock.price > 0 && stock.marketCap > 0) {
    stock.shares = Math.round((stock.marketCap * 1e6) / stock.price);
  }
}

async function getJson(url, { method = 'GET', body, headers = {}, timeout = YAHOO_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      body,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- Yahoo ---------------------------------- */
// Yahoo blocks anonymous server traffic from many hosts, so we first try the
// cookie + crumb handshake and the batched quote endpoint (a few requests).
async function yahooSession() {
  try {
    const landing = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
    });
    const cookies = new Map();
    for (const raw of landing.headers.getSetCookie?.() || []) {
      const pair = raw.split(';')[0];
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    if (!cookies.size) throw new Error('no cookies');
    const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': USER_AGENT, Cookie: cookieHeader },
    });
    if (!crumbResponse.ok) throw new Error(`crumb HTTP ${crumbResponse.status}`);
    const crumb = (await crumbResponse.text()).trim();
    if (!crumb || crumb.length > 40) throw new Error(`invalid crumb: ${crumb.slice(0, 20)}`);
    return { cookieHeader, crumb };
  } catch (error) {
    console.log(`Yahoo session failed: ${error.message}`);
    return null;
  }
}

async function yahooBatchQuotes(symbols, session) {
  const found = new Map();
  for (let index = 0; index < symbols.length; index += 100) {
    const chunk = symbols.slice(index, index + 100).map(symbol => `${symbol}.SR`).join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${chunk}&crumb=${encodeURIComponent(session.crumb)}`;
    const payload = await getJson(url, { headers: { Cookie: session.cookieHeader } });
    for (const quote of payload?.quoteResponse?.result || []) {
      if (!Number.isFinite(quote.regularMarketPrice)) continue;
      found.set(String(quote.symbol).replace('.SR', ''), {
        close: quote.regularMarketPrice,
        previous: Number.isFinite(quote.regularMarketPreviousClose) ? quote.regularMarketPreviousClose : null,
        date: quote.regularMarketTime ? riyadhFromUnix(quote.regularMarketTime) : null,
        source: 'yahoo',
      });
    }
  }
  return found;
}

async function yahooSeries(symbol, attempt = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?interval=1d&range=1mo`;
  try {
    const payload = await getJson(url);
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error('no chart result');
    if (result.meta?.currency && result.meta.currency !== 'SAR') throw new Error(`currency ${result.meta.currency}`);
    const closes = result.indicators?.quote?.[0]?.close || [];
    const bars = (result.timestamp || [])
      .map((time, index) => ({ time, close: closes[index] }))
      .filter(bar => bar.close != null && Number.isFinite(bar.close));
    if (!bars.length) throw new Error('no daily bars');
    const last = bars[bars.length - 1];
    const previous = bars.length > 1 ? bars[bars.length - 2].close : result.meta?.chartPreviousClose ?? null;
    return { close: last.close, previous, date: riyadhFromUnix(last.time), source: 'yahoo' };
  } catch (error) {
    if (attempt < YAHOO_MAX_RETRIES && !/HTTP 404/.test(error.message)) {
      await sleep(1500 * (attempt + 1));
      return yahooSeries(symbol, attempt + 1);
    }
    throw error;
  }
}

const quotes = new Map();
const failures = [];
let consecutiveYahooFailures = 0;
let yahooDisabled = false;

const session = await yahooSession();
if (session) {
  try {
    const batch = await yahooBatchQuotes(stocks.map(stock => stock.symbol), session);
    for (const [symbol, quote] of batch) quotes.set(symbol, quote);
    console.log(`Yahoo batch quotes: ${batch.size}/${stocks.length} symbols`);
  } catch (error) {
    console.log(`Yahoo batch quotes failed: ${error.message}`);
  }
}

const queue = stocks.filter(stock => !quotes.has(stock.symbol));
async function yahooWorker() {
  while (queue.length && !yahooDisabled) {
    const stock = queue.shift();
    if (!stock || quotes.has(stock.symbol)) continue;
    try {
      quotes.set(stock.symbol, await yahooSeries(stock.symbol));
      consecutiveYahooFailures = 0;
    } catch (error) {
      consecutiveYahooFailures += 1;
      failures.push({ symbol: stock.symbol, source: 'yahoo', reason: error.message });
      if (consecutiveYahooFailures <= 3) console.log(`Yahoo ${stock.symbol}: ${error.message}`);
      if (consecutiveYahooFailures >= YAHOO_FAIL_FAST && !yahooDisabled) {
        yahooDisabled = true;
        console.log(`Yahoo throttled after ${YAHOO_FAIL_FAST} consecutive failures; switching to TradingView.`);
      }
    }
    await sleep(YAHOO_DELAY_MS);
  }
}

await Promise.all(Array.from({ length: Math.min(YAHOO_CONCURRENCY, stocks.length) }, yahooWorker));
const viaYahoo = quotes.size;
console.log(`Yahoo Finance: ${viaYahoo}/${stocks.length} symbols`);

/* ----------------------------- TradingView ------------------------------- */
const missing = stocks.filter(stock => !quotes.has(stock.symbol));
let viaTradingView = 0;

for (let index = 0; index < missing.length; index += TV_BATCH) {
  const batch = missing.slice(index, index + TV_BATCH);
  const body = JSON.stringify({
    symbols: { tickers: batch.map(stock => `TADAWUL:${stock.symbol}`), query: { types: [] } },
    columns: ['close', 'change', 'currency'],
  });
  try {
    const payload = await getJson('https://scanner.tradingview.com/ksa/scan', { method: 'POST', body });
    for (const row of payload?.data || []) {
      const symbol = String(row.s).split(':')[1];
      const [close, change, currency] = row.d || [];
      if (!Number.isFinite(close) || currency !== 'SAR') continue;
      const percent = Number.isFinite(change) ? change : null;
      quotes.set(symbol, {
        close,
        previous: percent == null ? null : close / (1 + percent / 100),
        date: null,
        source: 'tradingview',
      });
      viaTradingView += 1;
    }
  } catch (error) {
    console.log(`TradingView batch failed (${batch.length} symbols): ${error.message}`);
  }
  await sleep(500);
}

if (viaTradingView) console.log(`TradingView: ${viaTradingView}/${missing.length} remaining symbols`);

/* ------------------------------- Apply ---------------------------------- */
const resolved = stocks.filter(stock => quotes.has(stock.symbol));
if (resolved.length < stocks.length * MIN_SUCCESS_RATIO) {
  console.error(`Only ${resolved.length}/${stocks.length} prices resolved; data.json left untouched.`);
  process.exit(1);
}

const yahooDates = [...quotes.values()].filter(quote => quote.date).map(quote => quote.date).sort();
let snapshotDate = yahooDates.at(-1) || null;

if (!snapshotDate) {
  // TradingView carries no trade date: treat a broad price move as a new session,
  // otherwise keep the date of the snapshot already on disk.
  const moved = resolved.filter(stock => Math.abs((quotes.get(stock.symbol).close - stock.price) / stock.price) > 0.001).length;
  snapshotDate = moved > resolved.length * 0.1 ? riyadhIso(new Date()) : data.asOf || data.priceDate.split('.').reverse().join('-');
}

for (const stock of stocks) {
  const quote = quotes.get(stock.symbol);
  if (!quote) continue;
  stock.price = round(quote.close);
  if (quote.previous > 0) stock.day = round((quote.close / quote.previous - 1) * 100);
  if (stock.shares) stock.marketCap = round((stock.shares * stock.price) / 1e6);
  if (quote.date) stock.priceDate = quote.date;
}

const provider = viaTradingView > viaYahoo ? 'TradingView' : 'Yahoo Finance';

data.priceDate = displayDate(snapshotDate);
data.asOf = snapshotDate;
data.priceSource = {
  provider,
  yahooSymbols: viaYahoo,
  tradingViewSymbols: viaTradingView,
};

// Daily Tadawul index snapshot from the same TradingView market-data source.
try {
  const response = await getJson('https://scanner.tradingview.com/ksa/scan', {
    method: 'POST',
    body: JSON.stringify({symbols:{tickers:['TADAWUL:TASI'],query:{types:[]}},columns:['close','change','Perf.3M','Perf.6M','Perf.Y','Value.Traded']})
  });
  const row=response?.data?.[0]?.d;
  if(row && Number.isFinite(row[0])) data.marketSummary={value:round(row[0],2),day:Number.isFinite(row[1])?round(row[1],2):null,month3:Number.isFinite(row[2])?round(row[2],2):null,month6:Number.isFinite(row[3])?round(row[3],2):null,year1:Number.isFinite(row[4])?round(row[4],2):null,turnover:Number.isFinite(row[5])?round(row[5]/1e6,2):null,date:data.priceDate,source:'TradingView'};
  else console.log('TASI summary unavailable; existing summary retained.');
} catch(error) { console.log(`TASI summary failed: ${error.message}; existing summary retained.`); }

await writeFile(DATA_FILE, JSON.stringify(data));

console.log(`Snapshot ${data.priceDate} · ${resolved.length}/${stocks.length} symbols updated via ${provider}`);
if (failures.length) console.log(`Unresolved after both sources: ${stocks.length - resolved.length}`);

#!/usr/bin/env node
/**
 * Refreshes Tadawul prices in dist/data.json. During the session the values
 * are current or delayed by the provider (normally no more than 15 minutes).
 *
 * Primary source : Yahoo Finance  (SYMBOL.SR, daily chart series)
 * Fallback source: TradingView   (TADAWUL:SYMBOL scanner, when Yahoo throttles)
 *
 * It updates price, day change and market cap (via the share count derived from
 * the original Tadawul snapshot), plus provider-reported 52-week extremes,
 * then stamps the quote date used by the page.
 * Data is written only when the run resolves most symbols, so a failed run never
 * replaces good prices with partial ones.
 *
 * Local run: node scripts/update-prices.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { applyWeek52Range } from './week52-range.mjs';

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
const financialMap = JSON.parse(await readFile(new URL('../dist/financial-map.json', import.meta.url), 'utf8'));
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
        timestamp: quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toISOString() : null,
        source: 'yahoo',
        week52Candidates: quote.currency === 'SAR' ? [{
          low: quote.fiftyTwoWeekLow, high: quote.fiftyTwoWeekHigh, referencePrice: quote.regularMarketPrice,
          source: 'Yahoo Finance', checkedAt: new Date().toISOString(),
        }] : [],
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
    return {
      close: last.close, previous, date: riyadhFromUnix(last.time),
      timestamp: new Date(last.time * 1000).toISOString(), source: 'yahoo',
      week52Candidates: result.meta?.currency === 'SAR' ? [{
        low: result.meta.fiftyTwoWeekLow, high: result.meta.fiftyTwoWeekHigh, referencePrice: last.close,
        source: 'Yahoo Finance', checkedAt: new Date().toISOString(),
      }] : [],
    };
  } catch (error) {
    if (attempt < YAHOO_MAX_RETRIES && !/HTTP 404/.test(error.message)) {
      await sleep(1500 * (attempt + 1));
      return yahooSeries(symbol, attempt + 1);
    }
    throw error;
  }
}

const quotes = new Map();
const tvWeek52 = new Map();
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
// Ask for the optional fields with the existing scanner requests. If an
// upstream schema change rejects them, retry the original request unchanged so
// the site's normal price/YTD refresh does not depend on this new indicator.
async function tradingViewScanWithOptionalRanges(batch, baseColumns, extraColumns) {
  const scan = columns => getJson('https://scanner.tradingview.com/ksa/scan', {
    method: 'POST',
    body: JSON.stringify({
      symbols: { tickers: batch.map(stock => `TADAWUL:${stock.symbol}`), query: { types: [] } },
      columns,
    }),
  });
  try {
    return await scan([...baseColumns, ...extraColumns]);
  } catch (error) {
    console.log(`TradingView extended scan failed (${error.message}); retrying original fields.`);
    return scan(baseColumns);
  }
}

function rememberTradingViewRange(symbol, close, currency, low, high) {
  if (currency !== 'SAR') return;
  const candidates = tvWeek52.get(symbol) || [];
  candidates.push({ low, high, referencePrice: close, source: 'TradingView', checkedAt: new Date().toISOString() });
  tvWeek52.set(symbol, candidates);
}

const missing = stocks.filter(stock => !quotes.has(stock.symbol));
let viaTradingView = 0;

for (let index = 0; index < missing.length; index += TV_BATCH) {
  const batch = missing.slice(index, index + TV_BATCH);
  try {
    const payload = await tradingViewScanWithOptionalRanges(batch,
      ['close', 'change', 'currency', 'Perf.YTD'], ['price_52_week_low', 'price_52_week_high']);
    for (const row of payload?.data || []) {
      const symbol = String(row.s).split(':')[1];
      const [close, change, currency, ytd, low, high] = row.d || [];
      if (!Number.isFinite(close) || currency !== 'SAR') continue;
      rememberTradingViewRange(symbol, close, currency, low, high);
      const percent = Number.isFinite(change) ? change : null;
      quotes.set(symbol, {
        close,
        previous: percent == null ? null : close / (1 + percent / 100),
        date: null,
        timestamp: null,
        source: 'tradingview',
        ytd: Number.isFinite(ytd) ? ytd : null,
      });
      viaTradingView += 1;
    }
  } catch (error) {
    console.log(`TradingView batch failed (${batch.length} symbols): ${error.message}`);
  }
  await sleep(500);
}

if (viaTradingView) console.log(`TradingView: ${viaTradingView}/${missing.length} remaining symbols`);

// Perf.YTD is fetched separately so it is present even when Yahoo resolves
// the closing price first (Yahoo's quote endpoint does not expose YTD).
for (let index = 0; index < stocks.length; index += TV_BATCH) {
  const batch = stocks.slice(index, index + TV_BATCH);
  try {
    const payload = await tradingViewScanWithOptionalRanges(batch, ['Perf.YTD'],
      ['close', 'currency', 'price_52_week_low', 'price_52_week_high']);
    for (const row of payload?.data || []) {
      const symbol = String(row.s).split(':')[1];
      const [ytd, close, currency, low, high] = row.d || [];
      const quote = quotes.get(symbol);
      if (quote && Number.isFinite(ytd)) quote.ytd = ytd;
      rememberTradingViewRange(symbol, close, currency, low, high);
    }
  } catch (error) {
    console.log(`TradingView YTD batch failed (${batch.length} symbols): ${error.message}`);
  }
  await sleep(250);
}

/* ------------------------------- Apply ---------------------------------- */
const resolved = stocks.filter(stock => quotes.has(stock.symbol));
if (resolved.length < stocks.length * MIN_SUCCESS_RATIO) {
  console.error(`Only ${resolved.length}/${stocks.length} prices resolved; data.json left untouched.`);
  process.exit(1);
}

const yahooDates = [...quotes.values()].filter(quote => quote.date).map(quote => quote.date).sort();
let snapshotDate = yahooDates.at(-1) || null;

if (!snapshotDate) {
  // TradingView does not return a trade timestamp, but it is the live/fallback
  // feed used during the session. Stamp the Riyadh date of this refresh instead
  // of retaining the previous closing date.
  snapshotDate = riyadhIso(new Date());
}

const week52Counts = { updated: 0, retained: 0, incompatible: 0, unavailable: 0 };
for (const stock of stocks) {
  const quote = quotes.get(stock.symbol);
  if (quote) {
    stock.price = round(quote.close);
    if (quote.previous > 0) stock.day = round((quote.close / quote.previous - 1) * 100);
    if (stock.shares) stock.marketCap = round((stock.shares * stock.price) / 1e6);
    if (quote.date) stock.priceDate = quote.date;
    if (Number.isFinite(quote.ytd)) stock.ytd = round(quote.ytd);
  }
  const status = applyWeek52Range(stock, [
    ...(quote?.week52Candidates || []), ...(tvWeek52.get(stock.symbol) || []),
  ]);
  week52Counts[status]++;
}
console.log(`52-week ranges: ${week52Counts.updated} updated, ${week52Counts.retained} retained, ${week52Counts.incompatible} incompatible with price, ${week52Counts.unavailable} unavailable`);

const provider = viaTradingView > viaYahoo ? 'TradingView' : 'Yahoo Finance';

data.priceDate = displayDate(snapshotDate);
data.asOf = snapshotDate;
data.priceSource = {
  provider,
  yahooSymbols: viaYahoo,
  tradingViewSymbols: viaTradingView,
  mode: 'intraday',
  delayMinutes: 15,
  checkedAt: new Date().toISOString(),
};

// Refresh TASI value and point move from the intraday feed. The official report
// remains the source for traded turnover when it is available for the same date.
async function tradingViewIndexSummary() {
  const payload = await getJson('https://scanner.tradingview.com/ksa/scan', {
    method: 'POST',
    body: JSON.stringify({
      symbols: { tickers: ['TADAWUL:TASI'], query: { types: [] } },
      columns: ['close', 'change', 'change_abs'],
    }),
  });
  const values = payload?.data?.[0]?.d || [];
  const [value, day, pointChange] = values;
  if (![value, day, pointChange].every(Number.isFinite)) throw new Error('TASI quote missing');
  return {
    value: round(value, 2),
    pointChange: round(pointChange, 2),
    day: round(day, 2),
    date: displayDate(riyadhIso(new Date())),
    quoteSource: 'TradingView',
    isIntraday: true,
    updatedAt: data.priceSource.checkedAt,
  };
}

let liveIndex = null;
try {
  liveIndex = await tradingViewIndexSummary();
} catch (error) {
  console.log(`TradingView TASI quote failed: ${error.message}`);
}

// Refresh the official daily turnover report as a supplement to the live quote.
async function officialTadawulSummary(){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  let html;try{const response=await fetch('https://www.saudiexchange.sa/Resources/Reports-v2/DetailedDaily_en.html',{headers:{'User-Agent':USER_AGENT,'Accept':'text/html'},signal:controller.signal});if(!response.ok)throw Error(`Tadawul HTTP ${response.status}`);html=await response.text();}finally{clearTimeout(timer);}
  const rows=[];
  for(const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const td=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>x[1].replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim());
    if(td.length>=2)rows.push(td);
  }
  const get=label=>rows.find(([key])=>key.toLowerCase()===label.toLowerCase())?.[1];
  const num=value=>{const n=Number(String(value??'').replace(/,/g,'').replace(/[^0-9.+-]/g,''));return Number.isFinite(n)?n:null;};
  const date=html.match(/Market Date\s+(\d{4})\/(\d{2})\/(\d{2})/i);
  const value=num(get('Close')),pointChange=num(get('Change')),day=num(get('% Change')),turnover=num(get('Value Traded (SAR)'));
  if(value==null||pointChange==null||day==null||turnover==null)throw Error('Required fields missing from daily report');
  return {value:round(value,2),pointChange:round(pointChange,2),day:round(day,2),turnover:round(turnover,0),date:date?`${date[3]}.${date[2]}.${date[1]}`:data.priceDate,source:'Saudi Exchange'};
}
try{
  const tv=await getJson('https://scanner.tradingview.com/ksa/scan',{method:'POST',body:JSON.stringify({symbols:{tickers:['TADAWUL:TASI'],query:{types:[]}},columns:['Perf.3M','Perf.6M','Perf.Y','Perf.YTD']})});
  const performance=tv?.data?.[0]?.d||[];
  data.marketSummary={...(data.marketSummary||{}),month3:Number.isFinite(performance[0])?round(performance[0],2):data.marketSummary?.month3??null,month6:Number.isFinite(performance[1])?round(performance[1],2):data.marketSummary?.month6??null,year1:Number.isFinite(performance[2])?round(performance[2],2):data.marketSummary?.year1??null,ytd:Number.isFinite(performance[3])?round(performance[3],2):data.marketSummary?.ytd??null};
}catch(error){console.log(`TASI performance fetch failed: ${error.message}`);}
try{
  const daily = await officialTadawulSummary();
  const sameDate = !liveIndex || daily.date === liveIndex.date;
  data.marketSummary = { ...(data.marketSummary || {}), ...daily };
  if (liveIndex) data.marketSummary = { ...data.marketSummary, ...liveIndex, turnover: sameDate ? data.marketSummary.turnover : null };
}catch(error){
  if (liveIndex) data.marketSummary = { ...(data.marketSummary || {}), ...liveIndex, turnover: null };
  else console.log(`Official Tadawul summary failed: ${error.message}; previous daily summary retained.`);
}

// Read Argaam's own financial indicator instead of rebuilding the yield from
// dividend-history reports. This is the same value shown on the company page:
// "Dividend Yield (%) (Last Year)".
async function argaamHtml(url){
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
    try{const response=await fetch(url,{headers:{'User-Agent':USER_AGENT,'Accept':'text/html','X-Requested-With':'XMLHttpRequest','Referer':'https://www.argaam.com/en/tadawul/tasi/saudi-energy'},signal:controller.signal});if(!response.ok)throw Error(`Argaam HTTP ${response.status}`);return await response.text();}
    catch(error){lastError=error;if(attempt<2)await sleep(700*(attempt+1));}
    finally{clearTimeout(timer);}
  }
  throw lastError;
}
async function pool(items,limit,worker){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;try{await worker(items[i]);}catch(error){console.log(`Argaam fetch failed: ${error.message}`);}}}));}
const argaamBase='https://www.argaam.com';
const companyIdsBySymbol=new Map(Object.entries(financialMap.companyIds).map(([companyId,symbol])=>[symbol,companyId]));
const stocksBySymbol=new Map(stocks.map(stock=>[stock.symbol,stock]));
let yieldCount=0,ratioCount=0;
await pool(stocks,4,async stock=>{
  const companyId=companyIdsBySymbol.get(stock.symbol);if(!companyId)return;
  const html=await argaamHtml(`${argaamBase}/en/companies/latest-quarter-financial-ratios?companyID=${companyId}&marketID=3&headingWithMoreLink=true`);
  const row=html.match(/<tr\b[^>]*data-fieldid=["']CurrentDividendYield["'][^>]*>[\s\S]*?<\/tr>/i)?.[0];
  if(!row)return;
  ratioCount++;
  const raw=row.match(/(?:currency-current-value|data-order)=["']\s*([^"']+?)\s*["']/i)?.[1];
  const value=raw==null?null:Number(raw.replace(/,/g,''));
  if(Number.isFinite(value)&&value>=0){stock.dividendYield=round(value,2);stock.dividendYieldSource='Argaam Dividend Yield (%) (Last Year)';yieldCount++;}
  else {stock.dividendYield=null;delete stock.dividendYieldSource;}
});
console.log(`Argaam financial-indicator dividend yields: ${yieldCount}/${stocks.length}; ratio rows ${ratioCount}/${stocks.length}`);

await writeFile(DATA_FILE, JSON.stringify(data));

console.log(`Snapshot ${data.priceDate} · ${resolved.length}/${stocks.length} symbols updated via ${provider}`);
if (failures.length) console.log(`Unresolved after both sources: ${stocks.length - resolved.length}`);

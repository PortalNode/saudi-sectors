// Price dates refer to a market observation, never to the time of a download.
export const RIYADH = 'Asia/Riyadh';
export const OFFICIAL_URL = 'https://www.saudiexchange.sa/Resources/Reports-v2/DetailedDaily_en.html';
export const OFFICIAL_HOME_URL = 'https://www.saudiexchange.sa/wps/portal/saudiexchange/home/';
export const round = (n, digits = 2) => Number(n.toFixed(digits));
export const isoDate = date => new Intl.DateTimeFormat('en-CA', {
  timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
export const displayDate = iso => iso.split('-').reverse().join('.');
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function dateFromUnix(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? isoDate(date) : null;
}
export function marketSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: RIYADH, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = key => parts.find(p => p.type === key)?.value;
  const weekday = !['Fri', 'Sat'].includes(get('weekday'));
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { active: weekday && minutes >= 600 && minutes < 920, beforeClose: weekday && minutes < 920 };
}
export function strictNumber(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(/,/g, '').replace(/\s*%$/, '').trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
const text = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const key = value => value.toLowerCase().replace(/\s+/g, ' ').trim();
export function parseOfficialDaily(html, now = new Date()) {
  const plain = text(html);
  const match = plain.match(/Market\s+Date\s*:?[\s]*(\d{4})\/(\d{2})\/(\d{2})/i);
  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  if (!validDate(date) || date > isoDate(now)) throw new Error('Official report missing/invalid/future market date');
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1])));
  const header = rows.find(row => row.some(v => key(v) === 'symbol') && row.some(v => key(v) === 'close (sar)'));
  if (!header) throw new Error('Official company-table schema not recognized');
  const index = name => header.findIndex(v => key(v) === name);
  const symbolIndex = index('symbol'), closeIndex = index('close (sar)'), dayIndex = index('% change');
  const capIndex = index('market cap (sar)'), companyIndex = index('company'), volumeIndex = index('volume traded');
  if ([symbolIndex, closeIndex, dayIndex, capIndex, companyIndex, volumeIndex].some(i => i < 0)) {
    throw new Error('Official company-table required columns missing');
  }
  const quotes = new Map();
  for (const row of rows) {
    const symbol = row[symbolIndex];
    if (!/^\d{4}$/.test(symbol || '') || row.length !== header.length) continue;
    if (quotes.has(symbol)) throw new Error(`Duplicate official symbol ${symbol}`);
    const close = strictNumber(row[closeIndex]), day = strictNumber(row[dayIndex]);
    const cap = strictNumber(row[capIndex]), volume = strictNumber(row[volumeIndex]);
    if (!(close > 0) || !(cap > 0) || day == null || volume == null || volume < 0) continue;
    quotes.set(symbol, { close, day, marketCap: cap / 1e6, date, source: 'Saudi Exchange',
      status: 'official_close', suspended: /\*/.test(row[companyIndex]) && volume === 0,
      timestamp: null, currency: 'SAR' });
  }
  if (!quotes.size) throw new Error('Official report contains no usable company prices');
  const get = name => strictNumber(rows.find(row => row.length === 2 && key(row[0]) === name)?.[1]);
  const value = get('close'), pointChange = get('change'), day = get('% change'), turnover = get('value traded (sar)');
  if (!(value > 0) || pointChange == null || day == null || turnover == null || turnover < 0) {
    throw new Error('Official index summary missing required values');
  }
  return { date, quotes, summary: { value, pointChange, day, turnover, date: displayDate(date),
    source: 'Saudi Exchange', turnoverSource: 'Saudi Exchange', mode: 'close', isIntraday: false } };
}
function classValue(html, className) {
  const match = html.match(new RegExp(`class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>\\s*([^<]+)`, 'i'));
  return strictNumber(match?.[1]);
}
export function parseOfficialMarketPage(html, now = new Date()) {
  const date = html.match(/dateTime"\s*:\s*"(\d{4}-\d{2}-\d{2})/i)?.[1] || null;
  const turnover = classValue(html, 'valueTradedMain');
  if (!validDate(date) || date > isoDate(now) || turnover == null || turnover < 0) {
    throw new Error('Official market page missing dated value traded');
  }
  return { date, turnover, source: 'Saudi Exchange' };
}
export const TV_COLUMNS = ['close', 'change', 'currency', 'time', 'update_mode', 'market_cap_basic',
  'Perf.YTD', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'price_52_week_low', 'price_52_week_high'];
export function normalizeTradingView(row, now = new Date(), isIndex = false) {
  const [close, day, currency, barTime, updateMode, marketCap, ytd, month3, month6, year1, low, high] = row.d || [];
  const date = dateFromUnix(barTime);
  if (!(Number.isFinite(close) && close > 0) || !Number.isFinite(day) || (!isIndex && currency !== 'SAR') ||
      !validDate(date) || date > isoDate(now) || barTime > now.getTime() / 1000) return null;
  const delay = String(updateMode || '').match(/^delayed_streaming_(\d+)$/);
  const nullable = n => Number.isFinite(n) ? n : null;
  return { close, day, currency: isIndex ? null : currency, date,
    // Scanner time identifies the daily bar. It is NOT a last-trade timestamp.
    timestamp: null, barTime, source: 'TradingView', status: 'delayed',
    marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap / 1e6 : null,
    delayMinutes: delay ? Number(delay[1]) / 60 : null,
    performance: { ytd: nullable(ytd), month3: nullable(month3), month6: nullable(month6), year1: nullable(year1) },
    week52Candidates: currency === 'SAR' ? [{ low, high, referencePrice: close, source: 'TradingView', checkedAt: now.toISOString() }] : [],
  };
}
export function selectQuote(official, delayed, targetDate, now = new Date()) {
  const officialUsable = official?.date === targetDate &&
    (targetDate < isoDate(now) || !marketSession(now).beforeClose);
  if (officialUsable) return official;
  if (delayed?.date === targetDate) return delayed;
  return null;
}

// Intraday market-turnover estimate: per-stock delayed volume x last price.
// Only with broad same-session coverage; always displayed labelled as an
// estimate, and replaced by the official traded value at close.
export function estimateTurnover(stocks, delayed, selected, targetDate) {
  let sum = 0, counted = 0;
  for (const stock of stocks) {
    const quote = selected.get(stock.symbol), supplemental = delayed.get(stock.symbol);
    if (quote?.close > 0 && supplemental?.date === targetDate &&
        Number.isFinite(supplemental.volume) && supplemental.volume > 0) {
      sum += quote.close * supplemental.volume;
      counted++;
    }
  }
  return stocks.length && counted / stocks.length >= 0.9 && sum > 0 ? round(sum) : null;
}
export function applyQuote(stock, quote, performance, checkedAt) {
  if (!quote) {
    stock.priceStatus = 'unavailable';
    stock.price = stock.day = stock.marketCap = stock.pe = stock.pb = null;
    stock.priceDate = stock.priceTimestamp = null;
    delete stock.priceSource;
  } else {
    stock.price = round(quote.close);
    stock.day = round(quote.day);
    stock.priceDate = quote.date;
    stock.priceTimestamp = quote.timestamp;
    stock.priceSource = quote.source;
    stock.priceStatus = quote.status;
    stock.marketCap = quote.marketCap == null ? null : round(quote.marketCap);
    stock.marketCapSource = quote.marketCap == null ? null : quote.source;
    if (quote.source === 'Saudi Exchange' && quote.marketCap > 0) {
      stock.shares = Math.round(quote.marketCap * 1e6 / quote.close);
      stock.sharesDate = quote.date;
      stock.sharesSource = 'Derived from official market capitalization / close';
    }
    stock.suspended = quote.suspended || false;
    stock.pe = Number.isFinite(stock.eps) && stock.eps > 0 ? stock.price / stock.eps : null;
    stock.pb = Number.isFinite(stock.bookValue) && stock.bookValue > 0 ? stock.price / stock.bookValue : null;
  }
  stock.priceCheckedAt = checkedAt;
  for (const field of ['ytd', 'month3', 'month6', 'year1']) {
    stock[field] = performance?.date === quote?.date && Number.isFinite(performance?.performance?.[field])
      ? round(performance.performance[field]) : null;
  }
  stock.performanceDate = performance?.date === quote?.date ? performance?.date ?? null : null;
  stock.performanceSource = stock.performanceDate ? 'TradingView' : null;
}

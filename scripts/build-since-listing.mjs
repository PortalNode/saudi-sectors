#!/usr/bin/env node
/**
 * dist/since-listing.json: each stock's performance since its first trading day, twice —
 *   priceReturn: price only (adjusted for bonus shares, splits and rights issues, no dividends)
 *   totalReturn: with every cash dividend reinvested on its ex-date (TradingView's ADJ basis)
 * plus the compound annual rate of each and what 1,000 SAR at the first close is worth now.
 *
 * Sources (scripts/listing-anchors.json, refreshed weekly by scripts/fetch-listing-history.mjs):
 *   price:     base → join from TradingView's history (before our candles start, e.g. 1999–2010), then
 *              join → last close from our candles, the Saudi Exchange's official adjusted closes
 *   dividends: their effect base → anchor from TradingView's dividend-adjusted series (a fuller record
 *              than ours), then anchor → last close from our own dividends (dist/ohlc div)
 * A stock without an anchor uses our candles alone. When the first session we know is later than
 * the listing, the figure is marked incomplete and says from when.
 * Runs without network. Usage: node scripts/build-since-listing.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readCandles } from './ohlc-files.mjs';
import { dividendFactors } from './adjust-dividends.mjs';

const ROOT = new URL('../', import.meta.url), DIST = new URL('dist/', ROOT), OHLC = new URL('ohlc/', DIST);
const readJson = async url => { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; } };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const round = (x, dp = 2) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp;
export const LISTING_SLACK = 10;

/** Compound annual rate of a return `r` (a fraction) over `years`; none under a year. */
export const cagr = (r, years) => years >= 1 && r > -1 ? (1 + r) ** (1 / years) - 1 : null;

/**
 * One stock's figures (pure). `ours` = { d, c, div } from dist/ohlc; `anchor` from listing-anchors.json
 * or null; `listed` = listing date. Returns null when there is nothing to measure.
 */
export function sinceListing({ ours, anchor = null, listed = null }) {
  if (!ours?.d?.length || ours.d.length !== ours.c?.length) return null;
  const n = ours.d.length - 1, factor = dividendFactors(ours.d, ours.c, ours.div ?? []);
  const j = anchor ? ours.d.indexOf(anchor.join?.d) : -1, a = anchor ? ours.d.indexOf(anchor.anchor?.d) : -1;
  const ok = x => x?.c > 0 && x?.ca > 0;
  let base, price, total, from;
  if (j >= 0 && a >= j && ok(anchor.base) && ok(anchor.join) && ok(anchor.anchor)) {
    base = anchor.base.d; from = 'tradingview';
    price = (anchor.join.c / anchor.base.c) * (ours.c[n] / ours.c[j]) - 1;
    // Dividends alone: TradingView's total move over its price move, base → anchor; then ours.
    const divMul = (anchor.anchor.ca / anchor.base.ca) / (anchor.anchor.c / anchor.base.c) / factor[a];
    total = (1 + price) * divMul - 1;
  } else {
    base = ours.d[0]; from = 'candles';
    price = ours.c[n] / ours.c[0] - 1;
    total = ours.c[n] / (ours.c[0] * factor[0]) - 1;
  }
  const years = days(base, ours.d[n]) / 365.25;
  return {
    listed, base, last: ours.d[n], close: ours.c[n], years: round(years, 2),
    complete: !listed || days(listed, base) <= LISTING_SLACK,
    priceReturn: round(price * 100), totalReturn: round(total * 100),
    priceCagr: round(cagr(price, years) * 100), totalCagr: round(cagr(total, years) * 100),
    priceValue: round(1000 * (1 + price), 0), totalValue: round(1000 * (1 + total), 0),
    source: from
  };
}

async function main() {
  const data = await readJson(new URL('data.json', DIST)), profiles = await readJson(new URL('company-profiles.json', DIST)) ?? {};
  const anchors = (await readJson(new URL('scripts/listing-anchors.json', ROOT)))?.symbols ?? {};
  const stocks = {}, missing = [];
  let partial = 0, fromAnchors = 0;
  for (const stock of data.sectors.flatMap(s => s.stocks)) {
    const ours = await readCandles(OHLC, stock.symbol);
    const row = sinceListing({ ours, anchor: anchors[stock.symbol] ?? null, listed: profiles[stock.symbol]?.listed ?? null });
    if (!row) { missing.push(stock.symbol); continue; }
    if (profiles[stock.symbol]?.listedPrecision === 'month') row.listedPrecision = 'month';
    if (!row.complete) partial += 1;
    if (row.source === 'tradingview') fromAnchors += 1;
    stocks[stock.symbol] = row;
  }
  const through = Object.values(stocks).reduce((m, r) => r.last > m ? r.last : m, '');
  await writeFile(new URL('since-listing.json', DIST), JSON.stringify({
    generatedAt: new Date().toISOString(), through,
    method: 'الأساس إغلاق أول جلسة تداول (لا سعر الطرح). بدون التوزيعات: الأسعار معدّلة للمنح والتجزئة وحقوق الأولوية فقط. مع التوزيعات: كل توزيع نقدي يُعاد استثماره في تاريخ استحقاقه. تاريخ ما قبل آخر تحديث أسبوعي من TradingView، وما بعده من إغلاقات تداول الرسمية والتوزيعات. لا زكاة ولا رسوم.',
    stocks
  }) + '\n');
  console.log(`Since listing: ${Object.keys(stocks).length} stocks (${fromAnchors} from TradingView history, ${partial} start after their listing) through ${through}${missing.length ? `; none for ${missing.join(', ')}` : ''}`);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();

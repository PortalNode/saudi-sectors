#!/usr/bin/env node
/**
 * Anchors for the "since listing" performance (scripts/build-since-listing.mjs), from TradingView's
 * full daily history (back to 1999, including the Nomu period of companies that moved to the main
 * market). Three sessions per stock, each with TradingView's close adjusted for capital actions (c)
 * and also for cash dividends (ca):
 *   base   = the first session on or after the listing (or the first TradingView has)
 *   join   = the first session our own candles (dist/ohlc, the exchange's official closes) also have
 *   anchor = the latest session both have
 * The build takes the price move base → join from TradingView and join → today from the official
 * closes, and the effect of dividends base → anchor from TradingView (its dividend record is fuller
 * than ours) and anchor → today from ours. Ratios between two dates don't change when a later capital
 * action or dividend rescales a history, so the anchors stay valid between weekly refreshes.
 *
 * A stock whose TradingView move over the shared sessions is far from the official one is a different
 * series (or an unadjusted capital action): it is left out and the build uses our candles alone.
 * Writes scripts/listing-anchors.json. Usage: node scripts/fetch-listing-history.mjs [--symbols 2222,1120]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { tvDailyHistory } from './tv-history.mjs';
import { readCandles } from './ohlc-files.mjs';

const ROOT = new URL('../', import.meta.url), DIST = new URL('dist/', ROOT), OHLC = new URL('ohlc/', DIST);
const OUT = new URL('scripts/listing-anchors.json', ROOT);
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const only = arg('--symbols') ? new Set(arg('--symbols').split(',')) : null;
const readJson = async url => { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

export const MATCH_TOLERANCE = 0.01;  // our close vs TradingView's on a session, after one common scale
export const LISTING_SLACK = 10;      // days between the listing date and the first session
export const WINDOW_LIMIT = 0.25;     // TradingView's move over the shared sessions vs the official one

/**
 * One stock's anchor from TradingView's two series and our candles (pure; exported for the tests).
 * `listed` is the listing date from company-profiles.json; `ours` is { d, c } from dist/ohlc.
 */
export function buildAnchor({ splits, dividends }, ours, listed) {
  if (!splits?.length || splits.length !== dividends?.length) return { error: 'TradingView series missing or unequal' };
  for (let i = 0; i < splits.length; i++) if (splits[i].d !== dividends[i].d) return { error: 'TradingView series dates differ' };
  // Base: the first session on or after the listing (a session listed days before it is the same listing).
  let b = 0;
  if (listed) { const i = splits.findIndex(x => days(listed, x.d) >= -LISTING_SLACK); if (i > 0) b = i; }
  const ourClose = new Map(ours.d.map((d, i) => [d, ours.c[i]]));
  let a = -1; for (let i = splits.length - 1; i >= b; i--) if (ourClose.has(splits[i].d)) { a = i; break; }
  if (a < 0) return { error: 'no session shared with our candles' };
  if (a === b) return { error: 'anchor not after the base session' };
  let j = b; while (j < a && !ourClose.has(splits[j].d)) j++;
  // How well the two histories agree on the sessions both have: per session after one common scale,
  // and as the whole move join → anchor.
  const k = ourClose.get(splits[a].d) / splits[a].c;
  const shared = splits.slice(j, a + 1).filter(x => ourClose.has(x.d)), off = shared.map(x => Math.abs(ourClose.get(x.d) / (x.c * k) - 1));
  const tvMove = splits[a].c / splits[j].c, ourMove = ourClose.get(splits[a].d) / ourClose.get(splits[j].d);
  const at = i => ({ d: splits[i].d, c: round(splits[i].c, 6), ca: round(dividends[i].c, 6) });
  return {
    listed: listed ?? null,
    first: splits[0].d,
    base: at(b), join: at(j), anchor: at(a),
    complete: !listed || days(listed, splits[b].d) <= LISTING_SLACK,
    check: { shared: shared.length, mismatched: off.filter(x => x > MATCH_TOLERANCE).length, maxOff: round(Math.max(...off) * 100, 2), window: round((tvMove / ourMove - 1) * 100, 2) }
  };
}
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

async function main() {
  const data = await readJson(new URL('data.json', DIST)), profiles = await readJson(new URL('company-profiles.json', DIST)) ?? {};
  const stocks = data.sectors.flatMap(s => s.stocks).filter(s => !only || only.has(s.symbol));
  const before = (await readJson(OUT))?.symbols ?? {};
  const symbols = only ? { ...before } : {}, failed = [], unchecked = [];
  let done = 0, inARow = 0, aborted = false;
  const queue = [...stocks];
  async function one(stock) {
    const ours = await readCandles(OHLC, stock.symbol);
    if (!ours?.d?.length) { failed.push(`${stock.symbol} (no candles)`); return; }
    let history = null;
    for (let attempt = 1; attempt <= 3 && !history; attempt++) {
      try { history = await tvDailyHistory(stock.symbol); }
      catch (error) { if (attempt === 3) failed.push(`${stock.symbol} (${error.message})`); else await sleep(1500 * attempt); }
    }
    if (!history) {
      if (before[stock.symbol]) symbols[stock.symbol] = before[stock.symbol]; // keep the last good anchor
      if (++inARow >= 8) aborted = true;
      return;
    }
    inARow = 0;
    const anchor = buildAnchor(history, ours, profiles[stock.symbol]?.listed);
    if (anchor.error) { failed.push(`${stock.symbol} (${anchor.error})`); if (before[stock.symbol]) symbols[stock.symbol] = before[stock.symbol]; return; }
    // A different move over the same sessions: not the same series; leave the stock out.
    if (Math.abs(anchor.check.window) > WINDOW_LIMIT * 100) { unchecked.push(`${stock.symbol} (TradingView ${anchor.check.window > 0 ? '+' : ''}${anchor.check.window}% vs the official closes over ${anchor.check.shared} sessions)`); return; }
    symbols[stock.symbol] = anchor;
    console.log(`[${done + 1}/${stocks.length}] ${stock.symbol} from ${anchor.base.d}${anchor.complete ? '' : ` (listed ${anchor.listed})`} · official from ${anchor.join.d} · anchor ${anchor.anchor.d} · ${anchor.check.mismatched}/${anchor.check.shared} sessions off · move ${anchor.check.window}%`);
  }
  // Three stocks at a time: one chart session each, as a few open TradingView charts would.
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length && !aborted) { await one(queue.shift()); done += 1; await sleep(300); }
  }));
  if (aborted) { console.error(`Stopped: ${inARow} stocks in a row failed (TradingView unreachable). Nothing written.`); process.exit(1); }
  const sorted = Object.fromEntries(Object.entries(symbols).sort(([a], [b]) => a < b ? -1 : 1));
  await writeFile(OUT, JSON.stringify({
    note: 'Since-listing anchors from TradingView daily history (scripts/fetch-listing-history.mjs). base = first session on/after listing; join = first session shared with dist/ohlc; anchor = latest shared session. c = close adjusted for capital actions, ca = also adjusted for cash dividends; only ratios between them are used.',
    fetchedAt: new Date().toISOString(), source: 'TradingView', symbols: sorted, failed, unchecked
  }, null, 1) + '\n');
  console.log(`Anchors for ${Object.keys(sorted).length}/${stocks.length} stocks; failed ${failed.length}${failed.length ? ': ' + failed.join(', ') : ''}; left out ${unchecked.length}${unchecked.length ? ': ' + unchecked.join(', ') : ''}`);
  if (!Object.keys(sorted).length) process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();

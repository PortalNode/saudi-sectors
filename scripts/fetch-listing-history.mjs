#!/usr/bin/env node
/**
 * Anchors for the "since listing" performance (scripts/build-since-listing.mjs), from TradingView's
 * full daily history (back to 1999, including the Nomu period of companies that moved to the main
 * market). Sessions per stock, with TradingView's close adjusted for capital actions (c) and also for
 * cash dividends (ca):
 *   base   = the first session on or after the listing (or the first TradingView has)
 *   join   = the first session our own candles (dist/ohlc, the exchange's official closes) also have
 *   anchor = the latest session both have (for the checks, and the date the dividends run to)
 *   preDiv = what reinvesting the dividends base → join multiplied the holding by
 * The build takes base → join from here and join → today from the official closes and our dividends.
 * Ratios between two dates don't change when a later capital action rescales a history, so the
 * anchors stay valid between weekly refreshes. A stock whose TradingView move over the shared sessions
 * is far from the official one is left out and the build uses our candles alone.
 *
 * Also rewrites each stock's dividends in dist/ohlc (the chart's ADJ, the scanner, the AI packs) by
 * checking TradingView's record against Yahoo's, dividend by dividend (see chooseDividends). Each one
 * is stated as its share of the previous close on our candles, so our ADJ moves as the chosen source's.
 * Writes scripts/listing-anchors.json.
 * Usage: node scripts/fetch-listing-history.mjs [--symbols 2222,1120] [--no-dividends]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { tvDailyHistory } from './tv-history.mjs';
import { readCandles, writeCandles } from './ohlc-files.mjs';
import { parseYahoo, parseYahooDividends, HISTORY_START } from './ohlc-merge.mjs';

const ROOT = new URL('../', import.meta.url), DIST = new URL('dist/', ROOT), OHLC = new URL('ohlc/', DIST);
const OUT = new URL('scripts/listing-anchors.json', ROOT);
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const only = arg('--symbols') ? new Set(arg('--symbols').split(',')) : null, noDividends = process.argv.includes('--no-dividends');
let dividendsWritten = 0;
const readJson = async url => { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; } };
const yahooJson = async symbol => {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?period1=${Date.parse(`${HISTORY_START}T00:00:00Z`) / 1000}&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  return r.json();
};
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
export const MATCH_DAYS = 5;          // a TradingView and a Yahoo dividend this close are the same one
export const IMPLAUSIBLE = 0.1;       // a dividend more than this share of the price that the price didn't fall by

/**
 * TradingView's dividends from its two series (pure): on an ex-date the ratio dividends ÷ splits steps
 * up, and ratio(before) ÷ ratio(ex) = 1 − D ÷ previous close. Returns [{ d, f, move }]: the ex-date,
 * the dividend's share of the previous close, and TradingView's own price move that day.
 */
export function tvDividendEvents({ splits, dividends }) {
  const out = [];
  for (let i = 1; i < splits.length; i++) {
    const f = 1 - (dividends[i - 1].c / splits[i - 1].c) / (dividends[i].c / splits[i].c);
    if (f > 1e-4 && f < 0.95) out.push({ d: splits[i].d, f, move: splits[i].c / splits[i - 1].c });
  }
  return out;
}
/** Yahoo's dividends as shares of its own previous close (pure): [{ d, f }]. */
export function yahooDividendEvents(json) {
  const bars = parseYahoo(json), out = [];
  for (const [date, amount] of parseYahooDividends(json)) {
    const k = bars.findIndex(b => b.d >= date);
    if (k > 0 && bars[k - 1].c > 0) out.push({ d: bars[k].d, f: amount / bars[k - 1].c });
  }
  return out;
}
// A large dividend the price did not fall by on its ex-date is a capital action recorded as cash
// (a capital reduction already adjusted in the prices, or a dividend not scaled with a share consolidation).
const implausible = (f, move) => f > IMPLAUSIBLE && f - (1 - move) > IMPLAUSIBLE;

/**
 * The dividends to keep inside our candles, on our basis (pure): [[ex-date, SAR]]. Dividend by dividend:
 *   - both sources have it and agree (within 15%): TradingView's
 *   - they disagree: the one closer to how far the official close fell on the ex-date
 *   - TradingView only: kept (Yahoo misses many before 2014) unless the price didn't fall by it
 *   - Yahoo only: dropped; the official close rarely falls on those dates (misdated or not cash)
 */
export function chooseDividends(tv, yahoo, ours) {
  const used = new Set(), out = [];
  for (const t of tv) {
    const k = ours.d.findIndex(d => d >= t.d);
    if (k <= 0) continue;
    const ourMove = ours.c[k] / ours.c[k - 1];
    let best = null;
    yahoo.forEach((y, i) => { const gap = Math.abs(days(t.d, y.d)); if (!used.has(i) && gap <= MATCH_DAYS && (!best || gap < best.gap)) best = { i, gap, f: y.f }; });
    let f = t.f;
    if (best) {
      used.add(best.i);
      const agree = Math.abs(t.f - best.f) <= Math.max(0.15 * Math.max(t.f, best.f), 0.0015);
      if (!agree && Math.abs((1 - ourMove) - best.f) < Math.abs((1 - ourMove) - t.f)) f = best.f;
    }
    if (implausible(f, ourMove)) continue;
    out.push([ours.d[k], f * ours.c[k - 1]]);
  }
  // Two dividends our candles put on one session are added up.
  const byDate = new Map(); for (const [d, a] of out) byDate.set(d, (byDate.get(d) ?? 0) + a);
  return [...byDate].map(([d, a]) => [d, round(a, 6)]);
}
export const PRE_JOIN_FIT = 0.5;      // the price falls on the ex-dates must explain at least half the dividends
export const PRE_JOIN_GAP = 0.05;     // with under three dividends, none may exceed its price fall by more

/**
 * What reinvesting TradingView's dividends after `from` up to and including `to` (the years before our
 * official candles) multiplied a holding by, and whether that record can be trusted (pure). With no
 * Yahoo record and no official closes to check them by, the dividends are checked against TradingView's
 * own price falls on their ex-dates, together: before 2010 its record often keeps amounts from before a
 * split or a bonus issue (Riyad Bank, Nomu companies), so a 9% "dividend" comes with a 2% fall. An
 * untrusted record counts nothing, and the figure says from when its dividends are counted.
 */
export function preJoinDividends(tv, from, to) {
  const ev = tv.filter(t => t.d > from && t.d <= to && !implausible(t.f, t.move));
  const fell = ev.reduce((a, t) => a + (1 - t.move), 0), paid = ev.reduce((a, t) => a + t.f, 0);
  const trusted = !ev.length || (ev.length >= 3 ? fell >= PRE_JOIN_FIT * paid : ev.every(t => t.f - (1 - t.move) <= PRE_JOIN_GAP));
  return { mul: trusted ? ev.reduce((m, t) => m / (1 - t.f), 1) : 1, trusted, count: ev.length };
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
    const tv = tvDividendEvents(history);
    const pre = preJoinDividends(tv, anchor.base.d, anchor.join.d);
    anchor.preDiv = round(pre.mul, 6);
    if (!pre.trusted) anchor.divFrom = anchor.join.d; // dividends before our candles left out
    symbols[stock.symbol] = anchor;
    if (!noDividends) {
      let yahoo = null;
      try { yahoo = yahooDividendEvents(await yahooJson(stock.symbol)); } catch { /* without Yahoo, every TradingView dividend is checked by the price alone */ }
      const div = chooseDividends(tv, yahoo ?? [], ours);
      const full = await readCandles(OHLC, stock.symbol); // re-read: the candles may have moved meanwhile
      if (full?.d?.at(-1) === ours.d.at(-1)) { await writeCandles(OHLC, { ...full, div, divSource: 'tradingview', divThrough: anchor.anchor.d }); dividendsWritten += 1; }
    }
    console.log(`[${done + 1}/${stocks.length}] ${stock.symbol} from ${anchor.base.d}${anchor.complete ? '' : ` (listed ${anchor.listed})`} · official from ${anchor.join.d} · anchor ${anchor.anchor.d} · ${anchor.check.mismatched}/${anchor.check.shared} sessions off · move ${anchor.check.window}%`);
  }
  // Three stocks at a time: one chart session each, as a few open TradingView charts would.
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length && !aborted) { await one(queue.shift()); done += 1; await sleep(300); }
  }));
  if (aborted) { console.error(`Stopped: ${inARow} stocks in a row failed (TradingView unreachable). Anchors not written.`); process.exit(1); }
  const sorted = Object.fromEntries(Object.entries(symbols).sort(([a], [b]) => a < b ? -1 : 1));
  await writeFile(OUT, JSON.stringify({
    note: 'Since-listing anchors from TradingView daily history (scripts/fetch-listing-history.mjs). base = first session on/after listing; join = first session shared with dist/ohlc; anchor = latest shared session; preDiv = dividends reinvested base→join (1 and divFrom = join when the TradingView record there fails the price check). c = close adjusted for capital actions, ca = also adjusted for cash dividends; only ratios between them are used.',
    fetchedAt: new Date().toISOString(), source: 'TradingView', symbols: sorted, failed, unchecked
  }, null, 1) + '\n');
  console.log(`Anchors for ${Object.keys(sorted).length}/${stocks.length} stocks; dividends checked and rewritten for ${dividendsWritten}; failed ${failed.length}${failed.length ? ': ' + failed.join(', ') : ''}; left out ${unchecked.length}${unchecked.length ? ': ' + unchecked.join(', ') : ''}`);
  if (!Object.keys(sorted).length) process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();

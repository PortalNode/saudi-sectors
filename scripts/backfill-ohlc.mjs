#!/usr/bin/env node
/**
 * Rebuild five years of daily candles per stock on TradingView's basis (dist/ohlc/<symbol>.json).
 *
 *  - Sessions and every close: the Saudi Exchange's own adjusted closes (company page chart,
 *    "adjusted for all corporate actions" — the same basis TradingView uses: bonus shares, splits,
 *    capital reductions and rights issues, not cash dividends).
 *  - Open/high/low/volume: Yahoo daily bars, rescaled to the exchange's basis. Sessions Yahoo never
 *    received come from Yahoo's 60-minute bars (about two years back) and are marked estimated;
 *    older ones get a candle from the previous close to the official close, also marked estimated.
 *  - Days a stock did not trade (suspensions) are left out, as on TradingView.
 *
 * saudiexchange.sa sits behind Akamai: run it where CURL_IMPERSONATE_BIN is set (GitHub Actions,
 * .github/workflows/backfill-ohlc.yml). With --official-dir it reads saved <symbol>.json responses.
 * Usage: node scripts/backfill-ohlc.mjs [--symbols 2222,1213] [--out <dir>] [--official-dir <dir>]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { parseYahoo, parseYahooSplits, hourlyDays, parseOfficialCloses, rebuildBars, candleFile, validOhlc, fileBars, round2Price, SOURCE } from './ohlc-merge.mjs';

const execFile = promisify(execFileCb);
const DIST = new URL('../dist/', import.meta.url);
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const dirUrl = path => new URL(`file://${path.startsWith('/') ? '' : process.cwd() + '/'}${path.replace(/\/?$/, '/')}`);
const DIR = arg('--out') ? dirUrl(arg('--out')) : new URL('ohlc/', DIST);
const OFFICIAL_DIR = arg('--official-dir') ? dirUrl(arg('--official-dir')) : null;
const only = arg('--symbols') ? new Set(arg('--symbols').split(',')) : null;
const IMPERSONATE = process.env.CURL_IMPERSONATE_BIN || null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const COMPANY_PAGE = symbol => `https://www.saudiexchange.sa/wps/portal/saudiexchange/hidden/company-profile-main/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziTR3NDIw8LAz83d2MXA0C3SydAl1c3Q0NvE30I4EKzBEKDMKcTQzMDPxN3H19LAzdTU31w8syU8v1wwkpK8hOMgUA-oskdg!!/?companySymbol=${symbol}`;
const JAR = `${process.env.RUNNER_TEMP || '/tmp'}/saudiexchange-cookies.txt`;
// How the chart endpoint is asked: as is, with the company page as referrer, or after opening the
// company page so its cookies come along (what a browser does). The probe picks the first that works.
const MODES = {
  plain: () => [],
  referer: symbol => ['--referer', COMPANY_PAGE(symbol)],
  cookies: symbol => ['--cookie', JAR, '--cookie-jar', JAR, '--referer', COMPANY_PAGE(symbol)]
};
let mode = 'plain';
export const officialUrl = symbol => `https://www.saudiexchange.sa/tadawul.eportal.charts.v2/ChartGenerator?chart-type=SQL_CI_CV_COM&chart-parameter=${symbol}&methodType=parsingMethod`;

async function getText(url, { headers = {}, impersonate = false, attempts = 3, maxTime = 30, extra = [] } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (impersonate && IMPERSONATE) {
        // No custom headers: Akamai matches the header set against the impersonated Chrome fingerprint.
        const { stdout } = await execFile(IMPERSONATE, [url, ...extra, '--silent', '--show-error', '--fail', '--max-time', String(maxTime), '--compressed'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (maxTime + 15) * 1000 });
        return stdout;
      }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), maxTime * 1000);
      try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } finally { clearTimeout(timer); }
    } catch (error) { last = error; if (attempt < attempts) await sleep(2000 * attempt); }
  }
  throw new Error(String(last?.stderr || last?.message || last).trim().split('\n').at(-1));
}
const yahooJson = async (symbol, query) => JSON.parse(await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SR?${query}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }));
async function officialCloses(symbol, { attempts = 2 } = {}) {
  const text = OFFICIAL_DIR ? await readFile(new URL(`${symbol}.json`, OFFICIAL_DIR), 'utf8')
    : await getText(officialUrl(symbol), { impersonate: true, attempts, maxTime: 25, extra: MODES[mode](symbol), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  return parseOfficialCloses(JSON.parse(text));
}
// Opening the company page stores the portal's cookies in JAR (as a browser would).
const openCompanyPage = symbol => IMPERSONATE ? getText(COMPANY_PAGE(symbol), { impersonate: true, attempts: 1, maxTime: 30, extra: ['--cookie-jar', JAR, '--location'] }) : Promise.resolve('');

const data = JSON.parse(await readFile(new URL('data.json', DIST), 'utf8'));
const officialDate = data.priceSource?.officialDate || null;
const stocks = data.sectors.flatMap(sector => sector.stocks).filter(stock => !only || only.has(stock.symbol));
const started = Date.now(), secs = () => ((Date.now() - started) / 1000).toFixed(1);

// Quick check before the long run: can the exchange and Yahoo be reached at all? (--probe stops here.)
{
  const symbol = stocks[0]?.symbol ?? '2222';
  let reached = false;
  for (const name of OFFICIAL_DIR ? ['plain'] : Object.keys(MODES)) {
    mode = name;
    try {
      if (name === 'cookies') { const page = await openCompanyPage(symbol); console.log(`[probe ${secs()}s] company page opened (${page.length} bytes)`); }
      const official = await officialCloses(symbol, { attempts: 1 });
      console.log(`[probe ${secs()}s] Saudi Exchange ${symbol} (${name}): ${official.length} adjusted closes, ${official[0].d} → ${official.at(-1).d} (last ${official.at(-1).c})`);
      reached = true; break;
    } catch (error) { console.warn(`[probe ${secs()}s] Saudi Exchange ${symbol} (${name}): ${error.message}`); }
  }
  if (!reached) { console.error(`[probe ${secs()}s] Saudi Exchange unreachable for ${symbol} in every way tried. Nothing was changed.`); process.exit(1); }
  try {
    const daily = parseYahoo(await yahooJson(symbol, 'range=6y&interval=1d'));
    console.log(`[probe ${secs()}s] Yahoo ${symbol}: ${daily.length} daily bars`);
  } catch (error) {
    console.error(`[probe ${secs()}s] Yahoo unreachable for ${symbol}: ${error.message}. Nothing was changed.`);
    process.exit(1);
  }
  if (process.argv.includes('--probe')) process.exit(0);
}
await mkdir(DIR, { recursive: true });

const report = { rebuilt: 0, failed: [], estimated: 0, flags: [] };
const queue = [...stocks];
let done = 0, failedInARow = 0, aborted = null;
async function worker() {
  while (queue.length && !aborted) {
    const stock = queue.shift(), t0 = Date.now();
    try {
      let official = await officialCloses(stock.symbol);
      const last = stock.lastOfficialClose;
      // The latest official close in data.json is final; nothing after it is kept.
      if (last?.date) {
        official = official.filter(x => x.d <= last.date);
        if (official.at(-1)?.d === last.date) official.at(-1).c = round2Price(last.price);
      }
      // Explicit dates: Yahoo has answered `range=6y` with a shorter history from some networks.
      const now = Math.floor(Date.now() / 1000), dailyJson = await yahooJson(stock.symbol, `period1=${now - 6 * 366 * 86400}&period2=${now}&interval=1d&events=split`);
      const daily = new Map(parseYahoo(dailyJson).map(b => [b.d, b])), splits = parseYahooSplits(dailyJson);
      let hourly = new Map();
      try { hourly = hourlyDays(await yahooJson(stock.symbol, 'range=730d&interval=60m')); } catch { /* estimated candles then use the closes only */ }
      const rebuilt = rebuildBars({ official, daily, hourly, splits });
      // Sessions the daily update stored from TradingView stay as they are while their close still
      // matches (a later capital action changes every earlier close, and then the rebuild wins).
      let before = null; try { before = JSON.parse(await readFile(new URL(`${stock.symbol}.json`, DIR), 'utf8')); } catch { /* new */ }
      const kept = new Map(before?.source === SOURCE && validOhlc(before) ? fileBars(before).filter(b => !(before.est || []).includes(b.d)).map(b => [b.d, b]) : []);
      const est = new Set(rebuilt.est);
      const bars = rebuilt.bars.map(b => { const k = kept.get(b.d); if (k && Math.abs(k.c - b.c) < 0.005) { est.delete(b.d); return k; } return b; });
      const file = candleFile(stock.symbol, SOURCE, official.at(-1)?.d ?? null, bars, [...est]);
      if (!validOhlc(file)) throw new Error('too few valid bars');
      await writeFile(new URL(`${stock.symbol}.json`, DIR), JSON.stringify(file) + '\n');
      report.rebuilt += 1; report.estimated += file.est.length; failedInARow = 0;
      if (file.flags.length) report.flags.push(`${stock.symbol}: ${file.flags.map(f => `${f.date} ${f.change}%`).join(', ')}`);
      console.log(`[${++done}/${stocks.length} ${secs()}s] ${stock.symbol} ok: ${bars.length} candles from ${bars[0]?.d}, ${file.est.length} estimated (exchange from ${official[0]?.d}, Yahoo ${daily.size} days from ${[...daily.keys()].sort()[0]}), ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (error) {
      report.failed.push(`${stock.symbol} (${error.message})`);
      console.warn(`[${++done}/${stocks.length} ${secs()}s] ${stock.symbol} failed: ${error.message}`);
      // A source that stopped answering fails every stock: stop instead of waiting out the rest.
      if (++failedInARow >= 6) aborted = `${failedInARow} stocks in a row failed (last: ${error.message})`;
    }
    await sleep(250);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));

if (aborted) {
  console.error(`Stopped after ${secs()}s: ${aborted}. Files rebuilt so far are kept; index.json is unchanged.`);
  process.exit(1);
}
if (!only) {
  const indexUrl = new URL('index.json', DIR);
  let index = {}; try { index = JSON.parse(await readFile(indexUrl, 'utf8')); } catch { /* new */ }
  await writeFile(indexUrl, JSON.stringify({ ...index, officialDate, rebuiltAt: new Date().toISOString(), source: SOURCE, symbols: report.rebuilt, failed: report.failed, estimatedSessions: report.estimated, unexplainedJumps: report.flags }, null, 1) + '\n');
}
console.log(`Rebuilt ${report.rebuilt}/${stocks.length} stocks in ${secs()}s; ${report.estimated} estimated sessions.`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Candle rebuild\n\n- Rebuilt: **${report.rebuilt}/${stocks.length}** stocks in ${secs()}s\n- Estimated sessions: ${report.estimated}\n- Failed: ${report.failed.length ? report.failed.join(', ') : 'none'}\n- Moves beyond the daily limit left unexplained: ${report.flags.length}\n\n`);
}
if (report.flags.length) console.warn(`Moves beyond the daily limit that no capital action explains:\n  ${report.flags.join('\n  ')}`);
if (report.failed.length) console.warn(`Not rebuilt (existing file kept): ${report.failed.join(', ')}`);
if (stocks.length && !report.rebuilt) process.exit(1);

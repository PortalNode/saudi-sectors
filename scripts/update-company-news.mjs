#!/usr/bin/env node
/**
 * Fetch issuer announcements from Saudi Exchange and publish a static snapshot.
 * Requires curl-impersonate because saudiexchange.sa is protected by Akamai.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const OUTPUT = path.join(DIST, 'company-news.json');
const COOKIE_DIR = process.env.RUNNER_TEMP || '/tmp';
const BIN = process.env.CURL_IMPERSONATE_BIN || 'curl_chrome116';
const LANDING = 'https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements?locale=ar';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/116.0.0.0 Safari/537.36';
const PAGE_SIZE = 10;
const RECENT_MONTHS = Number(process.env.NEWS_MONTHS || 3);
const MAX_PAGES = Number(process.env.MAX_NEWS_PAGES || 12);
const REQUEST_TIMEOUT = Number(process.env.NEWS_REQUEST_TIMEOUT || 45);
const BATCH_SIZE = Number(process.env.NEWS_BATCH_SIZE || 0);
const BATCH_INDEX = Number(process.env.NEWS_BATCH_INDEX || 0);
const requestedSymbols = new Set((process.env.SYMBOLS || '').split(',').map(s => s.trim()).filter(Boolean));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function formatTadawulDate(date) {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

function recentDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - RECENT_MONTHS);
  return { from, to, fromText: formatTadawulDate(from), toText: formatTadawulDate(to) };
}

function parseNewsDate(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : NaN;
}

async function runCurl(args, { json = false } = {}) {
  const result = await execFileAsync(BIN, args, { maxBuffer: 20 * 1024 * 1024, timeout: REQUEST_TIMEOUT * 1000 });
  const text = result.stdout;
  return json ? JSON.parse(text) : text;
}

function announcementUrl(item) {
  const raw = String(item.announcementUrl || '');
  if (!raw) return `https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements?locale=ar`;
  const url = new URL(raw, 'https://www.saudiexchange.sa');
  url.searchParams.set('locale', 'ar');
  return url.href;
}

function normalise(item) {
  const date = String(item.newsDateStr || item.PR_DATE || '').trim();
  return {
    id: String(item.PRESS_REL_ID || item.announcementNumber || ''),
    symbol: String(item.SYMBOL || item.indexSymbol || ''),
    title: esc(item.TITLE),
    description: esc(item.SHORT_DESC),
    date,
    hijriDate: esc(item.HijriDate),
    url: announcementUrl(item),
    source: 'Saudi Exchange / تداول السعودية'
  };
}

async function createSession() {
  const cookie = path.join(COOKIE_DIR, `tadawul-news-${process.pid}-${Date.now()}.cookies`);
  const html = await runCurl(['-sS', '-L', '--compressed', '--max-time', String(REQUEST_TIMEOUT), '-c', cookie, '-b', cookie, '-A', USER_AGENT, '-o', '-', LANDING]);
  const match = html.match(/<base[^>]+href=["']([^"']+)["']/i);
  if (!match) throw new Error('Could not find Saudi Exchange base URL');
  const endpoint = new URL('p0/IZ7_5A602H80O0HTC060SG6UT81DI1=CZ6_5A602H80O0HTC060SG6UT81D26=NJgetAnnouncementListData=/', match[1]).href;
  return { cookie, endpoint };
}

async function fetchPage(session, symbol, page) {
  const range = recentDateRange();
  const fields = new URLSearchParams({
    locale: 'ar', annoucmentType: '1_-1', symbol, sectorDpId: '-1', searchType: '1',
    fromDate: range.fromText, toDate: range.toText, datePeriod: '', productType: 'MAIN_MARKET', advisorsList: '-1',
    textSearch: '', pageNumberDb: String(page), pageSize: String(PAGE_SIZE)
  });
  const bodyFile = path.join(COOKIE_DIR, `tadawul-news-body-${process.pid}.txt`);
  const text = await runCurl([
    '-sS', '-L', '--compressed', '--max-time', String(REQUEST_TIMEOUT), '-c', session.cookie, '-b', session.cookie,
    '-A', USER_AGENT, '-e', LANDING, '-X', 'POST', session.endpoint,
    '-H', 'X-Requested-With: XMLHttpRequest', '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
    '--data', fields.toString(), '-o', bodyFile
  ]);
  // curl writes the response to bodyFile; stdout is intentionally empty.
  const response = await fs.readFile(bodyFile, 'utf8');
  await fs.rm(bodyFile, { force: true });
  return JSON.parse(response);
}

async function readPrevious() {
  try { return JSON.parse(await fs.readFile(OUTPUT, 'utf8')); } catch { return { companies: {} }; }
}

async function readCompanies() {
  const data = JSON.parse(await fs.readFile(path.join(DIST, 'data.json'), 'utf8'));
  const map = new Map();
  for (const sector of data.sectors || []) {
    for (const stock of sector.stocks || []) {
      const symbol = String(stock.symbol || '').trim();
      if (symbol && (!requestedSymbols.size || requestedSymbols.has(symbol))) map.set(symbol, { symbol, name: stock.name || symbol });
    }
  }
  const companies = [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (!requestedSymbols.size && BATCH_SIZE > 0) {
    const start = (BATCH_INDEX % Math.ceil(companies.length / BATCH_SIZE)) * BATCH_SIZE;
    return companies.slice(start, start + BATCH_SIZE);
  }
  return companies;
}

async function fetchCompany(session, company) {
  const range = recentDateRange();
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime() + 86400000 - 1;
  const all = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await fetchPage(session, company.symbol, page);
    const list = Array.isArray(payload.announcementList) ? payload.announcementList : [];
    total = Number(payload.totalCount || list[0]?.totalCount || total || 0);
    all.push(...list.map(normalise).filter(item => item.id && (() => {
      const time = parseNewsDate(item.date);
      return Number.isNaN(time) || (time >= fromMs && time <= toMs);
    })()));
    if (!list.length || all.length >= total || list.length < PAGE_SIZE) break;
    await sleep(150);
  }
  const unique = [...new Map(all.map(item => [item.id, item])).values()];
  return { symbol: company.symbol, name: company.name, totalCount: total || unique.length, announcements: unique };
}

async function main() {
  const companies = await readCompanies();
  if (!companies.length) throw new Error('No company symbols found');
  const previous = await readPrevious();
  const range = recentDateRange();
  const retained = {};
  for (const [symbol, company] of Object.entries(previous.companies || {})) {
    const announcements = (company.announcements || []).filter(item => {
      const time = parseNewsDate(item.date);
      return Number.isNaN(time) || (time >= range.from.getTime() && time <= range.to.getTime() + 86400000 - 1);
    });
    retained[symbol] = { ...company, totalCount: announcements.length, announcements };
  }
  const snapshot = {
    updatedAt: new Date().toISOString(),
    period: { months: RECENT_MONTHS, from: range.fromText, to: range.toText },
    source: LANDING,
    companies: retained
  };
  const session = await createSession();
  let succeeded = 0;
  for (const company of companies) {
    try {
      const result = await fetchCompany(session, company);
      snapshot.companies[company.symbol] = result;
      succeeded++;
      console.log(`${company.symbol}: ${result.announcements.length}/${result.totalCount}`);
    } catch (error) {
      console.warn(`${company.symbol}: kept previous snapshot (${error.message})`);
    }
  }
  if (!succeeded && Object.keys(previous.companies || {}).length === 0) throw new Error('No company news could be fetched');
  if (!succeeded) snapshot.companies = previous.companies || {};
  await fs.writeFile(OUTPUT, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Saved ${Object.keys(snapshot.companies).length} company snapshots to ${OUTPUT}`);
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

// Fetch company logos from TradingView into dist/logos/<symbol>.svg.
// The symbol list comes from dist/data.json; dist/logos/manifest.json lists the
// symbols that have a logo, so pages show a letter for the rest instead of requesting a missing file.
//
//   node scripts/fetch-logos.mjs           # fetch only symbols without a logo file
//   node scripts/fetch-logos.mjs --all     # refetch every logo
//   node scripts/fetch-logos.mjs 1120 2222 # fetch these symbols only
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const DIST = new URL('../dist/', import.meta.url);
const OUT = new URL('logos/', DIST);
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' };

// A logo is used only if it is a plain SVG: no scripts, event handlers or outside links.
export function isSafeSvg(text) {
  return /^\s*(<!--[^]*?-->\s*)?(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)
    && /<\/svg>\s*$/i.test(text)
    && !/<script|<foreignObject|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|data:)|<!ENTITY|@import/i.test(text);
}

async function logoId(symbol) {
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${symbol}&exchange=TADAWUL&hl=0&lang=en&domain=production`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const { symbols = [] } = await res.json();
  const hit = symbols.find(s => s.symbol === symbol && s.exchange === 'TADAWUL');
  return hit?.logoid || hit?.logo?.logoid || null;
}

async function fetchSvg(id) {
  const res = await fetch(`https://s3-symbol-logo.tradingview.com/${id}--big.svg`, { headers: HEADERS });
  if (!res.ok) throw new Error(`logo ${res.status}`);
  return res.text();
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const only = args.filter(a => /^\d{4}$/.test(a));
  const site = JSON.parse(readFileSync(new URL('data.json', DIST), 'utf8'));
  const symbols = only.length ? only : [...new Set(site.sectors.flatMap(s => s.stocks.map(x => String(x.symbol))))].sort();
  mkdirSync(OUT, { recursive: true });

  const missing = [];
  for (const symbol of symbols) {
    const file = new URL(`${symbol}.svg`, OUT);
    if (!all && !only.length && existsSync(file)) continue;
    try {
      const id = await logoId(symbol);
      if (!id) { missing.push(`${symbol} (لا يوجد شعار)`); continue; }
      const svg = await fetchSvg(id);
      if (!isSafeSvg(svg)) { missing.push(`${symbol} (ملف غير آمن)`); continue; }
      writeFileSync(file, svg.trim() + '\n');
      console.log(`${symbol} ← ${id}`);
    } catch (error) {
      missing.push(`${symbol} (${error.message})`);
    }
    await sleep(150);
  }

  const have = readdirSync(OUT).filter(f => /^\d{4}\.svg$/.test(f)).map(f => f.slice(0, 4)).sort();
  writeFileSync(new URL('manifest.json', OUT), JSON.stringify({ source: 'TradingView', symbols: have }, null, 2) + '\n');
  console.log(`\n${have.length} شعارًا في dist/logos`);
  if (missing.length) console.log(`بدون شعار: ${missing.join('، ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const prices = JSON.parse(read('data.json'));
const symbols = new Set(prices.sectors.flatMap(sector => sector.stocks.map(stock => stock.symbol)));
const files = readdirSync(new URL('earnings-calendar/', dist)).filter(name => /^\d{4}\.json$/.test(name));
const iso = /^\d{4}-\d{2}-\d{2}$/;

test('every earnings-calendar file is valid and belongs to a listed company', () => {
  assert.ok(files.length >= 200, 'expected dates for most companies');
  for (const name of files) {
    const c = JSON.parse(read(`earnings-calendar/${name}`));
    const symbol = name.replace('.json', '');
    assert.equal(c.s, symbol);
    assert.ok(symbols.has(symbol), `${symbol} is not in data.json`);
    assert.ok([3, 6, 7, 8, 9, 12].includes(c.fye), `${symbol} fiscal year end`);
    assert.ok(c.recs.length > 0, `${symbol} has no dates`);
    assert.ok(c.rank >= 1 && c.rank <= c.peers, `${symbol} rank`);
    let previous = null;
    for (const r of c.recs) {
      assert.match(r.d, iso); assert.match(r.pe, iso);
      assert.ok([1, 2, 3, 4].includes(r.q), `${symbol} quarter`);
      assert.ok(r.lag >= 0 && r.lag <= 150 && r.d > r.pe, `${symbol} ${r.fy}Q${r.q} lag ${r.lag}`);
      assert.ok(['tadawul', 'verified', 'history'].includes(r.src));
      assert.ok(['', 'fast', 'slow'].includes(r.sp));
      if (r.url) assert.match(r.url, /^https:\/\//);
      const key = r.fy * 10 + r.q;
      if (previous != null) assert.ok(key > previous, `${symbol} periods are not in order`);
      previous = key;
    }
    const n = c.next, last = c.recs.at(-1);
    for (const k of ['pe', 'd', 'lo', 'hi']) assert.match(n[k], iso, `${symbol} next.${k}`);
    assert.ok(n.lo <= n.d && n.d <= n.hi, `${symbol} expected date outside its range`);
    assert.ok(n.pe > last.pe && n.d > n.pe, `${symbol} next period must follow the last one`);
    assert.ok(![5, 6].includes(new Date(n.d + 'T00:00:00Z').getUTCDay()), `${symbol} expected on a weekend`);
    assert.ok(['عالية', 'متوسطة', 'أولية'].includes(n.conf));
  }
});

test('index.json lists every company file in date order', () => {
  const index = JSON.parse(read('earnings-calendar/index.json'));
  assert.equal(index.companies.length, files.length);
  const dates = index.companies.map(c => c.d);
  assert.deepEqual([...dates].sort(), dates);
});

test('every company results page loads the earnings-date card', () => {
  const pages = readdirSync(dist).filter(name => name.endsWith('.html') && !name.startsWith('preview') && read(name).includes('bank-heading'));
  assert.ok(pages.length >= 30);
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /company-earnings-date\.css\?v=/, `${page} misses the stylesheet`);
    assert.match(html, /<script src="company-earnings-date\.js\?v=[^"]*" defer><\/script>/, `${page} misses the script`);
  }
});

test('the card follows the announcements, before the latest results and the period bar, and loads each company file without caching', () => {
  const script = read('company-earnings-date.js');
  assert.match(script, /earnings-calendar\/\$\{encodeURIComponent\(symbol\)\}\.json/);
  assert.match(script, /cache: 'no-cache'/);
  // إعلانات الشركة ← موعد النتائج القادمة ← آخر النتائج المالية ← شريط الفترة ← الجدول
  assert.match(script, /\['company-announcements', 'company-quote', 'company-profile'\]/);
  assert.match(script, /order\(panel, box\)/, 'a new card is placed even before it has an id in the page');
  assert.match(script, /\[card, panel\.querySelector\(':scope > \.key-figures-title'\), panel\.querySelector\(':scope > \.key-figures'\), panel\.querySelector\(':scope > \.period-bar'\)\]/);
});

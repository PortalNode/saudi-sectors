import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const prices = JSON.parse(read('data.json'));
const symbols = new Set(prices.sectors.flatMap(sector => sector.stocks.map(stock => stock.symbol)));
const files = readdirSync(new URL('announcements/', dist)).filter(name => /^\d{4}\.json$/.test(name));
const isoDate = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

test('every announcements file is valid, belongs to a listed symbol and is newest first', () => {
  assert.ok(files.length >= 200, 'expected announcements for most companies');
  for (const name of files) {
    const file = JSON.parse(read(`announcements/${name}`));
    const symbol = name.replace('.json', '');
    assert.equal(file.symbol, symbol);
    assert.ok(symbols.has(symbol), `${symbol} is not in data.json`);
    assert.ok(file.items.length > 0, `${symbol} has an empty file`);
    assert.match(file.updated, /^\d{4}-\d{2}-\d{2}$/);
    const ids = new Set();
    let previous = null;
    for (const item of file.items) {
      assert.match(item.id, /^\d+$/, `${symbol} announcement id`);
      assert.ok(!ids.has(item.id), `${symbol} repeats announcement ${item.id}`);
      ids.add(item.id);
      assert.match(item.t, isoDate, `${symbol}/${item.id} date`);
      assert.ok(item.title.trim().length > 3, `${symbol}/${item.id} has no title`);
      assert.match(item.url, /^https:\/\/www\.saudiexchange\.sa\//, `${symbol}/${item.id} url`);
      assert.ok(item.url.includes(`anId=${item.id}`), `${symbol}/${item.id} url does not match its id`);
      if (previous) assert.ok(item.t.slice(0, 10) <= previous, `${symbol} is not newest first at ${item.id}`);
      previous = item.t.slice(0, 10);
    }
    assert.equal(file.updated, file.items[0].t.slice(0, 10), `${symbol} updated date`);
  }
});

test('latest.json lists the newest market announcements without their bodies', () => {
  const latest = JSON.parse(read('announcements/latest.json')).items;
  assert.ok(latest.length > 0 && latest.length <= 100);
  for (const item of latest) {
    assert.ok(symbols.has(item.symbol), `${item.symbol} is not in data.json`);
    assert.equal(item.body, undefined);
  }
  const dates = latest.map(item => item.t.slice(0, 10));
  assert.deepEqual([...dates].sort().reverse(), dates);
});

test('every company results page loads the announcements section', () => {
  const pages = readdirSync(dist).filter(name => name.endsWith('.html') && read(name).includes('bank-heading'));
  assert.ok(pages.length >= 30);
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /company-announcements\.css\?v=/, `${page} misses the stylesheet`);
    assert.match(html, /<script src="company-announcements\.js\?v=[^"]*" defer><\/script>/, `${page} misses the script`);
  }
});

test('the section is placed under the stock card and loads each company file without caching', () => {
  const script = read('company-announcements.js');
  assert.match(script, /getElementById\('company-quote'\)/);
  assert.match(script, /announcements\/\$\{encodeURIComponent\(symbol\)\}\.json/);
  assert.match(script, /cache: 'no-cache'/);
});

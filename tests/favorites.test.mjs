import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');

// Runs app.js against a minimal DOM: elements keep their innerHTML as text,
// and clicks are delivered straight to the document's click listener.
async function boot(stored) {
  const store = new Map(stored ? [['saudi-sectors-favorites', JSON.stringify(stored)]] : []);
  const elements = new Map();
  const element = () => {
    const children = new Map();
    return { innerHTML: '', textContent: '', hidden: false, value: '', dataset: {}, classList: { toggle() {} },
      setAttribute() {}, addEventListener() {}, focus() {},
      querySelector: selector => children.get(selector) || children.set(selector, element()).get(selector) };
  };
  let onClick;
  const document = {
    getElementById: id => elements.get(id) || elements.set(id, element()).get(id),
    addEventListener: (type, listener) => { if (type === 'click') onClick = listener; },
    querySelector: () => null, querySelectorAll: () => [], hidden: false
  };
  const site = read('data.json');
  const context = {
    document, console, Intl, Date, Math, JSON, Map, Set, Number, String, Array, Object, Promise, Error, URLSearchParams,
    setTimeout, clearTimeout, setInterval: () => 0, AbortController,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) },
    addEventListener() {},
    fetch: async url => String(url).startsWith('data.json') ? { ok: true, json: async () => JSON.parse(site) } : Promise.reject(new Error('offline'))
  };
  context.window = context;
  vm.runInNewContext(read('app.js'), context);
  await new Promise(resolve => setTimeout(resolve, 50));
  const click = (selector, dataset = {}) => onClick({ preventDefault() {}, target: { closest: wanted => wanted === selector ? { dataset } : null } });
  const rows = () => [...elements.get('sectors').innerHTML.matchAll(/<span class="symbol-badge">([^<]+)</g)].map(match => match[1]);
  return { store, click, rows, $: id => document.getElementById(id) };
}

test('a star beside every symbol adds the company to «المفضلة», saved in this browser', async () => {
  const page = await boot();
  assert.match(page.$('sector-nav').innerHTML, /data-favorites[^>]*>.*المفضلة<\/span><span class="count">0</);
  assert.match(page.$('sectors').innerHTML, /<button type="button" class="fav-toggle" data-fav="2222" aria-pressed="false"[^>]*>☆</);
  page.click('[data-fav]', { fav: '2222' });
  page.click('[data-fav]', { fav: '1120' });
  assert.deepEqual(JSON.parse(page.store.get('saudi-sectors-favorites')), ['2222', '1120']);
  assert.match(page.$('sector-nav').innerHTML, /المفضلة<\/span><span class="count">2</);
  page.click('[data-favorites]');
  assert.equal(page.$('view-title').textContent, 'المفضلة');
  assert.deepEqual(page.rows().sort(), ['1120', '2222']);
  assert.match(page.$('result-count').textContent, /^2 أسهم في المفضلة/);
  assert.equal(page.$('empty').hidden, true);
});

test('the favourites table sorts by its own columns and drops a star that is turned off', async () => {
  const page = await boot(['1120', '2222', '1010']);
  page.click('[data-favorites]');
  assert.equal(page.rows().length, 3);
  page.click('[data-sort]', { sort: 'symbol', index: 'fav' });
  assert.deepEqual(page.rows(), ['1010', '1120', '2222']);
  page.click('[data-fav]', { fav: '1120' });
  assert.deepEqual(page.rows(), ['1010', '2222']);
  page.click('[data-sector]', { sector: 'all' });
  assert.equal(page.$('view-title').textContent, 'جميع القطاعات');
  assert.ok(page.rows().length > 200);
});

test('an empty favourites list explains how to add a stock', async () => {
  const page = await boot();
  page.click('[data-favorites]');
  assert.equal(page.rows().length, 0);
  assert.equal(page.$('empty').hidden, false);
  assert.equal(page.$('empty').querySelector('h3').textContent, 'لم تضف أي سهم إلى المفضلة بعد');
  page.click('[data-sector]', { sector: 'all' });
  assert.equal(page.$('empty').querySelector('h3').textContent, 'لا توجد نتائج مطابقة');
});

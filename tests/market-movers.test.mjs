import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');

// الوحدة كما تُحمَّل في الصفحة (بلا document، فتُعرَّف الدوال النقية فقط).
const context = { window: {}, Intl, Math, JSON, Number, String, Set, Map, console };
vm.runInNewContext(read('market-movers.js'), context);
const M = context.window.MarketMovers;

const stock = (symbol, name, extra = {}) => ({ symbol, name, price: 10, day: 0, volume: null, tradedValue: null, suspended: false, ...extra });
const sectors = [
  { name: 'البنوك', stocks: [
    stock('1120', 'الراجحي', { price: 100, day: 2.5, volume: 1_000_000, tradedValue: 100_000_000 }),
    stock('1010', 'الرياض', { price: 30, day: -1.2, volume: 5_000_000, tradedValue: 150_000_000 }),
    stock('1180', 'الأهلي', { price: 40, day: 0, volume: 2_000_000, tradedValue: null }),
  ] },
  { name: 'التأمين', stocks: [
    stock('8010', 'التعاونية', { price: 120, day: 9.9, volume: 100, tradedValue: 12_000 }),
    stock('8020', 'ملاذ', { price: 20, day: -9.9, volume: 3_000_000, tradedValue: 60_000_000 }),
    stock('8030', 'موقوف', { price: 15, day: 10, volume: 9e9, tradedValue: 9e12, suspended: true }),
    stock('8040', 'بلا سعر', { price: null, day: 7, volume: 9e9, tradedValue: 9e12 }),
  ] },
];

test('الأكثر ارتفاعًا والأكثر انخفاضًا حسب نسبة التغير اليومي، بلا الصفر ولا الموقوف ولا بلا سعر', () => {
  const { gainers, losers } = M.buildLists(sectors);
  assert.deepEqual(gainers.map(r => r.symbol), ['8010', '1120']);
  assert.deepEqual(gainers.map(r => r.metric), [9.9, 2.5]);
  assert.deepEqual(losers.map(r => r.symbol), ['8020', '1010']);
  assert.deepEqual(losers.map(r => r.metric), [-9.9, -1.2], 'تُعرض النسبة الفعلية بإشارتها');
});

test('الحجم والقيمة مرتبتان تنازليًا، وقيمة التداول تُقدَّر من الحجم × السعر عند غيابها', () => {
  const { volume, value } = M.buildLists(sectors);
  assert.deepEqual(volume.map(r => r.symbol), ['1010', '8020', '1180', '1120', '8010']);
  assert.deepEqual(value.map(r => [r.symbol, r.metric, r.estimated]),
    [['1010', 150_000_000, false], ['1180', 80_000_000, true], ['1120', 100_000_000, false], ['8020', 60_000_000, false], ['8010', 12_000, false]]
      .sort((a, b) => b[1] - a[1]));
});

test('كل قائمة تتوقف عند عشر شركات، والتعادل يُحسم بالرمز', () => {
  const many = [{ name: 'س', stocks: Array.from({ length: 25 }, (_, i) => stock(String(1000 + i), `ش${i}`, { day: 1, volume: 5, tradedValue: 5 })) }];
  const lists = M.buildLists(many);
  for (const key of ['gainers', 'volume', 'value']) assert.equal(lists[key].length, 10);
  assert.deepEqual(lists.gainers.map(r => r.symbol), Array.from({ length: 10 }, (_, i) => String(1000 + i)));
  assert.equal(lists.losers.length, 0);
});

test('بلا بيانات تداول تبقى قائمتا الحجم والقيمة فارغتين دون خطأ', () => {
  const lists = M.buildLists([{ name: 'س', stocks: [stock('1111', 'أ', { day: 1 })] }]);
  assert.equal(lists.volume.length, 0);
  assert.equal(lists.value.length, 0);
  assert.equal(lists.gainers.length, 1);
  assert.match(M.html(lists, 'volume'), /بيانات التداول غير متاحة/);
  assert.doesNotThrow(() => M.buildLists(undefined));
});

test('الأرقام الكبيرة تُختصر إلى مليون ومليار بتنسيق الموقع', () => {
  assert.equal(M.compact(132_410_000), '132.41 مليون');
  assert.equal(M.compact(1_576_395_521.81), '1.58 مليار');
  assert.equal(M.compact(1_000_000), '1.00 مليون');
  assert.equal(M.compact(845_000), '845,000');
  assert.equal(M.compact(null), '—');
  assert.equal(M.compact(NaN), '—');
});

test('النقر على الصف يفتح صفحة نتائج قطاع الشركة كما يفعل الجدول', () => {
  const { gainers } = M.buildLists(sectors);
  assert.equal(gainers[0].href, 'insurance.html?symbol=8010');
  assert.equal(gainers[1].href, 'banks.html?symbol=1120');
  const html = M.html(M.buildLists(sectors));
  assert.match(html, /<a class="mover-row" href="banks\.html\?symbol=1120"/);
  assert.equal(M.resultsHref('قطاع مجهول', '1'), null);
});

test('صفحات القطاعات مطابقة لما يستخدمه الجدول في app.js ولكل ملف صفحة موجودة', () => {
  const app = read('app.js');
  const pages = [...app.matchAll(/href="([\w-]+)\.html\?symbol=\$\{encodeURIComponent\(stock\.symbol\)\}"/g)].map(m => m[1]);
  const mine = new Set(Object.values(JSON.parse(JSON.stringify(
    Object.fromEntries(JSON.parse(read('data.json')).sectors.map(s => [s.name, M.resultsHref(s.name, '1')?.split('.html')[0]]))))));
  mine.delete(undefined);
  assert.deepEqual([...mine].sort(), [...new Set(pages)].sort());
  for (const page of mine) assert.doesNotThrow(() => readFileSync(new URL(`${page}.html`, dist)), page);
});

test('عناوين القوائم الأربع مختصرة، واللون يتبع اتجاه تغير السهم', () => {
  const html = M.html(M.buildLists(sectors));
  for (const label of ['الأكثر ارتفاعًا', 'الأكثر انخفاضًا', 'الحجم', 'القيمة']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /mover-value num up" dir="ltr">\+9\.90%/);
  assert.match(html, /mover-value num down" dir="ltr">-9\.90%/);
  assert.match(html, /mover-value num down" dir="rtl">3\.00 مليون/);
});

test('تُحمَّل الوحدة قبل app.js ويستدعيها app.js بعد تحديث الأسعار، والصفحة تحوي حاضنتها', () => {
  const index = read('index.html');
  assert.ok(index.indexOf('market-movers.js') < index.indexOf('src="app.js'));
  assert.match(index, /id="market-movers-body"/);
  assert.match(read('app.js'), /globalThis\.MarketMovers\?\.paint\(data\)/);
  assert.match(read('app.js'), /'change_abs','volume'\]/, 'الجلب المباشر يطلب الحجم');
});

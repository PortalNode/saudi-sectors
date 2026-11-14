import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const dist = new URL('../dist/', import.meta.url);
const read = name => readFileSync(new URL(name, dist), 'utf8');
const profiles = JSON.parse(read('company-profiles.json'));
const prices = JSON.parse(read('data.json'));
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

test('every company profile is valid and belongs to a listed symbol', () => {
  const symbols = new Set(prices.sectors.flatMap(sector => sector.stocks.map(stock => stock.symbol)));
  const entries = Object.entries(profiles);
  assert.ok(entries.length >= 200, 'expected the full set of sector profiles');
  for (const [symbol, profile] of entries) {
    assert.ok(symbols.has(symbol), `${symbol} is not in data.json`);
    assert.ok(profile.activity.trim().length > 5, `${symbol} has no activity text`);
    assert.match(profile.founded, isoDate, `${symbol} founding date`);
    assert.ok(!Number.isNaN(new Date(`${profile.founded}T12:00:00`).getTime()), `${symbol} founding date is not a real date`);
    if (profile.listed != null) {
      assert.match(profile.listed, isoDate, `${symbol} listing date`);
      assert.ok(profile.listed >= profile.founded, `${symbol} listed before it was founded`);
    }
    if (profile.listedSource != null) assert.ok(profile.listed, `${symbol} has a listing source without a date`);
    if (profile.listedPrecision != null) assert.equal(profile.listedPrecision, 'month', `${symbol} listing precision`);
  }
});

test('every company results page loads the profile card', () => {
  const pages = readdirSync(dist).filter(name => name.endsWith('.html') && read(name).includes('bank-heading'));
  assert.ok(pages.length >= 27);
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="company-profile\.css\?v=[^"]+">/, `${page} stylesheet`);
    assert.match(html, /<script src="company-profile\.js\?v=[^"]+" defer><\/script>/, `${page} script`);
  }
});

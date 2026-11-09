import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const iconFiles = [
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'site.webmanifest',
];

test('favicon assets exist and every HTML page declares browser, Apple, and manifest icons', async () => {
  for (const name of iconFiles) assert.ok((await stat(join(dist, name))).size > 0, `${name} is empty`);
  const pages = (await readdir(dist)).filter(name => name.endsWith('.html'));
  assert.ok(pages.length > 0, 'expected static HTML pages');
  for (const page of pages) {
    const html = await readFile(join(dist, page), 'utf8');
    assert.match(html, /rel="icon"[^>]*favicon\.ico\?v=20261109-favicon1/, `${page}: ico link`);
    assert.match(html, /rel="icon"[^>]*favicon-32x32\.png\?v=20261109-favicon1/, `${page}: 32px link`);
    assert.match(html, /rel="icon"[^>]*favicon-16x16\.png\?v=20261109-favicon1/, `${page}: 16px link`);
    assert.match(html, /rel="apple-touch-icon"[^>]*apple-touch-icon\.png\?v=20261109-favicon1/, `${page}: Apple link`);
    assert.match(html, /rel="manifest"[^>]*site\.webmanifest\?v=20261109-favicon1/, `${page}: manifest link`);
    assert.ok(html.indexOf('favicon.ico') < html.indexOf('</head>'), `${page}: icon tags are in head`);
  }
  const ico = await readFile(join(dist, 'favicon.ico'));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'ICO signature');
  for (const name of iconFiles.filter(name => name.endsWith('.png'))) {
    const png = await readFile(join(dist, name));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name}: PNG signature`);
  }
  const manifest = JSON.parse(await readFile(join(dist, 'site.webmanifest'), 'utf8'));
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
});

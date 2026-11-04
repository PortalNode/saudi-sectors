import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/theme.js', import.meta.url), 'utf8');
const storageKey = 'saudi-sectors-theme';

function createDOM({ saved = null, blocked = '', readyState = 'loading', hasMeta = true } = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const writes = [];
  const root = { dataset: {} };
  const meta = { setAttribute(name, value) { this[name] = value; } };
  let mounted = readyState !== 'loading';
  const buttons = ['dark', 'light', 'invalid'].map(value => {
    const listeners = new Map();
    return {
      dataset: { themeOption: value },
      attributes: {},
      addEventListener(type, callback) { listeners.set(type, callback); },
      setAttribute(name, value) { this.attributes[name] = value; },
      click() { listeners.get('click')?.(); }
    };
  });
  const storage = {
    getItem(key) {
      assert.equal(key, storageKey);
      if (blocked === 'read') throw new Error('Storage read blocked');
      return saved;
    },
    setItem(key, value) {
      if (blocked === 'write') throw new Error('Storage write blocked');
      writes.push([key, value]);
    }
  };
  const window = {
    get localStorage() {
      if (blocked === 'access') throw new Error('Storage access blocked');
      return storage;
    },
    addEventListener(type, callback) { windowListeners.set(type, callback); }
  };
  const document = {
    documentElement: root,
    readyState,
    querySelector(selector) {
      assert.equal(selector, 'meta[name="theme-color"]');
      return mounted && hasMeta ? meta : null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-theme-option]');
      return mounted ? buttons : [];
    },
    addEventListener(type, callback, options) {
      assert.equal(options.once, true);
      documentListeners.set(type, callback);
    }
  };
  runInNewContext(source, { document, window }, { filename: 'theme.js' });
  return {
    root, meta, buttons, writes, storage,
    mount() {
      mounted = true;
      document.readyState = 'interactive';
      documentListeners.get('DOMContentLoaded')?.();
      documentListeners.delete('DOMContentLoaded');
    },
    storageEvent(event) { windowListeners.get('storage')(event); }
  };
}

function assertControls(dom, theme) {
  assert.equal(dom.root.dataset.theme, theme);
  assert.equal(dom.meta.content, theme === 'light' ? '#f4f6f8' : '#11161d');
  for (const button of dom.buttons) {
    assert.equal(button.attributes['aria-pressed'], String(button.dataset.themeOption === theme));
  }
}

test('dark is applied synchronously by default, with controls initialized after DOMContentLoaded', () => {
  const dom = createDOM();
  assert.equal(dom.root.dataset.theme, 'dark');
  assert.equal(dom.meta.content, undefined, 'Head execution precedes the meta element');
  assert.equal(dom.buttons[0].attributes['aria-pressed'], undefined);
  dom.mount();
  assertControls(dom, 'dark');
  assert.deepEqual(dom.writes, []);
});

test('saved light is applied before DOMContentLoaded and retained on initialization', () => {
  const dom = createDOM({ saved: 'light' });
  assert.equal(dom.root.dataset.theme, 'light');
  dom.mount();
  assertControls(dom, 'light');
  assert.deepEqual(dom.writes, []);
});

test('saved dark and invalid preferences use dark without rewriting storage', () => {
  for (const saved of ['dark', '', 'LIGHT', ' light ', 'system', 'undefined', '__proto__']) {
    const dom = createDOM({ saved });
    assert.equal(dom.root.dataset.theme, 'dark');
    dom.mount();
    assertControls(dom, 'dark');
    assert.deepEqual(dom.writes, []);
  }
});

test('clicks update the root, meta, aria-pressed and saved preference in both directions', () => {
  const dom = createDOM();
  dom.mount();
  dom.buttons[1].click();
  assertControls(dom, 'light');
  dom.buttons[0].click();
  assertControls(dom, 'dark');
  assert.deepEqual(dom.writes, [[storageKey, 'light'], [storageKey, 'dark']]);
});

for (const blocked of ['access', 'read', 'write']) {
  test(`blocked storage ${blocked} does not prevent initialization or switching`, () => {
    const dom = createDOM({ blocked });
    dom.mount();
    assertControls(dom, 'dark');
    assert.doesNotThrow(() => dom.buttons[1].click());
    assertControls(dom, 'light');
    assert.deepEqual(dom.writes, blocked === 'read' ? [[storageKey, 'light']] : []);
  });
}

test('invalid button values cannot change or persist a theme', () => {
  const dom = createDOM();
  dom.mount();
  dom.buttons[2].click();
  dom.buttons[1].dataset.themeOption = 'unexpected';
  dom.buttons[1].click();
  assert.equal(dom.root.dataset.theme, 'dark');
  assert.deepEqual(dom.writes, []);
});

test('already-loaded documents initialize controls and meta immediately', () => {
  const dom = createDOM({ saved: 'light', readyState: 'complete' });
  assertControls(dom, 'light');
  dom.buttons[0].click();
  assertControls(dom, 'dark');
});

test('a missing theme-color meta element does not prevent switching', () => {
  const dom = createDOM({ hasMeta: false });
  dom.mount();
  assert.doesNotThrow(() => dom.buttons[1].click());
  assert.equal(dom.root.dataset.theme, 'light');
  assert.equal(dom.buttons[1].attributes['aria-pressed'], 'true');
});

test('storage events sync valid preferences, reset removed or invalid ones, and never write back', () => {
  const dom = createDOM();
  dom.mount();
  dom.storageEvent({ key: storageKey, newValue: 'light', storageArea: dom.storage });
  assertControls(dom, 'light');
  dom.storageEvent({ key: 'another-key', newValue: 'dark', storageArea: dom.storage });
  dom.storageEvent({ key: storageKey, newValue: 'dark', storageArea: {} });
  assertControls(dom, 'light');
  for (const newValue of ['invalid', null]) {
    dom.storageEvent({ key: storageKey, newValue, storageArea: dom.storage });
    assertControls(dom, 'dark');
    dom.storageEvent({ key: storageKey, newValue: 'light', storageArea: dom.storage });
  }
  dom.storageEvent({ key: null, newValue: null, storageArea: dom.storage });
  assertControls(dom, 'dark');
  assert.deepEqual(dom.writes, []);
});

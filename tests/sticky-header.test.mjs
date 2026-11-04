import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/sticky-header.js', import.meta.url), 'utf8');

function createHeader({ top = 0, height = 500, headerHeight = 40 } = {}) {
  const rect = { top, height };
  const properties = new Map();
  const table = { getBoundingClientRect: () => ({ ...rect }) };
  const header = {
    offsetHeight: headerHeight,
    isConnected: true,
    style: { setProperty: (name, value) => properties.set(name, value) },
    closest(selector) {
      assert.equal(selector, 'table');
      return table;
    }
  };
  return {
    header,
    rect,
    properties,
    get offset() { return properties.get('--table-head-offset'); }
  };
}

function createDOM(initialHeaders) {
  let headers = initialHeaders.map(item => item.header);
  let nextFrameId = 1;
  let frameRequests = 0;
  const frames = new Map();
  const listeners = new Map();
  const mutations = [];
  const resizes = [];
  const mainContent = {};
  const sections = {
    querySelectorAll(selector) {
      assert.equal(selector, '.table-wrap table > thead');
      return headers;
    }
  };

  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      mutations.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
  }

  class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      this.unobserved = [];
      resizes.push(this);
    }
    observe(target) { this.observed.add(target); }
    unobserve(target) {
      this.observed.delete(target);
      this.unobserved.push(target);
    }
  }

  runInNewContext(source, {
    document: {
      getElementById(id) {
        if (id === 'sectors') return sections;
        if (id === 'main-content') return mainContent;
        return null;
      }
    },
    window: {
      addEventListener(type, callback, options) {
        listeners.set(type, { callback, options });
      }
    },
    MutationObserver,
    ResizeObserver,
    requestAnimationFrame(callback) {
      frameRequests += 1;
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    }
  }, { filename: 'sticky-header.js' });

  return {
    sections,
    mutations,
    resizes,
    get pendingFrames() { return frames.size; },
    get frameRequests() { return frameRequests; },
    dispatch(type) {
      assert.ok(listeners.has(type), `Expected a ${type} listener`);
      listeners.get(type).callback();
    },
    flushFrame() {
      assert.equal(frames.size, 1, 'Expected one scheduled animation frame');
      const [[id, callback]] = frames;
      frames.delete(id);
      callback(0);
    },
    replaceHeaders(replacements) {
      headers = replacements.map(item => item.header);
    }
  };
}

test('original header has zero translation when the table top is positive', () => {
  const original = createHeader({ top: 120 });
  const dom = createDOM([original]);

  assert.equal(original.offset, undefined, 'Measurements wait for animation frame');
  dom.flushFrame();

  assert.equal(original.offset, '0px');
  assert.ok(dom.resizes[0].observed.has(original.header));
});

test('original header translation matches the negative table top', () => {
  const original = createHeader({ top: -125, height: 600, headerHeight: 48 });
  const dom = createDOM([original]);

  dom.flushFrame();

  assert.equal(original.offset, '125px');
});

test('original header translation is clamped at the bottom of its table', () => {
  const original = createHeader({ top: -900, height: 300, headerHeight: 45 });
  const dom = createDOM([original]);

  dom.flushFrame();

  assert.equal(original.offset, '255px');
});

test('scroll events coalesce into one animation frame and use the latest position', () => {
  const original = createHeader({ top: 80 });
  const dom = createDOM([original]);

  dom.dispatch('scroll');
  dom.dispatch('scroll');
  assert.equal(dom.pendingFrames, 1);
  assert.equal(dom.frameRequests, 1, 'Scroll reuses the initial pending frame');
  dom.flushFrame();
  assert.equal(original.offset, '0px');

  original.rect.top = -25;
  dom.dispatch('scroll');
  original.rect.top = -75;
  dom.dispatch('scroll');
  dom.dispatch('scroll');
  assert.equal(dom.pendingFrames, 1);
  assert.equal(dom.frameRequests, 2);
  assert.equal(original.offset, '0px', 'Scroll does not mutate styles synchronously');

  dom.flushFrame();
  assert.equal(original.offset, '75px');
  assert.equal(dom.pendingFrames, 0);

  original.rect.top = -95;
  dom.dispatch('scroll');
  assert.equal(dom.frameRequests, 3, 'Another frame may be scheduled after flushing');
  dom.flushFrame();
  assert.equal(original.offset, '95px');
});

test('MutationObserver updates a replacement header and releases the removed header', () => {
  const original = createHeader({ top: -30 });
  const dom = createDOM([original]);
  dom.flushFrame();
  assert.equal(original.offset, '30px');

  const observer = dom.mutations[0];
  assert.equal(dom.mutations.length, 1);
  assert.equal(observer.target, dom.sections);
  assert.deepEqual({ ...observer.options }, {
    childList: true,
    subtree: true,
    characterData: true
  });

  const replacement = createHeader({ top: -110, height: 400, headerHeight: 50 });
  original.header.isConnected = false;
  dom.replaceHeaders([replacement]);
  observer.callback([{ type: 'childList', target: dom.sections }]);

  assert.equal(dom.pendingFrames, 1);
  assert.equal(replacement.offset, undefined);
  dom.flushFrame();

  assert.equal(replacement.offset, '110px');
  assert.equal(original.offset, '30px', 'Removed header is not updated');
  assert.ok(dom.resizes[0].observed.has(replacement.header));
  assert.equal(dom.resizes[0].observed.has(original.header), false);
  assert.deepEqual(dom.resizes[0].unobserved, [original.header]);
});

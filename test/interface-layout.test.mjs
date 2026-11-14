import test from 'node:test';
import assert from 'node:assert/strict';
import { interfaceLayoutFor, mountInterfaceLayout } from '../src/interface-layout.js';

test('presentation selects touch layouts in both phone orientations and preserves pointer desktop layouts', () => {
  for (const [width, height] of [[360, 800], [844, 390], [1024, 768], [768, 1024]]) {
    assert.equal(interfaceLayoutFor({ width, height, coarsePointer: true }), 'mobile');
  }
  for (const [width, height] of [[1440, 900], [1366, 768], [900, 600]]) {
    assert.equal(interfaceLayoutFor({ width, height, finePointer: true }), 'desktop');
  }
  assert.equal(interfaceLayoutFor({ width: 600, height: 900, finePointer: true }), 'mobile');
  assert.equal(interfaceLayoutFor({ width: 1366, height: 768, coarsePointer: true, finePointer: true }), 'desktop');
  assert.equal(interfaceLayoutFor({ width: 1280, height: 800, finePointer: true, mobileDevice: true }), 'mobile');
});

test('layout responds to rotation and input changes without repeatedly changing unchanged attributes', () => {
  const resizeListeners = new Set();
  const queries = new Map();
  const frames = new Map();
  let nextFrame = 0;
  let writes = 0;
  const doc = {
    documentElement: { clientWidth: 390, clientHeight: 844 },
    body: { dataset: new Proxy({}, { set(target, key, value) { writes++; target[key] = value; return true; } }) },
  };
  const view = {
    navigator: {},
    matchMedia(query) {
      const value = { matches: query === '(pointer: coarse)', listeners: new Set(),
        addEventListener(type, listener) { this.listeners.add(listener); },
        removeEventListener(type, listener) { this.listeners.delete(listener); } };
      queries.set(query, value);
      return value;
    },
    addEventListener(type, listener) { resizeListeners.add(listener); },
    removeEventListener(type, listener) { resizeListeners.delete(listener); },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  function resize(width, height) {
    Object.assign(doc.documentElement, { clientWidth: width, clientHeight: height });
    for (const listener of resizeListeners) listener();
  }
  function flush() { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback()); }
  const dispose = mountInterfaceLayout(view, doc);
  assert.equal(doc.body.dataset.uiLayout, 'mobile');
  assert.equal(doc.body.dataset.uiInput, 'touch');
  const originalWrites = writes;
  resize(390, 844); resize(390, 844);
  assert.equal(frames.size, 1);
  flush();
  assert.equal(writes, originalWrites);
  resize(844, 390); flush();
  assert.equal(doc.body.dataset.uiLayout, 'mobile');
  assert.equal(doc.body.dataset.uiOrientation, 'landscape');
  assert.equal(writes, originalWrites + 1);
  const fine = queries.get('(any-hover: hover) and (any-pointer: fine)');
  fine.matches = true;
  for (const listener of fine.listeners) listener();
  resize(1440, 900); flush();
  assert.equal(doc.body.dataset.uiLayout, 'desktop');
  assert.equal(doc.body.dataset.uiInput, 'pointer');
  resize(600, 900);
  dispose();
  assert.equal(frames.size, 0);
  assert.equal(resizeListeners.size, 0);
  assert.ok([...queries.values()].every(query => query.listeners.size === 0));
});

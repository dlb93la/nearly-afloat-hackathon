import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBayHosts } from '../src/bay-hosts.js';

function fixture(storage = new Map()) {
  const node = () => ({ hidden: true, dataset: {}, attributes: new Map(), listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    removeAttribute(name) { this.attributes.delete(name); },
    toggleAttribute(name, value) { if (value) this.attributes.set(name, ''); else this.attributes.delete(name); },
    focus() {},
    click() { this.listeners.get('click')?.({ detail: 1, target: this }); },
  });
  const nodes = Object.fromEntries(['strong', 'p', '[data-host-next]', '#host-progress', '[data-host-voice]', '[data-host-close]'].map(selector => [selector, node()]));
  const panel = node();
  panel.parentElement = node();
  panel.querySelector = selector => nodes[selector];
  const sounds = [], destinations = [];
  const store = storage instanceof Map ? { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } : storage;
  const hosts = mountBayHosts(panel, (...args) => sounds.push(args), destination => {
    destinations.push(destination); return true;
  }, { storage: store, view: { addEventListener() {}, setTimeout() {} } });
  return { hosts, panel, nodes, sounds, destinations, storage };
}

test('welcome starts once, stays through both pages, and does not return after leaving or reloading', () => {
  const app = fixture();
  app.hosts.update(false, 'new', false, false);
  assert.equal(app.storage.has('bay-intro-seen'), false);
  app.hosts.update(true, 'new', false, false);
  assert.equal(app.panel.hidden, false);
  assert.equal(app.nodes['#host-progress'].textContent, '1 / 2');
  assert.equal(app.storage.get('bay-intro-seen'), 'seen');
  app.hosts.update(true, 'new', false, false);
  assert.equal(app.panel.hidden, false, 'normal render updates must not dismiss the first welcome');
  app.nodes['[data-host-next]'].click();
  assert.equal(app.nodes['#host-progress'].textContent, '2 / 2');
  app.nodes['[data-host-next]'].click();
  assert.deepEqual(app.destinations, ['arena']);
  assert.equal(app.panel.hidden, true);
  app.hosts.update(true, 'new', false, false);
  assert.equal(app.panel.hidden, true);
  const reload = fixture(app.storage);
  reload.hosts.update(true, 'new', false, false);
  assert.equal(reload.panel.hidden, true);
});

test('returning reward-ready or claimed identities receive no automatic popup but can replay the welcome', () => {
  for (const stage of ['ready', 'claimed']) {
    const app = fixture();
    app.hosts.update(true, stage, true, true);
    assert.equal(app.panel.hidden, true);
    assert.equal(app.hosts.speaker, null);
    assert.equal(app.storage.get('bay-intro-seen'), 'seen');
    app.hosts.replay();
    assert.equal(app.hosts.speaker, 'captain');
    assert.equal(app.panel.hidden, true, '3D presentation waits for the host model to rise');
    app.hosts.place();
    assert.equal(app.panel.hidden, false);
    assert.equal(app.nodes['#host-progress'].textContent, '1 / 2');
    assert.match(app.nodes.p.textContent, /Welcome aboard/);
    assert.deepEqual(app.sounds, [['captain', 'argh']]);
    app.nodes['[data-host-close]'].click();
    app.hosts.update(true, stage, true, true);
    assert.equal(app.panel.hidden, true);
  }
});

test('unavailable browser storage does not break intro dismissal within the session', () => {
  const app = fixture({ getItem() { throw Error('Storage blocked'); }, setItem() { throw Error('Storage blocked'); } });
  app.hosts.update(true, 'new', false, false);
  assert.equal(app.panel.hidden, false);
  app.nodes['[data-host-close]'].click();
  app.hosts.update(false, 'new', false, false);
  app.hosts.update(true, 'new', false, false);
  assert.equal(app.panel.hidden, true);
});

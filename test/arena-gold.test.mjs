import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';

test('arena gold animates on entry click and confirmed victory, outside countdown', async () => {
  const { window, document } = parseHTML('<html><body><span id="header-gold"></span></body></html>');
  globalThis.window = window;
  globalThis.document = document;
  window.innerWidth = 1000;
  window.innerHeight = 700;
  const paths = [];
  window.HTMLElement.prototype.animate = function (frames) {
    paths.push({ kind: this.className, frames });
    return { finished: new Promise(() => {}) };
  };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 850, top: 10, width: 80, height: 40 });
  const hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    return next(url, context);
  } });
  try {
    const { playArenaGold, showArenaGold } = await import('../src/arena-gold.js');
    const packet = (status, winnerId = 'player') => ({
      code: 'GOLD', round: 1, phase: status === 'reserved' ? 'countdown' : 'results',
      roster: [{ id: 'player', bot: false }], stake: { entry: 200,
        round: { status, winnerId, paid: 1480 } },
    });
    const reserved = packet('reserved');
    showArenaGold({ debit: 200 }, false);
    assert.equal(document.querySelector('.arena-gold-label').textContent, '−2.00 GOLD');
    assert.equal(document.querySelectorAll('.arena-gold-coin').length, 7);
    assert.match(paths[0].frames[0].transform, /890px, 30px/);
    const count = paths.length;
    playArenaGold(reserved, reserved, 'player', false);
    assert.equal(paths.length, count);
    assert.equal(document.querySelector('.arena-gold-effect'), null, 'countdown removes the entry effect');

    const victory = packet('settled');
    playArenaGold(reserved, victory, 'player', false);
    assert.equal(document.querySelector('.arena-gold-label').textContent, '+14.80 GOLD');
    assert.match(paths.at(-2).frames.at(-1).transform, /890px, 30px/);
    document.querySelector('.arena-gold-effect').remove();

    const loss = packet('settled', 'other');
    playArenaGold(reserved, loss, 'player', false);
    assert.equal(document.querySelector('.arena-gold-effect'), null);
    playArenaGold(null, loss, 'player', false);
    assert.equal(document.querySelector('.arena-gold-effect'), null, 'reconnecting does not replay a payout');
    playArenaGold(reserved, victory, 'player', true);
    assert.equal(document.querySelectorAll('.arena-gold-coin').length, 0, 'reduced motion uses the receipt label');
  } finally {
    hook.deregister();
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';

test('GOLD wallet requires review and confirms the exact testnet deposit', async () => {
  const { document, window } = parseHTML(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const account = 'deckhand.testnet';
  const operations = [];
  const form = document.getElementById('gold-wallet-form');
  Object.defineProperty(form, 'elements', { value: [...form.querySelectorAll('input, select, button')] });
  globalThis.document = document;
  globalThis.window = window;
  globalThis.Event = window.Event;
  globalThis.goldTestSign = async (...args) => {
    operations.push(args);
    return { status: { SuccessValue: btoa('"125"') } };
  };
  globalThis.fetch = async () => Response.json({
    arena: 'arena.testnet', token: 'gold.testnet', inGame: operations.length ? 225 : 100,
    inWallet: operations.length ? '75' : '200', registered: true,
  });
  const hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('/near-wallet.js')) return {
      format: 'module', shortCircuit: true, source: 'export const signGoldWalletAction = globalThis.goldTestSign;',
    };
    return next(url, context);
  } });
  try {
    const { mountGoldWallet } = await import('../src/gold-wallet.js');
    const panel = document.getElementById('gold-wallet');
    const action = document.getElementById('gold-wallet-action');
    assert.equal(action.querySelector('option[value="send"]'), null, 'direct player transfers are outside the in-game menu');
    action.querySelector('option').selected = true;
    const amount = document.getElementById('gold-wallet-amount');
    const submit = document.getElementById('gold-wallet-submit');
    const mounted = mountGoldWallet();
    assert.equal(panel.hidden, true);
    mounted.update({ account }, false);
    assert.equal(panel.hidden, false);
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
    await new Promise(setImmediate);
    amount.value = '1.25';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    assert.equal(submit.textContent, 'Confirm');
    assert.equal(operations.length, 0);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise(setImmediate);
    assert.deepEqual(operations, [['gold.testnet', account, [{
      methodName: 'ft_transfer_call', args: { receiver_id: 'arena.testnet', amount: '125', msg: 'deposit' },
      deposit: '1', gas: '80000000000000',
    }]]]);
    assert.equal(document.getElementById('gold-wallet-status').textContent, 'Confirmed');
    assert.equal(document.getElementById('gold-wallet-balances').textContent, '2.25 in game · 0.75 in wallet');
  } finally {
    hook.deregister();
    delete globalThis.goldTestSign;
  }
});

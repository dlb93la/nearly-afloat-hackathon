import Privy, { LocalStorage, rawSign } from '@privy-io/js-sdk-core';
import {
  Account, actions, baseEncode, encodeTransaction, JsonRpcProvider, KeyType, PublicKey,
  Signature, SignedTransaction,
} from 'near-api-js';

let context;

async function initialize({ appId, clientId }) {
  const privy = new Privy({ appId, ...(clientId ? { clientId } : {}), storage: new LocalStorage() });
  await privy.initialize();
  const frame = document.createElement('iframe');
  frame.title = 'Secure GOLD wallet';
  frame.src = privy.embeddedWallet.getURL();
  frame.hidden = true;
  const origin = new URL(frame.src).origin;
  function receive(event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    try {
      privy.embeddedWallet.onMessage(typeof event.data === 'string' ? JSON.parse(event.data) : event.data);
    } catch { /* The frame can also send messages unrelated to wallet signing. */ }
  }
  window.addEventListener('message', receive);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The GOLD wallet timed out.')), 20_000);
      frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
      document.body.append(frame);
      privy.setMessagePoster(frame.contentWindow);
    });
  } catch (error) {
    window.removeEventListener('message', receive);
    frame.remove();
    throw error;
  }
  return privy;
}

export async function createGoldSigner(config, account) {
  if (!/^[a-f0-9]{64}$/.test(account)) throw new Error('This account uses an external wallet.');
  context ??= initialize(config).catch(error => { context = null; throw error; });
  const privy = await context;
  const { user } = await privy.user.get();
  const wallet = user?.linked_accounts.find(candidate => candidate.type === 'wallet' &&
    candidate.chain_type === 'near' && candidate.wallet_client_type === 'privy' && candidate.address === account);
  if (!wallet) throw new Error('Sign in with the account connected to this game.');
  const rpc = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' }, { retries: 1 });
  const publicKey = PublicKey.fromString('ed25519:' + baseEncode(Uint8Array.from(account.match(/../g), byte => parseInt(byte, 16))));
  const owner = new Account(account, rpc);
  return async (receiverId, calls) => {
    const transaction = await owner.createTransaction({ receiverId, publicKey,
      actions: calls.map(({ methodName, args, gas, deposit }) => actions.functionCall(methodName, args, BigInt(gas), BigInt(deposit))),
    });
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encodeTransaction(transaction)));
    const hash = '0x' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    const { data } = await rawSign(privy, options => privy.embeddedWallet.signWithUserSigner(options), {
      wallet_id: wallet.id, params: { hash },
    });
    if (!/^0x[a-fA-F0-9]{128}$/.test(data?.signature)) throw new Error('The wallet did not return a valid signature.');
    const bytes = Uint8Array.from(data.signature.slice(2).match(/../g), byte => parseInt(byte, 16));
    if (!publicKey.verify(digest, bytes)) throw new Error('The wallet signature does not match this transaction.');
    return rpc.sendTransactionUntil(new SignedTransaction({ transaction,
      signature: new Signature({ keyType: KeyType.ED25519, data: bytes }),
    }), 'FINAL');
  };
}

let connector;
let wallet;
let socialAccount;
const pendingEntryKey = 'barrel-bay:near-entry';

export function readPendingNearEntry(member) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingEntryKey));
    if (member && saved?.memberId === member.id && saved.code === member.code &&
      /^[1-9]\d{0,19}$/.test(saved.id) && typeof saved.ready === 'boolean' && saved.expiresAt > Date.now()) {
      return saved;
    }
  } catch {
    // Live reconciliation still works when tab storage is unavailable.
  }
  return null;
}

export function rememberNearEntry(entry) {
  try {
    if (!entry) sessionStorage.removeItem(pendingEntryKey);
    else {
      const { memberId, code, id, ready, expiresAt } = entry;
      sessionStorage.setItem(pendingEntryKey, JSON.stringify({ memberId, code, id, ready, expiresAt }));
    }
  } catch {
    // Tab storage is only needed to recover the check after a reload.
  }
}

async function getConnector() {
  if (!connector) {
    const { NearConnector } = await import('@hot-labs/near-connect');
    connector = new NearConnector({
      network: 'testnet',
      features: { signMessage: true, signInWithoutAddKey: true, signAndSendTransaction: true },
    });
  }
  return connector;
}

export async function selectNearWallet() {
  const connect = await getConnector();
  try { ({ wallet } = await connect.getConnectedWallet()); }
  catch { wallet = await connect.connect(); }
  const [account] = await wallet.getAccounts();
  if (!account?.accountId) throw new Error('No NEAR account was selected.');
  return account.accountId;
}

export function signNearChallenge(account, { nonce, recipient, message }) {
  const bytes = Uint8Array.from(nonce.match(/.{2}/g), hex => Number.parseInt(hex, 16));
  return wallet.signMessage({ signerId: account, message, recipient, nonce: bytes });
}

export function setNearSocialAccount(account, contract, enabled) {
  socialAccount = account ? { account, contract, enabled } : null;
}

export const usesNearSocialAccount = account => socialAccount?.account === account && Boolean(socialAccount);

export class NearSocialActionError extends Error {}

// Only explicit pre-broadcast session rejections allow this recovery path.
// A timeout or an unknown receipt must still be reconciled before retrying.
export function requiresGameSessionRenewal(error) {
  return error instanceof NearSocialActionError && [
    'Sign in again to authorize your game session.', 'Sign in again to continue.',
    'Sign in again to renew your game session.', 'This exceeds your remaining session limit.',
  ].includes(error.message);
}

async function signFunction(contract, account, methodName, args, gas) {
  if (usesNearSocialAccount(account)) {
    if (!socialAccount.enabled || socialAccount.contract !== contract) {
      throw new NearSocialActionError('Game transactions are unavailable for this sign-in.');
    }
    const body = JSON.stringify({ account, method: methodName, args, requestId: crypto.randomUUID() });
    const request = () => fetch('/near-social/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40_000), body,
    });
    // Rejoin the same server operation when the first HTTP response is interrupted.
    const response = await request().catch(request);
    const result = await response.json();
    if (!response.ok) throw new NearSocialActionError(result.message ?? 'Could not submit the game action.');
    return result;
  }
  if (await selectNearWallet() !== account) return { accountChanged: true };
  return wallet.signAndSendTransaction({ signerId: account, receiverId: contract,
    actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit: '0' } }],
  });
}

export async function signGoldWalletAction(receiverId, account, calls) {
  if (await selectNearWallet() !== account) throw new Error('Select the wallet connected to the game.');
  return wallet.signAndSendTransaction({ signerId: account, receiverId,
    actions: calls.map(params => ({ type: 'FunctionCall', params })),
  });
}

export async function signNearEntry(contract, account, round, ready) {
  const methodName = ready ? 'authorize_entry' : 'revoke_entry';
  await signEntryMethod(contract, account, methodName, ready ? { round_id: round } : {});
}

export async function signNearSession(contract, account, scope, enable) {
  const methodName = enable ? 'authorize_session' : 'revoke_session';
  await signEntryMethod(contract, account, methodName, enable ? { scope, entries: 3 } : { scope });
}

export async function signNearExpedition(contract, account, method, args) {
  const result = await signFunction(contract, account, method, args, '100000000000000');
  if (result?.accountChanged) throw new Error('Use the account connected to Expeditions.');
  if (result?.status?.Failure) throw Object.assign(new Error('Transaction declined. Your gold is available again.'), { declined: true });
  return result?.transaction?.hash;
}

export async function signNearWorkshop(contract, account, args, method = 'workshop_action') {
  const result = await signFunction(contract, account, method, args, '60000000000000');
  if (result?.accountChanged) return { accountChanged: true };
  const status = result?.status;
  return {
    hash: result?.transaction?.hash ?? null,
    failed: Boolean(status?.Failure),
    finalized: result?.final_execution_status === 'FINAL' && typeof status?.SuccessValue === 'string',
  };
}

async function signEntryMethod(contract, account, methodName, args) {
  const result = await signFunction(contract, account, methodName, args, '30000000000000');
  if (result?.accountChanged) throw new Error('Use the account you used to join this room.');
  if (usesNearSocialAccount(account) && result?.status?.Failure) throw new NearSocialActionError('The entry change was declined.');
}

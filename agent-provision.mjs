import { Account, actions, KeyPair } from 'near-api-js';
import { lockAgentFile, readAgentFile, writeAgentFile } from './agent-journal.mjs';

export async function provisionMerchantReserve({ admin, rpc, contract, chain, checkpointPath, items, stopAfter, allowPrivateRestore = false }) {
  const release = await lockAgentFile(checkpointPath);
  if (!release) throw new Error('Reserve provisioner already running');
  try {
    let saved = await readAgentFile(checkpointPath);
    const account = saved?.account ?? 'reserve.' + contract;
    if (!saved) {
      saved = { version: 1, chain, contract, account,
        ownerKey: KeyPair.fromRandom('ed25519').toString(), limitedKey: KeyPair.fromRandom('ed25519').toString(),
        policy: { agent: account, items, budget: 1500, per_trade: 650, expires_at: Date.now() + 8 * 3_600_000, enabled: true },
        receipts: [] };
      await writeAgentFile(checkpointPath, saved);
    }
    const restoredChain = allowPrivateRestore && /^test-chain-/.test(chain) && /^test-chain-/.test(saved.chain);
    if (saved.version !== 1 || (saved.chain !== chain && !restoredChain) || saved.contract !== contract ||
        !account.endsWith('.' + contract) || account === contract) {
      throw new Error('Reserve checkpoint belongs to another chain or contract');
    }
    saved.chain = chain;
    const checkpoint = async (stage, receipt) => {
      saved.stage = stage;
      if (receipt?.transaction?.hash) saved.receipts.push({ stage, hash: receipt.transaction.hash });
      await writeAgentFile(checkpointPath, saved);
      if (stopAfter === stage) throw new Error('Provisioning interrupted after ' + stage);
    };
    await checkpoint('keys-saved');
    const ownerKey = KeyPair.fromString(saved.ownerKey);
    const limitedKey = KeyPair.fromString(saved.limitedKey);
    try { await rpc.viewAccount({ accountId: account, blockQuery: { finality: 'final' } }); }
    catch (error) {
      if (error.name !== 'AccountDoesNotExistError') throw error;
      await checkpoint('account-created', await admin.signAndSendTransaction({ receiverId: account, waitUntil: 'FINAL',
        actions: [actions.createAccount(), actions.transfer(10n ** 24n), actions.addFullAccessKey(ownerKey.getPublicKey())] }));
    }
    const owner = new Account(account, rpc, saved.ownerKey);
    const ownerAccess = await owner.getAccessKey(ownerKey.getPublicKey());
    if (ownerAccess.permission !== 'FullAccess') throw new Error('Reserve recovery key mismatch');
    const view = (method, args) => rpc.callFunction({ contractId: contract, method, args, blockQuery: { finality: 'final' } });
    const call = (methodName, args) => admin.callFunctionRaw({ contractId: contract, methodName, args,
      gas: 100_000_000_000_000n, deposit: 0n, waitUntil: 'FINAL' });
    if (!await view('registered', { player: account })) {
      await checkpoint('gold-granted', await call('grant_test_gold', { player: account }));
    }
    const policy = await view('agent_policy', { agent: account });
    if (!policy) await checkpoint('policy-configured', await call('configure_agent', saved.policy));
    else {
      for (const field of ['items', 'budget', 'per_trade', 'expires_at', 'enabled']) {
        if (JSON.stringify(policy[field]) !== JSON.stringify(saved.policy[field])) throw new Error('Reserve policy differs from its checkpoint');
      }
    }
    try { await owner.getAccessKey(limitedKey.getPublicKey()); }
    catch (error) {
      if (error.name !== 'AccessKeyDoesNotExistError') throw error;
      await checkpoint('key-installed', await owner.addFunctionCallAccessKey({ publicKey: limitedKey.getPublicKey(),
        contractId: contract, methodNames: ['agent_trade'], allowance: 250_000_000_000_000_000_000_000n }));
    }
    const access = await owner.getAccessKey(limitedKey.getPublicKey());
    const permission = access.permission?.FunctionCall;
    if (permission?.receiver_id !== contract || permission.method_names?.length !== 1 ||
        permission.method_names[0] !== 'agent_trade' || BigInt(permission.allowance ?? 0) <= 0n) {
      throw new Error('Reserve delegated key mismatch');
    }
    await checkpoint('ready');
    return { ...saved, access };
  } finally { await release(); }
}

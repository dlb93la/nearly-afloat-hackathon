import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { on, once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider } from 'near-api-js';
import { signMessage } from 'near-api-js/nep413';
import { WebSocket } from 'ws';
import { EXPEDITION_ITEM } from '../../shared/cosmetics.mjs';

async function next(socket, predicate, send = () => {}) {
  const messages = on(socket, 'message', { signal: AbortSignal.timeout(20_000) });
  try {
    send();
    for await (const [bytes] of messages) {
      const message = JSON.parse(bytes);
      assert.notEqual(message.type, 'error', message.message);
      assert.notEqual(message.type, 'expedition-view-error', message.message);
      if (predicate(message)) return message;
    }
  } finally {
    await messages.return();
  }
}

export async function verifyGameClaim({ rpc, contract, winner, outbid, network = 'sandbox' }) {
  const endpoint = new URL(rpc);
  assert.ok(network === 'sandbox' || network === 'testnet', 'Choose the sandbox or testnet proof.');
  if (network === 'testnet') {
    assert.equal(endpoint.protocol, 'https:', 'Use an HTTPS testnet RPC.');
    const provider = new JsonRpcProvider({ url: endpoint.href }, { retries: 2, wait: 200, backoff: 2 });
    assert.equal((await provider.sendJsonRpc('status', [])).chain_id, 'testnet', 'The RPC must report NEAR testnet.');
  } else {
    assert.equal(endpoint.hostname, '127.0.0.1', 'Use a loopback sandbox RPC.');
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !name.startsWith('BARREL_NEAR_') && !name.startsWith('BARREL_EXPEDITIONS_')));
  Object.assign(env, {
    HOST: '127.0.0.1', PORT: '0', BARREL_DB: ':memory:',
    BARREL_EXPEDITIONS_CONTRACT: contract, BARREL_EXPEDITIONS_RPC: rpc,
  });
  const server = spawn(process.execPath, ['--experimental-sqlite', fileURLToPath(new URL('../../server.mjs', import.meta.url))],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const sockets = [];
  try {
    const output = createInterface({ input: server.stdout });
    const [line] = await once(output, 'line', { signal: AbortSignal.timeout(15_000) });
    const base = new URL(line.match(/https?:\/\/\S+/)[0]);
    const address = new URL('/arena', base);
    address.protocol = 'ws:';
    const wallet = message => message.type === 'wallet';
    const write = (socket, type, fields = {}) => socket.send(JSON.stringify({ type, ...fields }));
    async function connect(player, cookie) {
      if (!cookie) {
        const session = await fetch(new URL('/playtest-session', base));
        cookie = session.headers.get('set-cookie').split(';')[0];
      }
      const socket = new WebSocket(address, { headers: { cookie } });
      sockets.push(socket);
      const config = next(socket, message => message.type === 'expedition-chain-config');
      const initial = next(socket, wallet);
      assert.equal((await config).contract, contract);
      const localWallet = await initial;
      const actionId = randomUUID();
      const challenge = await next(socket, message => message.type === 'expedition-chain-challenge' && message.actionId === actionId,
        () => write(socket, 'expedition-chain-challenge', { account: player.id, actionId }));
      const signed = await signMessage({
        signerAccount: new Account(player.id, rpc, player.key.toString()),
        payload: { message: challenge.message, recipient: challenge.recipient, nonce: Buffer.from(challenge.nonce, 'hex') },
      });
      const view = next(socket, message => message.type === 'expedition-chain-view' && message.account === player.id);
      const reply = await next(socket, message => message.type === 'expedition-result' && message.actionId === actionId, () =>
        write(socket, 'expedition-chain-auth', {
          actionId, accountId: signed.accountId, publicKey: signed.publicKey.toString(),
          signature: Buffer.from(signed.signature).toString('base64'),
        }));
      assert.equal(reply.ok, true, reply.message);
      return { socket, cookie, view: await view, localWallet };
    }
    const claim = socket => {
      const actionId = randomUUID();
      return next(socket, message => message.type === 'expedition-result' && message.actionId === actionId,
        () => write(socket, 'expedition-chain-claim', { actionId }));
    };

    const loser = await connect(outbid);
    assert.equal(loser.view.campaign.status, 'settled');
    assert.equal(loser.view.campaign.won, false);
    assert.equal((await claim(loser.socket)).ok, false);
    const collector = await connect(winner);
    assert.equal(collector.view.campaign.won, true);
    assert.equal(collector.view.claimed, false);
    const cargo = next(collector.socket, wallet);
    assert.equal((await claim(collector.socket)).ok, true);
    const delivered = await cargo;
    const [pet] = delivered.workshop.inventory.filter(item => item.type === EXPEDITION_ITEM);
    assert.ok(pet);
    assert.equal(delivered.gold, collector.localWallet.gold, 'The chain prize must leave local gold alone.');
    const equipped = await next(collector.socket, wallet,
      () => write(collector.socket, 'gear-style', { id: pet.id, slot: 'pet' }));
    assert.equal(equipped.workshop.appearance.pet, EXPEDITION_ITEM);
    collector.socket.close();
    const resumed = await connect(winner, collector.cookie);
    assert.equal(resumed.view.claimed, true);
    assert.equal((await claim(resumed.socket)).ok, true);
    const refreshed = await next(resumed.socket, wallet, () => write(resumed.socket, 'gear-refresh'));
    assert.deepEqual(refreshed.workshop.inventory.filter(item => item.type === EXPEDITION_ITEM).map(item => item.id), [pet.id]);
    const secondProfile = await connect(winner);
    assert.equal(secondProfile.view.claimed, false);
    assert.equal((await claim(secondProfile.socket)).ok, false);
    console.log('Game bridge verified: signed winner, rejected outbid profile, equipped cargo, reconnect, one claim.');
  } finally {
    for (const socket of sockets) socket.terminate();
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  }
}

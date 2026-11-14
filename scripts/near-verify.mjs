import assert from 'node:assert/strict';
import { JsonRpcProvider } from 'near-api-js';

const contractId = 'bb-1ff20598-arena.testnet';
const provider = new JsonRpcProvider({ url: process.env.BARREL_NEAR_RPC || 'https://test.rpc.fastnear.com' });
const cases = [
  ['11023405630671469910', 'cancelled', 0, null],
  ['14509292132630452148', 'settled', 1280, null],
  ['6361697681059928002', 'settled', 1480, 'alice.bb-1ff20598-arena.testnet'],
  ['15731545500553711503', 'cancelled', 0, null],
];

assert.equal((await provider.sendJsonRpc('status', [])).chain_id, 'testnet');
const rounds = await Promise.all(cases.map(([id]) => provider.callFunction({
  contractId, method: 'round', args: { round_id: id }, blockQuery: { finality: 'final' },
})));
for (const [index, [id, status, paid, winner]] of cases.entries()) {
  const round = rounds[index];
  assert.ok(round, 'Missing round ' + id);
  assert.deepEqual([round.status, round.paid, round.winner, round.pot, round.fee, round.bonus, round.bots],
    [status, paid, winner, 1280, 320, 200, 6], 'Receipt mismatch for ' + id);
  console.log(id, status, (paid / 100).toFixed(2), winner ?? (status === 'settled' ? 'bot bank' : 'refunded'));
}

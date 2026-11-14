// Read-only proof of the current voyage. No signing key or wallet is required.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { JsonRpcProvider } from 'near-api-js';

const saleArgument = process.argv.slice(2).find(argument => argument.startsWith('--sale='));
const saleGold = saleArgument?.slice('--sale='.length) ?? '99.00';
assert.match(saleGold, /^\d+(?:\.\d{1,2})?$/, 'Use --sale=99.00 to specify the expected GOLD sale');
const expectedSale = Math.round(Number(saleGold) * 100);
assert.ok(Number.isSafeInteger(expectedSale) && expectedSale > 0);
const rpc = new JsonRpcProvider({ url: process.env.BARREL_NEAR_RPC || 'https://testnet-rpc.intea.rs' });
const contract = process.env.BARREL_NEAR_CONTRACT || 'r-f08ea9c0.afloat-proof-44f848902e.testnet';
assert.equal((await rpc.sendJsonRpc('status', [])).chain_id, 'testnet');
const block = await rpc.viewBlock({ finality: 'final' });
const blockQuery = { blockId: block.header.hash };
const view = (method, args = {}) => rpc.callFunction({ contractId: contract, method, args, blockQuery });
const campaign = await view('campaign');
const state = await rpc.sendJsonRpc('query', { request_type: 'view_state', block_id: block.header.hash,
  account_id: contract, prefix_base64: Buffer.from('unified-voyage').toString('base64') });
const key = Buffer.concat([Buffer.from('unified-voyage'), Buffer.from([0])]);
const voyage = state.values.find(entry => Buffer.from(entry.key, 'base64').equals(key));
assert.ok(voyage, 'Current voyage storage was not found');
const participants = [...new Set([
  ...process.argv.slice(2).filter(arg => !arg.startsWith('--')),
  ...(Buffer.from(voyage.value, 'base64').toString('latin1').match(/[a-f0-9]{64}/g) ?? []),
  campaign.highest_bidder, campaign.winner,
].filter(Boolean))];
const accounts = await Promise.all(participants.map(async player => ({ player, ...await view('account', { player }) })));
const contributors = accounts.filter(account => account.contribution > 0);
assert.equal(contributors.length, campaign.contributor_count, 'Pass any additional named contributor accounts as command arguments');
assert.equal(contributors.reduce((sum, account) => sum + account.contribution, 0), campaign.funded);
let checks = { contributions: true, settled: false };
if (campaign.status === 'settled') {
  assert.equal(campaign.sale, expectedSale, `Expected a sale of ${saleGold} GOLD`);
  const expectedFee = Math.ceil(campaign.sale * 5 / 100);
  assert.equal(campaign.fee, expectedFee);
  assert.equal(campaign.net, campaign.sale - expectedFee);
  const shares = contributors.map(account => {
    const weighted = BigInt(campaign.net) * BigInt(account.contribution);
    return { player: account.player, base: Number(weighted / BigInt(campaign.funded)), remainder: weighted % BigInt(campaign.funded) };
  }).sort((a, b) => Number(b.remainder - a.remainder));
  const dust = campaign.net - shares.reduce((sum, share) => sum + share.base, 0);
  shares.forEach((share, index) => assert.equal(contributors.find(account => account.player === share.player).payout, share.base + Number(index < dust)));
  assert.equal(contributors.reduce((sum, account) => sum + account.payout, 0), campaign.net);
  const winner = accounts.find(account => account.player === campaign.winner);
  assert.ok(winner.award_editions.some(edition => edition.campaign_id === campaign.id && edition.item_type === campaign.item_type));
  checks = { ...checks, settled: true, expectedSale: true, sale99: campaign.sale === 9900,
    fee5Percent: true, proportionalPayouts: true, winnerOwnsCargo: true };
}
const report = { checkedAt: new Date().toISOString(), network: 'testnet', contract, block: block.header.height,
  campaign, accounts, checks, expectedSale,
  scope: 'Finalized on-chain state and exact integer payouts. This command submits no transactions.' };
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/expedition-sale-current.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ block: report.block, campaign: campaign.id, status: campaign.status, funded: campaign.funded,
  sale: campaign.sale, fee: campaign.fee, net: campaign.net, contributors: contributors.map(({ player, contribution, payout }) => ({ player, contribution, payout })), checks }, null, 2));

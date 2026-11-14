# Standalone Expeditions contract

The hosted game uses the unified Arena/GOLD voyage. Follow the [judges guide](../docs/JUDGES-GUIDE.md) for the live player sale and separate Judges Tour rehearsal.

This contract tracks one voyage on a dedicated NEAR account. It uses internal test gold recorded in integer cents. Test gold stays in this contract, with separate balances from the arena and the local workshop.

## Build and test locally

```powershell
cd near-expeditions
cargo build --locked --release --target wasm32-unknown-unknown
node --test test/contract.test.mjs
```

The tests run the compiled WebAssembly exports with a minimal NEAR host. The checks cover signed-account roles, funding, bid reservations, an outbid refund, an expired campaign, a voyage without bids, and settlement. A testnet exercise requires a deployed instance and distinct funded testnet accounts.

## Signed rehearsal on a private NEAR node

On Linux with Node 22 and a compatible glibc (Debian Trixie in Docker was used on Windows), build the WASM as above. From the project root, install the sandbox runner without changing the application's dependency manifest, then run the test:

```sh
npm install --no-save --package-lock=false near-sandbox@0.3.5
node --experimental-sqlite --test near-expeditions/test/sandbox.test.mjs
```

The test starts NEAR Sandbox 2.14.0 on loopback with freshly generated accounts. It deploys two copies of the contract inside the sandbox, verifies the sale and the expired-funding refund, and connects the game server to the private node to verify the winner can claim and equip the cargo once. Transaction hashes from this run belong to the sandbox.

## Initializing a test campaign

The contract account calls `new` once. The configured operator grants each demonstration account 3,000 test gold via `grant_test_gold`. Use distinct accounts for the operator and contract if possible. A function-call key limited to the contract and `grant_test_gold,advance` is sufficient for the operator service. Wallet actions use zero attached deposit.

Example arguments for `new`

```json
{
  "operator": "operator.testnet",
  "funding_ms": 600000,
  "sailing_ms": 15000,
  "auction_ms": 120000,
  "item_type": "pet-expedition-parrot"
}
```

| Method | Arguments | Result |
| --- | --- | --- |
| `campaign` | `{}` | Campaign status, deadlines, highest bid, settlement and treasury. |
| `account` | `{player}` | Balance, contribution limits, next nonce base, payout, refund and award entitlement. |
| `grant_test_gold` | `{player}` | Operator-only grant. A repeated grant returns the account without issuing more gold. |
| `contribute` | `{amount, nonce}` | Reserves the signer’s pledge. Start the nonce at 1. An exact repeat of the latest contribution is safe. |
| `bid` | `{amount}` | Reserves the signer’s bid and releases the previous bidder’s balance. |
| `advance` | `{}` | Permissionless and safe to retry. Finalizes a deadline that has passed. |

## Rules and settlement

- The 300 gold target requires two contributing accounts. The first account can pledge up to 299 gold, leaving a full gold unit for a second account. The maximum is 16 contributors. Each account view returns the current allowable amount range.
- Completing the target credits the pledged test gold to the mercantile treasury and starts the sailing timer. The auction starts at the published timestamp. After a deadline, the view returns `needs_advance` until a transaction finalizes the campaign. Funding expiry returns the pledges. A completed voyage with no bid closes as unsold with zero proceeds.
- The initial bid and the minimum raise are 1 gold. The leading bidder can increase their offer by reserving the difference. The published auction deadline is fixed and a late bid is rejected.
- Settlement consumes the winning reservation, credits a fee of 5% rounded up to cents to the mercantile treasury and divides the rest in proportion to each pledge. Remainder cents go to the largest fractional shares, with first contribution order breaking ties. The contract returns the item entitlement for the winner only after settlement.

## Public testnet evidence after review

Use an authorized, initialized Expeditions account. The rehearsal script checks the RPC network and the campaign before any write. It assumes the operator has already granted test gold. Set `BARREL_EXPEDITIONS_CONTRACT` and the four distinct accounts named by `BARREL_EXPEDITIONS_REHEARSAL_SUPPORTER_A`, `BARREL_EXPEDITIONS_REHEARSAL_SUPPORTER_B`, `BARREL_EXPEDITIONS_REHEARSAL_BIDDER_A` and `BARREL_EXPEDITIONS_REHEARSAL_BIDDER_B`. `BARREL_EXPEDITIONS_RPC` is optional. Run from the project root:

```sh
node near-expeditions/test/rehearse-testnet.mjs
```

The default invocation only reads finalized state. On a dedicated campaign approved for the signed rehearsal, supply the corresponding variables with the `_KEY` suffix and pass `--execute`. The script records transaction hashes and verifies final balances, payouts and the winner's entitlement. Use `--scenario=refund` on a second initialized campaign with a short funding window. The same preparation and execution distinction applies to the refund scenario.

In the 12 November 2026 rehearsal, 0.05 test NEAR per signer was insufficient to prepay a 100 Tgas call. The successful rehearsal used about 0.20 test NEAR available per signer. The authorized contracts held only internal test gold, and no signer used mainnet.

The finalized receipts cover a 2,000 gold sale with 380 and 1,520 paid to contributors, and a separate refund of 60 gold. The game claim test used the sale's public testnet RPC and a local, in-memory game server. [Sale receipt](https://testnet.nearblocks.io/txns/EUcovAY8EkGJcSXSSDX69V3asbU9AFZiJ9P3LT7HLABk) · [Refund receipt](https://testnet.nearblocks.io/txns/42GynvQGiW7L79V7ZuvMLhiaZL6Nvwzp7tWCCuhZLUdA)

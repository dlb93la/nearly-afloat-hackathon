# Arena and GOLD contract

The hosted Arena contract settles paid matches and stores the shared deposited GOLD ledger, inventory, workshop and normal voyages. The fixed-supply NEP-141 token is implemented in `../near-gold`. Amounts in the Arena contract use hundredths of GOLD. Equipment, scrap and treasure are game inventory records.

## Build and test

Install Rust and its `wasm32-unknown-unknown` target. From this directory run:

```sh
cargo build --locked --release --target wasm32-unknown-unknown
node --test test/contract-session.test.mjs
```

The output is `target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm`. Upgrade tests require a separate pre-upgrade WASM supplied with `AFLOAT_PREVIOUS_WASM`. The isolated Judges Tour contract uses the `judges-demo` feature. Build that variant separately and set `AFLOAT_JUDGES_WASM` to its WASM before running `node --test test/judges-demo.test.mjs`.

The signed local rehearsal uses NEAR Sandbox on Linux. After building the standard WASM, run these commands from the repository root:

```sh
npm install --no-save --package-lock=false near-sandbox@0.3.5
node --test near-arena/test/sandbox.test.mjs
```

The rehearsal creates disposable keys and covers equipment, auction settlement, award equip, arena settlement and cancellation.

## Hosted flow

- The game server decides the last barrel afloat. A scoped referee key reserves and settles the round, or cancels it and restores the entry. Signed-in solo players start after a server balance check. Chain authorization, reservation and settlement proceed in the background. A paid result requires a confirmed reservation.
- A finalized settlement consumes a use from equipped commercial gear. Cancellation restores the entry and preserves its use. The Cottage Logbook displays finalized activity and available receipts.
- The normal voyage follows on-chain deadlines. It starts sailing when funding and the minimum crew size are met. The highest bidder owns the cargo and the net sale proceeds go to contributors in proportion to their pledges.
- Social sign-in uses an embedded wallet and a scoped session key. Sign-out ends the game session. The account and spending permissions have separate lifetimes.

See the [shared GOLD deployment and evidence](../docs/JUDGES-GUIDE.md) for configuration, the supported UI path, and public receipts. The standalone contract in [near-expeditions](../near-expeditions/README.md) is an implementation reference for the earlier separate ledger.

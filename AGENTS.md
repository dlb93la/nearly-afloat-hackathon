# Reviewing NEARly Afloat

Start with [README.md](README.md) for the supported gameplay routes and [the judges' guide](docs/JUDGES-GUIDE.md) for evidence and expected outcomes. The project has a credential-free local mode and a hosted testnet mode.

1. From the repository root with Node.js 22.22.2 or newer, run `npm ci`, `npm test`, and `npm run build`.
2. Run `npm start` and open `http://127.0.0.1:4182/` in a browser with WebGL. In Arena Pier, select Training, confirm the controls if shown, and finish a round. Expect one winner and a return to the bay.
3. Use the hosted demo for Google or email sign-in and the testnet Workshop, Cottage and Plunder Pot. Check the displayed entry price before accepting any paid round. The testnet balance uses GOLD and the local mode uses a separate SQLite ledger.
4. For a read-only chain check, run `node scripts/verify-gold-agent-evidence.mjs` and `node scripts/verify-judges-expedition.mjs`. Compare the contract, transaction and payout evidence to the applicable track in the judges' guide.

The normal voyage has a recorded player sale. The Judges Tour voyage is an isolated, interactive testnet rehearsal. The merchant agent is rule-based and its evidence comes from an isolated testnet run under scripted demand. The buy and sell cycle cost 2.51 GOLD. Use these distinctions when reporting findings.

Report each issue with a severity, reproduction steps, exact source path or receipt, and the expected and observed behavior. Record the hosted build from `/build-info.json` for browser findings. Use the checkout commands above for a reproducibility check. Treat provider throttling and authentication failures as separate observations from code failures.

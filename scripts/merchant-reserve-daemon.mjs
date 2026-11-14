import { loadMerchantAgent } from '../merchant-agent.mjs';
import { writeAgentFile } from '../agent-journal.mjs';

const agent = await loadMerchantAgent();
const statusPath = process.env.AFLOAT_AGENT_STATUS;
if (!agent || !statusPath) throw new Error('Limited agent and status path required');
let running = false;

async function cycle() {
  if (running) return;
  running = true;
  try {
    await agent.tick();
    const { account, contract, policy, balance, last, lastTrade, blockHash, blockHeight, unresolved } = await agent.snapshot();
    await writeAgentFile(statusPath, { account, contract, policy, balance, last, lastTrade,
      blockHash, blockHeight, unresolved, status: unresolved ? 'pending' : 'current', at: Date.now() });
  } catch {
    console.warn('Reserve cycle unavailable. Pending transactions stay in its private journal.');
  } finally { running = false; }
}
await cycle();
setInterval(cycle, 60_000);

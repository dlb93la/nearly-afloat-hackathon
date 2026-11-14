import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { ARENA_ENTRY, EconomyError, openEconomy } from './economy.mjs';
import { wagerBand } from './shared/arena-entry.mjs';
import { loadNearArena, nearRoundId } from './near-arena.mjs';
import { loadNearExpeditions } from './near-expeditions.mjs';
import { loadNearSocial } from './near-social.mjs';
import { loadNearSocialActions } from './near-social-actions.mjs';
import { loadNearEmbedded } from './near-embedded.mjs';
import { loadJudgesExpedition } from './judges-expedition.mjs';
import { isRpcReadBackoff } from './near-rpc-reads.mjs';
import { FIRST_BRAWL_RIGS } from './shared/rigs.mjs';
import { loadDeployment, requestHasSameOrigin } from './deployment-config.mjs';
import {
  MAX_PLAYERS, TICK_RATE, createDrill, createMatch, emotePlayer, forfeitPlayer, readMatch, stepMatch,
} from './shared/simulation.mjs';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
const deployment = loadDeployment();
const port = Number(process.env.PORT ?? 4182);
const host = process.env.HOST || '127.0.0.1';
const step = 1 / TICK_RATE;
const reconnectWindow = 8_000;
const idleWindow = 20 * 60_000;
const staleInput = 400;
const maxRooms = 64;
const maxClients = 160;
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const botNames = ['Captain Cork', 'Barnacle Bea', 'Tin Tom', 'Knot Ned', 'Black Brine', 'Old Clank', 'Salt Sally'];
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
};

const rooms = new Map();
const idleSteering = { x: 0, z: 0 };
const sockets = new WebSocketServer({ noServer: true, maxPayload: 4_096 });
const economyPath = process.env.BARREL_DB ?? fileURLToPath(new URL('./data/economy.sqlite', import.meta.url));
if (economyPath !== ':memory:') mkdirSync(dirname(economyPath), { recursive: true });
const near = loadNearArena();
const judgesExpedition = loadJudgesExpedition();
const nearExpeditions = loadNearExpeditions(process.env, near);
const unifiedEconomy = Boolean(near?.hasStarter && near.hasCollection && nearExpeditions?.unified);
const socialActions = near?.hasStarter && process.env.BARREL_NEAR_SOCIAL === '1'
  ? loadNearSocialActions(process.env, near.contract) : null;
const economy = openEconomy(economyPath, Date.now, unifiedEconomy ? { starterGold: 0 } : undefined);
const nearSocial = near?.hasStarter && process.env.BARREL_NEAR_SOCIAL === '1'
  ? loadNearSocial(process.env, { actions: socialActions, remembered: economy.rememberedLogins,
    accountHint: profile => {
      const reward = economy.wallet(profile)?.firstBrawl;
      return reward?.contract === near.contract ? reward.wallet : null;
    },
    onError: phase => console.warn('NEAR Auth sign-in failed during ' + phase + '.') }) : null;
const nearEmbedded = nearSocial ? loadNearEmbedded(process.env, { social: nearSocial, actions: socialActions,
  bindIdentity: (identity, account) => economy.bindEmbeddedIdentity(identity, account),
  accountHint: profile => {
    const reward = economy.wallet(profile)?.firstBrawl;
    return reward?.contract === near.contract ? reward.wallet : null;
  },
  onError: phase => console.warn('Embedded sign-in failed during ' + phase + '.') }) : null;
if (!unifiedEconomy) economy.openExpedition();
economy.sweep();
const activeNear = new Set();
const nearJobs = new Set();
const nearWalletReads = new Map();
const nearSnapshotClock = new Map();
const nearSnapshots = new Map();
const nearEntryQueues = new Map();
let nearReadClock = 0;
// A restart retains reservations whose RPC acknowledgement may have been lost.
const recoveredNearHolds = new Map(economy.nearRounds().filter(([, intent]) => intent.contract === near?.contract)
  .map(([id, intent]) => [id, new Set(intent.holdPlayers ?? [])]));
function heldNearGold(account) {
  let held = 0;
  for (const job of nearJobs) if (job.holds.has(account)) held += ARENA_ENTRY;
  for (const players of recoveredNearHolds.values()) if (players.has(account)) held += ARENA_ENTRY;
  return held;
}
function spendableNearGold(peer) {
  return Math.max(0, (nearSnapshots.get(peer.nearAccount)?.gold ?? peer.nearWorkshop?.gold ?? 0) - heldNearGold(peer.nearAccount));
}
function publishNearBalance(peer) {
  if (!peer.nearAccount || (!peer.nearWorkshop && !peer.nearBalanceLoading)) return;
  send(peer.socket, { type: 'near-wallet', account: peer.nearAccount,
    gold: peer.nearBalanceLoading ? null : spendableNearGold(peer),
    ...(peer.nearBalanceLoading ? { balanceLoading: true } : {}),
    social: peer.nearSocialAccount === peer.nearAccount, embedded: peer.nearEmbeddedWallet === true,
    ...(peer.nearSigningReady === false ? { signingReady: false } : {}), appearance: peer.nearAppearance ?? {} });
}
function cacheNearSnapshot(account, gold, view, readAt) {
  if (readAt < (nearSnapshotClock.get(account) ?? 0)) return false;
  nearSnapshotClock.set(account, readAt);
  nearSnapshots.set(account, { gold, view });
  for (const socket of sockets.clients) if (socket.peer?.nearAccount === account) {
    socket.peer.nearWorkshop = view?.workshop ?? { ...socket.peer.nearWorkshop, gold };
    if (view) socket.peer.nearAppearance = view.collection?.equipped ?? {};
  }
  return true;
}

function loadSignedInBalance(peer, session) {
  clearTimeout(peer.nearBalanceRetry);
  const load = { account: session.account, session, attempts: 0 };
  peer.nearBalanceLoad = load;
  peer.nearBalanceLoading = true;
  publishNearBalance(peer);
  async function attempt() {
    if (peer.nearBalanceLoad !== load || peer.nearAccount !== load.account || peer.socket.readyState !== WebSocket.OPEN) return;
    try {
      await near.ensureAccount(load.account);
      const readAt = ++nearReadClock;
      const view = await near.workshop(load.account);
      if (peer.nearBalanceLoad !== load || peer.nearAccount !== load.account || peer.socket.readyState !== WebSocket.OPEN) return;
      peer.nearWorkshop = view.workshop;
      peer.nearAppearance = view.collection?.equipped ?? {};
      cacheNearSnapshot(load.account, view.workshop.gold, view, readAt);
      await restoreFirstBrawl(peer, load.account, view);
      peer.nearBalanceLoading = false;
      walletUpdate(peer);
      publishNearBalance(peer);
      const starter = peer.deferredStarter;
      peer.deferredStarter = null;
      if (starter) void onMessage(peer, Buffer.from(JSON.stringify({ type: 'first-brawl-claim', rig: starter })), false)
        .catch(() => send(peer.socket, { type: 'first-brawl-error', message: 'Your starter is still available. Try again.' }));
    } catch (error) {
      if (peer.nearBalanceLoad !== load || peer.nearAccount !== load.account || peer.socket.readyState !== WebSocket.OPEN) return;
      load.attempts++;
      const retry = isRpcReadBackoff(error) ? error.retryAfterMs : Math.min(60_000, 2000 * 2 ** Math.min(load.attempts, 5));
      peer.nearBalanceRetry = setTimeout(attempt, Math.max(1000, retry));
      peer.nearBalanceRetry.unref?.();
    }
  }
  void attempt();
}
const accountCookie = 'barrel_bay_gold';

const http = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  if (deployment.production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  let pathname;
  let requestUrl;
  try {
    requestUrl = new URL(request.url, 'http://localhost');
    pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.includes('\0')) throw new URIError('Null path');
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (pathname === '/progress-code' || pathname === '/restore-progress') {
    await handleProgressRequest(request, response, pathname);
    return;
  }
  if (pathname === '/judges-expedition/state' || pathname === '/judges-expedition/action') {
    const headers = { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' };
    if (!judgesExpedition) return response.writeHead(503, headers).end(JSON.stringify({ available: false }));
    try {
      if (pathname.endsWith('/state') && request.method === 'GET') {
        return response.writeHead(200, headers).end(JSON.stringify(await judgesExpedition.snapshot()));
      }
      if (!pathname.endsWith('/action') || request.method !== 'POST' || !request.headers.origin || !sameOrigin(request) ||
          request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(403, headers).end('{}');
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) return response.writeHead(413, headers).end('{}');
      }
      const result = await judgesExpedition.act(JSON.parse(body));
      return response.writeHead(200, headers).end(JSON.stringify(result));
    } catch (error) {
      if (isRpcReadBackoff(error)) return response.writeHead(503, { ...headers,
        'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) }).end(JSON.stringify({
        message: error.message, retryAfterMs: error.retryAfterMs }));
      const safe = /^(Invalid rehearsal|Another judge|Previous action|This rehearsal|Invalid stage|Finish the current|Choose a demo|This crew|Funding target|Bid must|Not enough demo|Only the winning|Confirmation pending|The testnet rejected)/.test(error.message);
      return response.writeHead(409, headers).end(JSON.stringify({ message: safe ? error.message : 'Testnet confirmation is unavailable. Retry the same action shortly.' }));
    }
  }
  if (nearEmbedded && ['/near-social/embedded/prepare', '/near-social/embedded/complete', '/near-social/embedded/restart'].includes(pathname)) {
    if (request.method !== 'POST' || request.headers.origin !== nearSocial.origin || !sameOrigin(request)) {
      return response.writeHead(403).end();
    }
    const profile = economy.findAccount(cookieToken(request));
    if (!profile) return response.writeHead(403).end();
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 40_960) return response.writeHead(413).end();
      }
      await nearEmbedded.handle(request, response, profile, pathname, JSON.parse(body));
    } catch { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); }
    return;
  }
  if (nearSocial && (pathname === '/near-social/action' || pathname === '/near-social/logout')) {
    await handleSocialRequest(request, response, pathname);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (pathname === '/gold-wallet' && request.method === 'GET') {
    const headers = { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' };
    if (!near || process.env.BARREL_GOLD_WALLET !== '1' || !sameOrigin(request)) {
      return response.writeHead(404, headers).end('{}');
    }
    try {
      const wallet = await near.goldWallet(requestUrl.searchParams.get('account'));
      if (!wallet) return response.writeHead(404, headers).end('{}');
      return response.writeHead(200, headers).end(JSON.stringify({ ...wallet, embedded: nearEmbedded?.publicConfig }));
    } catch {
      return response.writeHead(503, headers).end(JSON.stringify({ message: 'GOLD balances are temporarily unavailable.' }));
    }
  }
  if (nearSocial && request.method === 'GET') {
    if (nearEmbedded && pathname === '/near-social/embedded/config') {
      if (!sameOrigin(request)) return response.writeHead(403).end();
      nearEmbedded.config(request, response, economy.findAccount(cookieToken(request)), requestUrl.searchParams.get('state'));
      return;
    }
    if (pathname === nearSocial.callbackPath && requestUrl.searchParams.has('state') &&
        (requestUrl.searchParams.has('code') || requestUrl.searchParams.has('error'))) {
      await nearSocial.finish(request, response, requestUrl.searchParams);
      return;
    }
    if (pathname === '/near-social/start' || pathname === '/near-social/session') {
      if (!sameOrigin(request)) return response.writeHead(403).end();
      const profile = economy.findAccount(cookieToken(request));
      if (pathname.endsWith('/start')) {
        const provider = nearEmbedded && requestUrl.searchParams.get('provider') !== 'near-auth' ? nearEmbedded : nearSocial;
        const flow = requestUrl.searchParams.get('flow');
        if (provider === nearEmbedded) await provider.start(request, response, profile, flow);
        else await provider.start(request, response, profile, flow, requestUrl.searchParams.get('renew') === '1');
      }
      else nearSocial.issue(request, response, profile);
      return;
    }
  }
  if (pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ok: true }));
    return;
  }
  if (pathname === '/playtest-session') {
    if (request.method !== 'GET' || !sameOrigin(request) || request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403).end();
      return;
    }
    try {
      const headers = { 'Cache-Control': 'no-store' };
      if (!economy.findAccount(cookieToken(request))) {
        headers['Set-Cookie'] = profileCookie(economy.createAccount());
      }
      response.writeHead(204, headers).end();
    } catch (error) {
      console.error('Test wallet setup failed.', error);
      response.writeHead(503).end();
    }
    return;
  }
  const file = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  const fromDist = relative(dist, file);
  if (fromDist === '..' || fromDist.startsWith(`..${sep}`) || isAbsolute(fromDist)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    const index = pathname === '/';
    response.writeHead(index ? 503 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(index ? 'Build the arena with npm run build first.' : 'File not found.');
  }
});

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256_000) {
    socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }
}

function fail(peer, message) {
  send(peer.socket, { type: 'error', message });
}

function cookieToken(request) {
  const prefix = accountCookie + '=';
  return request.headers.cookie?.split(';').map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
}

function profileCookie(token) {
  return accountCookie + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000' +
    (deployment.production ? '; Secure' : '');
}

async function handleSocialRequest(request, response, pathname) {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': types['.json'] };
  if (request.method !== 'POST') return response.writeHead(405, { ...headers, Allow: 'POST' }).end();
  if (request.headers.origin !== nearSocial.origin || !sameOrigin(request)) return response.writeHead(403, headers).end();
  const profile = economy.findAccount(cookieToken(request));
  if (!profile) return response.writeHead(403, headers).end();
  if (pathname === '/near-social/logout') {
    nearSocial.logout(request, response, profile);
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4096) return response.writeHead(413, headers).end();
    }
    const result = await nearSocial.authorizeRequest(request, profile, JSON.parse(body));
    response.writeHead(200, headers).end(JSON.stringify({ transaction: { hash: result.transaction?.hash },
      status: result.status?.Failure ? { Failure: true } : result.status,
      final_execution_status: result.final_execution_status }));
  } catch (error) {
    const allowed = ['Sign in again to authorize your game session.', 'Sign in again to continue.',
      'Sign in again to renew your game session.', 'This exceeds your remaining session limit.'];
    const message = allowed.includes(error?.message) ? error.message : 'Could not submit the game action.';
    response.writeHead(400, headers).end(JSON.stringify({ message }));
  }
}

async function handleProgressRequest(request, response, pathname) {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': types['.json'] };
  if (request.method !== 'POST') {
    response.writeHead(405, { ...headers, Allow: 'POST' }).end();
    return;
  }
  if (!request.headers.origin || !sameOrigin(request) || request.headers['sec-fetch-site'] === 'cross-site') {
    response.writeHead(403, headers).end(JSON.stringify({ message: 'Open this action from the game.' }));
    return;
  }
  try {
    const id = economy.findAccount(cookieToken(request));
    if (pathname === '/progress-code') {
      const code = economy.issueProgressCode(id);
      response.writeHead(200, headers).end(JSON.stringify({ code }));
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 256) {
        response.writeHead(413, headers).end(JSON.stringify({ message: 'Progress code is too long.' }));
        return;
      }
    }
    const token = economy.restoreProgress(JSON.parse(body)?.code, id);
    response.writeHead(200, { ...headers, 'Set-Cookie': profileCookie(token) }).end('{}');
  } catch (error) {
    const invalid = error instanceof EconomyError || error instanceof SyntaxError;
    if (!invalid) console.error('Could not update the local profile.', error);
    response.writeHead(invalid ? 400 : 503, headers)
      .end(JSON.stringify({ message: invalid && error instanceof EconomyError ? error.message : 'Could not update your profile.' }));
  }
}

function walletUpdate(peer) {
  if (!peer?.accountId) return;
  const wallet = economy.wallet(peer.accountId);
  if (unifiedEconomy) {
    wallet.gold = 0;
    wallet.treasury = 0;
    wallet.botBank = 0;
    wallet.expeditions = null;
    wallet.workshop = { appearance: {}, inventory: [], stock: [], market: [], scrap: 0 };
    wallet.vault = null;
    wallet.raid = null;
    wallet.rig = 'oak';
  }
  if (near?.hasStarter && peer.nearWorkshop && peer.nearAccount) wallet.rig = peer.nearWorkshop.equipped;
  send(peer.socket, { type: 'wallet', ...wallet });
}

function updateWallets() {
  for (const socket of sockets.clients) walletUpdate(socket.peer);
}

async function refreshNearExpedition(peer, hash) {
  // A slow RPC response must still reach the browser when a newer poll arrives.
  // Discarding every older request starves the UI whenever RPC latency exceeds the poll interval.
  if (peer.expeditionViewBusy) return;
  peer.expeditionViewBusy = true;
  const account = (nearExpeditions.unified ? peer.nearAccount : peer.expeditionNearAccount) ?? null;
  const readAt = ++nearReadClock;
  try {
    const known = peer.expeditionReceipt;
    const transactionStatus = nearExpeditions.unified && account && hash
      ? known?.account === account && known.hash === hash ? known.status
        : await near.transactionStatus(account, hash, ['contribute', 'bid', 'advance', 'equip_voyage_award']) : undefined;
    if (['finalized', 'failed'].includes(transactionStatus)) peer.expeditionReceipt = { account, hash, status: transactionStatus };
    const state = await nearExpeditions.read(account, { fresh: transactionStatus === 'finalized'
      && !(known?.account === account && known.hash === hash && known.status === 'finalized') });
    if (transactionStatus === 'finalized') {
      economy.rememberNearReceipt(near.contract, [account], hash, 'Expeditions receipt');
    }
    if (account !== ((nearExpeditions.unified ? peer.nearAccount : peer.expeditionNearAccount) ?? null)) return;
    const claimed = !nearExpeditions.unified && Boolean(state.campaign.won
      && economy.hasNearExpeditionClaim(peer.accountId, nearExpeditions.contract));
    send(peer.socket, { type: 'expedition-chain-view', ...state, claimed,
      ...(transactionStatus ? { transactionStatus, transactionHash: hash } : {}) });
    if (nearExpeditions.unified && account && account === peer.nearAccount) {
      cacheNearSnapshot(account, state.gold, null, readAt);
      publishNearBalance(peer);
    }
  } finally { peer.expeditionViewBusy = false; }
}

async function onExpeditionMessage(peer, message) {
  const { type, actionId } = message;
  if (type !== 'expedition-chain-view' && (typeof actionId !== 'string' || actionId.length > 64)) return;
  const result = (ok, message) => send(peer.socket, { type: 'expedition-result', actionId, ok, message });
  try {
    if (!peer.accountId || peer.room) throw new EconomyError('Visit Expeditions from the bay.');
    if (type === 'expedition-contribute' || type === 'expedition-bid') {
      if (nearExpeditions?.unified) throw new EconomyError('Use the shared NEAR gold for Expeditions.');
      economy.expeditionAction(peer.accountId, message);
      updateWallets();
      result(true, type === 'expedition-contribute' ? 'Contribution confirmed.' : 'Bid confirmed.');
      return;
    }
    if (!nearExpeditions) throw new EconomyError('NEAR Expeditions is unavailable on this server.');
    switch (type) {
      case 'expedition-chain-view':
        await refreshNearExpedition(peer, message.transactionHash);
        break;
      case 'expedition-chain-challenge': {
        if (peer.expeditionAuthenticating) throw new EconomyError('An account connection is already pending.');
        const proof = nearExpeditions.challenge(message.account);
        peer.expeditionChallenge = proof;
        send(peer.socket, { type: 'expedition-chain-challenge', actionId, ...proof });
        break;
      }
      case 'expedition-chain-auth': {
        if (peer.expeditionAuthenticating) throw new EconomyError('An account connection is already pending.');
        const proof = peer.expeditionChallenge;
        peer.expeditionChallenge = null;
        peer.expeditionAuthenticating = true;
        try {
          peer.expeditionNearAccount = await nearExpeditions.authenticate(proof, message);
          if (nearExpeditions.unified) peer.nearAccount = peer.expeditionNearAccount;
          await refreshNearExpedition(peer);
          result(true, 'Account connected.');
        } finally {
          peer.expeditionAuthenticating = false;
        }
        break;
      }
      case 'expedition-chain-claim': {
        if (nearExpeditions.unified) throw new EconomyError('Equip the cargo with the account that won it.');
        if (!peer.expeditionNearAccount) throw new EconomyError('Sign in to the account that won the cargo.');
        const state = await nearExpeditions.read(peer.expeditionNearAccount);
        if (!state.campaign.won) throw new EconomyError('This account has not been confirmed as the cargo winner.');
        economy.claimNearExpedition(peer.accountId, nearExpeditions.contract);
        walletUpdate(peer);
        await refreshNearExpedition(peer);
        result(true, 'Cargo delivered to Your Cottage.');
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof EconomyError) && !isRpcReadBackoff(error)) console.error('Expedition request failed.', error);
    if (type === 'expedition-contribute' || type === 'expedition-bid') walletUpdate(peer);
    const detail = error instanceof EconomyError || isRpcReadBackoff(error) ? error.message : 'Expeditions could not confirm the action. Try again.';
    if (type === 'expedition-chain-view') send(peer.socket, { type: 'expedition-view-error', message: detail,
      ...(isRpcReadBackoff(error) ? { retryAfterMs: error.retryAfterMs } : {}) });
    else result(false, detail);
  }
}

function canConnectNear(peer) {
  return !peer.room || (near?.hasStarter && ['practice', 'tutorial', 'fun', 'room'].includes(peer.room.kind) && peer.room.phase === 'results');
}

async function restoreFirstBrawl(peer, account, view) {
  if (!near?.hasStarter || !peer.accountId || peer.nearAccount !== account) return;
  economy.useStarterAccount(peer.accountId, account);
  const claimed = economy.wallet(peer.accountId)?.firstBrawl;
  if (claimed?.status === 'ready' || claimed?.status === 'claimed') economy.rememberPirateMatch(account);
  if (!claimed && economy.hasPirateMatch(account)) economy.completeFirstBrawl(peer.accountId);
  if (claimed?.status === 'claimed' && claimed.wallet === account && claimed.contract === near.contract) return;
  const rig = view?.workshop?.items?.find(item => item.starter)?.rig
    ?? (typeof near.firstBrawlReward === 'function' ? await near.firstBrawlReward(account) : null);
  if (peer.nearAccount === account && rig) economy.restoreNearFirstBrawl(peer.accountId, account, rig, near.contract);
}

async function refreshNearWallet(peer) {
  const account = peer.nearAccount;
  if (!near || !account || peer.socket.readyState !== WebSocket.OPEN) return;
  if (nearWalletReads.has(account)) {
    await nearWalletReads.get(account);
    publishNearBalance(peer);
    return;
  }
  const reading = readNearWallet(account);
  nearWalletReads.set(account, reading);
  try { await reading; }
  finally { if (nearWalletReads.get(account) === reading) nearWalletReads.delete(account); }
}

async function readNearWallet(account) {
  const acknowledged = [...nearJobs].filter(job => job.reserved && job.holds.has(account));
  const readAt = ++nearReadClock;
  const view = near.hasCollection ? await near.workshop(account) : null;
  const gold = view ? view.workshop.gold : await near.balance(account);
  if (!cacheNearSnapshot(account, gold, view, readAt)) return;
  // Publish a single account snapshot to all tabs before removing its local hold.
  // Otherwise another tab could keep a pre-reservation balance and spend it twice.
  for (const job of acknowledged) {
    job.holds.delete(account);
    if (!job.done) rememberNearJob(job);
  }
  for (const socket of sockets.clients) if (socket.peer?.nearAccount === account) {
    publishNearBalance(socket.peer);
  }
  pruneNearJobs();
}

function updateNearWallets(accounts) {
  const affected = accounts ? new Set(accounts) : null;
  for (const socket of sockets.clients) {
    if (!affected || affected.has(socket.peer?.nearAccount)) refreshNearWallet(socket.peer).catch(() => {});
  }
}

function sameOrigin(request) {
  return requestHasSameOrigin(request, deployment);
}

http.on('upgrade', (request, socket, head) => {
  if (request.url?.split('?')[0] !== '/arena' || !sameOrigin(request) ||
      (deployment.production && !request.headers.origin)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  if (sockets.clients.size >= maxClients) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client, request));
});

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  if (typeof name !== 'string') return 'Deckhand';
  return [...name.replace(/\p{C}/gu, '').trim().replace(/\s+/g, ' ')].slice(0, 20).join('') || 'Deckhand';
}

function sendPirateProfile(peer) {
  if (peer.nearAccount) send(peer.socket, { type: 'pirate-profile', account: peer.nearAccount, ...economy.pirateProfile(peer.nearAccount) });
}

function publicMember(member) {
  return { id: member.id, name: member.name, slot: member.slot, bot: false, connected: Boolean(member.peer),
    appearance: member.appearance,
    ...(member.wager ? { wager: member.wager } : {}) };
}

function publicState(room) {
  const preview = room.nearWarmup;
  const match = preview ? { ...preview.match, phase: 'preparing', seconds: 0 }
    : room.match ? readMatch(room.match) : null;
  const phase = match?.phase ?? 'lobby';
  room.phase = phase;
  const active = phase === 'preparing' || phase === 'countdown' || phase === 'playing';
  const humans = [...room.members.values()].map(publicMember);
  const roster = active ? (preview?.roster ?? room.matchRoster).map(({ nearAccount, ...entry }) => ({
    ...entry, connected: entry.bot || Boolean(room.members.get(entry.id)?.peer),
  })) : humans;
  const onChain = room.kind === 'near';
  const stake = room.kind === 'stakes' || onChain ? {
    entry: onChain ? ARENA_ENTRY : room.entry,
    ...(!onChain ? { band: wagerBand(room.entry) } : {}),
    ready: [...room.members.values()].filter((member) => member.peer &&
      (onChain ? member.nearReadyUntil > Date.now() : member.stakeReady)).map((member) => member.id),
    round: preview ? null : room.stakeRound ?? null,
    ...(preview ? { warmingUp: true } : {}),
    ...(onChain ? { network: 'testnet', receiptNetwork: near.receiptNetwork, chainId: room.nextNearId,
      processing: Boolean(room.chainBusy), pendingEntry: Boolean(room.nearJob && !room.nearJob.reserved && !room.nearJob.done) } : {}),
    ...(onChain && room.nearSessionScope ? {
      sessionScope: room.nearSessionScope,
      sessionReady: [...room.members.values()].filter(member => member.peer &&
        member.nearReadyMode === 'session' && member.nearReadyUntil > Date.now()).map(member => member.id),
    } : {}),
  } : null;
  return { type: 'state', code: room.code, kind: room.kind, hostId: room.hostId, phase,
    roster, match, stake, round: room.round + (preview ? 1 : 0),
    ...(room.kind === 'practice' && room.trainingSpeed === 3 ? { trainingSpeed: 3 } : {}),
    ...(room.kind === 'fun' && room.phase === 'lobby' ? { startsAt: room.startsAt } : {}) };
}

function broadcast(room) {
  if (!rooms.has(room.code)) return;
  const message = JSON.stringify(publicState(room));
  for (const member of room.members.values()) {
    if (member.peer) send(member.peer.socket, message);
  }
}

function announceMember(peer) {
  const { room, member } = peer;
  send(peer.socket, { type: 'welcome', id: member.id, code: room.code, resumeToken: member.resumeToken });
}

function assignHost(room) {
  if (room.members.get(room.hostId)?.peer) return;
  room.hostId = [...room.members.values()].find((member) => member.peer)?.id ?? null;
}

function closeStake(room) {
  if (room.kind === 'near' && room.nearJob) {
    closeNearJob(room.nearJob);
    return;
  }
  if (!room.reservation || (!room.cancelStake && room.match?.phase !== 'results')) return;
  if (room.kind === 'near') {
    if (!room.chainBusy && (room.retryNearAt ?? 0) <= Date.now()) void finishNearRound(room);
    return;
  }
  try {
    room.stakeRound = economy.finishRound(room.reservation, room.cancelStake ? null : room.match.winnerId);
    room.reservation = null;
    room.cancelStake = false;
    if (room.stakeRound.status === 'cancelled') {
      room.match = null;
      room.matchRoster = [];
    }
    updateWallets();
  } catch (error) {
    console.error('Could not close the gold reservation. It remains eligible for retry or expiry.', error);
  }
}

function syncNearJob(job) {
  const room = job.room;
  if (room.nearJob !== job) return;
  room.reservation = job.done ? null : job.id;
  room.chainBusy = job.chainBusy;
  room.cancelStake = job.cancelStake;
  room.stakeRound = job.stakeRound;
}

function publishNearJob(job) {
  syncNearJob(job);
  if (job.room.nearJob === job) broadcast(job.room);
}

function pruneNearJobs() {
  for (const job of nearJobs) if (job.done && !job.holds.size) nearJobs.delete(job);
}

function closeNearJob(job) {
  if (job.done) return;
  if (job.room.nearJob === job && job.room.cancelStake) job.cancelStake = true;
  if (!job.cancelStake && job.match?.phase !== 'results') return;
  const winner = job.roster.find(player => player.id === job.match?.winnerId);
  job.intent = job.cancelStake ? { action: 'cancel' } : { action: 'settle', winner: winner?.nearAccount ?? null };
  const key = JSON.stringify(job.intent);
  if (job.intentKey !== key) {
    job.intentKey = key;
    rememberNearJob(job);
  }
  if (!job.chainBusy && job.retryAt <= Date.now()) void finishNearJob(job);
}

function rememberNearJob(job) {
  economy.rememberNearRound(job.id, { ...(job.intent ?? { action: 'cancel' }), contract: near.contract,
    holdPlayers: [...job.holds] });
}

async function finishNearJob(job) {
  job.chainBusy = 'finish';
  publishNearJob(job);
  try {
    const receipt = await near.finish(job.id, job.intent);
    if (!receipt.round) {
      if (Date.now() - job.startedAt < 300_000) throw new Error('Receipt is pending.');
      // A conservative grace period covers an RPC response lost during submit.
      job.stakeRound = { status: 'cancelled', paid: 0 };
    } else {
      if (receipt.round.status === 'reserved') throw new Error('Receipt is pending.');
      economy.rememberNearReceipt(near.contract, receipt.round.players ?? job.players, receipt.hash,
        receipt.round.status === 'cancelled' ? 'Arena refund' : 'Arena settlement');
      job.stakeRound = nearReceipt(receipt, job.roster, job.match?.winnerId);
    }
    job.done = true;
    job.reserved = true;
    economy.forgetNearRound(job.id);
    activeNear.delete(job.id);
    updateNearWallets(job.players);
  } catch {
    job.retryAt = Date.now() + 2_000;
  } finally {
    job.chainBusy = null;
    publishNearJob(job);
    pruneNearJobs();
  }
}

function nearReceipt(receipt, players, previous) {
  const { round, hash } = receipt;
  return {
    status: round.status, expiresAt: round.expires_at, pot: round.pot, fee: round.fee,
    bonus: round.bonus, paid: round.paid, winnerId: round.winner
      ? players.find(player => player.nearAccount === round.winner)?.id ?? null
      : round.status === 'settled' ? previous : null,
    chainHash: hash,
  };
}

async function finishNearRound(room) {
  const id = room.reservation;
  const winnerId = room.match?.winnerId;
  const winner = room.matchRoster.find(player => player.id === winnerId);
  const intent = room.cancelStake ? { action: 'cancel' }
    : { action: 'settle', winner: winner?.nearAccount ?? null };
  room.chainBusy = 'finish';
  broadcast(room);
  try {
    economy.rememberNearRound(id, { ...intent, contract: near.contract, retryAfter: Date.now() + 12_000 });
    const receipt = await near.finish(id, intent);
    if (!receipt.round || receipt.round.status === 'reserved') throw new Error('NEAR receipt is pending.');
    economy.rememberNearReceipt(near.contract, receipt.round.players ?? [], receipt.hash,
      receipt.round.status === 'cancelled' ? 'Arena refund' : 'Arena settlement');
    room.stakeRound = nearReceipt(receipt, room.matchRoster, winnerId);
    room.reservation = null;
    room.cancelStake = false;
    if (receipt.round.status === 'cancelled') {
      room.match = null;
      room.matchRoster = [];
    }
    economy.forgetNearRound(id);
    updateNearWallets(receipt.round.players ?? room.matchRoster.map(player => player.nearAccount).filter(Boolean));
  } catch {
    room.retryNearAt = Date.now() + 2000;
  } finally {
    room.chainBusy = null;
    if (!room.reservation || !rooms.has(room.code)) activeNear.delete(id);
    broadcast(room);
  }
}

function removeMember(room, member) {
  room.members.delete(member.id);
  room.inputs.delete(member.id);
  if (room.match && room.match.phase !== 'results') {
    if (room.reservation && (room.match.phase === 'countdown' || !room.members.size)) room.cancelStake = true;
    else forfeitPlayer(room.match, member.id);
  }
  closeStake(room);
  assignHost(room);
  if (!room.members.size) rooms.delete(room.code);
}

function detach(peer, allowResume) {
  const { room, member } = peer;
  peer.room = null;
  peer.member = null;
  if (!room || !member || member.peer !== peer) return;
  member.peer = null;
  room.inputs.delete(member.id);
  room.lastActivity = Date.now();
  if (allowResume) {
    member.disconnectedAt = room.lastActivity;
    assignHost(room);
  } else {
    removeMember(room, member);
  }
  broadcast(room);
}

function attach(peer, room, name, wager) {
  const occupied = new Set([...room.members.values()].map((member) => member.slot));
  let slot = 0;
  while (occupied.has(slot)) slot++;
  const member = { id: randomUUID(), resumeToken: randomUUID(), name: peer.nearAccount ? economy.pirateProfile(peer.nearAccount).name : cleanName(name), slot,
    peer, accountId: peer.accountId, nearAccount: room.kind === 'near' ? peer.nearAccount : null,
    rewardAccount: peer.nearAccount,
    appearance: economy.appearance(peer.accountId),
    wager, stakeReady: false, disconnectedAt: 0, lastInputAt: 0 };
  room.members.set(member.id, member);
  room.lastActivity = Date.now();
  peer.room = room;
  peer.member = member;
  assignHost(room);
  announceMember(peer);
}

function start(room, slots, peer, autoAuthorize = false) {
  if ((room.reservation || room.chainBusy) && !(room.kind === 'near' && room.nearJob && room.match?.phase === 'results')) {
    fail(peer, 'Wait for the previous gold reservation to close.');
    return;
  }
  // Any disconnected participant can rejoin in the next lobby. The new roster only
  // includes connected members so the next round can never start with a ghost slot.
  for (const member of room.members.values()) {
    if (!member.peer) removeMember(room, member);
  }
  const humans = [...room.members.values()].sort((a, b) => a.slot - b.slot);
  let size = Math.max(humans.length, [6, 7, 8].includes(slots) ? slots : MAX_PLAYERS);
  if (room.kind === 'stakes' && humans.some((member) => !member.stakeReady)) {
    fail(peer, 'Every player must confirm their own wager.');
    return;
  }
  let botWager;
  if (room.kind === 'stakes' && size > humans.length) {
    const minimum = wagerBand(room.entry).min;
    const botBank = economy.wallet(humans[0].accountId).botBank;
    const bots = Math.min(size - humans.length, Math.floor(botBank / minimum));
    size = humans.length + bots;
    if (size < 2) throw new EconomyError('The NPC bank cannot cover this wager. Invite another player or try a smaller amount.');
    if (bots) botWager = Math.min(room.entry, Math.floor(botBank / bots));
  }
  const roster = humans.map((member, slot) => ({
    id: member.id, name: member.name, slot, bot: false,
    appearance: unifiedEconomy ? member.peer?.nearAppearance ?? {} : economy.appearance(member.accountId),
    ...(room.kind === 'stakes' ? { wager: member.wager } : {}),
    rig: ['room', 'practice', 'tutorial', 'fun'].includes(room.kind)
      ? (near?.hasStarter ? member.peer?.nearWorkshop?.equipped : null) ?? (unifiedEconomy ? 'oak' : economy.rig(member.accountId)) : undefined,
    ...(room.kind === 'near' ? { nearAccount: member.nearAccount } : {}),
  }));
  for (let slot = humans.length; slot < size; slot++) {
    const botIndex = slot - humans.length;
    roster.push({ id: `bot-${botIndex}`, name: botNames[botIndex], slot, bot: true,
      ...(botWager ? { wager: botWager } : {}) });
  }
  if (room.kind === 'near') {
    if (humans.some(member => !member.nearReadyUntil || member.nearReadyUntil <= Date.now())) {
      fail(peer, 'Every player must authorize this round on NEAR testnet.');
      return;
    }
    void startNearRound(room, peer, roster, humans, size, autoAuthorize);
    return;
  }
  if (room.kind === 'stakes') {
    const reservation = randomUUID();
    const seats = roster.map(({ id, slot, bot, wager }) => ({ id, wager, accountId: bot ? null : humans[slot].accountId }));
    room.stakeRound = economy.reserveRound(reservation, seats, room.entry);
    room.reservation = reservation;
    for (const entry of roster) entry.rig = room.stakeRound.rigs[entry.id];
  }
  beginRound(room, roster, humans);
  if (room.reservation) updateWallets();
}

function beginRound(room, roster, humans, warmup) {
  const inaugural = room.kind === 'tutorial' && humans.length === 1 && humans[0].accountId
    && !economy.wallet(humans[0].accountId)?.firstBrawl;
  const match = createMatch(roster, warmup?.seed ?? randomInt(2 ** 32), room.match, { inaugural: Boolean(inaugural) });
  // Rendering and simulation never wait for a chain acknowledgement.
  match.arenaStyle = roster.find(player => player.id === room.hostId)?.appearance?.arena ?? null;
  for (const [slot, member] of humans.entries()) {
    member.slot = slot;
    member.lastInputAt = 0;
    member.stakeReady = false;
    member.nearReadyUntil = 0;
    member.nearReadyMode = null;
  }
  room.matchRoster = roster;
  room.round++;
  room.inputs.clear();
  room.lastActivity = Date.now();
  room.match = match;
  room.trainingSpeed = 1;
  if (room.kind === 'practice' || room.kind === 'tutorial') {
    for (const member of humans) if (member.peer) member.peer.trainingPreviousMatch = match;
  }
  broadcast(room);
}

async function startNearRound(room, peer, roster, humans, size, autoAuthorize = false) {
  const id = room.nextNearId;
  const players = humans.map(member => member.nearAccount);
  const sessionPlayers = humans.filter(member => member.nearReadyMode === 'session').map(member => member.nearAccount);
  const session = sessionPlayers.length ? { scope: room.nearSessionScope, players: sessionPlayers } : undefined;
  const signer = { handle: peer.nearSession, profile: peer.accountId, account: peer.nearAccount };
  for (const entry of roster) if (!entry.bot) entry.rig = humans[entry.slot].peer?.nearWorkshop?.equipped ?? 'oak';
  // A job owns its match and intent. A rematch can replace room.match while the
  // previous receipt is still pending without changing that previous payout.
  const job = { id, room, players, roster, holds: new Set(players), startedAt: Date.now(),
    chainBusy: 'reserve', reserved: false, done: false, cancelStake: false, retryAt: 0,
    stakeRound: { status: 'pending', paid: 0 } };
  rememberNearJob(job);
  nearJobs.add(job);
  activeNear.add(id);
  room.nearJob = job;
  room.nextNearId = nearRoundId();
  syncNearJob(job);
  beginRound(room, roster, humans);
  job.match = room.match;
  for (const socket of sockets.clients) if (players.includes(socket.peer?.nearAccount)) publishNearBalance(socket.peer);
  // Entry consent is a single slot per account in the contract. Keep the full
  // authorize -> reserve pair ordered, including across tabs and rematches.
  const preceding = players.map(account => nearEntryQueues.get(account));
  let release;
  const queue = new Promise(resolve => { release = resolve; });
  for (const account of players) nearEntryQueues.set(account, queue);
  await Promise.all(preceding);
  try {
    if (job.cancelStake) throw new Error('Entry was cancelled before submission.');
    if (autoAuthorize) {
      const authorization = await nearSocial.sign(signer.handle, signer.profile,
        'authorize_entry', { round_id: id }, randomUUID());
      if (authorization?.status?.Failure) throw new Error('Entry authorization failed.');
      // A provider can return a hash before finality. Polling remains outside the
      // simulation, and a reserve is never sent before consent is confirmed.
      if (typeof authorization?.status?.SuccessValue !== 'string') {
        const deadline = Date.now() + 120_000;
        while (!(await near.consent(signer.account, id) > Date.now())) {
          if (Date.now() >= deadline) throw new Error('Entry authorization was not confirmed.');
          await new Promise(resolve => setTimeout(resolve, 1_000));
        }
      }
    }
    job.reserveAttempted = true;
    const receipt = await near.reserve(id, players, size, session);
    if (receipt.round?.status !== 'reserved') throw new Error('The round reservation is not confirmed.');
    job.reserved = true;
    economy.rememberNearReceipt(near.contract, players, receipt.hash, 'Arena reservation');
    job.stakeRound = nearReceipt(receipt, roster, null);
    // Cached equipment determines this match immediately. A changed loadout must
    // never silently acquire a paid advantage after simulation has begun.
    if (receipt.rigs && roster.some(entry => !entry.bot && receipt.rigs[entry.nearAccount] !== entry.rig)) job.cancelStake = true;
    if (!rooms.has(room.code) || (room.nearJob === job && !room.members.size)) job.cancelStake = true;
    updateNearWallets(players);
  } catch {
    // Keep the gameplay moving. An unconfirmed entry is reconciled/cancelled;
    // its result cannot mint a reward or masquerade as a confirmed paid round.
    job.cancelStake = true;
    job.stakeRound = { status: 'pending', paid: 0, entryFailed: true };
    if (!job.reserveAttempted) {
      // Authorizing an entry does not debit GOLD. A definite signing failure
      // before reserve cannot leave an ambiguous transfer to reconcile.
      job.done = true;
      job.holds.clear();
      job.stakeRound.status = 'cancelled';
      economy.forgetNearRound(id);
      activeNear.delete(id);
      for (const socket of sockets.clients) if (players.includes(socket.peer?.nearAccount)) publishNearBalance(socket.peer);
    }
  } finally {
    release();
    for (const account of players) if (nearEntryQueues.get(account) === queue) nearEntryQueues.delete(account);
    job.chainBusy = null;
    publishNearJob(job);
    closeNearJob(job);
    pruneNearJobs();
  }
}

function runDrill(peer, scenario) {
  const room = peer.room;
  if (room?.kind !== 'drill' || peer.member?.id !== room.hostId) {
    fail(peer, 'Open the impact lab to run a trial.');
    return;
  }
  const match = createDrill(room.matchRoster, scenario, randomInt(2 ** 32), room.match?.drill?.trial);
  if (!match) {
    fail(peer, 'Choose a valid impact scenario.');
    return;
  }
  room.round++;
  room.inputs.clear();
  room.lastActivity = Date.now();
  room.match = match;
  broadcast(room);
}

function checkWager(peer, wager, entry = wager) {
  if (!Number.isSafeInteger(wager) || wager < 1) throw new EconomyError('Enter a positive wager in test gold.');
  const { min, max } = wagerBand(entry);
  if (wager < min || wager > max) throw new EconomyError('Choose an amount within this room’s wager range.');
  if (!(economy.wallet(peer.accountId)?.gold >= wager)) throw new EconomyError('You need more test gold for that wager.');
}

function findStakes(peer, name, wager) {
  checkWager(peer, wager);
  const candidate = [...rooms.values()].find(room => {
    if (room.kind !== 'stakes' || room.phase !== 'lobby' || room.members.size >= MAX_PLAYERS) return false;
    const { min, max } = wagerBand(room.entry);
    return wager >= min && wager <= max && ![...room.members.values()].some(member => member.accountId === peer.accountId);
  });
  if (candidate) joinRoom(peer, candidate.code, name, null, wager);
  else createRoom(peer, 'stakes', name, wager);
}

function findFun(peer, name) {
  if (peer.room?.kind === 'fun' && peer.room.phase === 'lobby') return;
  const candidate = [...rooms.values()].find(room => room.kind === 'fun' && room.phase === 'lobby'
    && room.members.size < MAX_PLAYERS);
  if (candidate) {
    joinRoom(peer, candidate.code, name);
    if (candidate.members.size === MAX_PLAYERS) start(candidate, MAX_PLAYERS, peer);
  } else createRoom(peer, 'fun', name);
}

function createRoom(peer, kind, name, entry = ARENA_ENTRY) {
  // A stale tab requesting the introduction again gets normal bot training.
  if (kind === 'tutorial' && economy.wallet(peer.accountId)?.firstBrawl) kind = 'practice';
  if (kind === 'stakes' && !peer.accountId) { fail(peer, 'Reload to open your game account.'); return; }
  if (kind === 'stakes') checkWager(peer, entry);
  if (kind === 'near' && (!near || !peer.nearAccount || !peer.accountId)) {
    fail(peer, 'Sign in to open this room.');
    return;
  }
  if (rooms.size >= maxRooms) { fail(peer, 'The dock is full. Try again in a moment.'); return; }
  detach(peer, false);
  const room = {
    code: newCode(), kind, hostId: null, phase: 'lobby', round: 0, members: new Map(),
    inputs: new Map(), matchRoster: [], match: kind === 'practice' ? peer.trainingPreviousMatch ?? null : null, lastActivity: Date.now(),
  };
  if (kind === 'stakes') room.entry = entry;
  if (kind === 'fun') room.startsAt = Date.now() + 2_500;
  if (kind === 'near') {
    room.nextNearId = nearRoundId();
    if (near.sessions) room.nearSessionScope = nearRoundId();
  }
  rooms.set(room.code, room);
  attach(peer, room, name, kind === 'stakes' ? entry : undefined);
  if (kind === 'practice' || kind === 'tutorial') start(room, MAX_PLAYERS, peer);
  else if (kind === 'drill') {
    room.matchRoster = [
      { ...publicMember(peer.member), appearance: economy.appearance(peer.accountId), rig: economy.rig(peer.accountId) },
      { id: 'drill-dummy', name: 'Target barrel', slot: 1, bot: true },
    ];
    runDrill(peer, 'free');
  } else broadcast(room);
}

function joinRoom(peer, code, name, resumeToken, wager) {
  if (typeof code !== 'string') { fail(peer, 'Enter a room code.'); return; }
  const room = rooms.get(code.trim().toUpperCase());
  if (!room) { fail(peer, 'Room not found. Check the code.'); return; }
  if (peer.room === room) { announceMember(peer); broadcast(room); return; }
  if (typeof resumeToken === 'string' && resumeToken) {
    const member = [...room.members.values()].find((entry) => entry.resumeToken === resumeToken);
    if (!member || member.peer || Date.now() - member.disconnectedAt >= reconnectWindow
      || ((room.kind === 'stakes' || room.kind === 'near') && member.accountId !== peer.accountId)) {
      fail(peer, 'The reconnection window closed. Join the next round.');
      return;
    }
    detach(peer, false);
    member.peer = peer;
    member.disconnectedAt = 0;
    room.lastActivity = Date.now();
    peer.room = room;
    if (room.kind === 'near') {
      peer.nearAccount = member.nearAccount;
      refreshNearWallet(peer).catch(() => {});
    }
    peer.member = member;
    assignHost(room);
    announceMember(peer);
    broadcast(room);
    return;
  }
  if (room.kind === 'practice' || room.kind === 'tutorial') { fail(peer, 'That code belongs to a solo training session.'); return; }
  if (room.kind === 'drill') { fail(peer, 'That code belongs to a solo impact lab.'); return; }
  if (room.kind === 'stakes' && (!peer.accountId || [...room.members.values()].some((member) => member.accountId === peer.accountId))) {
    fail(peer, 'Use a separate browser profile with its own account.');
    return;
  }
  if (room.kind === 'near' && (!peer.accountId || !peer.nearAccount ||
    [...room.members.values()].some(member => member.nearAccount === peer.nearAccount || member.accountId === peer.accountId))) {
    fail(peer, 'This room needs a separate signed-in account.');
    return;
  }
  if (room.chainBusy === 'reserve') { fail(peer, 'The room is reserving its entries. Try again shortly.'); return; }
  if (room.phase === 'countdown' || room.phase === 'playing') {
    fail(peer, 'The round already started. Join when it finishes.');
    return;
  }
  if (room.members.size >= MAX_PLAYERS) { fail(peer, 'This room already has eight crew members.'); return; }
  if (room.kind === 'stakes') {
    wager ??= Math.min(room.entry, economy.wallet(peer.accountId).gold);
    checkWager(peer, wager, room.entry);
  }
  detach(peer, false);
  attach(peer, room, name, wager);
  broadcast(room);
}

function acceptInput(peer, message, now) {
  const { room, member } = peer;
  if (!member || !room?.match || room.nearWarmup || room.phase === 'results' || now - member.lastInputAt < 12) return;
  if (room.match.drill && room.match.drill.scenario !== 'free') return;
  const { x, z } = message;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const length = Math.hypot(x, z);
  if (length > 2) return;
  room.inputs.set(member.id, { x: x / Math.max(1, length), z: z / Math.max(1, length) });
  member.lastInputAt = now;
  if (room.kind === 'drill' && length > 0) room.lastActivity = now;
}

async function onMessage(peer, bytes, binary) {
  if (binary) return;
  let message;
  try { message = JSON.parse(bytes.toString()); } catch { return; }
  if (!message || Array.isArray(message) || typeof message.type !== 'string') return;
  const now = Date.now();
  if (message.type === 'input') { acceptInput(peer, message, now); return; }
  if (now - peer.actionWindow >= 10_000) {
    peer.actionWindow = now;
    peer.actions = 0;
  }
  if (++peer.actions > 24) { peer.socket.close(1008, 'Too many room actions'); return; }
  if (unifiedEconomy && (['create-stakes', 'find-stakes', 'stake-ready'].includes(message.type)
    || (message.type.startsWith('gear-') && !['gear-refresh', 'gear-colors'].includes(message.type)))) {
    fail(peer, 'Use the NEAR economy for this action.');
    return;
  }
  switch (message.type) {
    case 'pirate-name': {
      if (!peer.nearAccount || peer.room || typeof message.name !== 'string' || message.name.length > 100) break;
      economy.pirateProfile(peer.nearAccount, message.name);
      for (const client of sockets.clients) if (client.peer?.nearAccount === peer.nearAccount) sendPirateProfile(client.peer);
      break;
    }
    case 'near-logbook-view': {
      if (!near?.hasCollection || !peer.nearAccount) break;
      const account = peer.nearAccount;
      try {
        const entries = await near.logbook(account);
        if (peer.nearAccount === account) send(peer.socket, { type: 'near-logbook', account, entries,
          receiptNetwork: near.receiptNetwork, receipts: economy.nearReceipts(near.contract, account) });
      } catch {
        send(peer.socket, { type: 'near-logbook', account, error: 'Could not load confirmed NEAR activity.' });
      }
      break;
    }
    case 'near-workshop-view': {
      if (!near?.hasWorkshop) break;
      const account = typeof message.account === 'string' ? message.account.slice(0, 64) : '';
      const readAt = ++nearReadClock;
      try {
        const view = await near.workshop(message.account, message.transactionHash);
        if (view.transactionHash) economy.rememberNearReceipt(near.contract, [account], view.transactionHash, 'Workshop receipt');
        send(peer.socket, { type: 'near-workshop', account, ...view,
          workshop: { ...view.workshop, gold: Math.max(0, view.workshop.gold - heldNearGold(account)) } });
        if (account === peer.nearAccount) {
          cacheNearSnapshot(account, view.workshop.gold, view, readAt);
          await restoreFirstBrawl(peer, account, view);
          walletUpdate(peer);
          publishNearBalance(peer);
        }
      } catch (error) {
        const detail = error instanceof EconomyError ? error.message : 'Could not read the NEAR workshop. Refresh and try again.';
        send(peer.socket, { type: 'near-workshop', account, error: detail });
      }
      break;
    }
    case 'expedition-contribute':
    case 'expedition-bid':
    case 'expedition-chain-view':
    case 'expedition-chain-challenge':
    case 'expedition-chain-auth':
    case 'expedition-chain-claim':
      await onExpeditionMessage(peer, message);
      break;
    case 'practice': createRoom(peer, 'practice', message.name); break;
    case 'tutorial': createRoom(peer, 'tutorial', message.name); break;
    case 'find-fun': findFun(peer, message.name); break;
    case 'drill': createRoom(peer, 'drill', message.name); break;
    case 'drill-run': runDrill(peer, message.scenario); break;
    case 'create': createRoom(peer, 'room', message.name); break;
    case 'create-stakes': createRoom(peer, 'stakes', message.name, message.wager); break;
    case 'find-stakes': findStakes(peer, message.name, message.wager); break;
    case 'create-near': createRoom(peer, 'near', message.name); break;
    case 'join': joinRoom(peer, message.code, message.name, message.resumeToken); break;
    case 'emote':
      if (peer.member && peer.room.kind !== 'drill') emotePlayer(peer.room.match, peer.member.id, message.emote);
      break;
    case 'training-speed': {
      const { room, member } = peer;
      if (room?.kind !== 'practice' || room.match?.phase !== 'playing' ||
        !room.match.players.some(player => player.id === member?.id && !player.bot && !player.alive)) break;
      room.trainingSpeed = message.fast === false ? 1 : 3;
      broadcast(room);
      break;
    }
    case 'start': {
      const { room, member } = peer;
      if (!room || member?.id !== room.hostId) { fail(peer, 'Only the host can start the round.'); break; }
      if (room.phase === 'lobby' || room.phase === 'results') start(room, message.slots, peer);
      break;
    }
    case 'stake-ready':
      if (peer.room?.kind !== 'stakes' || peer.room.reservation || typeof message.ready !== 'boolean') {
        fail(peer, 'Confirm your entry between rounds.');
        break;
      }
      if (message.ready) {
        const wager = message.wager ?? peer.member.wager;
        checkWager(peer, wager, peer.room.entry);
        peer.member.wager = wager;
      }
      peer.member.stakeReady = message.ready;
      peer.room.lastActivity = now;
      broadcast(peer.room);
      break;
    case 'near-challenge':
      if (!near || !peer.accountId || !canConnectNear(peer) || peer.nearConnecting || peer.claimingStarter) {
        fail(peer, 'Sign in from the bay.'); break;
      }
      peer.nearChallenge = near.challenge();
      send(peer.socket, { type: 'near-challenge', ...peer.nearChallenge });
      break;
    case 'near-auth': {
      if (!near || !peer.accountId || !canConnectNear(peer) || peer.nearConnecting) {
        fail(peer, 'Sign in from the bay.'); break;
      }
      const challenge = peer.nearChallenge;
      peer.nearChallenge = null;
      peer.nearConnecting = true;
      try {
        const account = await near.authenticate(challenge, message);
        if (!canConnectNear(peer) || peer.socket.readyState !== WebSocket.OPEN) break;
        peer.nearAccount = account;
        peer.nearSocialAccount = null;
        peer.nearSession = null;
        peer.nearSigningReady = true;
        peer.nearEmbeddedWallet = false;
        sendPirateProfile(peer);
        const view = near.hasStarter ? await near.workshop(account) : null;
        peer.nearWorkshop = view?.workshop ?? null;
        peer.nearAppearance = view?.collection?.equipped ?? {};
        await restoreFirstBrawl(peer, account, view);
        if (near.hasStarter) walletUpdate(peer);
        await refreshNearWallet(peer);
      } finally {
        peer.nearConnecting = false;
      }
      break;
    }
    case 'near-social-auth': {
      if (!nearSocial || !peer.accountId || peer.nearConnecting || peer.claimingStarter) break;
      const session = nearSocial.consume(message.ticket, peer.accountId);
      const account = session?.account;
      if (!account || (!canConnectNear(peer) && peer.member?.nearAccount !== account)) {
        send(peer.socket, { type: 'near-social-error', message: 'Your sign-in could not be restored here.' });
        break;
      }
      peer.nearConnecting = true;
      try {
        peer.nearAccount = peer.nearSocialAccount = account;
        peer.nearSession = session;
        peer.nearSigningReady = session.signingReady !== false;
        peer.nearEmbeddedWallet = session.embedded;
        sendPirateProfile(peer);
        loadSignedInBalance(peer, session);
      } catch {
        send(peer.socket, { type: 'near-social-error', message: 'Your account is signed in. Try again to load your gold and gear.' });
      } finally {
        peer.nearConnecting = false;
      }
      break;
    }
    case 'near-play': {
      const { room, member } = peer;
      if (room?.nearJob && room.nearJob.id === message.id) { broadcast(room); break; }
      if (!nearSocial || room?.kind !== 'near' || member?.id !== room.hostId || room.members.size !== 1 ||
          !['lobby', 'results'].includes(room.phase) || message.id !== room.nextNearId || message.entry !== ARENA_ENTRY ||
          peer.nearAccount !== member.nearAccount || peer.nearSocialAccount !== member.nearAccount) {
        fail(peer, 'Sign in to play with your current game session.'); break;
      }
      if (!nearSocial.canSignAction(peer.nearSession, peer.accountId, ARENA_ENTRY)) {
        send(peer.socket, { type: 'error', renewSession: true,
          message: 'Continue playing to renew your game session.' });
        break;
      }
      if (peer.nearBalanceLoading) {
        fail(peer, 'Your gold is updating. Free modes are ready to play.'); break;
      }
      if (spendableNearGold(peer) < ARENA_ENTRY) {
        fail(peer, 'You need more gold to enter this round.'); break;
      }
      if ([...nearJobs].some(job => !job.done && job.players.includes(peer.nearAccount) &&
          job.match?.phase !== 'results' && !job.cancelStake)) {
        fail(peer, 'Finish your current round before entering another.'); break;
      }
      member.nearReadyUntil = now + 120_000;
      member.nearReadyMode = 'round';
      start(room, message.slots, peer, true);
      break;
    }
    case 'near-ready': {
      const { room, member } = peer;
      const verify = message.check === true;
      if (!near || room?.kind !== 'near' || room.reservation || room.chainBusy || !member?.nearAccount ||
        room.nextNearId !== message.id || typeof message.ready !== 'boolean') {
        if (!verify) fail(peer, 'Authorize the current round from the lobby.');
        break;
      }
      const check = {};
      member.nearEntryCheck = check;
      if (verify && !message.ready && member.nearReadyUntil) {
        member.nearReadyUntil = 0;
        broadcast(room);
      }
      let expires = null;
      try {
        if (verify || message.ready) expires = await near.consent(member.nearAccount, message.id);
      } catch (error) {
        if (!verify) throw error;
        if (member.nearEntryCheck === check && peer.room === room) {
          send(peer.socket, { type: 'near-entry-status', id: message.id, ready: message.ready, confirmed: false });
        }
        break;
      }
      if (member.nearEntryCheck !== check) break;
      if (peer.room !== room || member.peer !== peer || room.nextNearId !== message.id || room.reservation || room.chainBusy) {
        if (!verify) fail(peer, 'The NEAR round changed. Review the lobby.');
        break;
      }
      const authorized = expires > Date.now();
      member.nearReadyUntil = message.ready && authorized ? expires : 0;
      member.nearReadyMode = member.nearReadyUntil ? 'round' : null;
      if (verify) {
        send(peer.socket, { type: 'near-entry-status', id: message.id, ready: message.ready,
          confirmed: authorized === message.ready });
      } else if (message.ready && !member.nearReadyUntil) {
        fail(peer, 'No finalized entry authorization yet. Confirm again.');
      }
      broadcast(room);
      break;
    }
    case 'near-session-check': {
      const { room, member } = peer;
      if (!near?.sessions || !room?.nearSessionScope || message.scope !== room.nearSessionScope ||
        !member?.nearAccount) break;
      const session = await near.entrySession(member.nearAccount, room.nearSessionScope).catch(() => undefined);
      if (peer.room === room && member.peer === peer) {
        send(peer.socket, { type: 'near-session-status', scope: room.nearSessionScope,
          ...(session === undefined ? { unavailable: true } : { session }) });
      }
      break;
    }
    case 'near-session-ready': {
      const { room, member } = peer;
      if (!near?.sessions || !room?.nearSessionScope || room.reservation || room.chainBusy || !member?.nearAccount ||
        message.id !== room.nextNearId || typeof message.ready !== 'boolean') {
        fail(peer, 'Confirm your current NEAR round from the lobby.'); break;
      }
      const check = {};
      member.nearEntryCheck = check;
      if (!message.ready) {
        if (member.nearReadyMode === 'session') {
          member.nearReadyMode = null;
          member.nearReadyUntil = 0;
        }
        broadcast(room);
        break;
      }
      const session = await near.entrySession(member.nearAccount, room.nearSessionScope);
      if (member.nearEntryCheck !== check || peer.room !== room || member.peer !== peer ||
        room.nextNearId !== message.id || room.reservation || room.chainBusy) break;
      if (!session?.remaining || session.expires_at <= Date.now()) {
        send(peer.socket, { type: 'near-session-status', scope: room.nearSessionScope, session: null });
        fail(peer, 'Your room pass has ended. Sign a single entry or enable another pass.');
        break;
      }
      member.nearReadyUntil = session.expires_at;
      member.nearReadyMode = 'session';
      broadcast(room);
      break;
    }
    case 'gear-buy-stock':
    case 'gear-buy-cosmetic':
    case 'gear-open-chest':
    case 'gear-style':
    case 'gear-colors':
    case 'gear-buy-market':
    case 'gear-sell-merchant':
    case 'gear-equip':
    case 'gear-patch':
    case 'gear-list':
    case 'gear-unlist':
    case 'gear-discard':
      if (!peer.accountId || peer.room) { fail(peer, 'Visit the workshop from the bay.'); break; }
      try { economy.workshopAction(peer.accountId, message); }
      catch (error) { walletUpdate(peer); throw error; }
      updateWallets();
      send(peer.socket, { type: 'gear-ack', action: message.type, id: message.id });
      break;
    case 'first-brawl-claim':
      try {
        const results = peer.room?.match?.phase === 'results' && peer.room.kind !== 'drill';
        if (!peer.accountId || (peer.room && !results)) throw new EconomyError('Finish the round before claiming your barrel.');
        if (near?.hasStarter) {
          if (!peer.nearAccount) throw new EconomyError('Sign in to claim the barrel.');
          if (peer.nearBalanceLoading && FIRST_BRAWL_RIGS.includes(message.rig)) {
            peer.deferredStarter = message.rig;
            break;
          }
          if (peer.claimingStarter) throw new EconomyError('Your starter claim is pending.');
          peer.claimingStarter = true;
          const account = peer.nearAccount;
          try {
            const existing = await near.firstBrawlReward(account);
            const rig = existing ?? message.rig;
            if (!existing) {
              const { workshop } = await near.workshop(account);
              if (workshop.items.some(item => item.rig === rig)) {
                throw new EconomyError('You already own that barrel. Choose the other starter or sell the commercial piece first.');
              }
            }
            economy.prepareNearFirstBrawl(peer.accountId, account, rig, near.contract);
            peer.nearWorkshop = await near.grantFirstBrawl(account, rig);
            economy.completeNearFirstBrawl(peer.accountId, account, rig, near.contract);
          } catch (error) {
            if (error instanceof EconomyError) throw error;
            throw new EconomyError('Could not confirm the starter. Retry with the same account and barrel.');
          } finally {
            peer.claimingStarter = false;
          }
        } else economy.claimFirstBrawl(peer.accountId, message.rig);
        walletUpdate(peer);
      } catch (error) {
        if (!(error instanceof EconomyError)) throw error;
        send(peer.socket, { type: 'first-brawl-error', message: error.message });
      }
      break;
    case 'gear-refresh':
      walletUpdate(peer);
      break;
    case 'leave':
      if (message.round !== undefined && (message.round !== peer.room?.round || message.phase !== peer.room?.phase)) {
        fail(peer, 'The round changed. Review the exit again.');
        if (peer.room) broadcast(peer.room);
        break;
      }
      detach(peer, false);
      send(peer.socket, { type: 'left' });
      break;
    default: fail(peer, 'Unknown room action.');
  }
}

sockets.on('connection', (socket, request) => {
  const peer = { socket, accountId: economy.findAccount(cookieToken(request)), room: null, member: null, actions: 0, actionWindow: Date.now() };
  socket.peer = peer;
  socket.isResponsive = true;
  socket.on('pong', () => { socket.isResponsive = true; });
  socket.on('message', async (bytes, binary) => {
    try { await onMessage(peer, bytes, binary); }
    catch (error) {
      if (!(error instanceof EconomyError)) console.error(error);
      fail(peer, error instanceof EconomyError ? error.message : 'The test economy is temporarily unavailable.');
    }
  });
  socket.on('close', () => {
    clearTimeout(peer.nearBalanceRetry);
    peer.nearBalanceLoad = null;
    detach(peer, true);
  });
  socket.on('error', () => socket.terminate());
  if (near) send(socket, { type: 'near-config', contract: near.contract, goldWallet: process.env.BARREL_GOLD_WALLET === '1',
    ...(nearSocial ? { socialOrigin: nearSocial.origin, socialActions: nearSocial.canSign, socialGoldLimit: nearSocial.goldLimit,
      socialProvider: nearEmbedded ? 'privy' : 'near-auth' } : {}),
    ...(near.hasWorkshop ? { workshop: true, starter: near.hasStarter, collection: near.hasCollection, unifiedEconomy } : {}) });
  if (nearExpeditions) send(socket, { type: 'expedition-chain-config', contract: nearExpeditions.contract, unified: nearExpeditions.unified });
  walletUpdate(peer);
});

function sweepRooms(now) {
  for (const room of rooms.values()) {
    let changed = false;
    for (const member of room.members.values()) {
      if (member.nearReadyUntil && member.nearReadyUntil <= now) {
        member.nearReadyUntil = 0;
        changed = true;
      }
      if (!member.peer && now - member.disconnectedAt >= reconnectWindow) {
        removeMember(room, member);
        changed = true;
      }
    }
    if (changed) broadcast(room);
    if (room.kind === 'fun' && room.phase === 'lobby' && now >= room.startsAt) {
      const host = room.members.get(room.hostId)?.peer;
      if (host) start(room, MAX_PLAYERS, host);
    }
    const roundActive = room.kind !== 'drill' && (room.phase === 'playing' || room.phase === 'countdown');
    if (now - room.lastActivity < idleWindow || roundActive) continue;
    rooms.delete(room.code);
    for (const member of room.members.values()) {
      if (!member.peer) continue;
      const peer = member.peer;
      peer.room = null;
      peer.member = null;
      send(peer.socket, { type: 'left', message: 'Room closed after 20 minutes of inactivity.' });
    }
  }
}

let previous = performance.now();
let remaining = 0;
let ticks = 0;
const simulation = setInterval(() => {
  const current = performance.now();
  remaining = Math.min(remaining + (current - previous) / 1_000, 5 * step);
  previous = current;
  if (remaining < step) return;
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const [id] of room.inputs) {
      if (now - room.members.get(id)?.lastInputAt > staleInput) room.inputs.delete(id);
    }
  }
  while (remaining >= step) {
    remaining -= step;
    ticks++;
    for (const room of rooms.values()) {
      if (room.nearWarmup) {
        if (ticks % 5 === 0) broadcast(room);
        continue;
      }
      if (room.reservation && room.stakeRound?.expiresAt <= now && room.match?.phase !== 'results') room.cancelStake = true;
      if (!room.nearJob && (room.cancelStake || (room.reservation && room.match?.phase === 'results'))) {
        const reservation = room.reservation;
        closeStake(room);
        if (reservation && !room.reservation) broadcast(room);
        continue;
      }
      if (!room.match || room.match.phase === 'results') continue;
      const speed = room.kind === 'practice' ? room.trainingSpeed ?? 1 : 1;
      for (let i = 0; i < speed && room.match.phase !== 'results'; i++) stepMatch(room.match, step, room.inputs);
      if (room.kind !== 'drill' && room.match.phase === 'results' && room.match.winnerId) {
        for (const member of room.members.values()) {
          if (!member.accountId || !room.match.players.some(player => player.id === member.id)) continue;
          try {
            if (member.rewardAccount) economy.rememberPirateMatch(member.rewardAccount);
            if (economy.completeFirstBrawl(member.accountId)) walletUpdate(member.peer);
          } catch (error) {
            console.error('Could not record the first brawl reward.', error);
          }
        }
      }
      closeStake(room);
      if (!room.match || room.match.phase === 'results' || ticks % 2 === 0) broadcast(room);
    }
  }
  // Includes completed matches replaced by rematches, and rooms already closed.
  for (const job of nearJobs) closeNearJob(job);
}, 1_000 / TICK_RATE);

const cleanup = setInterval(() => sweepRooms(Date.now()), 500);
const ledgerCleanup = setInterval(() => {
  try { if (economy.sweep()) updateWallets(); }
  catch (error) { console.error('Could not expire test gold reservations.', error); }
}, 1_000);
let advancingExpedition = false;
const nearExpeditionCleanup = nearExpeditions?.advanceIfDue ? setInterval(async () => {
  if (advancingExpedition) return;
  advancingExpedition = true;
  try { await nearExpeditions.advanceIfDue(); }
  catch (error) { if (!isRpcReadBackoff(error)) console.error('Could not finalize the NEAR expedition.', error); }
  finally { advancingExpedition = false; }
}, 5_000) : null;
let recoveringNear = false;
const nearCleanup = near ? setInterval(async () => {
  if (recoveringNear) return;
  recoveringNear = true;
  try {
    const now = Date.now();
    const staleHolds = new Set([...nearJobs].filter(job => job.reserved && job.holds.size).flatMap(job => [...job.holds]));
    if (staleHolds.size) updateNearWallets([...staleHolds]);
    for (const [id, intent] of economy.nearRounds()) {
      if (activeNear.has(id) || intent.contract !== near.contract || now < (intent.retryAfter ?? intent.updatedAt)) continue;
      try {
        const { round } = await near.finish(id, intent);
        if ((round && round.status !== 'reserved') || (!round && now - intent.updatedAt > 300_000)) {
          economy.forgetNearRound(id);
          const held = recoveredNearHolds.get(id);
          recoveredNearHolds.delete(id);
          if (round) updateNearWallets(round.players ?? []);
          else if (held?.size) updateNearWallets([...held]);
        }
      } catch {
        // The saved intent is retried when the RPC is available again.
      }
    }
  } finally {
    recoveringNear = false;
  }
}, 5_000) : null;
const heartbeat = setInterval(() => {
  for (const socket of sockets.clients) {
    if (!socket.isResponsive) socket.terminate();
    else if (socket.readyState === WebSocket.OPEN) {
      socket.isResponsive = false;
      socket.ping();
    }
  }
}, 15_000);

function shutdown() {
  for (const interval of [simulation, cleanup, heartbeat, ledgerCleanup, nearCleanup, nearExpeditionCleanup]) clearInterval(interval);
  for (const room of rooms.values()) {
    room.cancelStake = room.match?.phase !== 'results';
    closeStake(room);
  }
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  http.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
http.listen(port, host, () => console.log(`NEARly Afloat ready on http://${host}:${http.address().port}/`));

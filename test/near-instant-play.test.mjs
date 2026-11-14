import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once, on } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

// Disposable, local-only chain/provider replacements. No credentials or RPC.
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'afloat-instant-entry-'));
  const file = join(directory, 'chain.json');
  await writeFile(file, JSON.stringify({ gold: 500, events: [], rounds: {}, ...options }));
  const account = 'a'.repeat(64);
  const chainSource = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { RpcReadBackoff } from ${JSON.stringify(new URL('../near-rpc-reads.mjs', import.meta.url).href)};
    const file = process.env.INSTANT_CHAIN;
    const read = () => JSON.parse(readFileSync(file, 'utf8'));
    const save = value => writeFileSync(file, JSON.stringify(value));
    const event = value => {const s=read(); s.events.push(value); save(s);};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    export const signingReady = () => !read().expired;
    let id = 0;
    export const nearRoundId = () => String(++id);
    export async function sign(_handle, _profile, _method, args) {
      event('authorize-start:'+args.round_id);
      await wait(600);
      const s=read();
      if(s.signFailure) throw new Error('Signing failed');
      s.consent=args.round_id; s.events.push('authorize-end:'+args.round_id); save(s);
      return {status:{SuccessValue:''}};
    }
    export const loadNearArena = () => ({
      contract:'instant-fixture.testnet', receiptNetwork:'fixture', hasStarter:true, hasWorkshop:true,
      hasCollection:false, sessions:false, ensureAccount:async()=>{}, firstBrawlReward:async()=>null,
      workshop:async()=>{
        const state=read();
        if(state.workshopFailures>0){state.workshopFailures--;save(state);throw new RpcReadBackoff(500);}
        return {workshop:{gold:state.gold,equipped:'iron'}};
      },
      balance:async()=>read().gold,
      reserve:async(id,players,slots)=>{
        event('reserve-start:'+id); await wait(600);
        const s=read();
        if(s.consent!==id) throw new Error('Consent overwritten');
        if(s.gold<200) throw new Error('Insufficient gold');
        s.gold-=200;
        const round={status:'reserved',players,bots:slots-players.length,expires_at:Date.now()+90000,pot:960,fee:240,bonus:200};
        s.rounds[id]=round; s.events.push('reserve-end:'+id); save(s);
        if(s.lostReserve) throw new Error('Response lost after debit');
        return {round,rigs:{[players[0]]:s.rigMismatch?'oak':'iron'}};
      },
      finish:async(id,intent)=>{
        event(intent.action+'-start:'+id); await wait(700);
        const s=read(), round=s.rounds[id];
        if(!round)return {round:null};
        if(round.status==='reserved'){
          round.status=intent.action==='cancel'?'cancelled':'settled';
          round.paid=0; round.winner=intent.winner;
          if(intent.action==='cancel')s.gold+=200;
          s.events.push(intent.action+'-end:'+id);save(s);
        }
        return {round};
      }
    });`;
  const chain = join(directory, 'chain.mjs');
  await writeFile(chain, chainSource);
  const simulation = new URL('../shared/simulation.mjs', import.meta.url).href;
  const simulationSource = `export * from ${JSON.stringify(simulation + '?real')};
    import {stepMatch as step} from ${JSON.stringify(simulation + '?real')};
    export function stepMatch(match, dt, inputs) {
      step(match,dt,inputs);
      if(match.tick>=12){match.phase='results';match.countdown=0;match.winnerId=match.players[1].id;
        for(const p of match.players){p.alive=p.id===match.winnerId;p.rank=p.alive?1:2;}}
    }`;
  const socialSource = `import {sign, signingReady} from ${JSON.stringify(pathToFileURL(chain).href)};
    export const loadNearSocial=()=>({canSign:true,canSignAction:(handle,_profile,cost)=>handle?.id==='fixture'&&cost===200&&signingReady(),
      consume:()=>({account:${JSON.stringify(account)},id:'fixture',embedded:true}),sign});`;
  const hook = join(directory, 'hook.mjs');
  await writeFile(hook, `import {registerHooks} from 'node:module';
    registerHooks({load(url,context,next){
      if(url.endsWith('/near-arena.mjs'))return next(${JSON.stringify(pathToFileURL(chain).href)},context);
      if(url.endsWith('/near-social.mjs'))return {format:'module',shortCircuit:true,source:${JSON.stringify(socialSource)}};
      if(url.endsWith('/near-social-actions.mjs'))return {format:'module',shortCircuit:true,source:'export const loadNearSocialActions=()=>null;'};
      if(url===${JSON.stringify(simulation)})return {format:'module',shortCircuit:true,source:${JSON.stringify(simulationSource)}};
      return next(url,context);
    }});`);
  const env = { ...process.env, HOST:'127.0.0.1', PORT:'0', BARREL_DB:':memory:', INSTANT_CHAIN:file };
  for (const key of Object.keys(env)) if (key.startsWith('BARREL_NEAR_') || key.startsWith('BARREL_EXPEDITIONS_') || key.startsWith('BARREL_PRIVY_')) delete env[key];
  env.BARREL_NEAR_SOCIAL = '1';
  const server = spawn(process.execPath, ['--experimental-sqlite','--import',pathToFileURL(hook).href,
    fileURLToPath(new URL('../server.mjs',import.meta.url))], { env,windowsHide:true,stdio:['ignore','pipe','inherit'] });
  const clients=[];
  t.after(async()=>{
    for(const socket of clients)socket.terminate();
    if(server.exitCode===null&&server.signalCode===null){const ended=once(server,'exit');server.kill();await ended;}
    await rm(directory,{recursive:true,force:true});
  });
  const lines=createInterface({input:server.stdout});
  const [line]=await once(lines,'line',{signal:AbortSignal.timeout(8000)});lines.close();
  const base=line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(base,line);
  async function next(socket,predicate,action=()=>{}){
    const messages=on(socket,'message',{signal:AbortSignal.timeout(8000)});
    try{action();for await(const[bytes]of messages){const m=JSON.parse(bytes);if(predicate(m))return m;assert.notEqual(m.type,'error',m.message);}}
    finally{await messages.return();}
  }
  async function connect(waitForBalance=true){
    const response=await fetch(base+'/playtest-session');
    const cookie=response.headers.get('set-cookie').split(';')[0];
    const socket=new WebSocket(base.replace('http:','ws:')+'/arena',{headers:{Cookie:cookie},origin:base});
    clients.push(socket);await once(socket,'open');
    socket.accountMessage=await next(socket,m=>m.type==='near-wallet'&&(!waitForBalance||!m.balanceLoading),()=>socket.send(JSON.stringify({type:'near-social-auth',ticket:'fixture'})));
    return socket;
  }
  const send=(socket,type,data={})=>socket.send(JSON.stringify({type,...data}));
  const state=(socket,action,predicate=m=>m.phase==='countdown')=>next(socket,m=>m.type==='state'&&predicate(m),action);
  const read=async()=>JSON.parse(await readFile(file,'utf8'));
  const credit=async gold=>{const value=await read();value.gold=gold;await writeFile(file,JSON.stringify(value));};
  async function until(predicate){for(let i=0;i<140;i++){if(await predicate())return;await delay(40);}assert.fail('Background accounting did not finish');}
  return {connect,next,send,state,read,until,credit};
}

test('social paid entry and rematch start before receipts, preserve consent order and hold funds across tabs', {timeout:20000},async t=>{
  const f=await fixture(t), socket=await f.connect(), other=await f.connect();
  const lobby=await f.state(socket,()=>f.send(socket,'create-near'),m=>m.phase==='lobby');
  const id=lobby.stake.chainId;
  const t0=performance.now();
  const first=await f.state(socket,()=>f.send(socket,'near-play',{id,entry:200,slots:6}));
  assert.ok(performance.now()-t0<500,'countdown must not wait for the 600ms signer or reservation');
  assert.equal(first.stake.round.status,'pending');
  assert.equal(first.stake.pendingEntry,true);
  assert.equal(first.match.seconds,3);
  assert.equal((await f.read()).rounds[id],undefined);
  const repeated=await f.state(socket,()=>f.send(socket,'near-play',{id,entry:200,slots:6}));
  assert.equal(repeated.round,first.round,'retransmitting the same entry cannot create another match');
  await f.next(other,m=>m.type==='near-wallet'&&m.gold===300,()=>f.send(other,'near-workshop-view',{account:'a'.repeat(64)}));
  const completed=await f.state(socket,()=>{},m=>m.phase==='results');
  const secondId=completed.stake.chainId;
  const second=await f.state(socket,()=>f.send(socket,'near-play',{id:secondId,entry:200,slots:6}));
  assert.equal(second.round,first.round+1);
  assert.equal(second.stake.round.status,'pending');
  assert.equal((await f.read()).rounds[id],undefined,'rematch starts while prior entry is still in flight');
  await f.state(socket,()=>{},m=>m.phase==='results');
  const otherRoom=await f.state(other,()=>f.send(other,'create-near'),m=>m.phase==='lobby');
  const rejected=await f.next(other,m=>m.type==='error',()=>f.send(other,'near-play',{id:otherRoom.stake.chainId,entry:200,slots:6}));
  assert.match(rejected.message,/more gold/,'other tab cannot spend locally held entries');
  await f.until(async()=>Object.values((await f.read()).rounds).filter(r=>r.status==='settled').length===2);
  const chain=await f.read();
  assert.equal(chain.gold,100);
  assert.equal(chain.events.filter(e=>e==='reserve-start:'+id).length,1);
  assert.ok(chain.events.indexOf('reserve-end:'+id)<chain.events.indexOf('authorize-start:'+secondId));
  assert.equal(chain.rounds[id].winner,null,'old round outcome must stay separate from rematch');
});

test('a signing failure releases the local hold without stopping gameplay or minting a reward', {timeout:12000},async t=>{
  const f=await fixture(t,{signFailure:true}),socket=await f.connect();
  const lobby=await f.state(socket,()=>f.send(socket,'create-near'),m=>m.phase==='lobby');
  await f.state(socket,()=>f.send(socket,'near-play',{id:lobby.stake.chainId,entry:200,slots:6}));
  const result=await f.state(socket,()=>{},m=>m.phase==='results'&&m.stake.round?.status==='cancelled');
  assert.equal(result.stake.round.paid,0);
  assert.equal(result.stake.round.entryFailed,true);
  await f.next(socket,m=>m.type==='near-wallet'&&m.gold===500,()=>f.send(socket,'near-workshop-view',{account:'a'.repeat(64)}));
  assert.equal((await f.read()).events.some(e=>e.startsWith('reserve-start:')),false);
});

test('a lost reserve response is refunded in background while the match still reaches results', {timeout:15000},async t=>{
  const f=await fixture(t,{lostReserve:true}),socket=await f.connect();
  const lobby=await f.state(socket,()=>f.send(socket,'create-near'),m=>m.phase==='lobby');
  await f.state(socket,()=>f.send(socket,'near-play',{id:lobby.stake.chainId,entry:200,slots:6}));
  await f.state(socket,()=>{},m=>m.phase==='results');
  await f.until(async()=>(await f.read()).rounds[lobby.stake.chainId]?.status==='cancelled');
  assert.equal((await f.read()).gold,500);
});

test('a loadout changed during reservation cancels the charge rather than changing the active match', {timeout:15000},async t=>{
  const f=await fixture(t,{rigMismatch:true}),socket=await f.connect();
  const lobby=await f.state(socket,()=>f.send(socket,'create-near'),m=>m.phase==='lobby');
  const start=await f.state(socket,()=>f.send(socket,'near-play',{id:lobby.stake.chainId,entry:200,slots:6}));
  assert.equal(start.match.players.find(p=>!p.bot).rig,'iron');
  const result=await f.state(socket,()=>{},m=>m.phase==='results'&&m.stake.round?.status==='cancelled');
  assert.equal(result.match.players.find(p=>!p.bot).rig,'iron');
  assert.equal(result.stake.round.paid,0);
  assert.equal((await f.read()).gold,500);
});

test('an expired signing session requests renewal before holding gold or starting a paid match', {timeout:10000},async t=>{
  const f=await fixture(t,{expired:true}),socket=await f.connect();
  const lobby=await f.state(socket,()=>f.send(socket,'create-near'),m=>m.phase==='lobby');
  const error=await f.next(socket,m=>m.type==='error',()=>f.send(socket,'near-play',{id:lobby.stake.chainId,entry:200,slots:6}));
  assert.equal(error.renewSession,true);
  assert.equal((await f.read()).gold,500);
  assert.deepEqual((await f.read()).events,[]);
});

test('signing in again refreshes the shared cached balance before instant entry', {timeout:10000},async t=>{
  const f=await fixture(t,{gold:100}),socket=await f.connect();
  await f.next(socket,m=>m.type==='near-workshop',()=>f.send(socket,'near-workshop-view',{account:'a'.repeat(64)}));
  await f.credit(500);
  const other=await f.connect();
  const lobby=await f.state(other,()=>f.send(other,'create-near'),m=>m.phase==='lobby');
  await f.state(other,()=>f.send(other,'near-play',{id:lobby.stake.chainId,entry:200,slots:6}));
});

test('verified social identity survives a throttled balance read and recovers while free gameplay continues', {timeout:10000},async t=>{
  const f=await fixture(t,{workshopFailures:1}),socket=await f.connect(false);
  assert.equal(socket.accountMessage.social,true);
  assert.equal(socket.accountMessage.account,'a'.repeat(64));
  assert.equal(socket.accountMessage.gold,null,'unavailable balance must not become a fake zero');
  assert.equal(socket.accountMessage.balanceLoading,true);
  const authErrors=[];
  socket.on('message',bytes=>{const message=JSON.parse(bytes);if(message.type==='near-social-error')authErrors.push(message);});
  await f.state(socket,()=>f.send(socket,'practice'));
  const loaded=await f.next(socket,m=>m.type==='near-wallet'&&!m.balanceLoading);
  assert.equal(loaded.gold,500);
  assert.deepEqual(authErrors,[],'an RPC problem must never require another social sign-in');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createMatch, readMatch } from '../../shared/simulation.mjs';
import { parseHTML } from 'linkedom';
const { window, document } = parseHTML(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'));
// linkedom does not implement the browser's :modal pseudo-class.
const querySelector=document.querySelector.bind(document);
document.querySelector=selector=>querySelector(selector.replaceAll(':modal','[open]'));
const storage = () => { const data = new Map(); return { getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key) }; };
let timerId = 0;
const timers = new Map();
const fakeTimeout = (callback, ms) => { const id=++timerId; timers.set(id,{callback,ms}); return id; };
const fakeInterval = () => ++timerId;
const realImmediate = setImmediate;
const flush = () => new Promise(resolve => realImmediate(resolve));
Object.assign(globalThis, { window, document, HTMLElement:window.HTMLElement, HTMLDialogElement:window.HTMLElement, Node:window.Node,
  localStorage:storage(),sessionStorage:storage(),BroadcastChannel:undefined,
  location:{ href:'http://localhost:44978/' + (process.argv.includes('--invite') ? '?room=CREW1234' : ''),origin:'http://localhost:44978',reload(){} },
  setTimeout:fakeTimeout,clearTimeout:id=>timers.delete(id),setInterval:fakeInterval,clearInterval(){} });
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async()=>{}}},configurable:true});
window.innerWidth = 393; window.innerHeight = 852;
window.matchMedia = query => ({ matches: process.argv.includes('--touch') && query.includes('pointer: coarse'),addEventListener(){} });
const captured = new Set();
window.HTMLElement.prototype.setPointerCapture = function(id){captured.add(id);};
window.HTMLElement.prototype.hasPointerCapture = function(id){return captured.has(id);};
window.HTMLElement.prototype.releasePointerCapture = function(id){captured.delete(id);};
window.setInterval = fakeInterval;
window.setTimeout = fakeTimeout;
window.clearTimeout = id=>timers.delete(id);
window.requestAnimationFrame = () => 0;
window.HTMLElement.prototype.focus = function () {};
window.HTMLElement.prototype.getBoundingClientRect = () => ({left:0,top:0,right:1000,bottom:1000,width:1000,height:1000});
window.HTMLElement.prototype.show = function () { this.open=true;this.setAttribute('open',''); };
window.HTMLElement.prototype.showModal = window.HTMLElement.prototype.show;
window.HTMLElement.prototype.close = function(value=''){this.returnValue=value;this.open=false;this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
const popups=[];
window.open=(url,name,features)=>{const popup={url,name,features,closed:false,focus(){}};popups.push(popup);return popup;};
const sent=[];
class Socket {
  static CONNECTING=0;static OPEN=1;static CLOSED=3;
  listeners=new Map();readyState=0;
  constructor(){globalThis.testSocket=this;queueMicrotask(()=>{this.readyState=1;this.emit('open',{});});}
  addEventListener(type,callback){const list=this.listeners.get(type)??[];list.push(callback);this.listeners.set(type,list);}
  emit(type,event){for(const listener of this.listeners.get(type)??[])listener(event);}
  message(value){this.emit('message',{data:JSON.stringify(value)});}
  send(value){sent.push(JSON.parse(value));}
  close(){this.readyState=3;this.emit('close',{});}
}
globalThis.WebSocket=Socket;
globalThis.fetch=async url=> String(url).includes('/near-social/session')?new Response(null,{status:204}):Response.json({});
registerHooks({load(url,context,next){
  const stub = source=>({format:'module',shortCircuit:true,source});
  if(url.endsWith('.css'))return stub('');
  if(url.endsWith('/harbor-audio.js'))return stub('export const harborSound=()=>{};export const playPirateVoice=()=>{};export const updateMusic=()=>{};');
  if(url.endsWith('/crowd-audio.js'))return stub('export const playCrowdReaction=()=>{};');
  if(url.endsWith('/arena-view.js'))return stub('export const ARENA_CAMERA={x:1,z:1};export const BARREL_COLORS=[0xff0000,0x00ff00,0x0000ff,0xffff00,0xff00ff,0x00ffff,0xffffff,0x333333];export const createArenaView=()=>({render(){},renderBay(){}});');
  if(url.endsWith('/item-thumbnail.js'))return stub('export function itemThumbnail(){const img=document.createElement("img");img.className="workshop-thumb";return img;}');
  return next(url,context);
}});
const get=id=>document.getElementById(id);
const travel=async()=>{for(const[id,timer]of [...timers])if(timer.ms<=600){timers.delete(id);timer.callback();}await flush();};
const click=async id=>{get(id).click();await travel();};
await import('../../src/main.js');
await flush();
const accessibilityDialog = get('accessibility-settings');
assert.equal(accessibilityDialog.open, true, 'accessibility opens before the first action');
assert.equal(get('accessibility-marker').checked, false, 'high visibility marker is opt-in');
if (process.argv.includes('--touch')) {
  for (const [option, checked] of [['marker',true],['text',true],['color',true],['music',false],['effects',false],['motion',true]]) {
    const input = get('accessibility-' + option);
    input.checked = checked;
    input.dispatchEvent(new window.Event('change'));
  }
  assert.ok(document.documentElement.hasAttribute('data-large-text'));
  assert.ok(document.documentElement.hasAttribute('data-reduce-motion'));
  assert.equal(get('sound').getAttribute('aria-pressed'), 'false');
  assert.equal(get('music').getAttribute('aria-pressed'), 'false');
}
accessibilityDialog.close();
assert.equal(get('mobile-tools-toggle'), null, 'game controls have no overflow menu');
assert.ok(get('feature-help').closest('.header-tools'), 'tutorial is directly in the controls bar');
assert.equal(get('fullscreen').parentElement.getAttribute('aria-describedby'), 'display-hint');
assert.equal(JSON.parse(localStorage.getItem('afloat-accessibility-v1')).seen, true);
assert.match(document.body.dataset.night, /^(true|false)$/);
assert.equal(get('night-mode'), null);
const ws=globalThis.testSocket;
const message=value=>ws.message(value);
const configuration={type:'near-config',contract:'arena.testnet',socialOrigin:location.origin,socialActions:true,socialGoldLimit:10000,starter:true,collection:true,workshop:true,unifiedEconomy:true};
message(configuration);
message({type:'expedition-chain-config',contract:'arena.testnet',unified:true});
await flush();
if (process.argv.includes('--invite')) {
  assert.equal(get('arena-menu').hidden, true);
  assert.equal(get('arena-play-options').hidden, false);
  assert.equal(get('crew-room').hidden, false, 'invitation must reveal the room-code panel');
  assert.equal(get('room-input').value, 'CREW1234');
  assert.notEqual(get('training-guide').open, true, 'invited guests should not be interrupted by the introduction');
  console.log('PASS actual main.js DOM invitation: room-code panel opens directly without an introductory detour.');
  process.exit(0);
}
assert.equal(get('near-social-connect').disabled,false,'guest without wallet packet can sign in');

if (process.argv.includes('--returning')) {
  // A known starter is authoritative even in a browser without the local guide marker.
  message({type:'wallet',gold:10000,rig:'iron',firstBrawl:{status:'claimed',rig:'iron'},workshop:{inventory:[],appearance:{}}});
  await click('open-arena');
  assert.notEqual(get('training-guide').open,true,'returning account must not see an automatic first-play guide');
  assert.equal(get('first-brawl-reward').hidden,true);
  for (const kind of ['practice','fun','room']) {
    result(kind,false);
    assert.equal(get('first-brawl-reward').hidden,true,kind+' must not repeat a claimed starter');
    assert.equal(get('inaugural-farewell').hidden,true,kind+' must not replay the introductory farewell');
    message({type:'left'});await travel();
  }
  console.log('PASS actual main.js DOM returning account: fresh browser does not repeat instructions, starter claim, or farewell.');
  process.exit(0);
}

// Every economic entry reaches the real main.js social popup, not a wallet stub.
await click('captain-menu-open');await click('near-social-connect');
assert.match(popups.at(-1).url,/^\/near-social\/start\?flow=/);
message({type:'near-social-error',message:'Sign-in cancelled.'});
await click('drill');
assert.equal(get('near-workshop-connect').disabled,false);
await click('near-workshop-connect');
assert.match(popups.at(-1).url,/^\/near-social\/start\?flow=/);
message({type:'near-social-error',message:'Sign-in cancelled.'});
await click('back-to-bay');
await click('open-expeditions');
if(get('feature-guide').open)get('feature-guide').close('cancel');
await click('expeditions-utility');
assert.match(popups.at(-1).url,/^\/near-social\/start\?flow=/);
assert.equal(popups.length,3);
message({type:'near-social-error',message:'Sign-in cancelled.'});
await click('back-to-bay');

// The first opening teaches once; Training itself is a distinct free mode.
await click('open-arena');
assert.equal(get('training-guide').open,true);
assert.deepEqual([...get('arena-menu').querySelectorAll('button')].map(b=>b.id),['arena-play','practice']);
get('training-guide').close('cancel');
await click('back-to-bay');await click('open-arena');
assert.equal(get('training-guide').open,false,'introduction must not auto-open twice');
await click('practice');
assert.equal(sent.at(-1).type,'practice');
message({type:'error',message:'Return to menu for next fixture'});
await click('arena-play');
assert.equal(get('arena-menu').hidden,true);assert.equal(get('arena-play-options').hidden,false);
await click('arena-fun');
assert.equal(sent.at(-1).type,'find-fun');
message({type:'error',message:'Return to menu for next fixture'});

// Paid mode advertises authentication before click and waits for both authentication and confirmation.
assert.equal(get('arena-paid').dataset.access,'signin');
assert.match(get('arena-play-price').textContent,/Sign in.*gold entry/);
const beforePaid=sent.filter(m=>m.type==='create-near').length;
await click('arena-paid');
assert.equal(popups.length,4);
assert.notEqual(get('arena-confirm').open,true);
assert.equal(sent.filter(m=>m.type==='create-near').length,beforePaid);
message({type:'near-wallet',account:'a'.repeat(64),gold:null,social:true,balanceLoading:true});await flush();
assert.notEqual(get('arena-confirm').open,true,'verified identity does not imply a known spendable balance');
assert.equal(get('arena-paid').dataset.access,'balance-loading');
assert.equal(sent.filter(m=>m.type==='create-near').length,beforePaid);
message({type:'near-wallet',account:'a'.repeat(64),gold:10000,social:true});await flush();
assert.equal(get('arena-confirm').open,true);
assert.equal(sent.filter(m=>m.type==='create-near').length,beforePaid,'login does not pay an entry');
get('arena-confirm').close('cancel');await flush();
assert.equal(sent.filter(m=>m.type==='create-near').length,beforePaid,'cancel does not create a paid room');
await click('arena-paid');get('arena-confirm').close('play');await flush();
assert.equal(sent.filter(m=>m.type==='create-near').length,beforePaid+1);
message({type:'error',message:'Return to menu for next fixture'});

const wallet={type:'wallet',gold:10000,rig:'oak',workshop:{inventory:[],appearance:{}}};
message({...wallet,firstBrawl:{status:'ready',rig:'iron'}});
function result(kind,inaugural){
  const roster=[{id:'player',name:'You',slot:0,bot:false},{id:'bot',name:'Bot',slot:1,bot:true}];
  const match=createMatch(roster,12,null,{inaugural});match.phase='results';match.winnerId='player';
  match.players[0].rank=1;match.players[1].rank=2;match.players[1].alive=false;
  message({type:'welcome',id:'player',code:'TEST',resumeToken:'fixture-token'});
  message({type:'state',code:'TEST',kind,hostId:'player',round:1,phase:'results',roster,match:readMatch(match),stake:null});
}
for(const kind of ['practice','fun','room']){
  result(kind,false);
  assert.equal(get('results').classList.contains('training-result'), kind === 'practice');
  if (kind === 'practice') {
    assert.equal(get('result-rank').hidden, true);
    assert.equal(get('result-crew').hidden, true);
    assert.equal(get('again').hidden, false);
    assert.equal(get('result-bay').hidden, false);
  }
  assert.equal(get('first-brawl-reward').hidden,true,kind+' has no introduction reward prompt');
  assert.equal(get('inaugural-farewell').hidden,true,kind+' has no introductory farewell');
  message({type:'left'});await travel();
  if (kind === 'practice') {
    assert.equal(get('first-match-prize').open, true, 'first-match reward opens in the bay after training');
    assert.equal(get('first-brawl-reward').hidden, false);
    get('first-match-prize').close('later');
  }
}
result('tutorial',true);
assert.equal(get('first-brawl-reward').hidden,true,'starter prompt waits until the player returns to the bay');
assert.equal(get('inaugural-farewell').hidden,false);
message({type:'left'});await travel();
await click('open-arena');
assert.equal(get('training-guide').open,false,'pending starter does not automatically replay instructions');
assert.equal(get('first-brawl-reward').hidden,true,'pending starter is not forced onto Arena Pier');
await click('feature-help');
assert.equal(get('training-guide').open,true,'help explicitly recovers an unclaimed starter');
assert.equal(get('training-guide').dataset.claimStarter,'true');
assert.equal(get('training-guide-start').hidden,true,'starter recovery does not start another tutorial');
assert.equal(get('first-brawl-reward').hidden,false);
const starter = get('first-brawl-options').querySelector('button[data-rig="iron"]');
assert.ok(starter);
starter.click();await flush();
assert.deepEqual(sent.at(-1),{type:'first-brawl-claim',rig:'iron'});
message({...wallet,rig:'iron',firstBrawl:{status:'claimed',rig:'iron'}});
assert.equal(get('training-guide').open,false,'claim acknowledgement closes recovery');
await click('back-to-bay');await click('open-arena');
assert.equal(get('training-guide').open,false);
assert.equal(get('first-brawl-reward').hidden,true,'claimed starter stays quiet on later visits');

await click('arena-play');
message({type:'near-wallet',account:'a'.repeat(64),gold:0,social:true});
assert.equal(get('arena-paid').disabled,true,'insufficient balance blocks paid entry before attempting it');
assert.equal(get('arena-paid').dataset.access,'insufficient');
assert.match(get('arena-play-price').textContent,/Need.*gold to enter/);

// A social solo replay sends one immediate start; chain work belongs to the server.
message({type:'near-wallet',account:'a'.repeat(64),gold:10000,social:true});
const rematchCrew=[{id:'player',name:'You',slot:0,bot:false},...Array.from({length:7},(_,i)=>({id:'bot-'+i,name:'Bot',slot:i+1,bot:true}))];
const rematch=createMatch(rematchCrew,73);
rematch.phase='results';rematch.winnerId='player';
message({type:'welcome',id:'player',code:'REPLAY',resumeToken:'fixture-replay'});
const paidResult={type:'state',code:'REPLAY',kind:'near',hostId:'player',round:1,phase:'results',
  roster:[rematchCrew[0]],match:readMatch(rematch),
  stake:{network:'testnet',entry:200,ready:[],sessionReady:[],sessionScope:'99',chainId:'100',
    round:{status:'settled',paid:1480,winnerId:'player',pot:1280,fee:320,bonus:200}}};
message(paidResult);
message({type:'near-session-status',scope:'99',session:{remaining:2,expires_at:Date.now()+600000}});
await flush();
assert.match(get('again').textContent,/Play again.*2.00 gold/);
const popupCount=popups.length;
await click('again');
assert.notEqual(get('arena-confirm').open,true,'replay click confirms the visible fee without another modal');
assert.equal(popups.length,popupCount,'social replay does not open a wallet');
assert.deepEqual(sent.at(-1),{type:'near-play',id:'100',entry:200,slots:8});
message({...paidResult,phase:'countdown',match:{...paidResult.match,phase:'countdown',seconds:3},
  stake:{...paidResult.stake,processing:true,pendingEntry:true,round:{status:'pending',paid:0}}});
await flush();
assert.equal(get('preparing').hidden,true,'pending chain entry cannot introduce a waiting overlay');
assert.equal(get('countdown').hidden,false);
const previousFetch=globalThis.fetch;
const automaticPass=[];
globalThis.fetch=async (url,options)=>{
  if(url==='/near-social/action'){
    automaticPass.push(JSON.parse(options.body));
    return Response.json({status:{SuccessValue:''},transaction:{hash:'fixture-pass'}});
  }
  return previousFetch(url,options);
};
message({...paidResult,round:2,stake:{...paidResult.stake,processing:true,sessionScope:'101',chainId:'102',round:{status:'pending',paid:0}}});
assert.equal(get('again').disabled,false,'previous settlement cannot block social replay');
assert.equal(get('result-entry').hidden,true,'solo social results do not repeat entry controls');
await click('again');
await flush();
assert.equal(automaticPass.length,0,'browser never waits for an entry signature before starting');
assert.deepEqual(sent.at(-1),{type:'near-play',id:'102',entry:200,slots:8});
assert.notEqual(get('arena-confirm').open,true);
assert.equal(get('near-room-pass').hidden,true,'social play has no three-entry pass control');
assert.equal(get('first-brawl-wallet'),null,'starter claim never offers a wallet detour');
globalThis.fetch=previousFetch;
message({type:'error',message:'Reset replay before input test'});
message({...paidResult,phase:'playing',match:{...paidResult.match,phase:'playing'}});
const keydown=Object.assign(new window.Event('keydown',{cancelable:true}),{code:'KeyW',key:'w'});
window.dispatchEvent(keydown);
assert.equal(sent.at(-1).type,'input','keyboard steering is sent immediately, without waiting for the interval');
assert.ok(Math.abs(Math.hypot(sent.at(-1).x,sent.at(-1).z)-1)<1e-10,'PC cardinal input has full force');
window.dispatchEvent(Object.assign(new window.Event('keydown',{cancelable:true}),{code:'KeyD',key:'d'}));
assert.ok(Math.abs(Math.hypot(sent.at(-1).x,sent.at(-1).z)-1)<1e-10,'PC diagonals retain full force without a speed bonus');
window.dispatchEvent(Object.assign(new window.Event('keyup',{cancelable:true}),{code:'KeyD',key:'d'}));
window.dispatchEvent(Object.assign(new window.Event('keyup',{cancelable:true}),{code:'KeyW',key:'w'}));
assert.deepEqual(sent.at(-1),{type:'input',x:0,z:0},'key release stops steering immediately');
if (process.argv.includes('--touch')) {
  assert.equal(get('helm').hidden,false,'touch steering must be visible before the first touch');
  Object.defineProperty(get('helm'),'offsetWidth',{value:144,configurable:true});
  const pointer=(type,x,y)=>Object.assign(new window.Event(type,{bubbles:true,cancelable:true}),{pointerType:'touch',pointerId:7,button:0,clientX:x,clientY:y});
  document.body.dispatchEvent(pointer('pointerdown',290,510));
  assert.equal(get('helm').style.left,'290px','first touch relocates the joystick');
  const radius=144*.42;
  for(const force of [.1,.25,.5,1,2]) {
    document.body.dispatchEvent(pointer('pointermove',290+radius*force,510));
    assert.equal(sent.at(-1).type,'input','touch movement is sent immediately');
    assert.ok(Math.abs(Math.hypot(sent.at(-1).x,sent.at(-1).z)-Math.min(1,force))<1e-10,'touch force follows the gesture linearly, without dead zone or extra weight');
  }
  document.body.dispatchEvent(pointer('pointerup',350,510));
  assert.deepEqual(sent.at(-1),{type:'input',x:0,z:0},'touch release stops the input immediately');
  assert.equal(get('helm').hidden,false,'idle joystick returns after release');
  assert.equal(get('helm').dataset.idle,'true');
  assert.equal(get('fullscreen').disabled,false,'unsupported iPhone fullscreen offers guidance rather than a dead button');
  await click('fullscreen'); assert.equal(get('display-help').open,true); get('display-help').close();
}
message(paidResult);
message({type:'error',message:'Renew game session',renewSession:true});
await click('again');
assert.match(popups.at(-1).url,/&renew=1/,'expired replay offers renewal rather than repeating a rejected entry');
message({type:'near-wallet',account:'a'.repeat(64),gold:10000,social:true});await flush();
assert.deepEqual(sent.at(-1),{type:'near-play',id:'100',entry:200,slots:8},'renewal resumes the original replay');
message({type:'error',message:'Reset to pending initial lobby'});
message({...paidResult,phase:'lobby',match:null,stake:{...paidResult.stake,round:null}});
message({type:'error',message:'Renew game session',renewSession:true});
await click('near-social-connect');
message({type:'near-wallet',account:'a'.repeat(64),gold:10000,social:true});await flush();
assert.equal(get('arena-confirm').open,true,'renewal restores the initial price review in an existing lobby');
const createdBeforeRenewal=sent.filter(m=>m.type==='create-near').length;
get('arena-confirm').close('play');await flush();
assert.deepEqual(sent.at(-1),{type:'near-play',id:'100',entry:200,slots:8});
assert.equal(sent.filter(m=>m.type==='create-near').length,createdBeforeRenewal,'renewal reuses the existing lobby');
console.log('PASS actual main.js DOM: guest login, free mode routing, paid entry and instant replay, session renewal, once-only introduction and full-force input.');

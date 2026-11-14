import { harborSound, playPirateVoice, updateMusic } from './harbor-audio.js';
import { mountBayHosts, hostSound } from './bay-hosts.js';
import './style.css';
import './world.css';
import './vault.css';
import './pier.css';
import './first-brawl.css';
import { ARENA_CAMERA, BARREL_COLORS, createArenaView } from './arena-view.js';
import { createBattleFeed } from './battle-feed.js';
import { goldLabel } from './harbor.js';
import { playArenaGold, showArenaGold } from './arena-gold.js';
import { availableGold, goldActionPending } from './pending-gold.js';
import { createCottage } from './cottage.js';
import { createExpeditions } from './expeditions.js';
import { createWorkshop } from './workshop.js';
import { createNearWorkshop } from './near-workshop.js';
import { NearSocialActionError, requiresGameSessionRenewal, readPendingNearEntry, rememberNearEntry, selectNearWallet, setNearSocialAccount,
  signNearChallenge, signNearEntry, signNearSession } from './near-wallet.js';
import { ARENA_ENTRY, GOLD_WAGER_PERCENT, TREASURY_PERCENT, wagerFee } from '../shared/arena-entry.mjs';
import { SOCIAL_LOGIN_WINDOW_MS } from '../shared/social-session.mjs';
import { ACCOUNT_CHOICE_KEY } from '../shared/login-choice.mjs';
import { bayDarkness } from '../shared/world-lighting.mjs';
import { EMOTE_COOLDOWN_MS, MAX_PLAYERS, TICK_RATE } from '../shared/simulation.mjs';
import { arenaHazardCue } from '../shared/arena-hazards.mjs';
import { arenaMapFor } from '../shared/arena-maps.mjs';
import { gameIcon, renderGameIcons } from './game-icons.js';
import { FIRST_BRAWL_RIGS, rigFor } from '../shared/rigs.mjs';
import { itemThumbnail } from './item-thumbnail.js';
import { mountProfileProgress } from './profile-progress.js';
import './quick-play.css';
import { mountCaptainMenu } from './captain-menu.js';
import './pirate-ui.css';
import { mountInterfaceLayout } from './interface-layout.js';
import './interface-layout.css';
import { mountAccessibility, reducedMotion } from './accessibility.js';
import './accessibility.css';
import './mobile-essential.css';

const DRILL_NAMES = { 'head-on': 'Head-on', glancing: 'Glancing blow', edge: 'Near the edge' };
const BAY_TRAVEL_MS = 520;
const HAZARD_ICONS = { broadside: 'cannon', parrots: 'parrot', collapse: 'break', powder: 'powder', kraken: 'kraken' };

mountInterfaceLayout();
renderGameIcons();
const byId = (id) => document.getElementById(id);
function updateWorldTheme() {
  const night = String(room?.match ? room.match.night === true : bayDarkness() >= .5);
  if (document.body.dataset.night !== night) document.body.dataset.night = night;
}
const ui = {
  arena: byId('arena'),
  brand: byId('brand'),
  back: byId('back-to-bay'),
  backLabel: byId('back-label'),
  backdrop: byId('bay-backdrop'),
  bayMap: byId('bay-map'),
  openArena: byId('open-arena'),
  crew: byId('crew'),
  fallback: byId('arena-fallback'),
  overlay: byId('overlay'),
  home: byId('home'),
  lobby: byId('lobby'),
  results: byId('results'),
  countdown: byId('countdown'),
  preparing: byId('preparing'),
  arenaMap: byId('arena-map'),
  connection: byId('connection'),
  sound: byId('sound'),
  soundLabel: byId('sound-label'),
  fullscreen: byId('fullscreen'),
  notice: byId('notice'),
  leaveDialog: byId('leave-dialog'),
  leaveDetail: byId('leave-detail'),
  nickname: byId('nickname'),
  practice: byId('practice'),
  drill: byId('drill'),
  openLab: byId('open-lab'),
  workshop: byId('workshop'),
  drillPanel: byId('drill-panel'),
  drillScenario: byId('drill-scenario'),
  drillRun: byId('drill-run'),
  drillForce: byId('drill-force'),
  drillOwn: byId('drill-own'),
  drillDummy: byId('drill-dummy'),
  drillSteering: byId('drill-steering'),
  create: byId('create'),
  createStakes: byId('create-stakes'),
  createNear: byId('create-near'),
  nearOptions: byId('near-options'),
  nearConnect: byId('near-connect'),
  nearSocialConnect: byId('near-social-connect'),
  nearAccount: byId('near-account'),
  wagerAmount: byId('wager-amount'),
  stakeWager: byId('stake-wager'),
  stakeWagerLabel: byId('stake-wager-label'),
  homeGold: byId('home-gold'),
  pierNotice: byId('pier-notice'),
  lobbyTitle: byId('lobby-title'),
  lobbyDetail: byId('lobby-detail'),
  lobbyCrew: byId('lobby-crew'),
  resultCrew: byId('result-crew'),
  lobbyStake: byId('lobby-stake'),
  resultStake: byId('result-stake'),
  stakeStrip: byId('stake-strip'),
  stakeEntry: byId('stake-entry'),
  stakeBalance: byId('stake-balance'),
  stakeCurrency: byId('stake-currency'),
  stakeRefund: byId('stake-refund'),
  refundReceipt: byId('refund-receipt'),
  stakeDetail: byId('stake-detail'),
  stakeReady: byId('stake-ready'),
  joinForm: byId('join-form'),
  roomInput: byId('room-input'),
  code: byId('code'),
  copy: byId('copy'),
  seatLabel: byId('seat-label'),
  seats: byId('seats'),
  start: byId('start'),
  again: byId('again'),
  resultTitle: byId('result-title'),
  resultDetail: byId('result-detail'),
  resultRank: byId('result-rank'),
  rankValue: byId('rank-value'),
  resultNotice: byId('result-notice'),
  goldResult: byId('gold-result'),
  goldReceipt: byId('gold-receipt'),
  hud: byId('play-hud'),
  clock: byId('clock'),
  count: byId('count'),
  alive: byId('alive'),
  tide: byId('tide'),
  tideIcon: byId('tide-icon'),
  tideValue: byId('tide-value'),
  helm: byId('helm'),
  helmThumb: byId('helm-thumb'),
  emotes: byId('emotes'),
  crewCaption: byId('crew-caption'),
  roster: byId('roster'),
};
const battleFeed = createBattleFeed({
  strip: byId('battle-strip'),
  title: byId('battle-title'),
  detail: byId('battle-detail'),
  recap: byId('battle-recap'),
  recapList: byId('recap-list'),
});
const workshop = createWorkshop(send);
const nearWorkshop = createNearWorkshop(send, connectPlayerAccount);
const cottage = createCottage(send, nearWorkshop.openInventory, nearWorkshop.closeInventory, nearWorkshop.homeState);
const expeditions = createExpeditions(send, connectPlayerAccount, nearWorkshop.homeState);
const updateProfileProgress = mountProfileProgress();
const captainMenu = mountCaptainMenu(name => !room && send({ type: 'pirate-name', name }));
let offeredPirateAccount = '';
let offeredPrize = false;
const prizeDialog = byId('first-match-prize');
const judgesTour = byId('judges-tour');
const judgesWelcome = byId('judges-welcome');
const judgeSteps = Array.from(judgesTour.querySelectorAll('[data-judge-step]'));
const liveJudgeStops = judgeSteps.filter(step => step.querySelector('[data-judge-place]'));
const judgeProgressKey = 'afloat-judges-tour-v1';
let judgeVisit = null;
let completedStops = [];
try {
  const saved = JSON.parse(localStorage.getItem(judgeProgressKey));
  if (Array.isArray(saved)) completedStops = saved.filter(id => judgeSteps.some(step => step.dataset.judgeStep === id));
} catch {}
function showJudgesTour() {
  const thanks = byId('judges-thanks');
  const complete = judgeSteps.every(step => completedStops.includes(step.dataset.judgeStep));
  const justCompleted = complete && thanks.hidden;
  thanks.hidden = !complete;
  for (const step of judgeSteps) {
    const visited = completedStops.includes(step.dataset.judgeStep);
    step.querySelector('input').checked = visited;
    step.classList.toggle('visited', visited);
  }
  const visited = liveJudgeStops.filter(step => completedStops.includes(step.dataset.judgeStep)).length;
  text(byId('judges-progress'), visited + ' / ' + liveJudgeStops.length + ' live stops visited');
  if (!judgesTour.open) judgesTour.showModal();
  if (justCompleted) thanks.scrollIntoView?.({ block: 'nearest' });
}
function recordJudgeStop(id) {
  if (!completedStops.includes(id)) {
    completedStops.push(id);
    try { localStorage.setItem(judgeProgressKey, JSON.stringify(completedStops)); } catch {}
  }
}
function finishJudgeVisit(completed = true) {
  if (!judgeVisit) return false;
  if (completed) recordJudgeStop(judgeVisit);
  judgeVisit = null;
  showJudgesTour();
  return true;
}
for (const link of judgesTour.querySelectorAll('#bay-tests a')) link.addEventListener('click', () => {
  recordJudgeStop(link.closest('[data-judge-step]').dataset.judgeStep);
  showJudgesTour();
});
byId('evaluation-mode').addEventListener('click', () => judgesWelcome.showModal());
byId('judges-welcome-start').addEventListener('click', () => {
  judgesWelcome.close();
  showJudgesTour();
});
for (const button of judgesTour.querySelectorAll('[data-judge-place]')) {
  button.addEventListener('click', () => {
    if (room || pending || journey) return;
    judgeVisit = button.closest('[data-judge-step]').dataset.judgeStep;
    judgesTour.close();
    const targets = { arena: ui.openArena, lab: ui.drill, home: byId('open-home'), expeditions: byId('open-expeditions') };
    targets[button.dataset.judgePlace].click();
  });
}
let suggestedPirateName = '';
let pendingPiratePrompt = false;
const pirateNameDialog = byId('pirate-name-dialog');
pirateNameDialog.addEventListener('close', () => {
  const name = pirateNameDialog.returnValue === 'save' ? byId('pirate-name-first').value : suggestedPirateName;
  if (!room) send({ type: 'pirate-name', name: name || suggestedPirateName });
});
const bayMarkers = new Map([...ui.bayMap.querySelectorAll('[data-place]')].map((button) => [button.dataset.place, button]));
const joinButton = ui.joinForm.querySelector('button');
const roomModes = new Map(['crew', 'gold'].map(mode => [mode, {
  button: byId('show-' + mode + '-room'),
  panel: byId(mode + '-room'),
}]));
const connectionLabel = ui.connection.querySelector('span');
const emoteButtons = ui.emotes.querySelectorAll('[data-emote]');
const trialButtons = ui.drillScenario.querySelectorAll('[data-scenario]');
const bayHosts = mountBayHosts(byId('bay-host'), (speaker, phrase) => {
  unlockSound();
  if (!soundOn || !audio) return;
  if (speaker === 'captain') {
    playPirateVoice(phrase, .6, true);
    return;
  }
  if (audio.state === 'running') hostSound(audio, speaker);
  else audio.resume().then(() => { if (soundOn) hostSound(audio, speaker); }).catch(() => {});
}, place => {
  if (journey || room || pending || socket?.readyState !== WebSocket.OPEN) return false;
  const marker = bayMarkers.get(place);
  if (!marker || marker.disabled) return false;
  marker.click();
  return true;
});

const featureHelp = byId('feature-help');
const featureGuide = byId('feature-guide');
const featureLessons = {
  arena: ['Arena Pier', 'For Fun: online crew and bots, no rewards. Plunder Pot: pay the gold entry and fight for the pot. Training: bots only, no rewards.'],
  lab: ['Barrel Works', 'Buy gear or sell it to the merchant. Wanted offers pay more when stock runs low.'],
  home: ['Your Cottage', 'Equip your barrel, outfit and pet in Gear. Decor lets you furnish your home.'],
  expeditions: ['Expeditions', 'Fund a voyage and share the proceeds, or bid for the cargo when the ship docks.'],
};
const seenLessons = new Set();
let helpPlace = '';

function showFeatureLesson(place) {
  const lesson = featureLessons[place];
  if (!lesson || featureGuide.open) return;
  text(byId('feature-guide-title'), lesson[0]);
  text(byId('feature-guide-text'), lesson[1]);
  featureGuide.showModal();
  seenLessons.add(place);
  try { localStorage.setItem('bay-lesson-' + place, 'seen'); } catch {}
}

featureHelp.addEventListener('click', () => {
  if (helpPlace === 'arena') openIntroduction(true);
  else if (helpPlace) showFeatureLesson(helpPlace);
  else bayHosts.replay();
});

function updateFeatureHelp(phase) {
  const visiting = phase === 'home' && !journey;
  helpPlace = destination;
  featureHelp.hidden = !visiting;
  if (helpPlace === 'arena' || (helpPlace === 'lab' && nearCollection)) return;
  if (!visiting || !featureLessons[helpPlace] || seenLessons.has(helpPlace)) return;
  try { if (localStorage.getItem('bay-lesson-' + helpPlace)) return; } catch {}
  showFeatureLesson(helpPlace);
}

const firstBrawl = {
  reward: byId('first-brawl-reward'),
  title: byId('first-brawl-title'),
  options: byId('first-brawl-options'),
  result: byId('first-brawl-result'),
  farewell: byId('inaugural-farewell'),
  rematch: byId('first-brawl-rematch'),
  cottage: byId('first-brawl-cottage'),
  notice: byId('first-brawl-notice'),
  breakdown: byId('round-gold-breakdown'),
};
const trainingGuide = byId('training-guide');
const arenaConfirm = byId('arena-confirm');
let quickPlay = null;
let confirmedPlay = null;
let arenaChoices = false;
let freePlayAfterLeaving = false;
let paidReviewAfterLogin = null;
const INTRO_GUIDE_KEY = 'nearly-afloat:introduction-seen';
let introductionSeen = false;
try { introductionSeen = localStorage.getItem(INTRO_GUIDE_KEY) === '1' || Boolean(localStorage.getItem('bay-lesson-arena')); } catch {}
for (const [index, mapId] of ['harbor', 'jungle', 'wreck'].entries()) {
  const map = arenaMapFor(mapId);
  const preview = document.querySelectorAll('.adventure-previews > div')[index];
  preview.prepend(itemThumbnail({ slot: 'arena', color: map.color ?? 0xbc8a4c, trim: map.trim ?? 0xe2c078 }));
  const name = document.createElement('small');
  name.textContent = map.label;
  preview.append(name);
}
for (const [index, [label, icon]] of [['Move', 'arrow'], ['Knock them off', 'impact'], ['Last one wins', 'trophy']].entries()) {
  const frame = document.createElement('div');
  frame.className = 'training-frame';
  const picture = document.createElement('div');
  picture.className = 'training-picture';
  picture.append(itemThumbnail(rigFor(FIRST_BRAWL_RIGS[0])), gameIcon(icon));
  if (index === 1) picture.append(itemThumbnail(rigFor(FIRST_BRAWL_RIGS[1])));
  const labelElement = document.createElement('strong');
  labelElement.textContent = label;
  frame.append(picture, labelElement);
  byId('training-story').append(frame);
}

function openIntroduction(manual = false) {
  if (room || pending || trainingGuide.open || socket?.readyState !== WebSocket.OPEN) return;
  if (!manual && (wallet?.firstBrawl || introductionSeen)) return;
  const recovering = manual && wallet?.firstBrawl?.status === 'ready';
  trainingGuide.dataset.claimStarter = String(recovering);
  text(byId('training-title'), recovering ? 'Your starter barrel' : 'Stay afloat!');
  byId('training-story').hidden = recovering;
  trainingGuide.querySelector('.training-controls').hidden = recovering;
  byId('training-guide-start').hidden = recovering;
  trainingGuide.returnValue = '';
  trainingGuide.showModal();
  renderInterface();
}

function openTraining() {
  if (pending || room || socket?.readyState !== WebSocket.OPEN) return;
  request('practice', { name: ui.nickname.value });
}

function playForFun() {
  if (pending || socket?.readyState !== WebSocket.OPEN) return;
  if (room) {
    if (isActive(room.phase)) return;
    freePlayAfterLeaving = true;
    request('leave');
  } else request('find-fun', { name: ui.nickname.value });
}

trainingGuide.addEventListener('close', () => {
  introductionSeen = true;
  try { localStorage.setItem(INTRO_GUIDE_KEY, '1'); } catch {}
  if (trainingGuide.returnValue === 'play' && !room && !pending && socket?.readyState === WebSocket.OPEN) {
    request(wallet?.firstBrawl ? 'practice' : 'tutorial', { name: ui.nickname.value });
  } else renderInterface();
});

for (const modal of [trainingGuide, arenaConfirm]) {
  modal.addEventListener('click', event => {
    if (event.target !== modal) return;
    const bounds = modal.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) modal.close('cancel');
  });
}

function reviewPlay(replay = false) {
  if (pending || quickPlay || arenaConfirm.open || nearBusy || socket?.readyState !== WebSocket.OPEN) return;
  if (replay && !room?.stake) {
    request('start', { slots: room.match.players.length });
    return;
  }
  if (!nearContract) {
    feedback = { message: 'Plunder Pot is unavailable. For Fun and Training are free.', error: true };
    renderInterface();
    return;
  }
  if (!nearWallet || nearRenewalNeeded) {
    paidReviewAfterLogin = { replay, code: room?.code ?? null };
    if (!connectPlayerAccount()) paidReviewAfterLogin = null;
    return;
  }
  if (nearWorkshop.isBusy() || expeditions.isBusy() || goldActionPending()) {
    feedback = { message: 'Wait for your current gold action to finish before entering.', error: false };
    renderInterface();
    return;
  }
  if (nearWallet.balanceLoading || !Number.isSafeInteger(nearWallet.gold)) {
    feedback = { message: 'Your gold is updating. Free modes are ready to play.', error: false };
    renderInterface();
    return;
  }
  const direct = replay && room.stake.network === 'testnet' && nearWallet.social && nearSocialActions &&
    room.roster.length === 1 && room.hostId === member?.id;
  if (nearWallet.gold < ARENA_ENTRY && !(direct && room.stake.processing)) {
    feedback = { message: `You need ${goldLabel(ARENA_ENTRY)} gold for the entry.`, error: true };
    renderInterface();
    return;
  }
  const network = replay ? room.stake.network === 'testnet' : Boolean(nearContract);
  const entry = replay ? room.roster.find(player => player.id === member?.id)?.wager ?? room.stake.entry : ARENA_ENTRY;
  if (direct) {
    showArenaGold({ debit: entry }, reducedMotion.matches);
    quickPlay = { replay, account: nearWallet.account, network, slots: room.match.players.length,
      code: room.code, stage: 'entry' };
    renderInterface();
    return;
  }
  confirmedPlay = { replay, account: nearWallet?.account ?? null, network, slots: replay ? room.match.players.length : MAX_PLAYERS };
  text(byId('arena-confirm-title'), 'Enter Plunder Pot?');
  text(byId('arena-confirm-detail'), `${goldLabel(entry)} gold entry · ${network ? TREASURY_PERCENT : GOLD_WAGER_PERCENT}% fee. Winner takes the pot. A cancelled round returns your entry.`);
  arenaConfirm.returnValue = '';
  arenaConfirm.showModal();
}

arenaConfirm.addEventListener('close', () => {
  const choice = confirmedPlay;
  confirmedPlay = null;
  if (arenaConfirm.returnValue !== 'play' || !choice || quickPlay || pending) return;
  if (goldActionPending()) return;
  if ((!choice.replay && choice.network !== Boolean(nearContract)) || (choice.account && nearWallet?.account !== choice.account)) return;
  showArenaGold({ debit: ARENA_ENTRY }, reducedMotion.matches);
  quickPlay = { ...choice, stage: 'connect', code: choice.replay ? room?.code : null };
  if (nearContract && !nearWallet) {
    void connectPlayerAccount();
    renderInterface();
  } else advanceQuickPlay();
});

function advanceQuickPlay() {
  const flow = quickPlay;
  if (!flow || pending || nearBusy || socket?.readyState !== WebSocket.OPEN) return;
  if (flow.stage === 'connect') {
    if (flow.network && !nearWallet) return;
    if (flow.account && flow.account !== nearWallet?.account) { quickPlay = null; return; }
    flow.account = nearWallet?.account ?? null;
    if (flow.replay) flow.stage = 'entry';
    else if (room) {
      if (room.kind !== 'near' || room.phase !== 'lobby' || room.hostId !== member?.id) { quickPlay = null; return; }
      flow.code = room.code;
      flow.stage = 'entry';
    } else {
      flow.stage = 'create';
      request(flow.network ? 'create-near' : 'create-stakes', { name: ui.nickname.value, wager: ARENA_ENTRY });
      return;
    }
  }
  if (flow.stage === 'create') {
    if (!room || room.hostId !== member?.id) return;
    flow.code = room.code;
    flow.stage = 'entry';
  }
  if (!room || room.code !== flow.code || room.hostId !== member?.id || !room.stake || isActive(room.phase)) return;
  if (flow.stage === 'entry') {
    if (flow.network && nearWallet?.social && nearSocialActions && !nearRenewalNeeded && room.roster.length === 1) {
      flow.stage = 'start';
      request('near-play', { id: room.stake.chainId, entry: ARENA_ENTRY, slots: flow.slots });
      return;
    }
    if (room.stake.processing || currentNearEntry() || nearEntrySigning) return;
    flow.stage = 'confirming';
    if (!room.stake.ready.includes(member.id)) {
      void confirmStake();
      return;
    }
  }
  if (flow.stage === 'confirming' && !room.stake.processing && room.stake.ready.includes(member.id)) {
    flow.stage = 'start';
    request('start', { slots: flow.slots });
  }
}

const emoteKeys = new Map([['Digit1', 'wave'], ['Digit2', 'cheer'], ['Digit3', 'shrug']]);
const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const keys = new Set();
const thumb = { id: null, x: 0, up: 0, centerX: 0, centerY: 0, radius: 1 };
let helmUsedInRound = '';
const cameraDistance = Math.hypot(ARENA_CAMERA.x, ARENA_CAMERA.z);
const slotColors = BARREL_COLORS.map((color) => '#' + color.toString(16).padStart(6, '0'));
const storageKey = 'barrel-bay:member';
const socketUrl = new URL('/arena', location.href);
socketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

let socket;
let member = null;
let room = null;
let wallet = null;
let nearContract = '';
let goldWalletEnabled = false;
let nearWallet = null;
let nearSocialAvailable = false;
let nearSocialActions = false;
let nearSocialGoldLimit = 0;
let nearSocialPending = false;
let nearRenewalNeeded = false;
let socialPopup = null;
let socialChannel = null;
let socialPopupTimer = null;
let socialProofTimer = null;
let nearBusy = false;
let nearConnecting = '';
let nearEntry = null;
let nearEntryTimer = null;
let nearEntrySigning = false;
let nearPass = null;
let nearPassProbe = '';
let nearPassChange = null;
let nearPassTimer = null;
const nearPassButton = byId('near-room-pass');
const nearPassDetail = byId('near-room-pass-detail');
const invite = new URL(location.href);
let nearInvite = invite.searchParams.get('network') === 'testnet';
let destination = '';
let journey = null;
let travelTimer;
let hasBayView = false;
let pending = null;
let feedback = null;
let leavingForCottage = false;
let claimedInWorkshop = false;
let rewardRound = null;
let firstBrawlClaim = null;
let firstBrawlAfterConnect = null;
let nearStarter = false;
let nearCollection = false;
let firstBrawlError = '';
let shownBreakdown = '';
let rosterKey = '';
let roomMode = '';
let heardEvent = -1;
let nextEmoteAt = 0;
let soundOn = true;
let musicOn = true;
try {
  soundOn = localStorage.getItem('afloat-effects') !== 'off';
  musicOn = localStorage.getItem('afloat-music') !== 'off';
} catch {}
function syncAudioButtons() {
  ui.sound.setAttribute('aria-pressed', String(soundOn));
  ui.sound.title = ui.sound.ariaLabel = soundOn ? 'Effects on' : 'Effects muted';
  text(ui.soundLabel, soundOn ? 'Effects on' : 'Effects off');
  byId('music').setAttribute('aria-pressed', String(musicOn));
  byId('music').title = byId('music').ariaLabel = musicOn ? 'Music on' : 'Music muted';
}
syncAudioButtons();
let soundStarted = false;
let audio;
const accessSetup = mountAccessibility(() => ({ effects: soundOn, music: musicOn }), setAudioPreference, renderInterface);

try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  if (typeof saved?.id === 'string' && typeof saved.code === 'string' && typeof saved.resumeToken === 'string') {
    member = saved;
  }
} catch {
  // The live connection still works if tab storage is unavailable.
}
const savedNearEntry = readPendingNearEntry(member);
if (savedNearEntry) nearEntry = { ...savedNearEntry, stage: 'checking', checks: 0 };

function rememberMember(next) {
  member = next;
  try {
    if (member) sessionStorage.setItem(storageKey, JSON.stringify(member));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // Keep the ticket in memory so a dropped socket can still reconnect.
  }
}

function text(element, value) {
  const next = String(value);
  if (element.textContent !== next) element.textContent = next;
}

function renderTide(icon, label, value = '') {
  if (ui.tideIcon.dataset.icon !== icon) {
    ui.tideIcon.dataset.icon = icon;
    ui.tideIcon.replaceChildren(gameIcon(icon));
  }
  ui.tide.title = label;
  ui.tide.setAttribute('aria-label', label);
  text(ui.tideValue, value);
}

function isActive(phase) {
  return phase === 'countdown' || phase === 'playing';
}

function ownBarrel() {
  return room?.match?.players.find((player) => player.id === member?.id);
}

function renderRoster(phase, match) {
  const final = phase === 'results';
  const players = final ? match.players : room?.roster ?? [];
  const sorted = [...players].sort((a, b) => final ? a.rank - b.rank || a.slot - b.slot : a.slot - b.slot);
  const eliminated = new Set(match?.players.filter((player) => !player.alive).map((player) => player.id));
  const entries = sorted.map((player) => {
    const self = player.id === member?.id;
    const out = eliminated.has(player.id);
    let status = player.bot ? 'BOT' : 'CREW';
    if (room.kind === 'drill' && player.bot) status = 'TARGET';
    if (player.id === room.hostId) status = 'HOST';
    if (self) status = 'YOU';
    if (player.connected === false) status = 'AWAY';
    if (out) status = 'OUT';
    if (final) status = '#' + player.rank;
    const color = player.appearance?.barrelColor ?? player.appearance?.pirateColor ?? slotColors[player.slot];
    return { name: player.name, color, status: player.wager ? status + ' · ' + goldLabel(player.wager) + ' gold' : status, self, out };
  });
  const key = JSON.stringify(entries);
  if (key === rosterKey) return;
  rosterKey = key;
  ui.roster.replaceChildren(...entries.map((entry) => {
    const row = document.createElement('li');
    const flag = document.createElement('i');
    const name = document.createElement('strong');
    const status = document.createElement('small');
    row.classList.toggle('self', Boolean(entry.self));
    row.classList.toggle('eliminated', Boolean(entry.out));
    if (entry.color) row.style.setProperty('--flag', entry.color);
    flag.setAttribute('aria-hidden', 'true');
    name.textContent = entry.name;
    status.textContent = entry.status ?? '';
    row.append(flag, name, status);
    return row;
  }));
}

function syncNavigation() {
  if (pendingPiratePrompt && !room && !journey && !document.querySelector('dialog:modal')) {
    pendingPiratePrompt = false;
    pirateNameDialog.showModal();
  }
  ui.back.hidden = !(destination || room);
  ui.brand.hidden = !ui.back.hidden;
  ui.back.disabled = Boolean(pending || (room && socket?.readyState !== WebSocket.OPEN));
  text(ui.backLabel, judgeVisit ? 'Back to Judges Tour' : 'Back to bay');
  text(byId('result-bay-label'), judgeVisit ? 'Back to Judges Tour' : 'Back to bay');
  ui.backdrop.hidden = !(destination) || Boolean(room || pending);
  const steerable = canSteer();
  document.documentElement.toggleAttribute('data-helm-ready', Boolean(steerable));
  if (!steerable && (keys.size || thumb.id !== null)) releaseControls();
  syncHelmHint();
}

const rewardButtons = FIRST_BRAWL_RIGS.map(id => {
  const rig = rigFor(id);
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.rig = id;
  button.setAttribute('aria-label', rig.label + '. ' + rig.description);
  const label = document.createElement('strong');
  label.textContent = rig.label;
  const stats = document.createElement('span');
  stats.className = 'first-brawl-stats';
  for (const [icon, value, name] of [['impact', rig.mass, 'Impact weight'], ['control', rig.turn, 'Turning control']]) {
    const stat = document.createElement('span');
    stat.dataset.benefit = String(value > 1);
    stat.title = name;
    stat.append(gameIcon(icon), value > 1 ? '↑' : '↓');
    stats.append(stat);
  }
  button.append(itemThumbnail(rig), label, stats);
  button.addEventListener('click', () => {
    if (firstBrawlClaim || wallet?.firstBrawl?.status !== 'ready') return;
    if (nearStarter && !nearWallet) {
      if (nearBusy) return;
      firstBrawlAfterConnect = { rig: id, memberId: member?.id };
      firstBrawlError = '';
      void connectPlayerAccount();
      return;
    }
    claimFirstBrawl(id);
    renderInterface();
  });
  firstBrawl.options.append(button);
  return button;
});

function claimFirstBrawl(rig) {
  if (!send({ type: 'first-brawl-claim', rig })) return;
  firstBrawlClaim = rig;
  firstBrawlError = '';
}

function renderFirstBrawl(phase, ready) {
  if (prizeDialog.open && (phase !== 'home' || destination)) prizeDialog.close();
  const rewardReady = wallet?.firstBrawl?.status === 'ready';
  const claimed = claimedInWorkshop && wallet?.firstBrawl?.status === 'claimed'
    && phase === 'results' && rewardRound === room.code + '/' + room.round;
  const inauguralResult = phase === 'results' && room?.kind === 'tutorial' && room.match?.inaugural === true;
  const recovering = trainingGuide.open && trainingGuide.dataset.claimStarter === 'true';
  if (phase === 'home' && !destination && !judgeVisit && rewardReady && !offeredPrize && ![...document.querySelectorAll('dialog')].some(dialog => dialog.open)) {
    offeredPrize = true;
    prizeDialog.showModal();
  }
  if (!rewardReady && prizeDialog.open) prizeDialog.close();
  const showReward = (prizeDialog.open || recovering) && rewardReady;
  firstBrawl.farewell.hidden = !inauguralResult;
  text(firstBrawl.farewell.querySelector('p'), wallet?.firstBrawl?.status === 'claimed' ? 'Your barrel is ready. More chaos awaits!' : 'Pick your free barrel. Come back for more!');
  if (showReward) {
    const target = recovering ? byId('intro-reward-recovery') : byId('first-match-prize-content');
    if (firstBrawl.reward.parentElement !== target) target.append(firstBrawl.reward);
  }
  firstBrawl.reward.hidden = !showReward;
  ui.practice.classList.remove('tutorial-action');
  firstBrawl.options.hidden = !rewardReady;
  firstBrawl.rematch.hidden = firstBrawl.cottage.hidden = !claimed;
  const resultActions = ui.again.parentElement;
  const rewardActions = firstBrawl.reward.querySelector('.first-brawl-actions');
  if (firstBrawl.rematch.parentElement !== rewardActions) {
    rewardActions.prepend(firstBrawl.rematch, firstBrawl.cottage);
  }
  resultActions.classList.remove('result-actions--first');
  firstBrawl.cottage.disabled = !ready;
  const firstStep = !wallet?.firstBrawl && !introductionSeen ? 'Start here' : '';
  const nextMarker = ui.openArena;
  for (const marker of [ui.openArena, ui.drill]) {
    const cue = marker.querySelector('.bay-next-step');
    cue.hidden = !(marker === nextMarker && firstStep && wallet);
    text(cue, cue.hidden ? '' : firstStep);
  }
  firstBrawl.rematch.disabled = !ready;
  for (const button of rewardButtons) button.disabled = !ready || Boolean(firstBrawlClaim || firstBrawlAfterConnect);
  text(firstBrawl.title, claimed ? rigFor(wallet.rig).label + ' equipped' : 'Choose your first barrel');
  const socialNotice = nearSocialPending ? 'Finish signing in to receive your barrel.'
    : nearSocialAvailable && nearSocialActions && nearStarter && !nearWallet && rewardReady
      ? 'Join the crew to keep your gear.' : '';
  firstBrawl.notice.hidden = !(firstBrawlError || socialNotice);
  text(firstBrawl.notice, firstBrawlError || socialNotice);
}

function renderGoldBreakdown(phase) {
  const round = room?.stake?.round;
  const settled = phase === 'results' && round?.status === 'settled';
  firstBrawl.breakdown.hidden = !settled;
  if (!settled) return;
  const values = [
    ['coin', 'Your wager', round.wagers?.[member?.id] ?? room.stake.entry], ['bag', 'Pot', round.pot], ['tag', 'Treasury', round.fee],
    ...(round.bonus ? [['plus', 'Bonus', round.bonus]] : []),
    ['trophy', 'Paid', round.paid],
  ].filter(([, , value]) => Number.isFinite(value));
  const key = JSON.stringify(values);
  if (key === shownBreakdown) return;
  shownBreakdown = key;
  firstBrawl.breakdown.replaceChildren(...values.map(([icon, name, value]) => {
    const cell = document.createElement('div');
    const term = document.createElement('dt');
    const amount = document.createElement('dd');
    term.append(gameIcon(icon), name);
    amount.textContent = goldLabel(value);
    cell.append(term, amount);
    return cell;
  }));
}

function renderInterface() {
  updateWorldTheme();
  const phase = room?.phase ?? 'home';
  const match = room?.match;
  const drill = match?.drill;
  const own = ownBarrel();
  const active = isActive(phase);
  const host = Boolean(member && room?.hostId === member.id);
  const online = socket?.readyState === WebSocket.OPEN;
  updateMusic(soundStarted && musicOn, phase === 'playing');
  const rejoining = pending === 'resume' || Boolean(member && !online);
  const ready = online && !pending;
  let connectionState = 'error';
  let connectionText = 'Offline';
  if (rejoining) {
    connectionState = 'pending';
    connectionText = 'Rejoining';
  } else if (online) {
    connectionState = 'ready';
    connectionText = 'Online';
  } else if (socket?.readyState === WebSocket.CONNECTING) {
    connectionState = 'pending';
    connectionText = 'Connecting';
  }
  ui.connection.dataset.state = connectionState;
  ui.connection.setAttribute('aria-label', connectionText);
  ui.connection.title = connectionText;
  text(connectionLabel, connectionText);

  const phaseChanged = ui.overlay.dataset.screen !== phase;
  ui.overlay.dataset.screen = phase;
  document.body.dataset.scene = room ? phase : 'bay';
  document.body.dataset.place = destination;
  for (const screen of ['lobby', 'preparing', 'countdown', 'results']) ui[screen].hidden = screen !== phase;
  ui.home.hidden = phase !== 'home' || destination !== 'arena' || journey;
  ui.workshop.hidden = phase !== 'home' || destination !== 'lab' || journey;
  workshop.update(wallet, online);
  nearWorkshop.update(online, !ui.workshop.hidden, nearWallet?.account,
    phase === 'home' && destination === 'home' && !journey, nearBusy);
  cottage.update(wallet, online, ready, phase === 'home' && destination === 'home' && !journey,
    nearCollection ? nearWallet?.account : null);
  expeditions.update(wallet, online, phase === 'home' && destination === 'expeditions' && !journey, nearBusy || nearEntrySigning,
    nearWallet?.account ?? null, nearRenewalNeeded, nearWallet?.gold ?? null);
  updateProfileProgress(online && Boolean(wallet));
  renderFirstBrawl(phase, ready);
  renderGoldBreakdown(phase);
  ui.bayMap.hidden = phase !== 'home' || Boolean(destination) || journey;
  updateFeatureHelp(phase);
  accessSetup.button.hidden = ui.bayMap.hidden;
  bayHosts.update(!accessSetup.dialog.open && !ui.bayMap.hidden && ready && Boolean(wallet), wallet?.firstBrawl?.status ?? 'new', claimedInWorkshop, hasBayView);
  const trainingResult = phase === 'results' && room?.kind === 'practice';
  ui.results.classList.toggle('training-result', trainingResult);
  byId('result-eyebrow').hidden = trainingResult;
  byId('result-crew').hidden = trainingResult;
  const staging = phase === 'lobby' || (phase === 'results' && !trainingResult);
  if (staging) {
    const crewSlot = phase === 'lobby' ? ui.lobbyCrew : ui.resultCrew;
    if (ui.crew.parentElement !== crewSlot) {
      ui.crew.open = false;
      crewSlot.append(ui.crew);
    }
  }
  ui.crew.hidden = !staging;
  for (const button of [ui.practice, ui.drill, ui.openLab, ui.create, joinButton]) button.disabled = !ready;
  ui.practice.disabled = !ready || nearBusy;
  ui.seatLabel.hidden = ui.start.hidden = !host;
  ui.again.hidden = (!host && room?.kind !== 'fun') || (phase === 'results' && room?.kind === 'tutorial' && !firstBrawl.reward.hidden);
  byId('result-bay').disabled = !ready;
  ui.seats.disabled = ui.start.disabled = ui.again.disabled = !ready;
  ui.createStakes.disabled = !ready || !wallet;
  const unified = document.body.classList.contains('unified-near-economy');
  byId('arena-play').disabled = !ready || nearBusy || Boolean(quickPlay);
  byId('arena-menu').hidden = arenaChoices;
  byId('arena-play-options').hidden = !arenaChoices;
  byId('arena-play').setAttribute('aria-expanded', String(arenaChoices));
  byId('arena-fun').disabled = !ready || nearBusy;
  byId('arena-modes-back').disabled = !ready;
  const paidState = !nearContract ? 'unavailable' : nearBusy || nearEntrySigning ? 'busy'
    : !nearWallet ? 'signin' : nearRenewalNeeded ? 'renew'
      : nearWallet.balanceLoading || !Number.isSafeInteger(nearWallet.gold) ? 'balance-loading'
        : nearWallet.gold < ARENA_ENTRY ? 'insufficient' : 'ready';
  byId('arena-paid').disabled = !ready || Boolean(quickPlay) || ['unavailable', 'busy', 'balance-loading', 'insufficient'].includes(paidState);
  byId('arena-paid').dataset.access = paidState;
  text(byId('arena-play-price'), paidState === 'unavailable' ? 'Unavailable · Try For Fun'
    : paidState === 'balance-loading' ? 'Updating gold · For Fun is ready'
      : paidState === 'busy' ? 'Signing in…' : paidState === 'signin' ? `Sign in · ${goldLabel(ARENA_ENTRY)} gold entry`
      : paidState === 'renew' ? `Renew session · ${goldLabel(ARENA_ENTRY)} gold entry`
        : paidState === 'insufficient' ? `Need ${goldLabel(ARENA_ENTRY)} gold to enter`
          : `${goldLabel(ARENA_ENTRY)} gold entry · Winner takes the pot`);
  roomModes.get('gold').button.closest('.pier-mode').hidden = true;
  byId('gold-room').hidden = true;
  const goldButton = roomModes.get('gold').button;
  const goldText = unified ? 'Plunder Pot' : 'Wager test gold';
  if (goldButton.lastChild?.nodeType === Node.TEXT_NODE) goldButton.lastChild.nodeValue = goldText;
  byId('near-entry-summary').hidden = !unified || roomMode !== 'gold';
  ui.nearOptions.hidden = !nearContract;
  ui.nearConnect.hidden = Boolean(nearWallet);
  const signInBlocked = !nearWallet && Boolean(room && !(nearStarter && ['practice', 'tutorial', 'fun', 'room'].includes(room.kind) && phase === 'results'));
  ui.nearConnect.disabled = !ready || nearBusy || nearEntrySigning || signInBlocked;
  ui.nearSocialConnect.hidden = !nearSocialAvailable || Boolean(nearWallet && !nearRenewalNeeded);
  if (ui.nearSocialConnect.lastChild?.nodeType === Node.TEXT_NODE) {
    ui.nearSocialConnect.lastChild.nodeValue = nearRenewalNeeded ? 'Continue playing' : 'Join the crew';
  }
  ui.nearSocialConnect.disabled = ui.nearConnect.disabled;
  ui.nearSocialConnect.title = signInBlocked ? 'Finish the round before signing in.'
    : nearSocialActions ? `Game session up to ${goldLabel(nearSocialGoldLimit)} test gold for 8 hours` : '';
  text(byId('captain-guest-hint'), signInBlocked ? 'Finish the round before joining the crew.' : 'Join the crew to keep your loot and enter Plunder Pot.');
  byId('near-social-logout').hidden = !nearWallet?.social;
  ui.createNear.hidden = true;
  ui.createNear.disabled = !ready || !nearWallet;
  text(ui.nearAccount, nearWallet ? nearWallet.account + ' · NEAR testnet' : 'Your progress is saved on this device until you sign in.');
  captainMenu.update({ account: nearWallet, goldWalletEnabled, gold: nearWallet ? availableGold(nearWallet.account, nearWallet.gold) : (!nearContract ? wallet?.gold : null),
    balanceLoading: nearWallet?.balanceLoading === true,
    enabled: Boolean(nearContract), online, busy: nearBusy || nearEntrySigning || Boolean(nearPassChange) || nearWorkshop.isBusy() || expeditions.isBusy(), sound: soundOn,
    goldActionPending: goldActionPending(),
    locked: Boolean(room && (isActive(phase) || room.stake?.processing || room.stake?.round?.status === 'reserved')) });
  text(ui.homeGold, wallet ? goldLabel(wallet.gold) : '—');
  if (wallet) ui.wagerAmount.max = goldLabel(wallet.gold);
  const stakeNotice = renderStake(phase, ready);
  if (phase === 'results' && host && room.stake) {
    const direct = room.stake.network === 'testnet' && nearWallet?.social && nearSocialActions && room.roster.length === 1;
    ui.again.disabled = !ready || nearBusy || Boolean(quickPlay) ||
      (!direct && (room.stake.processing || room.stake.round?.status === 'reserved'));
    text(byId('again-label'), quickPlay ? 'Starting…' : direct ? `Play again · ${goldLabel(room.stake.entry)} gold` : 'Play again');
  } else {
    text(byId('again-label'), 'Play again');
  }
  byId('result-economy').hidden = !room?.stake;
  byId('result-entry').hidden = !room?.stake ||
    (room.stake.network === 'testnet' && nearWallet?.social && room.roster.length === 1);
  const funQueue = room?.kind === 'fun' && phase === 'lobby';
  document.body.dataset.quickPlay = String(Boolean(quickPlay) || funQueue);
  byId('quick-play-status').hidden = !(quickPlay || funQueue) || phase !== 'lobby';
  text(byId('quick-play-status'), funQueue ? 'Finding crew… Bots fill open seats.' : 'Preparing your round…');
  if (phaseChanged && phase === 'results') {
    byId('result-economy').open = byId('result-entry').open = false;
  }
  const hazardCue = phase === 'playing' ? arenaHazardCue(match?.hazard, match?.elapsed) : null;
  ui.hud.hidden = !active;
  ui.tide.classList.toggle('hazard-active', Boolean(hazardCue));
  if (ui.leaveDialog.open) {
    if (!active || drill || !ready) ui.leaveDialog.close('stay');
    else text(ui.leaveDetail, leaveMessage());
  }
  ui.emotes.hidden = phase !== 'playing' || !own?.alive || !ready || Boolean(drill);
  const trainingSpeed = byId('training-speed');
  const fastTraining = room?.trainingSpeed === 3;
  trainingSpeed.hidden = room?.kind !== 'practice' || phase !== 'playing' || !own || own.alive;
  trainingSpeed.disabled = !ready;
  trainingSpeed.setAttribute('aria-pressed', String(fastTraining));
  text(byId('training-speed-label'), fastTraining ? 'Normal speed' : 'Speed up ×3');
  ui.drillPanel.hidden = !drill;
  for (const button of trialButtons) {
    button.disabled = !ready;
    button.setAttribute('aria-pressed', String(button.dataset.scenario === drill?.scenario));
  }
  ui.drillRun.disabled = !ready;
  const emoteCoolingDown = performance.now() < nextEmoteAt;
  for (const button of emoteButtons) button.disabled = emoteCoolingDown;
  syncNavigation();

  let notice = '';
  let caption = '';
  let clock = '—';
  if (phase === 'lobby') {
    const aboard = room.roster.filter((player) => player.connected).length;
    for (const option of ui.seats.options) option.disabled = Number(option.value) < aboard;
    if (Number(ui.seats.value) < aboard) ui.seats.value = String(aboard);
    text(ui.code, room.code);
    text(ui.lobbyTitle, room.kind === 'near' ? 'Plunder Pot' : room.stake ? 'Gold Wager Lobby' : 'Friends Room');
    caption = `Crew aboard · ${aboard}/${MAX_PLAYERS}`;
    notice = stakeNotice || (host
      ? room.kind === 'stakes' ? 'Share the code to invite players. NPCs fund available seats.' : 'Open berths fill with bots.'
      : 'Waiting for the host.');
  }
  if (drill) {
    clock = 'LAB';
    caption = 'Two barrels on a fixed dock.';
    text(ui.alive, match.players.length);
    ui.alive.setAttribute('aria-label', match.players.length + ' barrels');
    renderTide('impact', 'Fixed dock');
    const impact = drill.impact;
    text(ui.drillForce, impact ? impact.force.toFixed(2) + ' m/s' : '—');
    text(ui.drillOwn, impact ? impact.ownRecoil.toFixed(2) : '—');
    text(ui.drillDummy, impact ? impact.dummyRecoil.toFixed(2) : '—');
    text(ui.drillSteering, impact ? Math.round(impact.steeringDelay * 1_000) + ' ms' : '—');
    notice = 'Steer into the target or choose a repeatable trial.';
    if (drill.scenario === 'shuffle') {
      notice = (DRILL_NAMES[drill.trial] ?? '') + (drill.done ? ' · Shuffle again for a new trial.' : ' · Trial in progress.');
    } else if (drill.scenario !== 'free') notice = drill.done ? 'Trial complete. Run it again to compare.' : 'Trial running from fixed starting positions.';
  } else if (active) {
    const seconds = Math.ceil(match.seconds);
    const afloat = match.players.filter((player) => player.alive).length;
    clock = '0:' + String(seconds).padStart(2, '0');
    text(ui.alive, afloat);
    ui.alive.setAttribute('aria-label', afloat + ' players afloat');
    if (phase === 'countdown') {
      text(ui.arenaMap, arenaMapFor(match.arenaMap).label);
      text(ui.count, seconds);
      byId('countdown-entry').hidden = true;
      renderTide('tide', 'Low tide');
      notice = 'Round starting soon.';
    } else {
      const tideSeconds = match.shrinkIn > 0 ? Math.ceil(match.shrinkIn) : '';
      const tideLabel = match.radius < 2.6 ? 'Last plank' : tideSeconds ? `Tide in ${tideSeconds} seconds` : 'Rising tide';
      renderTide(hazardCue ? HAZARD_ICONS[match.hazard.kind] : 'tide', hazardCue ?? tideLabel, hazardCue ? '' : tideSeconds);
      notice = own?.alive ? 'Stay afloat.' : 'You’re out. Watch the rest of the round.';
    }
    caption = `${afloat} of ${match.players.length} afloat.`;
  }
  if (phase === 'results') {
    const winner = match.players.find((player) => player.id === match.winnerId);
    let title = 'Round closed.';
    if (winner) title = winner.id === member?.id ? 'You win!' : `${winner.name} wins!`;
    text(ui.resultTitle, title);
    let detail = own ? `You finished #${own.rank} of ${match.players.length}.` : 'The next round is yours to join.';
    if (match.decider === 'crossing') detail += ' The last barrel afloat took the round.';
    if (match.decider === 'center') detail += ' The barrel closest to the center took the round.';
    text(ui.resultDetail, detail);
    ui.resultRank.hidden = !own || trainingResult;
    if (own) text(ui.rankValue, '#' + own.rank + ' / ' + match.players.length);
    clock = 'END';
    caption = 'Final standings';
    notice = feedback?.message ?? (room.stake?.processing && !nearWallet?.social ? 'Closing the round…' : '');
  }

  if (rejoining) notice = 'Reconnecting to your room…';
  else if (!online) notice = 'Waiting for the dock server…';
  else if (pending) notice = 'Waiting for the dock…';
  text(ui.clock, clock);
  ui.clock.classList.toggle('urgent', phase === 'playing' && !drill && match.seconds <= 10);
  text(ui.crewCaption, caption);
  const status = phase === 'lobby' ? ui.lobbyDetail
    : phase === 'results' ? ui.resultNotice
    : phase === 'home' && destination === 'arena' ? ui.pierNotice
    : ui.notice;
  for (const region of [ui.notice, ui.pierNotice, ui.lobbyDetail, ui.resultNotice]) {
    text(region, region === status ? feedback?.message ?? notice : '');
    region.classList.toggle('error', region === status && feedback?.error === true);
  }
  if (phaseChanged && (phase === 'lobby' || phase === 'results')) (phase === 'lobby' ? ui.lobbyTitle : ui.resultTitle).focus({ preventScroll: true });
  renderRoster(phase, match);
  queueMicrotask(advanceQuickPlay);
}

let wagerRoom;
const goldUnits = input => Math.round(input.valueAsNumber * 100);

function renderStake(phase, ready) {
  const stake = room?.stake;
  const betweenRounds = phase === 'lobby' || phase === 'results';
  ui.stakeStrip.hidden = !stake || !betweenRounds;
  ui.goldResult.hidden = true;
  ui.goldReceipt.hidden = true;
  ui.refundReceipt.hidden = true;
  if (!stake || !betweenRounds) return '';
  const slot = phase === 'lobby' ? ui.lobbyStake : ui.resultStake;
  if (ui.stakeStrip.parentElement !== slot) slot.append(ui.stakeStrip);
  const round = stake.round;
  const onChain = stake.network === 'testnet';
  const balance = onChain ? nearWallet : wallet;
  const busy = round?.status === 'reserved' || stake.processing;
  const pass = currentNearPass();
  const passVisible = Boolean(onChain && !nearWallet?.social && stake.sessionScope && balance && nearPass?.scope === stake.sessionScope &&
    !nearPass.unavailable);
  nearPassButton.hidden = nearPassDetail.hidden = !passVisible;
  nearPassButton.disabled = !ready || busy || Boolean(nearPassChange) || nearEntrySigning || Boolean(currentNearEntry());
  nearPassButton.dataset.action = pass ? 'revoke' : 'enable';
  text(nearPassButton, nearPassChange ? 'Checking room pass…' : pass ? 'Revoke room pass' : 'Enable room pass');
  text(nearPassDetail, pass ? `${pass.remaining} entries left · this room only`
    : `Up to 3 entries · ${goldLabel(stake.entry * 3)} max · 10 minutes`);
  const entry = onChain ? currentNearEntry() : null;
  const authorized = stake.ready.includes(member?.id);
  const social = Boolean(onChain && nearWallet?.social);
  const seatWager = room.roster.find(player => player.id === member?.id)?.wager ?? stake.entry;
  ui.stakeWagerLabel.hidden = onChain;
  ui.stakeWager.disabled = authorized || busy || !ready;
  if (!onChain) {
    const key = room.code + '/' + room.round;
    if (wagerRoom !== key) ui.stakeWager.value = goldLabel(seatWager);
    wagerRoom = key;
    ui.stakeWager.min = goldLabel(stake.band.min);
    ui.stakeWager.max = goldLabel(Math.min(stake.band.max, balance?.gold ?? stake.band.max));
  }
  const amount = onChain ? stake.entry : authorized ? seatWager : goldUnits(ui.stakeWager);
  const connected = room.roster.filter((player) => !player.bot && player.connected).length;
  const enough = Boolean(balance && balance.gold >= amount && (onChain || ui.stakeWager.validity.valid));
  ui.stakeReady.hidden = busy && !stake.processing;
  ui.stakeReady.disabled = !ready || busy || nearBusy || Boolean(entry) || (onChain && (nearEntrySigning || Boolean(nearPassChange))) ||
    !balance || (!authorized && !enough);
  ui.stakeReady.setAttribute('aria-pressed', String(authorized));
  text(ui.stakeReady, entry ? (entry.stage === 'signing' && !social ? 'Confirming entry…' : 'Checking entry…')
    : authorized ? '✓ Confirmed · Undo'
    : (onChain && !pass && !social ? 'Sign ' : 'Confirm ') + (Number.isFinite(amount) ? goldLabel(amount) : '') + (onChain ? ' entry' : ' wager'));
  if (stake.ready.length < connected || busy || entry) ui.start.disabled = ui.again.disabled = true;
  text(ui.stakeEntry, Number.isFinite(amount) ? goldLabel(amount) : '—');
  text(ui.stakeBalance, balance ? goldLabel(balance.gold) : '—');
  text(ui.stakeCurrency, 'Test gold');
  text(ui.stakeDetail, busy ? (phase === 'lobby' ? 'Reserving entry…' : 'Closing the round…') :
    entry ? (entry.stage === 'signing' && !social ? 'Confirming your entry…' : 'Confirming your entry…') :
    onChain ? `${stake.ready.length}/${connected} confirmed · ${100 - TREASURY_PERCENT}% pot / ${TREASURY_PERCENT}% treasury`
      : `${stake.ready.length}/${connected} confirmed · Range ${goldLabel(stake.band.min)}–${goldLabel(stake.band.max)} · ${GOLD_WAGER_PERCENT}% fee${Number.isFinite(amount) ? ' (' + goldLabel(wagerFee(amount)) + ')' : ''}`);
  let payout = '';
  if (round?.status === 'settled') {
    const winner = room.match?.players.find((player) => player.id === round.winnerId);
    payout = goldLabel(round.paid) + (winner?.bot ? ' test gold to the bot bank.' :
      ' test gold paid to ' + (winner?.id === member?.id ? 'you' : winner?.name ?? 'the winner') + '.');
  }
  if (round?.status === 'cancelled') payout = 'Round cancelled. Every entry was refunded.';
  ui.stakeRefund.hidden = phase !== 'lobby' || round?.status !== 'cancelled';
  text(ui.stakeRefund, ui.stakeRefund.hidden ? '' : payout);
  if (phase === 'results' && payout) {
    text(ui.goldResult, payout);
    ui.goldResult.hidden = false;
  }
  if (onChain && stake.receiptNetwork === 'testnet' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(round?.chainHash ?? '')) {
    const link = phase === 'results' ? ui.goldReceipt : ui.stakeRefund.hidden ? null : ui.refundReceipt;
    if (link) {
      link.href = 'https://testnet.nearblocks.io/txns/' + round.chainHash;
      link.hidden = false;
    }
  }
  if (busy) return phase === 'lobby' || social ? '' : 'Wait for settlement before starting another round.';
  if (!balance) return 'Loading your balance…';
  if (!enough && !authorized) return 'You need ' + goldLabel(stake.entry) + ' test gold to confirm.';
  if (!authorized) return 'Gold is reserved when the round starts.';
  if (stake.ready.length < connected) return 'Waiting for the rest of the crew to confirm.';
  return '';
}

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function request(type, data = {}) {
  if (pending || !send({ type, ...data })) return;
  pending = type;
  feedback = null;
  renderInterface();
}

let lastActiveHud = '';
function activeHudKey(state) {
  const match = state.match;
  if (!isActive(state.phase) || !match || match.drill) return '';
  const alive = match.players.reduce((mask, player) => player.alive ? mask | (1 << player.slot) : mask, 0);
  return JSON.stringify([state.code, state.round, state.phase, match.arenaMap, match.night,
    Math.ceil(match.seconds), Math.ceil(match.shrinkIn), match.radius < 2.6,
    arenaHazardCue(match.hazard, match.elapsed), alive, state.trainingSpeed,
    state.roster.map(player => player.connected), performance.now() < nextEmoteAt]);
}

function receive(event) {
  const message = JSON.parse(event.data);
  if (message.type !== 'state') lastActiveHud = '';
  const restoreConfirmation = (pending === 'stake-ready' || pending === 'near-ready') && document.activeElement === document.body;
  switch (message.type) {
    case 'wallet': {
      if (!message.workshop) return;
      wallet = message;
      if (wallet.firstBrawl?.status !== 'ready') offeredPrize = false;
      if (wallet.firstBrawl) {
        introductionSeen = true;
        try { localStorage.setItem(INTRO_GUIDE_KEY, '1'); } catch {}
      }
      const finishedClaim = firstBrawlClaim && wallet.firstBrawl?.status === 'claimed';
      if (finishedClaim) {
        firstBrawlClaim = null;
        claimedInWorkshop = true;
        rewardRound = room?.phase === 'results' ? room.code + '/' + room.round : null;
      }
      renderInterface();
      if (wallet.firstBrawl?.status === 'claimed' && trainingGuide.open && trainingGuide.dataset.claimStarter === 'true') trainingGuide.close('cancel');
      if (finishedClaim && !firstBrawl.rematch.hidden) firstBrawl.rematch.focus({ preventScroll: true });
      return;
    }
    case 'near-config':
      nearContract = message.contract;
      goldWalletEnabled = message.goldWallet === true;
      nearSocialAvailable = message.socialOrigin === location.origin;
      nearSocialActions = message.socialActions === true;
      nearSocialGoldLimit = message.socialGoldLimit ?? 0;
      nearStarter = message.starter === true;
      nearCollection = message.collection === true;
      document.body.classList.toggle('unified-near-economy', message.unifiedEconomy === true);
      nearWorkshop.configure(message.workshop === true ? nearContract : '');
      renderInterface();
      if (nearSocialAvailable && !socialPopup) void resumeSocialAccount(nearSocialPending);
      return;
    case 'near-logbook':
      cottage.receiveActivity(message);
      return;
    case 'near-workshop':
      if (message.transactionHash) cottage.rememberReceipt(message.account, message.transactionHash, 'Workshop receipt', message.receiptNetwork);
      nearWorkshop.receive(message);
      cottage.refresh();
      return;
    case 'expedition-chain-config':
      expeditions.setContract(message.contract, message.unified);
      return;
    case 'expedition-chain-view':
      expeditions.setChain(message);
      return;
    case 'expedition-chain-challenge':
      void expeditions.challenge(message, signNearChallenge);
      return;
    case 'expedition-result':
      expeditions.result(message);
      return;
    case 'expedition-view-error':
      expeditions.viewError(message.message, message.retryAfterMs);
      return;
    case 'near-challenge':
      if (nearConnecting) void finishNearConnection(message);
      return;
    case 'near-wallet': {
      const accountChanged = nearWallet?.account !== message.account || (nearSocialPending && message.social);
      nearWallet = { ...message,
        social: message.social ?? (nearWallet?.account === message.account && nearWallet.social),
        embedded: message.embedded ?? (nearWallet?.account === message.account && nearWallet.embedded),
        appearance: message.appearance ?? (nearWallet?.account === message.account ? nearWallet.appearance : null) };
      setNearSocialAccount(nearWallet.social ? nearWallet.account : null, nearContract, nearSocialActions);
      if (nearConnecting === message.account || (nearSocialPending && message.social)) {
        nearRenewalNeeded = message.signingReady === false;
        if (!nearRenewalNeeded) {
          nearWorkshop.sessionRestored();
          expeditions.sessionRestored();
        }
        nearConnecting = '';
        nearBusy = false;
        clearSocialLogin();
      }
      if (!message.balanceLoading) {
        const choice = firstBrawlAfterConnect;
        firstBrawlAfterConnect = null;
        const atReward = !room || (choice?.memberId === member?.id && room.kind === 'tutorial' && room.match?.inaugural && room.phase === 'results');
        if (choice && atReward && wallet?.firstBrawl?.status === 'ready') claimFirstBrawl(choice.rig);
      }
      if (destination === 'expeditions' && accountChanged) send({ type: 'expedition-chain-view' });
      renderInterface();
      if (paidReviewAfterLogin && !message.balanceLoading && Number.isSafeInteger(message.gold)) {
        const action = paidReviewAfterLogin;
        paidReviewAfterLogin = null;
        if (destination === 'arena' && (!room || (room.code === action.code && (action.replay || room.phase === 'lobby')))) queueMicrotask(() => reviewPlay(action.replay));
      }
      return;
    }
    case 'pirate-profile':
      captainMenu.profile(message);
      if (!message.named && offeredPirateAccount !== message.account) {
        offeredPirateAccount = message.account;
        suggestedPirateName = message.name;
        byId('pirate-name-first').value = message.name;
        pendingPiratePrompt = true;
        if (!room) { captainMenu.close(); syncNavigation(); }
      }
      renderInterface();
      return;
    case 'near-social-error':
      if (nearSocialPending) nearFailure(message.message);
      return;
    case 'near-entry-status':
      handleNearEntryStatus(message);
      return;
    case 'near-session-status':
      if (message.scope !== room?.stake?.sessionScope) return;
      nearPass = message;
      handleNearPassChange(message);
      renderInterface();
      return;
    case 'gear-ack':
      if (!cottage.acknowledge(message.action)) workshop.acknowledge(message.action, message.id);
      return;
    case 'first-brawl-error':
      firstBrawlClaim = null;
      firstBrawlError = message.message;
      renderInterface();
      return;
    case 'welcome':
      rememberMember({ id: message.id, code: message.code, resumeToken: message.resumeToken });
      return;
    case 'state':
      if (message.stake?.network === 'testnet') cottage.rememberReceipt(nearWallet?.account, message.stake.round?.chainHash, 'Arena receipt', message.stake.receiptNetwork);
      if (message.code !== member?.code) return;
      if (pending === 'leave') return;
      const previousPending = pending;
      playMatchSounds(message);
      if (pending !== 'resume') playArenaGold(room, message, member.id, reducedMotion.matches);
      battleFeed.update(message, member.id, pending === 'resume');
      if (pending === 'drill-run' && message.round === room?.round) break;
      if (pending === 'start' && room?.stake?.processing && !message.stake?.processing) pending = null;
      room = message;
      if (quickPlay && ['countdown', 'playing'].includes(room.phase)) quickPlay = null;
      if (nearPassChange && nearPassChange.scope !== room.stake?.sessionScope) clearNearPassChange();
      if (pending !== 'start' || isActive(room.phase)) pending = null;
      if (nearEntry && !currentNearEntry()) setNearEntry(null);
      checkNearEntry();
      checkNearPass();
      // Simulation and effects consume every packet. The DOM only needs visible HUD changes.
      const hudKey = activeHudKey(message);
      if (hudKey && hudKey === lastActiveHud && previousPending === pending) return;
      lastActiveHud = hudKey;
      break;
    case 'error':
      if (message.renewSession && nearWallet?.social) {
        nearRenewalNeeded = true;
        paidReviewAfterLogin = { replay: room?.phase === 'results', code: room?.code ?? null };
      }
      if (pending === 'drill' && judgeVisit === 'impact') finishJudgeVisit(false);
      quickPlay = null;
      freePlayAfterLeaving = false;
      if (cottage.error(message.message) || workshop.error(message.message)) return;
      if (nearConnecting) nearWorkshop.connectionFailed(message.message);
      if (!nearSocialPending) {
        if (firstBrawlAfterConnect) firstBrawlError = message.message;
        firstBrawlAfterConnect = null;
      }
      leavingForCottage = false;
      nearConnecting = '';
      nearBusy = nearSocialPending;
      if (pending === 'resume') {
        if (room?.kind === 'room') ui.roomInput.value = room.code;
        rememberMember(null);
        setNearEntry(null);
        room = null;
        battleFeed.update(null);
      }
      if (pending === 'resume') destination = '';
      pending = null;
      feedback = { message: message.message, error: true };
      break;
    case 'left':
      quickPlay = null;
      rememberMember(null);
      setNearEntry(null);
      clearNearPassChange();
      room = null;
      battleFeed.update(null);
      pending = null;
      feedback = message.message ? { message: message.message } : null;
      claimedInWorkshop = false;
      rewardRound = null;
      if (freePlayAfterLeaving) {
        freePlayAfterLeaving = false;
        destination = 'arena';
        playForFun();
        return;
      }
      if (leavingForCottage) {
        leavingForCottage = false;
        travelTo('home', () => byId('cottage-title').focus({ preventScroll: true }));
        return;
      }
      returnToBay();
      return;
    default:
      return;
  }
  renderInterface();
  if (restoreConfirmation && !ui.stakeStrip.hidden && !ui.stakeReady.hidden && !ui.stakeReady.disabled) {
    ui.stakeReady.focus({ preventScroll: true });
  }
}

async function connect() {
  try {
    await fetch('/playtest-session', { cache: 'no-store', signal: AbortSignal.timeout(3_000) });
  } catch {
    // Free modes remain usable if the local test wallet is unavailable.
  }
  socket = new WebSocket(socketUrl);
  socket.addEventListener('open', () => {
    if (member) {
      pending = 'resume';
      send({ type: 'join', code: member.code, resumeToken: member.resumeToken });
    }
    renderInterface();
  });
  socket.addEventListener('message', receive);
  socket.addEventListener('close', () => {
    quickPlay = null;
    freePlayAfterLeaving = false;
    paidReviewAfterLogin = null;
    if (arenaConfirm.open) arenaConfirm.close('cancel');
    wallet = null;
    leavingForCottage = false;
    firstBrawlClaim = null;
    if (!nearSocialPending) firstBrawlAfterConnect = null;
    nearWallet = null;
    setNearSocialAccount(null);
    nearSocialAvailable = false;
    clearTimeout(socialProofTimer);
    socialProofTimer = null;
    nearContract = '';
    nearConnecting = '';
    nearBusy = nearSocialPending;
    clearTimeout(nearEntryTimer);
    nearEntryTimer = null;
    nearPass = null;
    nearPassProbe = '';
    if (!member) room = null;
    battleFeed.update(room, member?.id, true);
    pending = null;
    feedback = null;
    renderInterface();
    // The server owns the eight-second window. Start trying as soon as the socket drops.
    window.setTimeout(connect, 500);
  });
  renderInterface();
}

function canSteer() {
  if (pending || socket?.readyState !== WebSocket.OPEN || ui.leaveDialog.open) return false;
  const drill = room?.match?.drill;
  return isActive(room?.phase)
    && (!drill || drill.scenario === 'free') && ownBarrel()?.alive;
}

function sendEmote(emote) {
  const now = performance.now();
  if (room?.phase !== 'playing' || room.match?.drill || !canSteer() || now < nextEmoteAt) return;
  if (send({ type: 'emote', emote })) {
    nextEmoteAt = now + EMOTE_COOLDOWN_MS;
    renderInterface();
  }
}

function sendSteering() {
  if (!canSteer()) return;
  const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + thumb.x;
  const up = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + thumb.up;
  if (socket.bufferedAmount > 0) return;
  const scale = cameraDistance * Math.max(1, Math.hypot(right, up));
  // Rotate screen-relative input into the dock's horizontal plane.
  const x = (right * ARENA_CAMERA.z - up * ARENA_CAMERA.x) / scale;
  const z = (-right * ARENA_CAMERA.x - up * ARENA_CAMERA.z) / scale;
  send({ type: 'input', x, z });
}

function releaseControls() {
  keys.clear();
  releaseHelm();
  sendSteering();
}

function unlockSound() {
  if (accessSetup.dialog.open) return;
  soundStarted = true;
  updateMusic(musicOn, room?.phase === 'playing');
  if (!soundOn || typeof AudioContext !== 'function') return;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}

function tone(start, end, duration, volume, wave = 'triangle') {
  if (!soundOn || audio?.state !== 'running') return;
  const at = audio.currentTime;
  const voice = audio.createOscillator();
  const gain = audio.createGain();
  voice.type = wave;
  voice.frequency.setValueAtTime(start, at);
  voice.frequency.exponentialRampToValueAtTime(end, at + duration);
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  voice.connect(gain).connect(audio.destination);
  voice.start(at);
  voice.stop(at + duration);
}

function playMatchSounds(next) {
  const match = next.match;
  if (!match) return;
  if (next.round !== room?.round || next.code !== room?.code) heardEvent = -1;
  if (pending !== 'resume') {
    const previousCount = Math.ceil(room?.match?.seconds ?? 0);
    if (next.phase === 'countdown' && Math.ceil(match.seconds) !== previousCount) tone(480, 420, 0.13, 0.075);
    if (next.phase === 'playing' && room?.phase === 'countdown') tone(660, 880, 0.24, 0.09);
    for (const event of match.events) {
      if (event.id <= heardEvent) continue;
      if (soundOn) {
        if (event.type === 'fall') harborSound(audio, 'splash', .105);
        if (event.type === 'hazard-fire' && ['collapse', 'anchor-drop'].includes(event.kind)) harborSound(audio, 'wood', .135);
      }
      if (event.type === 'hit') {
        const strength = Math.min(1, (event.impulse ?? event.force) / 11);
        tone(125 + strength * 76, 43, 0.16 + strength * 0.05, 0.045 + strength * 0.095);
        if (strength > 0.4) tone(320, 85, 0.08, 0.04, 'square');
      } else if (event.type === 'fall' && event.playerId === member.id) {
        tone(370, 73, 0.36, 0.12);
      } else if (event.type === 'hazard-warning') {
        tone(390, 590, .19, .065);
      } else if (event.type === 'hazard-fire' && ['broadside', 'powder', 'mini-powder'].includes(event.kind)) {
        const mini = event.kind === 'mini-powder';
        tone(mini ? 171 : 130, 38, mini ? .14 : .24, mini ? .063 : .095, 'sawtooth');
      } else if (event.type === 'hazard-fire' && event.kind === 'kraken') {
        tone(94, 34, .42, .10, 'sawtooth');
      } else if (event.type === 'hazard-fire' && ['crate', 'crate-drop', 'barrel-roll', 'anchor-drop'].includes(event.kind)) {
        tone(104, 46, .24, .075);
        tone(240, 104, .075, .024, 'square');
      } else if (event.type === 'anchor-launch') {
        tone(560, 205, .14, .022, 'triangle');
      } else if (event.type === 'hazard-hit' && event.playerId === member.id) {
        const strength = Math.min(1, event.force / 13);
        if (event.kind === 'parrots') tone(730, 330, .12, .035);
        tone(190 + strength * 85, 37, .18 + strength * .14, .07 + strength * .065);
        if (strength > .66) tone(280, 70, .09, .05, 'square');
      } else if (event.type === 'hazard-grab' && event.playerId === member.id) {
        tone(130, 300, .3, .10);
      }
    }
  }
  heardEvent = match.events.at(-1)?.id ?? heardEvent;
}

function showRoomMode(next) {
  roomMode = next;
  for (const [mode, { button, panel }] of roomModes) {
    panel.hidden = mode !== next;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  }
  renderInterface();
}

function nearFailure(detail) {
  quickPlay = null;
  paidReviewAfterLogin = null;
  nearBusy = false;
  clearSocialLogin();
  nearConnecting = '';
  if (firstBrawlAfterConnect) firstBrawlError = detail;
  firstBrawlAfterConnect = null;
  nearWorkshop.connectionFailed(detail);
  feedback = { message: detail, error: true };
  renderInterface();
}

function clearSocialLogin() {
  clearInterval(socialPopupTimer);
  clearTimeout(socialProofTimer);
  socialChannel?.close();
  socialChannel = null;
  socialPopup = null;
  socialPopupTimer = null;
  socialProofTimer = null;
  nearSocialPending = false;
}

function connectPlayerAccount(options) {
  if (options?.renew === true) {
    nearRenewalNeeded = true;
  }
  if (nearBusy || nearEntrySigning) {
    if (socialPopup && !socialPopup.closed) { socialPopup.focus(); return true; }
    feedback = { message: 'Your sign-in is being checked. Please wait.', error: false };
    renderInterface();
    return false;
  }
  if (!nearWallet && room && !(nearStarter && ['practice', 'tutorial', 'fun', 'room'].includes(room.kind) && room.phase === 'results')) {
    feedback = { message: 'Finish the round before signing in.', error: false };
    renderInterface();
    return false;
  }
  if (!nearSocialAvailable || socket?.readyState !== WebSocket.OPEN) {
    feedback = { message: 'Sign-in is not ready. Reconnect to the bay and try again.', error: true };
    renderInterface();
    return false;
  }
  const flow = crypto.randomUUID();
  const renewal = nearRenewalNeeded ? '&renew=1' : '';
  const popup = window.open('/near-social/start?flow=' + flow + renewal, 'afloat-sign-in', 'popup,width=500,height=660');
  if (!popup) {
    nearFailure('Allow the sign-in window and try again.');
    return false;
  }
  if (typeof BroadcastChannel !== 'undefined') {
    socialChannel = new BroadcastChannel('afloat-sign-in-' + flow);
    socialChannel.addEventListener('message', event => finishSocialPopup(event.data));
  }
  socialPopup = popup;
  nearSocialPending = nearBusy = true;
  feedback = null;
  renderInterface();
  const startedAt = Date.now();
  socialPopupTimer = setInterval(() => {
    if (Date.now() - startedAt > SOCIAL_LOGIN_WINDOW_MS || (!socialChannel && popup.closed)) nearFailure('Sign-in expired. Try again.');
  }, 800);
  return true;
}

async function resumeSocialAccount(required = false) {
  const connection = socket;
  try {
    const response = await fetch('/near-social/session', { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (connection !== socket || connection.readyState !== WebSocket.OPEN) return;
    if (response.status === 204 && !required) return;
    if (!response.ok || response.status === 204) throw new Error('No session');
    const { ticket } = await response.json();
    if (connection !== socket || (!required && (nearWallet || nearBusy))) return;
    nearSocialPending = nearBusy = true;
    if (!send({ type: 'near-social-auth', ticket })) throw new Error('Disconnected');
    socialProofTimer = setTimeout(() => nearFailure('Could not restore your account. Try again.'), 15_000);
    renderInterface();
  } catch {
    if (required && connection === socket && nearSocialPending) nearFailure('Could not restore your account. Try again.');
  }
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin) return;
  if (!socialPopup) {
    // A provider window can outlive an old UI timeout. The server cookie/ticket, not this message, authenticates the account.
    if (event.data?.type === 'afloat-social-login' && event.data.result === 'success' &&
        nearSocialAvailable && !nearWallet && !nearBusy) void resumeSocialAccount(false);
    return;
  }
  if (event.source !== socialPopup) return;
  finishSocialPopup(event.data);
});

window.addEventListener('focus', () => {
  if (nearSocialAvailable && !nearWallet && !nearBusy) void resumeSocialAccount(false);
});

function finishSocialPopup(data) {
  if (!socialPopup || data?.type !== 'afloat-social-login') return;
  clearInterval(socialPopupTimer);
  socialPopup = null;
  if (data.result === 'success') void resumeSocialAccount(true);
  else nearFailure(data.result === 'cancelled' ? 'Sign-in cancelled.' : 'Could not sign in. Try again.');
}

function currentNearEntry() {
  return nearEntry && nearEntry.memberId === member?.id && nearEntry.code === room?.code &&
    nearEntry.id === room.stake?.chainId ? nearEntry : null;
}

function setNearEntry(entry) {
  clearTimeout(nearEntryTimer);
  nearEntryTimer = null;
  nearEntry = entry;
  rememberNearEntry(entry);
}

function scheduleNearEntryCheck(delay) {
  clearTimeout(nearEntryTimer);
  nearEntryTimer = setTimeout(() => {
    nearEntryTimer = null;
    checkNearEntry();
    renderInterface();
  }, delay);
}

function checkNearEntry() {
  const entry = currentNearEntry();
  if (entry?.stage !== 'checking' || nearEntryTimer !== null || pending === 'resume' ||
    room.stake.processing || isActive(room.phase) || socket?.readyState !== WebSocket.OPEN) return;
  if (entry.checks >= 7 || Date.now() >= entry.expiresAt) {
    quickPlay = null;
    setNearEntry(null);
    feedback = { message: 'The entry change is still unconfirmed. Check your Logbook before retrying.', error: true };
    return;
  }
  if (send({ type: 'near-ready', id: entry.id, ready: entry.ready, check: true })) {
    entry.checks++;
    scheduleNearEntryCheck(7_000);
  }
}

function handleNearEntryStatus(message) {
  const entry = currentNearEntry();
  if (entry?.stage !== 'checking' || entry.id !== message.id || entry.ready !== message.ready) return;
  if (message.confirmed) setNearEntry(null);
  else scheduleNearEntryCheck(1_500);
  renderInterface();
}

async function connectNearWallet() {
  if (nearBusy || nearEntrySigning || !nearContract || socket?.readyState !== WebSocket.OPEN) return;
  const connection = socket;
  nearBusy = true;
  feedback = null;
  renderInterface();
  try {
    const account = await selectNearWallet();
    if (socket !== connection || connection.readyState !== WebSocket.OPEN || !nearBusy) return;
    nearConnecting = account;
    if (!send({ type: 'near-challenge' })) throw new Error('Disconnected');
  } catch {
    if (socket === connection && connection.readyState === WebSocket.OPEN) {
      nearFailure('Could not connect your account.');
    }
  }
}

async function finishNearConnection(challenge) {
  const connection = socket;
  const account = nearConnecting;
  try {
    if (challenge.recipient !== nearContract || !/^[a-f0-9]{64}$/.test(challenge.nonce)) throw new Error('Invalid challenge');
    const signed = await signNearChallenge(account, challenge);
    if (socket !== connection || nearConnecting !== account) return;
    if (signed.accountId !== account || !send({ type: 'near-auth', ...signed })) throw new Error('Account changed');
  } catch {
    if (socket === connection && nearConnecting === account) nearFailure('Could not verify the connected account.');
  }
}

async function confirmStake() {
  const stake = room?.stake;
  if (!stake || !member || nearBusy || currentNearEntry()) return;
  const ready = !stake.ready.includes(member.id);
  if (stake.network !== 'testnet') {
    request('stake-ready', { ready, ...(ready ? { wager: goldUnits(ui.stakeWager) } : {}) });
    return;
  }
  if (!nearWallet || nearEntrySigning || nearPassChange) return;
  if (ready && nearPass?.scope === stake.sessionScope && nearPass?.session && !currentNearPass()) {
    nearPass.session = null;
  }
  if (ready ? currentNearPass() : stake.sessionReady?.includes(member.id)) {
    request('near-session-ready', { id: stake.chainId, ready });
    return;
  }
  // Social sessions sign each entry automatically; no three-round pass or renewal is needed.
  const entry = { memberId: member.id, code: room.code, id: stake.chainId, ready,
    expiresAt: Date.now() + 180_000, stage: 'signing', checks: 0 };
  setNearEntry(entry);
  nearEntrySigning = true;
  feedback = null;
  if (!ready) send({ type: 'near-ready', id: entry.id, ready: false });
  renderInterface();
  try {
    await signNearEntry(nearContract, nearWallet.account, stake.chainId, ready);
  } catch (error) {
    if (error instanceof NearSocialActionError && nearEntry === entry) {
      quickPlay = null;
      setNearEntry(null);
      feedback = { message: error.message, error: true };
      if (requiresGameSessionRenewal(error)) connectPlayerAccount({ renew: true });
    }
    // A wallet can lose its response after sending the transaction.
  } finally {
    nearEntrySigning = false;
  }
  if (nearEntry === entry) {
    entry.stage = 'checking';
    checkNearEntry();
  }
  renderInterface();
}

function currentNearPass() {
  const session = nearPass?.session;
  if (nearPass?.scope !== room?.stake?.sessionScope || !session?.remaining || session.expires_at <= Date.now()) return null;
  return session;
}

function checkNearPass() {
  const stake = room?.stake;
  if (!stake?.sessionScope || isActive(room.phase) || stake.processing) return;
  const probe = stake.sessionScope + '/' + stake.chainId;
  if (nearPassProbe !== probe && send({ type: 'near-session-check', scope: stake.sessionScope })) {
    nearPassProbe = probe;
  }
}

function clearNearPassChange() {
  clearTimeout(nearPassTimer);
  nearPassTimer = null;
  nearPassChange = null;
}

function checkNearPassChange() {
  const change = nearPassChange;
  if (!change) return;
  if (room?.stake?.sessionScope !== change.scope) {
    clearNearPassChange();
    return;
  }
  if (Date.now() >= change.until) {
    clearNearPassChange();
    if (change.joinRound) quickPlay = null;
    feedback = { message: 'The entry permission is still unconfirmed. Check your Logbook before retrying.', error: true };
    renderInterface();
    return;
  }
  send({ type: 'near-session-check', scope: change.scope });
  clearTimeout(nearPassTimer);
  nearPassTimer = setTimeout(checkNearPassChange, 2_000);
}

function handleNearPassChange(message) {
  const change = nearPassChange;
  if (!change || change.scope !== message.scope || message.unavailable) return;
  if (Boolean(currentNearPass()) === change.enable) {
    clearNearPassChange();
    if (change.joinRound && quickPlay && room?.code === change.code) {
      request('near-session-ready', { id: room.stake.chainId, ready: true });
    }
  }
}

async function changeNearPass(enable, joinRound = false) {
  const stake = room?.stake;
  if (nearPassChange || !stake?.sessionScope || !nearWallet) return;
  if (enable !== !currentNearPass()) {
    renderInterface();
    return;
  }
  const change = { scope: stake.sessionScope, enable, joinRound, code: room.code };
  nearPassChange = change;
  feedback = null;
  if (!enable && stake.sessionReady?.includes(member?.id)) {
    send({ type: 'near-session-ready', id: stake.chainId, ready: false });
  }
  renderInterface();
  try {
    await signNearSession(nearContract, nearWallet.account, stake.sessionScope, enable);
  } catch (error) {
    if (requiresGameSessionRenewal(error)) {
      clearNearPassChange();
      if (joinRound) quickPlay = null;
      connectPlayerAccount({ renew: true });
    }
    // The wallet can lose its response after sending the transaction.
  }
  if (nearPassChange === change) {
    change.until = Date.now() + 16_000;
    checkNearPassChange();
  }
  renderInterface();
}

nearPassButton.addEventListener('click', () => {
  void changeNearPass(nearPassButton.dataset.action === 'enable');
});

ui.roomInput.value = (invite.searchParams.get('room') ?? '').trim().toUpperCase().slice(0, ui.roomInput.maxLength);
if (ui.roomInput.value) {
  destination = 'arena';
  arenaChoices = true;
  showRoomMode('crew');
}
for (const [mode, { button }] of roomModes) {
  button.addEventListener('click', () => showRoomMode(roomMode === mode ? '' : mode));
}

function travelTo(place, arrive) {
  window.clearTimeout(travelTimer);
  destination = place;
  const duration = reducedMotion.matches ? 410 : BAY_TRAVEL_MS;
  journey = hasBayView ? { at: performance.now(), duration } : null;
  function reveal() {
    journey = null;
    renderInterface();
    arrive();
  }
  if (journey) {
    renderInterface();
    travelTimer = window.setTimeout(reveal, duration);
  } else reveal();
}

function returnToBay() {
  const returnMarker = bayMarkers.get(destination) ?? ui.openArena;
  travelTo('', () => { if (!finishJudgeVisit()) returnMarker.focus({ preventScroll: true }); });
}

function enterPlace(place, enter) {
  if (journey || room || pending) return;
  travelTo(place, enter);
}

ui.openArena.addEventListener('click', () => {
  if (room || pending || journey) return;
  nearInvite = false;
  arenaChoices = false;
  showRoomMode('');
  enterPlace('arena', () => {
    byId('arena-play').focus({ preventScroll: true });
    openIntroduction();
  });
});
ui.practice.addEventListener('click', openTraining);
byId('training-speed').addEventListener('click', () => {
  if (byId('training-speed').hidden || byId('training-speed').disabled) return;
  send({ type: 'training-speed', fast: room.trainingSpeed !== 3 });
});
byId('arena-play').addEventListener('click', () => {
  arenaChoices = true;
  renderInterface();
  byId('arena-fun').focus({ preventScroll: true });
});
byId('arena-modes-back').addEventListener('click', () => {
  arenaChoices = false;
  showRoomMode('');
  byId('arena-play').focus({ preventScroll: true });
});
byId('arena-fun').addEventListener('click', playForFun);
byId('arena-paid').addEventListener('click', () => reviewPlay());
firstBrawl.rematch.addEventListener('click', () => {
  claimedInWorkshop = false;
  playForFun();
});
ui.drill.addEventListener('click', () => enterPlace('lab', () => byId('workshop-title').focus({ preventScroll: true })));
byId('open-home').addEventListener('click', () => enterPlace('home', () => byId('cottage-title').focus({ preventScroll: true })));
byId('open-expeditions').addEventListener('click', () => enterPlace('expeditions', () => byId('expeditions-title').focus({ preventScroll: true })));
byId('cottage-brawl').addEventListener('click', playForFun);
byId('cottage-shop').addEventListener('click', () => enterPlace('lab', () => byId('workshop-title').focus({ preventScroll: true })));
firstBrawl.cottage.addEventListener('click', () => {
  if (room?.phase === 'results') {
    leavingForCottage = true;
    request('leave');
  } else enterPlace('home', () => byId('cottage-title').focus({ preventScroll: true }));
});
ui.openLab.addEventListener('click', () => {
  if (room || pending || journey || !send({ type: 'drill', name: ui.nickname.value })) return;
  judgeVisit = 'impact';
  judgesTour.close();
  pending = 'drill';
  feedback = null;
  renderInterface();
});
for (const button of trialButtons) button.addEventListener('click', () => request('drill-run', { scenario: button.dataset.scenario }));
ui.drillRun.addEventListener('click', () => {
  if (room?.match?.drill) request('drill-run', { scenario: room.match.drill.scenario });
});
ui.create.addEventListener('click', () => request('create', { name: ui.nickname.value }));
byId('wager-form').addEventListener('submit', event => {
  event.preventDefault();
  request('find-stakes', { name: ui.nickname.value, wager: goldUnits(ui.wagerAmount) });
});
ui.stakeWager.addEventListener('input', renderInterface);
const arenaModeInfo = byId('arena-mode-info');
arenaModeInfo.addEventListener('click', event => {
  if (event.target !== arenaModeInfo) return;
  const bounds = arenaModeInfo.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) arenaModeInfo.close();
});
for (const button of document.querySelectorAll('[data-mode-info]')) button.addEventListener('click', () => {
  const friends = button.dataset.modeInfo === 'friends';
  const unified = document.body.classList.contains('unified-near-economy');
  text(byId('arena-mode-title'), friends ? 'Play with friends' : unified ? 'Plunder Pot' : 'Wager test gold');
  text(byId('arena-mode-detail'), friends
    ? 'Create a free private room or join one with a code. Share the room code with friends. NPCs fill open seats.'
    : unified ? 'Confirm 2.00 gold per round. The treasury takes 20%. If the round is cancelled, your entry returns.'
      : 'Choose how much test gold to wager. Join an open lobby whose range includes your wager, or open a new one. Each lobby accepts wagers within 25% of its opening amount. NPCs fund open seats as their bank allows. The treasury takes 10% of each wager, rounded to the nearest 0.01 gold. The winner gets the pot. NEAR testnet rooms use separate rules.');
  arenaModeInfo.showModal();
});
ui.nearConnect.addEventListener('click', connectNearWallet);
ui.nearSocialConnect.addEventListener('click', connectPlayerAccount);
byId('near-social-logout').addEventListener('click', async () => {
  if (!captainMenu.canSignOut() || nearWorkshop.isBusy() || expeditions.isBusy() || goldActionPending()) return;
  byId('near-social-logout').disabled = true;
  try {
    const result = await fetch('/near-social/logout', { method: 'POST', signal: AbortSignal.timeout(5_000) });
    if (!result.ok) throw new Error('Sign-out failed');
    localStorage.setItem(ACCOUNT_CHOICE_KEY, '1');
    location.reload();
  } catch {
    nearFailure('Could not sign out. Try again.');
  }
});
byId('captain-menu-open').addEventListener('click', () => renderInterface(), { capture: true });
window.addEventListener('pending-gold-changed', () => renderInterface());
window.addEventListener('gold-wallet-confirmed', () => {
  if (nearWallet) send({ type: 'near-workshop-view', account: nearWallet.account });
});
ui.createNear.addEventListener('click', () => request('create-near', { name: ui.nickname.value }));
ui.stakeReady.addEventListener('click', confirmStake);
ui.joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (nearInvite && !nearWallet) { void connectPlayerAccount(); return; }
  request('join', { name: ui.nickname.value, code: ui.roomInput.value.trim().toUpperCase() });
});
ui.start.addEventListener('click', () => request('start', { slots: Number(ui.seats.value) }));
ui.again.addEventListener('click', () => {
  if (room?.stake) reviewPlay(true);
  else if (room?.kind === 'fun' || room?.kind === 'tutorial') playForFun();
  else request('start', { slots: room.match.players.length });
});
byId('result-bay').addEventListener('click', navigateBack);
judgesTour.addEventListener('close', () => { if (!judgeVisit) renderInterface(); });
function leaveMessage() {
  if (!room?.stake) return 'Your barrel leaves the round.';
  if (room.phase === 'countdown') return 'Leaving before the start cancels the round and refunds all entries.';
  return 'Your barrel forfeits. If the round finishes, your entry stays in the pot.';
}
function navigateBack() {
  quickPlay = null;
  paidReviewAfterLogin = null;
  if (ui.back.hidden || ui.back.disabled || ui.leaveDialog.open) return;
  if (!room) {
    returnToBay();
    return;
  }
  if (!isActive(room.phase) || room.match?.drill) {
    request('leave');
    return;
  }
  releaseControls();
  text(ui.leaveDetail, leaveMessage());
  ui.leaveDialog.showModal();
  syncNavigation();
}
ui.back.addEventListener('click', navigateBack);
ui.backdrop.addEventListener('click', navigateBack);
ui.leaveDialog.addEventListener('close', syncNavigation);
ui.leaveDialog.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'leave') return;
  event.preventDefault();
  ui.leaveDialog.close('stay');
  if (isActive(room?.phase)) request('leave', { round: room.round, phase: room.phase });
});
for (const button of emoteButtons) button.addEventListener('click', () => sendEmote(button.dataset.emote));

ui.copy.addEventListener('click', async () => {
  const code = room?.code;
  if (!code) return;
  const url = new URL('/', location.href);
  url.searchParams.set('room', code);
  if (room.kind === 'near') url.searchParams.set('network', 'testnet');
  let message = `Share room code ${code}.`;
  try {
    await navigator.clipboard.writeText(url.href);
    message = 'Room link copied.';
  } catch {
    // The code is still shareable when the browser denies clipboard access.
  }
  if (room?.code !== code) return;
  feedback = { message };
  renderInterface();
});

document.addEventListener('click', unlockSound);
document.addEventListener('visibilitychange', () => updateMusic(soundStarted && musicOn, room?.phase === 'playing'));
function setAudioPreference(channel, enabled) {
  if (channel === 'effects') {
    soundOn = enabled;
    if (!enabled) { playPirateVoice(null); audio?.suspend().catch(() => {}); }
  } else musicOn = enabled;
  try { localStorage.setItem(`afloat-${channel}`, enabled ? 'on' : 'off'); } catch {}
  syncAudioButtons();
  renderInterface();
}
ui.sound.addEventListener('click', () => setAudioPreference('effects', !soundOn));
byId('music').addEventListener('click', () => setAudioPreference('music', !musicOn));
const nativeFullscreen = document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen;
const fullscreenActive = () => document.fullscreenElement || document.webkitFullscreenElement;
function dismissDisplayHint() {
  byId('display-hint').hidden = true;
  byId('fullscreen').parentElement.removeAttribute('data-tip');
}
byId('rotate-screen').addEventListener('click', async () => {
  dismissDisplayHint();
  const orientation = window.screen?.orientation;
  try {
    if (!orientation?.lock) throw new Error('Orientation unavailable');
    const next = window.innerWidth > window.innerHeight ? 'portrait' : 'landscape';
    if (!fullscreenActive() && nativeFullscreen) await nativeFullscreen.call(document.documentElement);
    await orientation.lock(next);
  } catch {
    byId('display-help').showModal();
  }
});
if (!nativeFullscreen) {
  ui.fullscreen.setAttribute('aria-label', 'Fullscreen tips');
  ui.fullscreen.title = 'Fullscreen tips';
}
ui.fullscreen.addEventListener('click', async () => {
  dismissDisplayHint();
  try {
    if (!nativeFullscreen) { byId('display-help').showModal(); return; }
    if (fullscreenActive()) await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    else await nativeFullscreen.call(document.documentElement);
  } catch {
    byId('display-help').showModal();
  }
});

let pressedBackdrop = null;
function onBackdrop(event) {
  if (!(event.target instanceof HTMLDialogElement) || !event.target.open) return null;
  const rect = event.target.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
    ? event.target : null;
}
document.addEventListener('pointerdown', event => { pressedBackdrop = onBackdrop(event); });
document.addEventListener('click', event => {
  const dialog = onBackdrop(event);
  if (dialog && dialog === pressedBackdrop) dialog.close();
  pressedBackdrop = null;
  const path = event.composedPath();
  for (const menu of document.querySelectorAll('details[open]')) {
    if (!path.includes(menu)) menu.open = false;
  }
});

window.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog:modal')) return;
  if (event.key === 'Escape' && !ui.back.hidden) {
    event.preventDefault();
    navigateBack();
    return;
  }
  const emote = emoteKeys.get(event.code);
  if ((!controls.has(event.code) && !emote) || event.altKey || event.ctrlKey || event.metaKey || !canSteer()) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.matches('input, select, textarea') || target.isContentEditable)) return;
  if (emote && (room?.phase !== 'playing' || room.match?.drill)) return;
  event.preventDefault();
  if (emote) {
    if (!event.repeat) sendEmote(emote);
    return;
  }
  const changed = !keys.has(event.code);
  keys.add(event.code);
  if (changed) sendSteering();
  unlockSound();
});
window.addEventListener('keyup', (event) => {
  if (keys.delete(event.code)) {
    event.preventDefault();
    sendSteering();
  }
});
function moveHelm(event) {
  if (event.pointerId !== thumb.id) return;
  const x = (event.clientX - thumb.centerX) / thumb.radius;
  const up = (thumb.centerY - event.clientY) / thumb.radius;
  const length = Math.hypot(x, up);
  const scale = Math.max(1, length);
  thumb.x = x / scale;
  thumb.up = up / scale;
  ui.helmThumb.style.transform = `translate(${thumb.x * thumb.radius}px, ${-thumb.up * thumb.radius}px)`;
  sendSteering();
}

function syncHelmHint() {
  const visible = canSteer() && !document.querySelector('dialog:modal') && window.matchMedia('(any-pointer: coarse)').matches;
  const centered = visible && helmUsedInRound !== `${room.code}/${room.round}`;
  ui.helm.hidden = !visible || (centered && room.phase === 'countdown');
  if (!visible || thumb.id !== null) return;
  ui.helm.dataset.idle = 'true';
  ui.helm.style.left = centered ? '50%' : '76px';
  ui.helm.style.top = centered ? '50%' : 'auto';
  ui.helm.style.bottom = centered ? 'auto' : 'max(1rem, env(safe-area-inset-bottom))';
  ui.helm.dataset.centered = String(centered);
}

function releaseHelm() {
  const id = thumb.id;
  thumb.id = null;
  thumb.x = thumb.up = 0;
  ui.helmThumb.style.transform = '';
  syncHelmHint();
  if (id !== null && document.body.hasPointerCapture(id)) document.body.releasePointerCapture(id);
}

document.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch' || thumb.id !== null || event.button !== 0 || !canSteer() ||
      document.querySelector('dialog:modal') || event.target.closest?.('button, a, input, select, label, textarea, summary, [role="button"]')) return;
  event.preventDefault();
  thumb.id = event.pointerId;
  helmUsedInRound = `${room.code}/${room.round}`;
  thumb.centerX = event.clientX;
  thumb.centerY = event.clientY;
  ui.helm.style.left = `${thumb.centerX}px`;
  ui.helm.style.top = `${thumb.centerY}px`;
  ui.helm.style.bottom = 'auto';
  ui.helm.hidden = false;
  ui.helm.dataset.idle = 'false';
  thumb.radius = ui.helm.offsetWidth * .42 || 60;
  document.body.setPointerCapture(event.pointerId);
  unlockSound();
  sendSteering();
});
document.addEventListener('pointermove', moveHelm);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  document.addEventListener(type, (event) => {
    if (event.pointerId !== thumb.id) return;
    releaseHelm();
    sendSteering();
  });
}
window.addEventListener('resize', () => {
  if (thumb.id !== null) { releaseHelm(); sendSteering(); }
  syncHelmHint();
});
window.addEventListener('blur', releaseControls);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseControls();
});
window.addEventListener('pagehide', () => socket?.close());
window.setInterval(sendSteering, 1_000 / TICK_RATE);

try {
  const view = createArenaView(ui.arena);
  hasBayView = true;
  const interactiveBay = () => !ui.bayMap.hidden && !destination && !journey && !room && !document.querySelector('dialog:modal');
  const buildingAt = event => {
    const bounds = ui.arena.getBoundingClientRect();
    return view.pickBayPlace?.((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  };
  let highlighted;
  function highlight(place) {
    if (place === highlighted) return;
    bayMarkers.get(highlighted)?.classList.remove('building-selected');
    highlighted = place;
    bayMarkers.get(place)?.classList.add('building-selected');
    view.highlightBayPlace?.(place);
    ui.arena.classList.toggle('interactive-building', Boolean(place));
  }
  let hoveredPlace, focusedPlace;
  const hover = place => {
    hoveredPlace = place;
    highlight(journey && destination ? destination : interactiveBay() ? hoveredPlace ?? focusedPlace : null);
  };
  ui.arena.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') hover(interactiveBay() ? buildingAt(event) : null); });
  ui.arena.addEventListener('pointerleave', () => hover(null));
  for (const [place, marker] of bayMarkers) {
    marker.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && interactiveBay()) hover(place); });
    marker.addEventListener('pointerleave', () => hover(null));
    marker.addEventListener('focus', () => { focusedPlace = place; if (interactiveBay()) highlight(place); });
    marker.addEventListener('blur', () => { focusedPlace = null; hover(hoveredPlace); });
    marker.addEventListener('click', () => { if (destination === place) highlight(place); });
  }
  ui.arena.addEventListener('click', event => {
    if (!interactiveBay()) return;
    const marker = bayMarkers.get(buildingAt(event));
    if (marker && !marker.disabled) marker.click();
  });
  function placeMarker(name, x, y) {
    if (ui.bayMap.hidden) return;
    const marker = bayMarkers.get(name);
    if (!marker) return;
    const left = Math.round(x) + 'px';
    const top = Math.round(y) + 'px';
    if (marker.style.getPropertyValue('--marker-x') !== left) marker.style.setProperty('--marker-x', left);
    if (marker.style.getPropertyValue('--marker-y') !== top) marker.style.setProperty('--marker-y', top);
  }
  let previousFrame;
  let nextWarmupAt = performance.now() + 450;
  let warmNight = bayDarkness() >= .5;
  function frame(now) {
    const roundKey = room ? room.code + '/' + room.round : '';
    const delta = (now - (previousFrame ?? now)) / 1_000;
    const travel = journey ? (now - journey.at) / journey.duration : 1;
    if (highlighted && !interactiveBay() && !(journey && destination === highlighted)) highlight(null);
    if (room) view.render(room.match, member?.id, delta, roundKey);
    else {
      view.renderBay(delta, destination, travel, placeMarker, nearWallet?.appearance ?? wallet?.workshop.appearance, wallet?.workshop.merchant,
        wallet?.firstBrawl, bayHosts, expeditions.scene(), nearWorkshop.homeState());
      if (now >= nextWarmupAt && !document.hidden && !journey && !destination && !document.querySelector('dialog:modal')) {
        nextWarmupAt = now + 1_000;
        view.warmArena?.(warmNight);
        warmNight = !warmNight;
      }
    }
    previousFrame = now;
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
} catch (error) {
  ui.fallback.hidden = false;
  ui.bayMap.classList.add('bay-map-fallback');
  document.body.classList.add('vault-fallback');
  console.error('Could not initialize the arena display.', error);
}

window.setInterval(updateWorldTheme, 1_000);
if (!member) accessSetup.showFirstVisit();
if (!member && new URL(location.href).searchParams.has('tour')) {
  if (accessSetup.dialog.open) accessSetup.dialog.addEventListener('close', showJudgesTour, { once: true });
  else showJudgesTour();
}
connect();

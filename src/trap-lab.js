import './trap-lab.css';
import { createArenaView, ARENA_CAMERA } from './arena-view.js';
import { renderGameIcons } from './game-icons.js';
import { createTrapTrial } from '../shared/trap-lab.mjs';
import { createMatch, readMatch, stepMatch, TICK_RATE } from '../shared/simulation.mjs';
import { crowdReaction } from '../shared/reactions.mjs';
import { playCrowdReaction } from './crowd-audio.js';
import { bayDarkness } from '../shared/world-lighting.mjs';
import { DROP_CRATES, ROLLING_BARRELS } from '../shared/arena-hazards.mjs';
import { ANCHOR_COUNT, CRATE_COUNT } from '../shared/experimental-traps.mjs';

renderGameIcons();
const get = id => document.getElementById(id);
const view = createArenaView(get('lab-arena'));
const keys = new Set();
const stick = get('lab-stick');
const thumb = stick.firstElementChild;
const timeScale = get('lab-speed');
const force = get('lab-force');
const offset = get('lab-offset');
const multiple = get('lab-multiple');
const count = get('lab-count');
const tuning = {
  force, count, heading: get('lab-heading'), warning: get('lab-warning'),
  reach: get('lab-reach'), fuse: get('lab-fuse'), crane: get('lab-crane-speed'), tilt: get('lab-tilt'),
};
const trapButtons = [...document.querySelectorAll('[data-kind]')];
const trapSettings = {
  broadside: { count: 3, unit: 'Firing lanes', settings: ['force', 'heading', 'warning', 'reach'] },
  parrots: { count: 3, unit: 'Flight paths', settings: ['force', 'heading', 'warning', 'reach'] },
  kraken: { settings: ['heading', 'warning', 'reach'] },
  powder: { settings: ['force', 'warning', 'reach'] },
  collapse: { settings: ['warning', 'reach'] },
  'anchor-drop': { settings: ['heading', 'warning', 'reach'] },
  'crate-drop': { count: DROP_CRATES, unit: 'Cargo barrels', settings: ['heading', 'warning', 'fuse'] },
  'barrel-roll': { count: ROLLING_BARRELS, unit: 'Rolling barrels', settings: ['force', 'heading', 'warning', 'reach'] },
  seesaw: { settings: ['tilt'] },
  anchor: { count: ANCHOR_COUNT, unit: 'Anchors', settings: ['force', 'crane'] },
  crate: { count: CRATE_COUNT, unit: 'Crates', settings: ['force', 'crane'] },
};
const play = get('lab-play');
const pauseHit = get('lab-hit-pause');
const sound = get('lab-sound');
const botMode = new URLSearchParams(location.search).get('mode') === 'bots';
const botStyle = get('lab-bot-style');
const botCount = get('lab-bot-count');
if (botMode) {
  document.title = 'NEARly Afloat · Bot Lab';
  get('lab-title').textContent = 'Bot Lab';
  get('lab-bots').hidden = false;
  for (const id of ['lab-trap-controls', 'lab-trap-settings', 'lab-hit-pause']) get(id).hidden = true;
}
for (const control of [botStyle, botCount]) control.addEventListener('change', reset);
get('lab-map').addEventListener('change', () => reset());
let kind = 'broadside';
let match;
let trial = 0;
let paused = false;
let accumulator = 0;
let peak = 0;
let impulse;
let contact;
let seen = new Set();
let pointer = null;
let touchX = 0;
let touchUp = 0;
let bounds;
let audio;
let soundOn = true;

function unlockSound() {
  if (!soundOn || typeof AudioContext !== 'function') return;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}

function setPaused(value) {
  paused = value;
  play.textContent = paused ? '▶' : 'Ⅱ';
  play.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
}

function reset() {
  if (botMode) {
    const roster = Array.from({ length: 1 + Number(botCount.value) }, (_, slot) =>
      ({ id: slot ? 'bot-' + slot : 'target-0', slot, bot: slot > 0, name: slot ? 'Crewmate ' + slot : 'You' }));
    match = createMatch(roster, 801, null, { botStyle: botStyle.value });
  } else {
    const value = key => tuning[key].disabled ? undefined : Number(tuning[key].value);
    match = createTrapTrial(kind, { scale: value('force'), offset: Number(offset.value), multiple: multiple.checked,
      count: value('count'), heading: value('heading'), warning: value('warning'),
      reach: value('reach'), fuse: value('fuse'), approachSpeed: value('crane'), tilt: value('tilt') });
  }
  match.arenaMap = get('lab-map').value;
  match.night = bayDarkness() >= .5;
  trial++;
  accumulator = peak = 0;
  impulse = contact = null;
  seen = new Set();
  setPaused(false);
  get('lab-multiple-label').textContent = kind === 'seesaw' ? 'Weight on one side' : '3 targets';
  get('lab-offset-value').value = offset.value;
}

function selectTrap(button) {
  kind = button.dataset.kind;
  const profile = trapSettings[kind];
  const label = button.textContent.trim();
  get('lab-tuning-title').textContent = label + ' settings';
  for (const choice of trapButtons) choice.setAttribute('aria-pressed', String(choice === button));
  for (const [key, field] of Object.entries(tuning)) {
    field.disabled = key === 'count' ? !profile.count : !profile.settings.includes(key);
    field.closest('[data-tuning]').hidden = field.disabled;
  }
  if (profile.count) {
    get('lab-count-label').textContent = profile.unit;
    count.replaceChildren(...Array.from({ length: profile.count }, (_, i) => new Option(String(i + 1), String(i + 1))));
    count.value = ['broadside', 'parrots'].includes(kind) ? '1' : String(profile.count);
  }
  get('lab-reach-label').textContent = kind === 'powder' ? 'Blast radius'
    : ['collapse', 'anchor-drop'].includes(kind) ? 'Break width' : 'Impact width';
  reset();
}

function release() {
  pointer = null;
  touchX = touchUp = 0;
  thumb.style.transform = '';
}

function controls() {
  const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + touchX;
  const up = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + touchUp;
  const scale = Math.hypot(ARENA_CAMERA.x, ARENA_CAMERA.z) * Math.max(1, Math.hypot(right, up));
  return { x: (right * ARENA_CAMERA.z - up * ARENA_CAMERA.x) / scale,
    z: (-right * ARENA_CAMERA.x - up * ARENA_CAMERA.z) / scale };
}

function move(event) {
  if (event.pointerId !== pointer) return;
  const x = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width * .34);
  const up = (bounds.top + bounds.height / 2 - event.clientY) / (bounds.width * .34);
  const length = Math.max(1, Math.hypot(x, up));
  touchX = x / length;
  touchUp = up / length;
  thumb.style.transform = `translate(${touchX * bounds.width * .34}px, ${-touchUp * bounds.width * .34}px)`;
}

for (const button of trapButtons) button.addEventListener('click', () => selectTrap(button));
get('lab-reset').addEventListener('click', reset);
play.addEventListener('click', () => setPaused(!paused));
pauseHit.addEventListener('click', () => pauseHit.setAttribute('aria-pressed', String(pauseHit.getAttribute('aria-pressed') !== 'true')));
for (const control of [...Object.values(tuning), multiple]) control.addEventListener('change', reset);
offset.addEventListener('input', reset);
sound.addEventListener('click', () => {
  soundOn = !soundOn;
  sound.setAttribute('aria-pressed', String(soundOn));
});
document.addEventListener('pointerdown', unlockSound);
window.addEventListener('keydown', event => {
  if (event.target.closest('input,select,a') || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'Space' && event.target.closest('button')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) setPaused(!paused);
  } else if (event.code === 'KeyR') reset();
  else if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
  unlockSound();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); release(); });
window.addEventListener('resize', release);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keys.clear(); release(); setPaused(true); }
});
stick.addEventListener('pointerdown', event => {
  if (pointer !== null) return;
  event.preventDefault();
  pointer = event.pointerId;
  bounds = stick.getBoundingClientRect();
  stick.setPointerCapture(pointer);
  move(event);
});
stick.addEventListener('pointermove', move);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  stick.addEventListener(type, event => { if (event.pointerId === pointer) release(); });
}

if (botMode) reset();
else selectTrap(trapButtons[0]);
let previous;
function frame(now) {
  const dt = Math.min(.1, (now - (previous ?? now)) / 1000);
  previous = now;
  if (!paused) {
    accumulator += dt * Number(timeScale.value);
    while (accumulator >= 1 / TICK_RATE && !paused) {
      accumulator -= 1 / TICK_RATE;
      stepMatch(match, 1 / TICK_RATE, new Map([['target-0', controls()]]));
      for (const event of match.events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        if (soundOn) playCrowdReaction(audio, crowdReaction(event));
        const ownContact = event.playerId === 'target-0' && ['hazard-hit', 'hazard-grab', 'fall'].includes(event.type);
        const anchorTransfer = kind === 'anchor' && event.kind === 'anchor' && event.type === 'hazard-hit';
        if (ownContact || anchorTransfer) {
          impulse = event.force ?? impulse;
          if (!contact) {
            contact = { x: event.x, z: event.z, playerId: event.playerId };
            if (anchorTransfer) peak = 0;
          }
          if (pauseHit.getAttribute('aria-pressed') === 'true') setPaused(true);
        }
      }
      const measured = contact ? match.players.find(entry => entry.id === contact.playerId) : match.players[0];
      peak = Math.max(peak, Math.hypot(measured.vx, measured.vz));
    }
  }
  const player = match.players[0];
  const measured = contact ? match.players.find(entry => entry.id === contact.playerId) : player;
  get('lab-velocity').textContent = Math.hypot(measured.vx, measured.vz).toFixed(2);
  get('lab-peak').textContent = peak.toFixed(2);
  get('lab-impulse').textContent = impulse?.toFixed(2) ?? '—';
  get('lab-travel').textContent = contact ? Math.hypot(measured.x - contact.x, measured.z - contact.z).toFixed(2) : '0';
  const trap = match.placedTrap ?? match.hazard;
  const angle = trap?.kind === 'seesaw' ? Math.hypot(trap.tiltX, trap.tiltZ) : 0;
  const tilt = angle > .005 ? ` · Tilt ${Math.round(angle * 180 / Math.PI)}°` : '';
  const crushed = match.falls.some(fall => fall.playerId === player.id && fall.cause === 'crushed');
  get('lab-status').textContent = paused ? 'Paused' : botMode
    ? match.phase === 'results' ? (match.players.find(entry => entry.id === match.winnerId)?.name ?? 'Round over') + ' · R to restart'
      : match.phase === 'countdown' ? 'Starting in ' + Math.ceil(match.countdown) : 'In play · ' + match.players.filter(entry => entry.alive).length + ' afloat'
    : player.grab ? 'Grabbed' : !player.alive ? (crushed ? 'Crushed' : 'Overboard') + ' · R to restart'
    : match.elapsed < trap?.fireAt ? 'Preparing' : match.elapsed < trap?.end ? 'Active' + tilt : 'Ready to restart';
  view.render(readMatch(match), 'target-0', paused ? 0 : dt * Number(timeScale.value), 'trap-lab/' + trial);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const welcome = [
  ['captain', 'Ahoy, deckhand! Welcome aboard. At Arena Pier, the last barrel afloat wins.', 'Next'],
  ['parrot', 'Roll to steer. Ram the other barrels and keep clear of the edge.', 'Arena Pier', 'arena'],
];

export function hostSound(audio, speaker) {
  if (audio.state !== 'running') return;
  const captain = speaker === 'captain';
  const calls = captain ? [[0, .42, 155, 76]] : [[0, .13, 760, 1450], [.15, .18, 1150, 530]];
  for (const [delay, duration, start, end] of calls) {
    const at = audio.currentTime + delay;
    const voice = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const volume = audio.createGain();
    voice.type = captain ? 'sawtooth' : 'triangle';
    voice.frequency.setValueAtTime(start, at);
    voice.frequency.exponentialRampToValueAtTime(end, at + duration);
    filter.type = captain ? 'bandpass' : 'lowpass';
    filter.frequency.setValueAtTime(captain ? 940 : 1900, at);
    filter.frequency.exponentialRampToValueAtTime(captain ? 480 : 1300, at + duration);
    volume.gain.setValueAtTime(.001, at);
    volume.gain.exponentialRampToValueAtTime(captain ? .14 : .10, at + .035);
    volume.gain.exponentialRampToValueAtTime(.001, at + duration);
    voice.connect(filter).connect(volume).connect(audio.destination);
    voice.start(at);
    voice.stop(at + duration);
  }
}

export function mountBayHosts(panel, play, navigate, options = {}) {
  const view = options.view ?? globalThis.window;
  let storage;
  try { storage = options.storage ?? globalThis.localStorage; } catch {}
  const viewport = panel.parentElement;
  const name = panel.querySelector('strong');
  const message = panel.querySelector('p');
  const advance = panel.querySelector('[data-host-next]');
  const progress = panel.querySelector('#host-progress');
  let replaying = false;
  let canShow = false;
  let sceneAvailable = false;
  let heardWelcome = false;
  let page = 0;
  let line;
  let welcomeSeen = false;
  let autoWelcome = false;
  try { welcomeSeen = Boolean(storage?.getItem('bay-intro-seen')); } catch {}
  let stage;
  let placed = false;
  let focusNext = false;
  const state = { speaker: null, voice: 0, place };

  function rememberWelcome() {
    if (welcomeSeen) return;
    welcomeSeen = true;
    try { storage?.setItem('bay-intro-seen', 'seen'); } catch {}
  }

  function setVisible(visible) {
    panel.hidden = !visible;
    placed = visible;
  }

  function show(next) {
    if (line === next) return;
    line = next;
    const [speaker, words, action] = line;
    panel.dataset.speaker = speaker;
    name.textContent = speaker === 'captain' ? 'Captain Brine' : 'Pip';
    message.textContent = words;
    advance.textContent = action;
    progress.hidden = !welcome.includes(line);
    progress.textContent = (welcome.indexOf(line) + 1) + ' / ' + welcome.length;
  }

  function speak() {
    state.voice += 1;
    if (line === welcome[0]) heardWelcome = true;
    play(line[0], 'argh');
  }

  function place() {
    if (!placed) {
      setVisible(true);
      if (focusNext) advance.focus({ preventScroll: true });
      focusNext = false;
    }
  }

  function dismiss() {
    rememberWelcome();
    autoWelcome = false;
    replaying = false;
    viewport.removeAttribute('data-host-intro');
    state.speaker = null;
    setVisible(false);
  }

  panel.querySelector('[data-host-voice]').addEventListener('click', speak);
  panel.querySelector('[data-host-close]').addEventListener('click', dismiss);
  viewport.addEventListener('click', event => {
    if (placed && event.target === viewport) dismiss();
  });
  view.addEventListener('keydown', event => {
    if (state.speaker && event.key === 'Escape') dismiss();
  });
  advance.addEventListener('click', event => {
    if (line[3]) {
      if (navigate(line[3])) dismiss();
      return;
    }
    const greeting = !heardWelcome && line === welcome[0];
    if (greeting) speak();
    show(welcome[++page]);
    state.speaker = line[0];
    if (!panel.dataset.fallback) {
      focusNext = event.detail === 0;
      setVisible(false);
    }
    if (!greeting) speak();
    else view.setTimeout(() => { if (state.speaker === 'parrot') speak(); }, 740);
  });

  state.update = (visible, nextStage, _claimedHere, hasScene) => {
    stage = nextStage;
    canShow = visible;
    sceneAvailable = hasScene;
    // A bound/available starter proves this identity already passed the debut,
    // even on a browser without the local welcome marker. Reward prompts belong
    // only to the actual introductory result, not to recurring bay visits.
    if (stage === 'ready' || stage === 'claimed') {
      rememberWelcome();
      autoWelcome = false;
    }
    if (!visible) autoWelcome = false;
    if (visible && !replaying && stage === 'new' && !welcomeSeen) {
      autoWelcome = true;
      rememberWelcome();
    }
    const active = visible && (replaying || (autoWelcome && stage === 'new'));
    viewport.toggleAttribute('data-host-intro', active && hasScene);
    if (!active) {
      state.speaker = null;
      setVisible(false);
      return;
    }
    show(welcome[page]);
    const changed = state.speaker !== line[0];
    state.speaker = line[0];
    if (!hasScene) {
      panel.dataset.fallback = 'true';
      setVisible(true);
    } else if (changed) {
      setVisible(false);
    }
  };
  state.replay = () => {
    if (!canShow) return;
    replaying = true;
    page = 0;
    state.update(true, stage, false, sceneAvailable);
    speak();
  };
  return state;
}

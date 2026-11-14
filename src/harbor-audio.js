const directory = '/audio/';
const music = new Audio(directory + 'bay-shanty.ogg');
music.loop = true;
music.preload = 'none';
const voices = Object.fromEntries(['argh', 'yarr'].map(name => [name, new Audio(directory + name + '.ogg')]));
let lastVoice = 0;

export function updateMusic(enabled, inRound) {
  music.volume = inRound ? .19 : .34;
  if (!enabled || document.hidden) music.pause();
  else if (music.paused) music.play().catch(() => {});
}

export function playPirateVoice(name, volume = .44, force = false) {
  if (name == null) { for (const voice of Object.values(voices)) voice.pause(); return; }
  const now = performance.now();
  if (!force && now - lastVoice < 840) return;
  const clip = voices[name];
  if (!clip) return;
  lastVoice = now;
  clip.volume = volume;
  clip.currentTime = 0;
  clip.play().catch(() => {});
}

export function harborSound(audio, kind, volume = .055) {
  if (audio?.state !== 'running') return;
  const splash = kind === 'splash';
  const duration = splash ? .49 : kind === 'wood' ? .19 : .81;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const wave = buffer.getChannelData(0);
  for (let i = 0; i < wave.length; i++) wave[i] = 2 * Math.random() - 1;
  const at = audio.currentTime;
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(splash ? 1500 : kind === 'wood' ? 390 : 630, at);
  filter.frequency.exponentialRampToValueAtTime(splash ? 360 : 180, at + duration);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(.001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + (kind === 'surf' ? .27 : .025));
  gain.gain.exponentialRampToValueAtTime(.001, at + duration);
  noise.connect(filter).connect(gain).connect(audio.destination);
  noise.start(at);
}

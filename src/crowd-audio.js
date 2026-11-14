const lastCheers = new WeakMap();

export function playCrowdReaction(audio, strength) {
  if (!strength || audio?.state !== 'running') return;
  const at = audio.currentTime;
  if (at - (lastCheers.get(audio) ?? -Infinity) < 1.8) return;
  lastCheers.set(audio, at);
  for (let i = 0; i < 5; i++) {
    const start = at + i * .035;
    const voice = audio.createOscillator();
    const throat = audio.createBiquadFilter();
    const volume = audio.createGain();
    const duration = .35 + i * .055;
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(125 + i * 27, start);
    voice.frequency.exponentialRampToValueAtTime(215 + i * 23, start + .11);
    voice.frequency.exponentialRampToValueAtTime(105 + i * 19, start + duration);
    throat.type = 'bandpass';
    throat.frequency.value = 650 + i * 100;
    throat.Q.value = 1.2;
    volume.gain.setValueAtTime(.001, start);
    volume.gain.linearRampToValueAtTime(.018 * strength, start + .08);
    volume.gain.exponentialRampToValueAtTime(.001, start + duration);
    voice.connect(throat).connect(volume).connect(audio.destination);
    voice.start(start);
    voice.stop(start + duration);
    voice.onended = () => {
      voice.disconnect();
      throat.disconnect();
      volume.disconnect();
    };
  }
}

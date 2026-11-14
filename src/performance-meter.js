// Explicit opt-in diagnostics for physical-device acceptance. No loop/listener
// is installed in normal play; measurements use the renderer's existing loop.
export function createFrameSampler(limit = 120) {
  const frames = [];
  return {
    sample(seconds) {
      if (!(seconds > 0 && seconds < .5)) return;
      frames.push(seconds * 1000);
      if (frames.length > limit) frames.shift();
    },
    reset() { frames.length = 0; },
    read() {
      if (!frames.length) return null;
      const ordered = [...frames].sort((a, b) => a - b);
      return { frames: frames.length, fps: 1000 * frames.length / frames.reduce((sum, frame) => sum + frame, 0),
        p95: ordered[Math.ceil(ordered.length * .95) - 1], slowFrames: frames.filter(frame => frame > 33.4).length };
    },
  };
}

export function mountPerformanceMeter(canvas, renderer) {
  const toggle = document.getElementById('judges-performance');
  if (!toggle) return { sample() {}, dispose() {} };
  const sampler = createFrameSampler();
  const output = document.createElement('output');
  output.className = 'performance-meter';
  output.id = 'performance-readout';
  output.hidden = true;
  output.setAttribute('aria-label', 'Device performance diagnostics');
  document.body.append(output);
  let elapsed = 0;
  function toggleReadout() {
    output.hidden = !toggle.checked;
    output.textContent = 'Measuring frame rate…';
    sampler.reset();
    elapsed = 0;
  }
  toggle.addEventListener('change', toggleReadout);
  return {
    sample(seconds) {
      if (output.hidden) return;
      if (document.hidden) { sampler.reset(); elapsed = 0; return; }
      sampler.sample(seconds);
      elapsed += Math.min(seconds || 0, .1);
      if (elapsed < 1) return;
      elapsed = 0;
      const stats = sampler.read();
      if (!stats) return;
      output.textContent = `${stats.fps.toFixed(0)} FPS · p95 ${stats.p95.toFixed(1)} ms · >33ms ${stats.slowFrames}/${stats.frames}\n`
        + `${document.body.dataset.uiLayout ?? ''} · ${canvas.clientWidth}×${canvas.clientHeight} → ${canvas.width}×${canvas.height} · ${renderer.info.render.calls} draws`;
    },
    dispose() { toggle.removeEventListener('change', toggleReadout); output.remove(); },
  };
}

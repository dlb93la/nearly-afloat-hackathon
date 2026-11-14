const storageKey = 'afloat-accessibility-v1';
const defaults = { text: false, marker: false, color: false, motion: null };
const systemMotion = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };
let saved;
try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch {}

export const accessibility = { ...defaults };
for (const key of Object.keys(defaults)) {
  if (typeof saved?.[key] === 'boolean') accessibility[key] = saved[key];
}
export const reducedMotion = { get matches() { return accessibility.motion ?? systemMotion.matches; } };

function applyDisplay() {
  document.documentElement.toggleAttribute('data-large-text', accessibility.text);
  document.documentElement.toggleAttribute('data-reduce-motion', reducedMotion.matches);
}

export function mountAccessibility(getAudio, setAudio, onClose) {
  const dialog = document.getElementById('accessibility-settings');
  const button = document.getElementById('accessibility-open');
  const inputs = Object.fromEntries([...Object.keys(defaults), 'effects', 'music'].map(key =>
    [key, document.getElementById(`accessibility-${key}`)]));
  const sync = () => {
    const values = { ...accessibility, ...getAudio(), motion: reducedMotion.matches };
    for (const [key, input] of Object.entries(inputs)) input.checked = values[key];
  };
  let seen = saved?.seen === true;
  const persist = () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...accessibility, seen })); } catch {}
  };
  function open() {
    if (dialog.open) return;
    sync();
    dialog.showModal();
  }
  for (const [key, input] of Object.entries(inputs)) input.addEventListener('change', () => {
    if (key === 'effects' || key === 'music') setAudio(key, input.checked);
    else { accessibility[key] = input.checked; applyDisplay(); persist(); }
  });
  function rememberVisit() { seen = true; persist(); }
  dialog.addEventListener('submit', rememberVisit);
  dialog.addEventListener('close', () => { rememberVisit(); onClose(); });
  button.addEventListener('click', open);
  systemMotion.addEventListener?.('change', () => { applyDisplay(); if (dialog.open) sync(); });
  applyDisplay();
  return { dialog, button, showFirstVisit() { if (!seen) open(); } };
}

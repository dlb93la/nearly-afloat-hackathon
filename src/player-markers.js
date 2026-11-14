const storageKey = 'barrel-bay:player-markers';
const automaticSwatch = '#ffd77d';
const fields = [['arrow', 'Head arrow'], ['ring', 'Deck ring']];

let colors;
export function playerMarkerColors() {
  if (!colors) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch {}
    colors = Object.fromEntries(fields.map(([key]) => [key,
      /^#[a-f0-9]{6}$/i.test(saved?.[key]) ? saved[key] : null]));
  }
  return colors;
}

export function createPlayerMarkerControls() {
  const section = document.createElement('section');
  section.className = 'player-marker-colors';
  const title = document.createElement('h4');
  title.textContent = 'Player markers';
  section.append(title);
  const inputs = new Map();
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Auto colors';

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(playerMarkerColors())); } catch {}
    reset.disabled = !fields.some(([key]) => playerMarkerColors()[key]);
  }

  for (const [key, text] of fields) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'color';
    input.value = playerMarkerColors()[key] ?? automaticSwatch;
    input.addEventListener('input', () => {
      playerMarkerColors()[key] = input.value;
      save();
    });
    label.append(text, input);
    section.append(label);
    inputs.set(key, input);
  }
  reset.disabled = !fields.some(([key]) => playerMarkerColors()[key]);
  reset.addEventListener('click', () => {
    for (const [key, input] of inputs) {
      playerMarkerColors()[key] = null;
      input.value = automaticSwatch;
    }
    save();
  });
  section.append(reset);
  return section;
}

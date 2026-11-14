import { certifiedRoute, FORT_CELLS, FORT_COLUMNS, FORT_ENTRY, FORT_PIECES, FORT_PRESETS,
  FORT_ROWS, FORT_TILE, liveFort } from '../shared/live-vault.mjs';
import { DEFAULT_RIG, rigFor } from '../shared/rigs.mjs';
import { gameIcon } from './game-icons.js';

export function goldLabel(units) {
  return (units / 100).toFixed(2);
}

const fixtures = {
  entry: { name: 'Entrance', glyph: '↟', color: 0x6eb59c },
  chest: { name: 'Treasure', glyph: '◆', color: 0xe6ac57, hint: 'Set the treasure in the north six rows.' },
  clear: { name: 'Erase', glyph: '×', color: 0x42545d, hint: 'Remove an obstacle and restore the deck.' },
  ...FORT_PIECES,
};

function drawFortMap(ctx, map, tile, frame) {
  const dot = (cell, color) => {
    ctx.fillStyle = color;
    ctx.fillRect((cell % FORT_COLUMNS) * tile, Math.floor(cell / FORT_COLUMNS) * tile, tile, tile);
  };
  ctx.fillStyle = '#a88c6f';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const { cell, kind } of map.pieces) {
    if (cell === frame?.breach || (kind === 'gate' && frame?.opened)) continue;
    dot(cell, '#' + FORT_PIECES[kind].color.toString(16).padStart(6, '0'));
  }
  dot(map.chest, '#ffdc76');
  dot(frame?.checkpoint ?? FORT_ENTRY, '#8ff6d6');
  if (!frame) return;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc((frame.x / FORT_TILE + FORT_COLUMNS / 2) * tile, (frame.z / FORT_TILE + FORT_ROWS / 2) * tile, 3.2, 0, Math.PI * 2);
  ctx.fill();
}

export function createHarbor(send, onReturn) {
  const get = id => document.getElementById(id);
  const panel = get('harbor');
  const arena = get('arena-layout');
  const board = get('defense-board');
  const notice = get('harbor-notice');
  let tool = 'wall';
  const exposed = get('vault-gold');
  const raidCode = get('raid-code');
  const leave = get('fort-leave');
  const radar = get('fort-minimap').getContext('2d');
  const presets = get('fort-training');
  const tools = get('fort-tools');
  let wallet;
  let draft;
  let route;
  let run;
  let online = false;
  let pending;
  let message = '';
  let section = 'defense';

  function action(type, data) {
    if (!online || pending || !send({ type, ...data })) return;
    pending = type;
    message = '';
    render();
  }

  function setDraft(map) {
    draft = structuredClone(map);
    route = certifiedRoute(draft);
  }

  function editable() {
    return online && !pending && !wallet?.vault.locked;
  }

  function edit(cell) {
    if (!editable() || cell === FORT_ENTRY) return;
    const kind = tool;
    const pieces = draft.pieces.filter(piece => piece.cell !== cell);
    if (kind === 'chest') {
      if (cell >= FORT_COLUMNS * 6) return;
      setDraft({ ...draft, chest: cell, pieces });
    } else {
      if (cell === draft.chest) return;
      if (kind !== 'clear' && !draft.pieces.some(piece => piece.cell === cell && piece.kind === kind)) {
        pieces.push({ cell, kind });
      }
      setDraft({ ...draft, pieces });
    }
    render();
  }

  const cells = Array.from({ length: FORT_CELLS }, (_, cell) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = cell === FORT_ENTRY ? 0 : -1;
    button.addEventListener('click', () => edit(cell));
    button.addEventListener('focus', () => {
      const previous = board.querySelector('[tabindex="0"]');
      if (previous) previous.tabIndex = -1;
      button.tabIndex = 0;
    });
    button.addEventListener('keydown', event => {
      const move = { ArrowUp: -FORT_COLUMNS, ArrowDown: FORT_COLUMNS,
        ArrowLeft: cell % FORT_COLUMNS ? -1 : 0, ArrowRight: (cell + 1) % FORT_COLUMNS ? 1 : 0 }[event.key];
      if (!move) return;
      event.preventDefault();
      cells[cell + move]?.focus();
    });
    return button;
  });
  board.replaceChildren(...cells);
  const layouts = get('fort-layout');
  layouts.add(new Option('Choose a layout…', ''));
  layouts.add(new Option('Empty pier', 'empty'));
  for (const [id, { label, map }] of Object.entries(FORT_PRESETS)) {
    layouts.add(new Option(label, id));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fort-preset';
    button.title = label + ' · Free';
    button.setAttribute('aria-label', button.title);
    const miniature = document.createElement('canvas');
    miniature.width = FORT_COLUMNS * 4;
    miniature.height = FORT_ROWS * 4;
    miniature.setAttribute('aria-hidden', 'true');
    drawFortMap(miniature.getContext('2d'), map, 4);
    const badge = document.createElement('span');
    badge.className = 'symbol-button';
    badge.append(gameIcon('play'), gameIcon('coin'), '0');
    button.append(miniature, badge);
    button.addEventListener('click', () => action('raid-training', { preset: id }));
    presets.append(button);
  }
  layouts.addEventListener('change', () => {
    if (!editable() || !layouts.value) return;
    const map = layouts.value === 'empty' ? { ...FORT_PRESETS.dock.map, pieces: [] } : FORT_PRESETS[layouts.value].map;
    setDraft(map);
    layouts.value = '';
    render();
  });
  for (const [id, item] of Object.entries(fixtures)) {
    if (id === 'entry') continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tool = id;
    button.title = item.name + ' · ' + item.hint;
    button.setAttribute('aria-label', item.name);
    button.style.setProperty('--piece', '#' + item.color.toString(16).padStart(6, '0'));
    button.textContent = item.glyph;
    button.addEventListener('click', () => {
      tool = id;
      render();
    });
    tools.append(button);
  }
  get('fort-show-route').addEventListener('change', render);

  function renderRun() {
    if (!run) return;
    const frame = run.frame;
    get('fort-run-title').textContent = run.label + (run.paid ? ' · ' + goldLabel(run.gold) + ' gold' : ' · Practice');
    get('fort-hearts').textContent = '♥'.repeat(frame.hearts) + '♡'.repeat(3 - frame.hearts) + (frame.armor ? ' · Shield' : '');
    get('fort-hearts').setAttribute('aria-label', frame.hearts + ' hearts');
    get('fort-time').textContent = String(frame.seconds) + 's';
    const note = !online ? 'Reconnecting…' : frame.status === 'expired' ? 'Raid expired. Entry returned.'
      : frame.status === 'won' && run.paid ? goldLabel(run.gold) + ' gold secured!' : frame.event;
    const event = get('fort-event');
    if (event.textContent !== note) event.textContent = note;
    drawFortMap(radar, run.map, 8, frame);
  }

  function render() {
    if (!wallet || panel.hidden) return;
    const { vault, raid, gold } = wallet;
    panel.dataset.activity = run ? 'running' : section;
    get('fort-run').hidden = !run;
    board.hidden = Boolean(run) || section !== 'defense';
    get('harbor-gold').textContent = goldLabel(gold);
    notice.textContent = online ? message : 'Reconnecting to the fort…';
    get('vault-code').textContent = vault.code;
    for (const name of ['defense', 'raid']) {
      get('vault-' + name).hidden = section !== name;
      get('show-' + name).setAttribute('aria-pressed', String(section === name));
    }
    if (run) {
      renderRun();
      return;
    }
    const canEdit = editable();
    for (const input of [exposed, layouts, ...tools.children]) input.disabled = !canEdit;
    for (const button of tools.children) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    for (const button of presets.children) button.disabled = !online || Boolean(pending);
    get('vault-save').disabled = !canEdit || !route;
    get('fort-test').disabled = !online || Boolean(pending) || !route;
    const status = get('vault-status');
    status.title = vault.locked ? 'Defense and gold locked during the raid.'
      : route ? 'Oak route verified · ' + (route.length - 1) + ' sections · ' + draft.pieces.length + ' obstacles'
      : 'No safe oak route. Clear a lane, move a cannon or add a parrot crossing.';
    const detail = document.createElement('span');
    detail.className = 'visually-hidden';
    detail.textContent = status.title;
    status.replaceChildren(gameIcon(vault.locked ? 'lock' : route ? 'check' : 'close'), route ? String(route.length - 1) : '', detail);
    status.dataset.valid = String(Boolean(route));
    const guide = new Set(get('fort-show-route').checked ? route ?? [] : []);
    const pieces = new Map(draft.pieces.map(({ cell, kind }) => [cell, kind]));
    for (const [cell, button] of cells.entries()) {
      const kind = cell === FORT_ENTRY ? 'entry' : cell === draft.chest ? 'chest' : pieces.get(cell);
      const item = fixtures[kind];
      button.textContent = item?.glyph ?? '';
      button.classList.toggle('route', guide.has(cell));
      button.style.setProperty('--piece', item ? '#' + item.color.toString(16).padStart(6, '0') : '');
      button.setAttribute('aria-label', 'Row ' + (Math.floor(cell / FORT_COLUMNS) + 1) + ', column '
        + (cell % FORT_COLUMNS + 1) + ', ' + (item?.name ?? 'deck'));
      button.setAttribute('aria-disabled', String(!canEdit || cell === FORT_ENTRY || (tool === 'chest'
        ? cell >= FORT_COLUMNS * 6 : cell === draft.chest)));
    }
    const stranded = raid?.status === 'open';
    raidCode.disabled = get('raid-start').disabled = !online || Boolean(pending) || stranded;
    get('raid-recover').hidden = !stranded;
    get('raid-rig').textContent = wallet.rig === DEFAULT_RIG ? 'Oak barrel' : rigFor(wallet.rig).label;
    get('raid-result').textContent = raid?.status === 'won' ? 'Last raid · ' + goldLabel(raid.gold) + ' gold secured.'
      : raid?.status === 'failed' ? 'Last raid failed.' : ['cancelled', 'expired'].includes(raid?.status) ? 'Last entry refunded.' : '';
  }

  function update(next) {
    if (wallet?.vault.code !== next.vault.code || wallet?.vault.version !== next.vault.version) {
      setDraft(liveFort(next.vault.defense));
      exposed.value = goldLabel(next.vault.gold);
    }
    wallet = next;
    render();
  }
  function setOnline(connected) {
    if (online === connected) return;
    online = connected;
    if (!online) pending = null;
    render();
  }
  function acknowledge(type) {
    if (type !== pending) return;
    pending = null;
    if (type === 'raid-cancel') run = null;
    message = type === 'vault-save' ? 'Defense saved.' : '';
    render();
  }
  function error(detail) {
    if (!pending) return false;
    pending = null;
    message = detail;
    render();
    return true;
  }
  function open() {
    if (!wallet || !online) return false;
    arena.hidden = true;
    panel.hidden = false;
    if (wallet.raid?.status === 'open') section = 'raid';
    render();
    get('harbor-title').focus({ preventScroll: true });
    return true;
  }
  function leaveRun() {
    if (!run) return;
    if (run.frame.status === 'running') {
      if (!leave.open) leave.showModal();
    } else {
      run = null;
      render();
    }
  }
  function close() {
    if (pending) return;
    if (run) { leaveRun(); return; }
    panel.hidden = true;
    arena.hidden = false;
    onReturn();
  }
  function receiveRun(next) {
    run = next;
    panel.scrollTop = 0;
    if (pending === 'raid-start' || pending === 'raid-training') pending = null;
    if (panel.hidden) open();
    render();
  }
  function receiveFrame(next) {
    if (!run || next.id !== run.id) return;
    run.frame = next.frame;
    renderRun();
  }
  leave.addEventListener('submit', event => {
    if (event.submitter?.value !== 'leave') return;
    event.preventDefault();
    leave.close();
    if (run) action('raid-cancel', { id: run.id });
  });
  for (const name of ['defense', 'raid']) get('show-' + name).addEventListener('click', () => {
    section = name;
    render();
  });
  get('vault-copy').addEventListener('click', async () => {
    const code = wallet.vault.code;
    try {
      await navigator.clipboard.writeText(code);
      message = 'Vault code copied.';
    } catch {
      message = 'Share vault code ' + code + '.';
    }
    render();
  });
  get('vault-form').addEventListener('submit', event => {
    event.preventDefault();
    action('vault-save', { version: wallet.vault.version, defense: draft, gold: Math.round(exposed.valueAsNumber * 100) });
  });
  get('raid-form').addEventListener('submit', event => {
    event.preventDefault();
    action('raid-start', { code: raidCode.value.trim().toUpperCase() });
  });
  get('fort-test').addEventListener('click', () => action('raid-training', { defense: draft }));
  get('raid-recover').addEventListener('click', () => action('raid-cancel', { id: wallet.raid.id }));

  return {
    open, close, update, setOnline, acknowledge, error, receiveRun, receiveFrame,
    visible: () => !panel.hidden,
    presentation: () => run,
    canSteer: () => Boolean(run?.frame.status === 'running' && !leave.open && online && !pending),
    steer: (x, z) => send({ type: 'raid-input', id: run.id, x, z }),
  };
}

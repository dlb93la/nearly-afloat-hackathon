const NOTICE_MS = 2_250;
const QUEUE_LIMIT = 3;
const hazardFalls = {
  collapse: ['BROKEN DECK', ' fell through the dock.'],
  broadside: ['BROADSIDE', ' got blasted overboard.'],
  parrots: ['PARROT RAID', ' got swept off the dock.'],
  powder: ['POWDER BLAST', ' got launched into the sea.'],
  kraken: ['KRAKEN GRAB', ' got dragged into the sea.'],
};

function describeFall(fall, players, ownId) {
  const name = (id) => id === ownId ? 'You' : players.find((player) => player.id === id)?.name ?? 'A barrel';
  const victim = name(fall.playerId);
  const personal = fall.playerId === ownId || fall.attackerId === ownId;
  let detail;
  let title = 'SPLASH';
  if (fall.attackerId) {
    const attacker = name(fall.attackerId);
    detail = attacker + ' knocked ' + (fall.playerId === ownId ? 'you' : victim) + ' overboard.';
    title = 'KNOCKOUT';
  } else if (fall.cause === 'left') {
    detail = victim + ' left the dock.';
    title = 'DEPARTURE';
  } else if (fall.cause === 'tide') {
    detail = victim + ' lost the last plank.';
    title = 'TIDE CLOSED';
  } else if (hazardFalls[fall.hazard]) {
    const [label, action] = hazardFalls[fall.hazard];
    title = label;
    detail = victim + action;
  } else {
    detail = victim + ' went overboard.';
  }
  if (fall.first) title = 'FIRST SPLASH';
  if (fall.revenge) title = 'REVENGE';
  return {
    title, detail, tone: fall.revenge ? 'revenge' : 'fall',
    priority: Number(personal) * 4 + Number(Boolean(fall.revenge)) * 2 + Number(Boolean(fall.first)),
  };
}

export function createBattleFeed({ strip, title, detail, recap, recapList }) {
  let key = '';
  let recapKey = '';
  let lastId = -1;
  let queue = [];
  let timer;

  function stop() {
    window.clearTimeout(timer);
    timer = undefined;
    queue = [];
    title.textContent = detail.textContent = '';
  }

  function showNext() {
    timer = undefined;
    const next = queue.shift();
    title.textContent = next?.title ?? '';
    detail.textContent = next?.detail ?? '';
    if (!next) return;
    strip.dataset.tone = next.tone;
    timer = window.setTimeout(showNext, NOTICE_MS);
  }

  function update(state, ownId, quiet = false) {
    const match = state?.match;
    const falls = match?.falls ?? [];
    const nextKey = match ? state.code + '/' + state.round : '';
    if (key !== nextKey) {
      stop();
      key = nextKey;
      lastId = -1;
    }
    const live = Boolean(match && !match.drill && (match.phase === 'playing' || match.phase === 'countdown'));
    strip.hidden = !live;
    const latest = falls.at(-1)?.id ?? -1;
    if (!live || quiet) {
      if (timer !== undefined) stop();
      lastId = latest;
    } else if (latest > lastId) {
      const fresh = falls.filter((fall) => fall.id > lastId && fall.cause !== 'tide');
      queue.push(...fresh.map((fall) => describeFall(fall, match.players, ownId)));
      queue.sort((a, b) => b.priority - a.priority);
      queue.length = Math.min(queue.length, QUEUE_LIMIT);
      lastId = latest;
      if (timer === undefined) showNext();
    }

    recap.hidden = match?.phase !== 'results' || !falls.length;
    const nextRecapKey = recap.hidden ? '' : key + '/' + latest + '/' + ownId;
    if (nextRecapKey === recapKey) return;
    recapKey = nextRecapKey;
    recap.open = false;
    if (recap.hidden) {
      recapList.replaceChildren();
      return;
    }
    const highlights = falls.map((fall) => ({ ...describeFall(fall, match.players, ownId), id: fall.id }));
    highlights.sort((a, b) => b.priority - a.priority || b.id - a.id);
    recapList.replaceChildren(...highlights.slice(0, 3).map(({ title, detail }) => {
      const row = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = title;
      row.append(label, detail);
      return row;
    }));
  }

  return { update };
}

const shapes = {
  accessibility: '<circle cx="12" cy="4" r="2"/><path d="M4 8l8 2 8-2m-8 2v5m0 0-4 6m4-6 4 6"/>',
  moon: '<path d="M20.5 15.1A9 9 0 0 1 8.9 3.5 9 9 0 1 0 20.5 15.1Z"/><path d="M17.5 3v5M15 5.5h5"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  play: '<path d="M7 4v16l13-8Z" fill="currentColor"/>',
  replay: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  shuffle: '<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 5-5m2-4c1-2 3-3 5-3h3m-4-4 4 4-4 4"/>',
  glance: '<path d="M3 20 12 11m-2 6 2-6-6 2m7-4 7-5m-4 0h4v4m-5 5 4 4"/>',
  crew: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2ZM16 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2h-3"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3M8 12h1m6 0h1m-8 4h8M2 12v3m20-3v3"/>',
  sword: '<path d="m4 20 5-5m-2-4 6 6m-3-3L20 4l-1 6-6 6m-9 2 2 2M6 4l-2 1 1 4 4 4m6 2 5 5m-3-7-4 4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 5-4 5-4-5Z"/>',
  store: '<path d="M3 10 5 4h14l2 6M5 13v8h14v-8M3 10c0 4 5 4 6 0 1 4 5 4 6 0 1 4 6 4 6 0M10 21v-5h4v5"/>',
  bag: '<path d="m8 8-3 4-2 8h18l-2-8-3-4ZM8 8V5a4 4 0 0 1 8 0v3m-7 6h6"/>',
  trade: '<path d="M3 7h17m-5-5 5 5-5 5m6 5H4m5-5-5 5 5 5"/>',
  barrel: '<path d="M7 3h10c4 4 4 14 0 18H7C3 17 3 7 7 3ZM5 8h14M5 16h14m-9-7v6m4-6v6"/>',
  shirt: '<path d="m8 4-6 4 3 5 3-2v9h8v-9l3 2 3-5-6-4a4 4 0 0 1-8 0Z"/>',
  parrot: '<path d="M6 15c0-4 3-7 5-7 0-3 3-5 6-3 2 1 2 2 2 4l3 1-3 2c-1 4-4 6-8 6l-5 3 1-4-3 1Zm6-1-3 2m7-8h.1"/>',
  flag: '<path d="M5 22V3m0 1c5-3 9 3 15 0v10c-6 3-10-3-15 0m5-5h5"/>',
  home: '<path d="m2 11 10-8 10 8M5 10v11h14V10m-9 11v-7h4v7"/>',
  chest: '<path d="M3 11h18v9H3Zm0 0V8l3-4h12l3 4v3m-6-7v7M9 4v7m1 0v4h4v-4"/>',
  force: '<path d="M4 9v6m3-8v10m10-10v10m3-8v6M7 12h10"/>',
  impact: '<path d="m12 2 2 6 6-3-3 6 5 2-6 2 2 6-6-3-5 3 2-6-7-2 5-2-3-6 6 3Z"/>',
  control: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7m2 3 6 4m-10-4-6 4"/>',
  speed: '<path d="M4 18a9 9 0 1 1 16 0M6 14h2m4-7v2m4 1-4 5m4 3h4M4 18h4"/>',
  durability: '<path d="m12 3 8 4v6c0 4-4 7-8 9-4-2-8-5-8-9V7Zm-2 9 2 2 4-5"/>',
  break: '<path d="M3 5h18v14H3Zm0 5h18M3 15h18m-13-5V5m7 14v-4m-4-5-2 5h5l-3 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  buy: '<path d="M2 4h3l2 11h12l2-8H6m4 4h7m-3.5-3.5v7"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
  equip: '<path d="M12 3v10m-4-4 4 4 4-4M5 14v6h14v-6"/>',
  remove: '<path d="M12 14V4m-4 4 4-4 4 4M5 14v6h14v-6"/>',
  tag: '<path d="M3 4h8l10 10-7 7L3 10Z"/><circle cx="7.5" cy="8" r="1"/>',
  unlist: '<path d="M3 4h8l10 10-7 7L3 10Z"/><path d="m10 13 5 5m0-5-5 5"/>',
  repair: '<path d="M15 3a5 5 0 0 0-6 6l-6 7a2 2 0 0 0 3 3l7-6a5 5 0 0 0 6-6l-3 3-3-3Z"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15m-8 4v7m4-7v7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  arrow: '<path d="M3 12h17m-6-6 6 6-6 6"/>',
  exit: '<path d="M10 4H4v16h6m0-8h11m-4-4 4 4-4 4"/>',
  link: '<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3m-3 3-3 3a5 5 0 0 1-7-7l3-3m1 6 8-8"/>',
  trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0Zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 3v6m-5 1h10"/>',
  wave: '<path d="M6 11v-3a1 1 0 0 1 2 0v4-7a1 1 0 0 1 2 0v6-8a1 1 0 0 1 2 0v8-6a1 1 0 0 1 2 0v7l2-2c1-1 3 0 2 2l-2 5a5 5 0 0 1-9 1l-3-5a1 1 0 0 1 2-1Zm13-8 2 2m-2 2h3"/>',
  cheer: '<path d="m3 21 4-12 8 8Zm8-10 3-3m2 6 4-1m-3-5 2-4m-9 1 1-2m9 15 2 1"/>',
  shrug: '<circle cx="12" cy="9" r="4"/><path d="M9 17h6m-7 3-3-3-3 1m14 2 3-3 3 1m-12-9h.1m3.8 0h.1"/>',
  tide: '<path d="M2 9c3 0 3-4 6-4s3 4 6 4 3-4 8-4M2 15c3 0 3-4 6-4s3 4 6 4 3-4 8-4M2 21c3 0 3-4 6-4s3 4 6 4 3-4 8-4"/>',
  cannon: '<path d="M3 10 20 4l2 5-16 7Zm4 6v2h9l-2-5"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/>',
  powder: '<circle cx="10" cy="14" r="7"/><path d="m13 7 3-4 2 2m0-4v2m2 2 2 1m-3 1 1 2"/>',
  kraken: '<path d="M4 21c1-10 6-3 8-9 1-3-1-5-1-7 0-3 4-4 7-1 3 3 2 8-1 11-4 4-7 4-7 6m5-14h.1m1 4h.1m-3 4h.1"/>',
  route: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 19h9a4 4 0 0 0 0-8H8a3 3 0 0 1 0-6h9"/>',
  save: '<path d="M4 3h13l3 3v15H4Zm4 0v6h8V3M8 21v-7h8v7"/>',
  person: '<circle cx="12" cy="6" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2Z"/>',
  sound: '<path d="M3 9h4l5-4v14l-5-4H3Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  music: '<path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  rotate: '<rect x="7" y="4" width="10" height="16" rx="2" transform="rotate(25 12 12)"/><path d="M3 10a9 9 0 0 1 13-7M2 5l1 5 4-2m14 6a9 9 0 0 1-13 7m14-2-1-5-4 2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
};

export function gameIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('game-icon');
  svg.innerHTML = shapes[name];
  return svg;
}

export function renderGameIcons() {
  for (const mark of document.querySelectorAll('[data-icon]')) mark.replaceChildren(gameIcon(mark.dataset.icon));
}

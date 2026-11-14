import { goldLabel } from './harbor.js';
import './arena-gold.css';

export function playArenaGold(previous, next, player, reducedMotion) {
  if (next.phase === 'countdown') document.querySelector('.arena-gold-effect[data-entry]')?.remove();
  const receipt = next.stake?.round;
  if (!receipt || !previous || !['results', 'lobby'].includes(next.phase)) return;
  const prior = previous?.code === next.code && previous.round === next.round ? previous.stake?.round : null;
  if (prior?.status === receipt.status || (!prior && next.phase === 'results')) return;
  const joined = next.roster.some(entry => entry.id === player && !entry.bot);
  if (!joined) return;
  const entry = receipt.wagers?.[player] ?? next.stake.entry;
  const credit = receipt.status === 'cancelled' ? entry : receipt.status === 'settled' && receipt.winnerId === player ? receipt.paid : 0;
  if (credit) showArenaGold({ credit }, reducedMotion);
}

export function showArenaGold({ credit, debit }, reducedMotion) {
  const wallet = document.getElementById('header-gold');
  if (!wallet || wallet.hidden || !wallet.animate || document.hidden) return;

  const bounds = wallet.getBoundingClientRect();
  const top = [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
  const center = [window.innerWidth / 2, window.innerHeight * .44];
  const from = debit ? top : center;
  const to = debit ? center : top;
  const effect = document.createElement('div');
  effect.className = 'arena-gold-effect';
  if (debit) effect.dataset.entry = '';
  effect.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'arena-gold-label';
  label.textContent = credit ? `+${goldLabel(credit)} GOLD` : `−${goldLabel(debit)} GOLD`;
  label.style.transform = `translate(${center[0]}px, ${center[1] + 30}px) translateX(-50%)`;
  effect.append(label);
  document.body.append(effect);
  if (!reducedMotion) {
    for (let index = 0; index < 7; index++) {
      const coin = document.createElement('i');
      coin.className = 'arena-gold-coin';
      coin.textContent = '✦';
      effect.append(coin);
      const start = from;
      const finish = to;
      const point = ([x, y], scale = 1) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
      coin.animate([
        { transform: point(start, .6), opacity: 0 },
        { transform: point([(start[0] + finish[0]) / 2 + (index - 3) * 22, (start[1] + finish[1]) / 2 - 30]), opacity: 1 },
        { transform: point(finish, .35), opacity: 0 },
      ], { duration: 550 + index * 22, delay: index * 38, easing: 'ease-in-out', fill: 'both' });
    }
  }
  label.animate([{ opacity: 0 }, { opacity: 1, offset: .18 }, { opacity: 1, offset: .73 }, { opacity: 0 }],
    { duration: 980 }).finished.then(() => effect.remove(), () => effect.remove());
}

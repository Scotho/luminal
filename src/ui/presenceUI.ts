// ── Presence UI ──────────────────────────────────────────────────────────────
// Wires presence callbacks to DOM elements (online count badge, connection dot).

import { initPresence, onOnlineCount, onConnectionChange } from '../presence';
import { swallow } from '../swallow';

export function initPresenceUI(): void {
  initPresence().catch(swallow('presenceUI'));

  onOnlineCount((count: number) => {
    const lobbyCount = document.getElementById('online-count-lobby');
    if (lobbyCount) lobbyCount.textContent = String(count);
    const badgeCount = document.getElementById('online-badge-count');
    const badge = document.getElementById('online-badge');
    if (badgeCount) badgeCount.textContent = String(count);
    if (badge) badge.classList.toggle('hidden', count <= 0);
  });

  onConnectionChange((connected: boolean) => {
    const dot: HTMLElement | null = document.getElementById('connection-dot');
    if (dot) dot.classList.toggle('connection-dot--connected', connected);
    const lobbyDot: HTMLElement | null = document.getElementById('connection-dot-lobby');
    if (lobbyDot) {
      lobbyDot.style.background = connected ? 'rgba(var(--c-green), 0.8)' : 'rgba(var(--c-red), 0.4)';
      lobbyDot.style.boxShadow = connected ? '0 0 6px rgba(var(--c-green), 0.4)' : 'none';
    }
  });
}

// ── Admin Panel Toggle ───────────────────────────────────────────────────────
// Ctrl+Shift+S (or ` on localhost) toggles the admin panel.

import { initAdminPanel, destroyAdminPanel, setAdminDeps, hasAdminAccess } from '../adminPanel';
import type { GameLike } from '../adminPanel';
import type { WebGLRenderer } from 'three';
import { navigateTo } from './navigation';

interface AdminToggleDeps {
  game: unknown; // structurally compatible with GameLike
  renderer: WebGLRenderer;
}

export function initAdminToggle(deps: AdminToggleDeps): void {
  const { game, renderer } = deps;
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  let adminOpen = false;

  setAdminDeps({ navigateToDebug: () => navigateTo('debug'), renderer });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const isAdminKey = (e.ctrlKey && e.shiftKey && e.key === 'S')
      || (e.key === '`' && !e.ctrlKey && !e.altKey && isLocal);
    if (!isAdminKey) return;
    e.preventDefault();
    if (!hasAdminAccess()) return;
    adminOpen = !adminOpen;
    // Game satisfies GameLike structurally; Player._beam is private so TS requires a
    // widening cast through unknown at this admin/game boundary.
    if (adminOpen) initAdminPanel(game as unknown as GameLike);
    else destroyAdminPanel();
  });
}

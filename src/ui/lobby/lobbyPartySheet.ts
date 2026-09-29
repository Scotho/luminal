// ── Mobile party chip & bottom sheet ───────────────────
// Renders the mobile-only party chip dots and the expandable bottom sheet.
// Extracted from lobbyPartyHud.ts (TASK-247).

import type { LobbyContext } from './lobbyContext';
import type { LobbyData } from '../../types/index';
import { COLOR_MAP } from './lobbyContext';
import { escapeHtml } from '../dom';

/** Update the mobile party chip dots + count */
export function updatePartyChip(data: LobbyData, ctx: LobbyContext): void {
  const dotsEl = document.getElementById('lobby-party-chip-dots');
  const countEl = document.getElementById('lobby-party-chip-count');
  if (!dotsEl || !countEl) return;

  const lobbySize = data.settings?.lobbySize ?? 2;

  // Collect all player colors
  const colors: { color: string; isAi: boolean }[] = [];

  // Host
  if (data.host?.color) {
    colors.push({ color: data.host.color, isAi: false });
  }

  // Guests
  if (data.guests) {
    for (const g of Object.values(data.guests)) {
      if (g.color) colors.push({ color: g.color, isAi: false });
    }
  }

  // AIs
  if (data.ais) {
    for (const ai of Object.values(data.ais)) {
      if (ai.color) colors.push({ color: ai.color, isAi: true });
    }
  }

  // Render dots
  dotsEl.innerHTML = colors.map(({ color, isAi }) => {
    const bg = COLOR_MAP[color] ?? 'rgba(255,255,255,0.3)';
    const aiClass = isAi ? ' lobby-party-chip-dot--ai' : '';
    return `<div class="lobby-party-chip-dot${aiClass}" style="background:${escapeHtml(bg)}"></div>`;
  }).join('');

  // Update count
  countEl.textContent = `${colors.length}/${lobbySize}`;

  // Suppress unused warning
  void ctx;
}

/** Render the mobile party bottom sheet contents */
export function renderPartySheet(data: LobbyData, ctx: LobbyContext): void {
  const inviteEl = document.getElementById('lobby-party-sheet-invite');
  const playersEl = document.getElementById('lobby-party-sheet-players');
  if (!inviteEl || !playersEl) return;

  // Invite row
  const currentLobbyId = ctx.getCurrentLobbyId();
  if (currentLobbyId) {
    const code = currentLobbyId.slice(0, 6).toUpperCase();
    inviteEl.innerHTML = `
      <svg class="icon lobby-party-sheet-invite-icon"><use href="/icons.svg#i-link"/></svg>
      <span class="lobby-party-sheet-invite-code">${escapeHtml(code)}</span>
      <span class="lobby-party-sheet-invite-copy" id="lobby-party-sheet-copy">COPY</span>
    `;
  }

  // Player list
  const rows: string[] = [];

  // Host
  if (data.host) {
    const bg = COLOR_MAP[data.host.color] ?? 'rgba(255,255,255,0.3)';
    const ready = data.host.ready ? 'lobby-party-sheet-player-status--ready' : '';
    const readyText = data.host.ready ? '✓ READY' : '';
    rows.push(`<div class="lobby-party-sheet-player">
      <div class="lobby-party-sheet-player-dot" style="background:${escapeHtml(bg)}"></div>
      <span class="lobby-party-sheet-player-name">${escapeHtml(data.host.username || 'Host')}</span>
      <span class="lobby-party-sheet-player-host">HOST</span>
      <span class="lobby-party-sheet-player-status ${ready}">${readyText}</span>
    </div>`);
  }

  // Guests
  if (data.guests) {
    for (const g of Object.values(data.guests)) {
      const bg = COLOR_MAP[g.color] ?? 'rgba(255,255,255,0.3)';
      const ready = g.ready ? 'lobby-party-sheet-player-status--ready' : '';
      const readyText = g.ready ? '✓ READY' : '';
      rows.push(`<div class="lobby-party-sheet-player">
        <div class="lobby-party-sheet-player-dot" style="background:${escapeHtml(bg)}"></div>
        <span class="lobby-party-sheet-player-name">${escapeHtml(g.username || 'Guest')}</span>
        <span class="lobby-party-sheet-player-status ${ready}">${readyText}</span>
      </div>`);
    }
  }

  // AIs
  if (data.ais) {
    for (const ai of Object.values(data.ais)) {
      const bg = COLOR_MAP[ai.color] ?? 'rgba(255,255,255,0.3)';
      rows.push(`<div class="lobby-party-sheet-player">
        <div class="lobby-party-sheet-player-dot" style="background:${escapeHtml(bg)}"></div>
        <span class="lobby-party-sheet-player-name lobby-party-sheet-player-name--ai">${escapeHtml(ai.name || 'AI')}</span>
        <span class="lobby-party-sheet-player-status">AI</span>
      </div>`);
    }
  }

  playersEl.innerHTML = rows.join('');
}

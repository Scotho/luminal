// ── Lobby Invites & Persistence ──────────────────────────
// Invite checking, pending lobby resume, rejoin-after-match,
// and localStorage persistence.

import type { LobbyContext } from './lobbyContext';
import type { LobbyData } from '../../types/index';
import { rejoinLobby, listenToLobby, stopListening as stopLobbyListening, updateLobbyPlayer, updateLobbySettings, promoteSpectator } from '../../lobby';
import { clearUserLobby, getUserLobby } from '../../auth';
import { ref, set as rtdbSet, get as rtdbGet } from 'firebase/database';
import { rtdb as rtdbInstance } from '../../firebase';
import { getGuestList, getGuestByUid } from '../../types/index';
import { resolveColor } from '../../colorFallback';
import { pushNotif } from '../notifUI';
import { getSelectedMap } from '../mapSelectUI';
import { MAX_LOBBY_SIZE, _swallow } from './lobbyContext';
import { initLobbyChatIntegration } from './lobbyChat';

// ── Lobby persistence helpers (localStorage) ─────────────
const LS_LOBBY_KEY = 'luminal-active-lobby';

export function saveLobbyLocally(lobbyId: string, role: 'host' | 'guest'): void {
  localStorage.setItem(LS_LOBBY_KEY, JSON.stringify({ lobbyId, role }));
}

export function clearLobbyLocally(): void {
  localStorage.removeItem(LS_LOBBY_KEY);
}

export function getLocalLobby(): { lobbyId: string; role: 'host' | 'guest' } | null {
  try {
    const raw = localStorage.getItem(LS_LOBBY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Invite state ─────────────────────────────────────────
// Module-scoped: tracks the invite being processed to block saved lobby restore.
let _pendingInviteLobbyId: string | null = null;

/** Returns true if a lobby invite URL is being processed (blocks saved lobby restore). */
export function hasPendingInvite(): boolean {
  return _pendingInviteLobbyId !== null || !!new URLSearchParams(window.location.search).get('lobby');
}

// ── Invite checking ──────────────────────────────────────

/** Called on page load — stashes the invite lobby ID immediately so _checkSavedLobby doesn't race it. */
export async function checkLobbyInvite(
  ctx: LobbyContext,
  joinLobbyById: (lobbyId: string) => void,
): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const lobbyId = params.get('lobby');
  if (!lobbyId) return;

  // Stash immediately and clean URL
  _pendingInviteLobbyId = lobbyId;
  window.history.replaceState(null, '', window.location.origin + '/');

  // Wait for auth
  await new Promise<void>(resolve => {
    if (ctx.getCurrentUid()) { resolve(); return; }
    const check = setInterval(() => {
      if (ctx.getCurrentUid()) { clearInterval(check); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 10000);
  });

  _pendingInviteLobbyId = null;
  if (!ctx.getCurrentUid()) return;

  // Leave any existing lobby first
  if (ctx.getCurrentLobbyId()) {
    ctx.leaveLobby();
  }

  joinLobbyById(lobbyId);
}

// ── Pending lobby check (after login redirect) ───────────

export function checkPendingLobby(
  ctx: LobbyContext,
  joinLobbyById: (lobbyId: string) => void,
): void {
  const pendingLobby = localStorage.getItem('luminal-pending-lobby');
  if (pendingLobby && ctx.getCurrentUid()) {
    localStorage.removeItem('luminal-pending-lobby');
    joinLobbyById(pendingLobby);
  }
}

// ── Rejoin lobby after page refresh ──────────────────────

/** SVG icon for ready button: ✓ when ready, ✕ when not */
const _readyIcon = (ready: boolean): string =>
  `<svg class="icon" style="width:14px;height:14px;margin-right:4px;stroke-width:3"><use href="/icons.svg#i-${ready ? 'check' : 'x'}"/></svg>`;

export async function checkSavedLobby(
  ctx: LobbyContext,
  onLobbyUpdate: (data: LobbyData | null) => void,
): Promise<void> {
  const uid = ctx.getCurrentUid();
  if (!uid) return;
  if (ctx.getCurrentLobbyId()) return; // already in a lobby
  if (hasPendingInvite()) return; // invite URL takes priority

  // Check localStorage first (instant), fall back to Firestore
  const saved = getLocalLobby() ?? await getUserLobby(uid).catch(() => null);
  if (!saved) return;

  const data = await rejoinLobby(saved.lobbyId, uid, saved.role);
  if (!data) {
    // Lobby gone or we were kicked — clean up both stores
    clearLobbyLocally(); clearUserLobby(uid).catch(() => {});
    return;
  }

  // Restore lobby state
  ctx.setCurrentLobbyId(saved.lobbyId);
  ctx.setMyRole(saved.role);
  ctx.setLobbyMatchStarting(false);
  ctx.setAiSlots(new Map());
  ctx.setSelectedAiSlot(null);
  ctx.setHostAiHydrated(false);
  ctx.setOpponentColor(
    (saved.role === 'host') ? (getGuestList(data)[0]?.color || null) : data.host.color,
  );

  // Restore ready state from Firebase
  const me = saved.role === 'host' ? data.host : (uid ? getGuestByUid(data, uid) : null);
  ctx.setReady(!!(me?.ready));

  const readyBtn = document.getElementById('btn-lobby-ready');
  if (readyBtn) {
    readyBtn.innerHTML = _readyIcon(ctx.isReady()) + 'READY';
    readyBtn.classList.toggle('btn-lobby-ready--active', ctx.isReady());
  }

  // Resync mapVote so disconnected-player vote exclusion doesn't erase our preference
  const savedMap = getSelectedMap();
  updateLobbyPlayer(saved.lobbyId, saved.role, { mapVote: savedMap }, uid).catch(e => console.warn('map vote resync failed:', e));

  // Listen for lobby changes + start heartbeat
  listenToLobby(saved.lobbyId, onLobbyUpdate);
  ctx.startHeartbeat();
  initLobbyChatIntegration(saved.lobbyId);

  // If lobby is active (match in progress), show notification
  // The lobby listener (onLobbyUpdate) will handle spectating guests automatically.
  // For non-spectating players who refreshed mid-match, show an info notification.
  if (data.status === 'active' && !me?.spectating) {
    pushNotif({
      id: `info-${Date.now()}`,
      type: 'info',
      message: 'Your party is in a match. Waiting for it to end...',
      createdAt: Date.now(),
    });
  }

  // Don't auto-navigate to lobby — the user stays on whatever screen they're on.
  // They can return to the lobby via the party HUD, social tab, or lobby button.
  // The lobby listener / heartbeat are already running so the party HUD shows.
}

// ── Rejoin after match ────────────────────────────────────

/** Host promotes spectating guests: clear spectating flag, replace AIs or expand lobby. */
async function _promoteSpectatingGuests(lobbyId: string, data: LobbyData): Promise<void> {
  const spectators = Object.entries(data.guests || {}).filter(([, g]) => g.spectating);
  if (spectators.length === 0) return;

  // Count current AIs from Firebase
  const aiSnap = await rtdbGet(ref(rtdbInstance, `lobbies/${lobbyId}/ais`)).catch(() => null);
  const ais: Record<string, unknown> = aiSnap?.val() || {};
  const aiKeys = Object.keys(ais);
  let aiIdx = 0;
  let sizeExpansions = 0;
  const currentSize = data.settings.lobbySize || 2;

  // Collect currently taken colors (host + non-spectator guests + AIs)
  const promoteTaken = new Set<string>();
  promoteTaken.add(data.host.color);
  for (const g of getGuestList(data)) {
    if (!g.spectating) promoteTaken.add(g.color);
  }
  for (const ai of Object.values(ais as Record<string, { color?: string }>)) {
    if (ai.color) promoteTaken.add(ai.color);
  }

  for (const [uid, guest] of spectators) {
    // Promote: clear spectating flag
    await promoteSpectator(lobbyId, uid).catch(() => {});

    // Resolve color conflict for the promoted spectator
    const resolved = resolveColor(guest.color, promoteTaken);
    if (resolved !== guest.color) {
      await updateLobbyPlayer(lobbyId, 'guest', { color: resolved }, uid).catch(() => {});
    }
    promoteTaken.add(resolved); // block this color for subsequent spectators

    // Try to remove an AI to make room
    if (aiIdx < aiKeys.length) {
      await rtdbSet(ref(rtdbInstance, `lobbies/${lobbyId}/ais/${aiKeys[aiIdx]}`), null).catch(() => {});
      aiIdx++;
    } else if (currentSize + sizeExpansions < MAX_LOBBY_SIZE) {
      // No AI to replace — expand lobby size if room
      sizeExpansions++;
      await updateLobbySettings(lobbyId, { lobbySize: currentSize + sizeExpansions }).catch(() => {});
    }
  }
}

/** Rejoin the lobby after a match ends (called when host returns party to lobby).
 *  Returns true if rejoin succeeded, false if lobby is gone. */
export async function rejoinLobbyAfterMatch(
  lobbyId: string,
  role: 'host' | 'guest',
  ctx: LobbyContext,
  onLobbyUpdate: (data: LobbyData | null) => void,
): Promise<boolean> {
  const uid = ctx.getCurrentUid();
  if (!uid) return false;

  // Reset lobby status back to waiting (host only)
  if (role === 'host') {
    await rtdbSet(ref(rtdbInstance, `lobbies/${lobbyId}/status`), 'waiting').catch(_swallow('status write'));
  }

  const data = await rejoinLobby(lobbyId, uid, role);
  if (!data) return false;

  // Host: promote spectating guests — replace AIs or expand lobby size
  if (role === 'host' && data.guests) {
    await _promoteSpectatingGuests(lobbyId, data);
  }

  // Resolve color conflict on rejoin (another player may have taken our color during the match)
  const myColor = role === 'host' ? data.host.color : getGuestByUid(data, uid)?.color;
  if (myColor) {
    const takenOnRejoin = new Set<string>();
    if (role !== 'host') takenOnRejoin.add(data.host.color);
    for (const g of getGuestList(data)) {
      if (g.uid !== uid) takenOnRejoin.add(g.color);
    }
    if (data.ais) for (const ai of Object.values(data.ais as Record<string, { color: string }>)) takenOnRejoin.add(ai.color);
    const resolved = resolveColor(myColor, takenOnRejoin);
    if (resolved !== myColor) {
      await updateLobbyPlayer(lobbyId, role, { color: resolved }, uid).catch(() => {});
    }
  }

  // Clear ready state in Firebase so autostart doesn't immediately re-trigger
  await updateLobbyPlayer(lobbyId, role, { ready: false }, uid).catch(() => {});

  ctx.setCurrentLobbyId(lobbyId);
  ctx.setMyRole(role);
  ctx.setLobbyMatchStarting(false);
  ctx.setReady(false);
  ctx.clearAutostart(); // kill any leftover autostart countdown
  ctx.setAiSlots(new Map());
  ctx.setSelectedAiSlot(null);
  ctx.setHostAiHydrated(false);
  ctx.setOpponentColor((role === 'host') ? (getGuestList(data)[0]?.color || null) : data.host.color);

  const readyBtn = document.getElementById('btn-lobby-ready');
  if (readyBtn) { readyBtn.innerHTML = _readyIcon(false) + 'READY'; readyBtn.classList.remove('btn-lobby-ready--active'); }

  // Stop any existing listener before attaching a new one to prevent stacking (#6)
  stopLobbyListening();
  listenToLobby(lobbyId, onLobbyUpdate);
  ctx.startHeartbeat();
  initLobbyChatIntegration(lobbyId);
  ctx.navigateTo('lobby');
  return true;
}

// ── Lobby update pipeline ────────────────────────────────
// Phase helpers for the RTDB lobby snapshot handler. Split out of lobbyUI.ts
// to keep that file under budget. Order matters — helpers run in the same
// order as the original monolithic _onLobbyUpdate to avoid HUD flicker.

import { stopListening as stopLobbyListening, promoteToHost, switchPresence, updateLobbySettings, checkLobby } from '../../lobby';
import { pushNotif } from '../notifUI';
import { setUserLobby, clearUserLobby } from '../../auth';
import { destroyLobbyChatIntegration } from './lobbyChat';
import { playLobbyJoin, playLobbyLeave } from '../../sfx';
import type { LobbyData, VehicleType } from '../../types/index';
import { getGuestList, getGuestByUid, getGuestCount, getHumanCount, hasGuest } from '../../types/index';
import { pickAiName, pickAiColor } from './lobbyAI';
import {
  BESTOF_OPTIONS,
  LOBBY_SIZE_OPTIONS,
  MAX_LOBBY_SIZE,
  INVITE_PERM_OPTIONS,
  ALLOW_ANON_OPTIONS,
  type LobbyContext,
} from './lobbyContext';

/** Module-scoped hooks the lobby update pipeline needs beyond LobbyContext.
 *  Mirrors the module-level let-variables and helper functions inside lobbyUI.ts
 *  so the extracted helpers can read and mutate them without a circular import. */
export interface LobbyUpdateHooks {
  // ── Promotion flag ──
  getPromotionInProgress(): boolean;
  setPromotionInProgress(v: boolean): void;

  // ── Match spectator flags (proxied from lobbyMatch) ──
  isSpectatingMatch(): boolean;
  setSpectatingMatch(v: boolean): void;
  isJoinGameNotifPushed(): boolean;
  setJoinGameNotifPushed(v: boolean): void;

  // ── Ready icon builder (SVG fragment for the READY button) ──
  readyIcon(ready: boolean): string;

  // ── Lifecycle helpers from lobbyMatch / lobbyInvites ──
  hideMatchInProgress(): void;
  showMatchInProgress(data: LobbyData): void;
  startLobbyMatch(data: LobbyData): Promise<void>;
  handleReturnToLobby(): void;
  clearLobbyLocally(): void;
  stopHeartbeat(): void;
  checkAutostart(data: LobbyData): void;
  clearAutostart(): void;
}

/** Entry point — the RTDB listener calls this with each snapshot. */
export function handleLobbyUpdate(
  data: LobbyData | null,
  ctx: LobbyContext,
  hooks: LobbyUpdateHooks,
): void {
  // Phase 0 — null snapshot: lobby destroyed teardown.
  if (!data) {
    handleLobbyDestroyed(ctx, hooks);
    return;
  }

  // Phase 0b — kicked player detection (guest removed from lobby).
  if (handleKicked(data, ctx, hooks)) return;

  // Phase 1 — host promotion (async, returns on trigger) + voluntary role swap.
  if (syncRoleTransitions(data, ctx, hooks)) return;

  const isHost = ctx.getMyRole() === 'host';

  // Phase 2 — AI slot hydration + host-side displacement on human join.
  syncAiSlots(data, isHost, ctx);

  // Phase 3 — join/leave sfx + mirror server color/vehicle back to localStorage.
  syncLocalPlayerMirror(data, isHost, ctx);

  // Phase 4 — vehicle / map / color pickers.
  ctx.renderVehicleGrid(data);
  ctx.renderMapGrid(data);
  ctx.renderColorPickerForSelection(data);

  // Phase 5 — bestof label.
  syncBestofLabel(data, ctx);

  // Phase 6 — ready + start action buttons.
  syncReadyButton(data, isHost, ctx, hooks);
  syncStartButton(data, isHost, ctx);

  // Phase 7 — autostart countdown (host only).
  if (isHost) hooks.checkAutostart(data);

  // Phase 8 — remaining settings labels + host arrow affordances.
  syncSettingsLabels(data, ctx);
  syncHostArrows(isHost);

  // Phase 9 — party HUD (top bar, chip, sheet, lobby column).
  syncPartyHud(data, ctx);

  // Phase 10 — match lifecycle transitions (starting/active/returning/waiting).
  syncMatchStatus(data, ctx, hooks);
}

// ── Phase 0 — lobby destroyed upstream ─────────────────────
function handleLobbyDestroyed(ctx: LobbyContext, hooks: LobbyUpdateHooks): void {
  stopLobbyListening();
  hooks.clearLobbyLocally();
  const uid = ctx.getCurrentUid();
  if (uid) clearUserLobby(uid).catch(() => {});
  ctx.setCurrentLobbyId(null);
  ctx.setMyRole(null);
  ctx.setLobbyMatchStarting(false);
  ctx.getAiSlots().clear();
  ctx.setSelectedAiSlot(null);
  ctx.setHostAiHydrated(false);
  ctx.setLastLobbyData(null);
  if (hooks.isSpectatingMatch()) hooks.hideMatchInProgress();
  destroyLobbyChatIntegration();
  ctx.navigateReset('main');
}

// ── Phase 0b — kicked guest ────────────────────────────────
function handleKicked(data: LobbyData, ctx: LobbyContext, hooks: LobbyUpdateHooks): boolean {
  const uid = ctx.getCurrentUid();
  if (!(ctx.getMyRole() === 'guest' && uid && !hasGuest(data, uid))) return false;

  hooks.stopHeartbeat();
  stopLobbyListening();
  hooks.clearLobbyLocally();
  if (uid) clearUserLobby(uid).catch(() => {});
  const wasOnLobby = document.getElementById('lobby-overlay')?.classList.contains('hidden') === false;
  const wasOnMip = hooks.isSpectatingMatch();
  ctx.setCurrentLobbyId(null);
  ctx.setMyRole(null);
  ctx.getAiSlots().clear();
  ctx.setSelectedAiSlot(null);
  ctx.setHostAiHydrated(false);
  ctx.setLastLobbyData(null);
  if (hooks.isSpectatingMatch()) hooks.hideMatchInProgress();
  ctx.updatePartyHud(null);
  destroyLobbyChatIntegration();
  pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'You were kicked from the party', createdAt: Date.now() });
  // Navigate to home if currently on the lobby or match-in-progress screen
  if (wasOnLobby || wasOnMip) ctx.navigateReset('main');
  return true;
}

// ── Phase 1 — role transitions (promotion / swap) ──────────
function syncRoleTransitions(data: LobbyData, ctx: LobbyContext, hooks: LobbyUpdateHooks): boolean {
  const uid = ctx.getCurrentUid();
  const lobbyId = ctx.getCurrentLobbyId();

  // Host disconnect reassignment — guest promotes to host
  if (ctx.getMyRole() === 'guest' && data.host && data.host.presence === false && !hooks.getPromotionInProgress()) {
    hooks.setPromotionInProgress(true);
    const colorKey = ctx.getPlayerColorKey();
    const icon = ctx.getPlayerIcon() || undefined;
    // Safety timeout: if promotion hangs, reset the flag after 10s
    const promotionTimeout = setTimeout(() => { hooks.setPromotionInProgress(false); }, 10_000);
    promoteToHost(lobbyId!, uid!, ctx.getCurrentUsername() || 'ANON', colorKey, icon).then((promoted: boolean) => {
      clearTimeout(promotionTimeout);
      hooks.setPromotionInProgress(false);
      if (promoted) {
        ctx.setMyRole('host');
        if (uid && lobbyId) setUserLobby(uid, lobbyId, 'host').catch(e => console.warn('lobby: setUserLobby failed', e));
        pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'You are now the host', createdAt: Date.now() });
      }
    }).catch(e => { console.warn('lobby: promoteToHost failed', e); clearTimeout(promotionTimeout); hooks.setPromotionInProgress(false); });
    return true; // Let the next update handle UI refresh
  }

  // Detect voluntary host transfer (role swap)
  if (ctx.getMyRole() === 'host' && data.host.uid !== uid && uid && hasGuest(data, uid)) {
    ctx.setMyRole('guest');
    if (uid && lobbyId) {
      switchPresence(lobbyId, 'guest', uid).catch(e => console.warn('lobby: switchPresence failed', e));
      setUserLobby(uid, lobbyId, 'guest').catch(e => console.warn('lobby: setUserLobby failed', e));
    }
    pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'You are now a guest', createdAt: Date.now() });
  } else if (ctx.getMyRole() === 'guest' && data.host.uid === uid && !hooks.getPromotionInProgress()) {
    ctx.setMyRole('host');
    if (uid && lobbyId) {
      switchPresence(lobbyId, 'host').catch(e => console.warn('lobby: switchPresence failed', e));
      setUserLobby(uid, lobbyId, 'host').catch(e => console.warn('lobby: setUserLobby failed', e));
    }
    pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'You are now the host', createdAt: Date.now() });
  }

  return false;
}

// ── Phase 2 — AI slot hydration + displacement ─────────────
function syncAiSlots(data: LobbyData, isHost: boolean, ctx: LobbyContext): void {
  const aiSlots = ctx.getAiSlots();

  // Hydrate AI slots from Firebase (persisted by host, visible to all clients).
  // Host is the source of truth for AI data after initial hydration — skip server
  // overwrites to avoid stale data re-adding AIs the host just removed.
  if (isHost && ctx.isHostAiHydrated()) {
    // Host already has local AI state — don't let stale server data overwrite it
  } else {
    if (data.ais) {
      const prevSelected = ctx.getSelectedAiSlot();
      aiSlots.clear();
      for (const [slot, ai] of Object.entries(data.ais)) {
        aiSlots.set(Number(slot), { name: ai.name, color: ai.color, vehicle: (ai.vehicle || 'bike') as VehicleType });
      }
      ctx.setSelectedAiSlot(prevSelected !== null && aiSlots.has(prevSelected) ? prevSelected : null);
    } else if (!isHost) {
      aiSlots.clear();
      ctx.setSelectedAiSlot(null);
    }
    if (isHost) ctx.setHostAiHydrated(true);
  }

  // When a real guest joins, displace any AI in overlapping slots and auto-expand
  // so the lobby isn't immediately full (e.g. size 2 → 3 keeps room for an AI).
  if (!isHost) return;

  const humanCount = getHumanCount(data);
  let displaced = false;
  // Remove AI slots that overlap with human guest slots (1..humanCount-1)
  for (let s = 1; s < humanCount; s++) {
    if (aiSlots.has(s)) {
      aiSlots.delete(s);
      if (ctx.getSelectedAiSlot() === s) ctx.setSelectedAiSlot(null);
      displaced = true;
    }
  }
  if (!displaced) return;

  const currentSize = data.settings.lobbySize || 2;
  // Only expand if humans now fill all slots (lobby would be "full")
  if (humanCount >= currentSize && currentSize < MAX_LOBBY_SIZE) {
    const newSize = currentSize + 1;
    const sizeOpt = LOBBY_SIZE_OPTIONS.find(o => o.size === newSize);
    if (sizeOpt) ctx.setLobbySizeIndex(LOBBY_SIZE_OPTIONS.indexOf(sizeOpt));
    ctx.syncSizeToQuickStart();
    const lobbyId = ctx.getCurrentLobbyId();
    if (lobbyId) updateLobbySettings(lobbyId, { lobbySize: newSize }).catch(() => {});
    // Add an AI to the newly opened slot
    const usedNames = new Set<string>();
    const usedColors = new Set<string>();
    usedNames.add(data.host.username); usedColors.add(data.host.color);
    for (const g of getGuestList(data)) { usedNames.add(g.username); usedColors.add(g.color); }
    for (const [, ai] of aiSlots) { usedNames.add(ai.name); usedColors.add(ai.color); }
    aiSlots.set(newSize - 1, { name: pickAiName(usedNames), color: pickAiColor(usedColors), vehicle: 'bike' as VehicleType });
  }
  ctx.syncAisToServer();
}

// ── Phase 3 — sfx + localStorage mirror ────────────────────
function syncLocalPlayerMirror(data: LobbyData, isHost: boolean, ctx: LobbyContext): void {
  // Sound: guest joined/left
  const last = ctx.getLastLobbyData();
  const prevGuestCount = last ? getGuestCount(last) : 0;
  const currGuestCount = getGuestCount(data);
  if (currGuestCount > prevGuestCount) {
    playLobbyJoin();
  } else if (currGuestCount < prevGuestCount) {
    playLobbyLeave();
  }

  ctx.setLastLobbyData(data);

  // Sync local player's color + vehicle from server back to localStorage
  // so game.ts and character select always read up-to-date values
  const uid = ctx.getCurrentUid();
  const me = isHost ? data.host : (uid ? getGuestByUid(data, uid) : null);
  if (me) {
    if (me.color) localStorage.setItem('luminal-color', me.color);
    if (me.vehicle) localStorage.setItem('luminal-vehicle', me.vehicle);
  }
}

// ── Phase 5 — bestof label ─────────────────────────────────
function syncBestofLabel(data: LobbyData, ctx: LobbyContext): void {
  const bestofLabel = document.getElementById('lobby-bestof-label');
  if (!bestofLabel) return;
  const opt = BESTOF_OPTIONS.find(o => o.rounds === data.settings.seriesLength);
  bestofLabel.textContent = opt?.label || `BEST OF ${data.settings.seriesLength}`;
  let idx = BESTOF_OPTIONS.findIndex(o => o.rounds === data.settings.seriesLength);
  if (idx < 0) idx = 0;
  ctx.setLobbyBestofIndex(idx);
  ctx.syncBestofToQuickStart();
}

// ── Phase 6a — READY button affordance ─────────────────────
function syncReadyButton(data: LobbyData, isHost: boolean, ctx: LobbyContext, hooks: LobbyUpdateHooks): void {
  const readyBtn = document.getElementById('btn-lobby-ready');
  if (!readyBtn) return;
  const uid = ctx.getCurrentUid();
  const me = isHost ? data.host : (uid ? getGuestByUid(data, uid) : null);
  const myVehicle = me?.vehicle;
  const hasOpponent = getGuestCount(data) > 0 || ctx.getAiSlots().size > 0;
  if (!myVehicle) {
    readyBtn.style.opacity = '0.3';
    readyBtn.style.pointerEvents = 'auto';
    readyBtn.dataset.disabled = 'true';
    readyBtn.textContent = 'SELECT A LOADOUT';
    readyBtn.setAttribute('data-tip', 'Pick a loadout first');
  } else if (!hasOpponent) {
    readyBtn.style.opacity = '0.3';
    readyBtn.style.pointerEvents = 'auto';
    readyBtn.dataset.disabled = 'true';
    readyBtn.innerHTML = hooks.readyIcon(false) + 'READY';
    readyBtn.setAttribute('data-tip', 'Need at least one opponent — invite a friend or add an AI');
  } else if (!ctx.isReady()) {
    readyBtn.style.opacity = '1';
    readyBtn.style.pointerEvents = 'auto';
    delete readyBtn.dataset.disabled;
    readyBtn.innerHTML = hooks.readyIcon(false) + 'READY';
    readyBtn.removeAttribute('data-tip');
  } else {
    readyBtn.style.opacity = '1';
    readyBtn.style.pointerEvents = 'auto';
    delete readyBtn.dataset.disabled;
    readyBtn.removeAttribute('data-tip');
    // Keep the current NOT READY text
  }
}

// ── Phase 6b — START button affordance ─────────────────────
function syncStartButton(data: LobbyData, isHost: boolean, ctx: LobbyContext): void {
  const startBtn = document.getElementById('btn-lobby-start');
  if (!startBtn) return;
  const hostHasVehicle = !!data.host.vehicle;
  const allGuestsHaveVehicle = getGuestList(data).every(g => !!g.vehicle);
  const allHumansReady = hostHasVehicle && allGuestsHaveVehicle;
  const hasOpponent = getGuestCount(data) > 0 || ctx.getAiSlots().size > 0;
  if (isHost && allHumansReady && hasOpponent) {
    startBtn.style.opacity = '1';
    startBtn.style.pointerEvents = 'auto';
    delete startBtn.dataset.disabled;
    startBtn.textContent = 'START';
    startBtn.removeAttribute('data-tip');
  } else if (isHost) {
    startBtn.style.opacity = '0.3';
    startBtn.style.pointerEvents = 'none';
    startBtn.textContent = 'START';
    startBtn.style.pointerEvents = 'auto';
    startBtn.dataset.disabled = 'true';
    if (!hasOpponent) startBtn.setAttribute('data-tip', 'Need at least one opponent');
    else if (!hostHasVehicle) startBtn.setAttribute('data-tip', 'Select a vehicle first');
    else startBtn.setAttribute('data-tip', 'Waiting for all players to select a vehicle');
  } else {
    startBtn.style.opacity = '0.3';
    startBtn.style.pointerEvents = 'none';
    startBtn.textContent = 'WAITING FOR HOST...';
  }
}

// ── Phase 8a — size / invite-perm / allow-anon labels ──────
function syncSettingsLabels(data: LobbyData, ctx: LobbyContext): void {
  // Lobby size label
  const sizeLabel = document.getElementById('lobby-size-label');
  if (sizeLabel) {
    const sz = data.settings.lobbySize || 2;
    const sizeOpt = LOBBY_SIZE_OPTIONS.find(o => o.size === sz);
    sizeLabel.textContent = sizeOpt?.label || `${sz} PLAYERS`;
    let idx = LOBBY_SIZE_OPTIONS.findIndex(o => o.size === sz);
    if (idx < 0) idx = 0;
    ctx.setLobbySizeIndex(idx);
    ctx.syncSizeToQuickStart();
  }

  // Invite permission label
  const permLabel = document.getElementById('lobby-invite-perm-label');
  if (permLabel) {
    const perm = data.settings.invitePermission || 'invite';
    const permOpt = INVITE_PERM_OPTIONS.find(o => o.value === perm);
    permLabel.textContent = permOpt?.label || 'HOST ONLY';
    let idx = INVITE_PERM_OPTIONS.findIndex(o => o.value === perm);
    if (idx < 0) idx = 0;
    ctx.setInvitePermIndex(idx);
  }

  // Allow anonymous label
  const anonVal = data.settings.allowAnonymous !== false; // default true
  let anonIdx = ALLOW_ANON_OPTIONS.findIndex(o => o.value === anonVal);
  if (anonIdx < 0) anonIdx = 0;
  ctx.setAllowAnonIndex(anonIdx);
  const anonLabel = document.getElementById('lobby-anon-label');
  if (anonLabel) anonLabel.textContent = ALLOW_ANON_OPTIONS[anonIdx].label;

  // Render invite code in settings column
  const lobbyId = ctx.getCurrentLobbyId();
  const inviteCodeEl = document.getElementById('lobby-settings-invite-code');
  if (inviteCodeEl && lobbyId) {
    inviteCodeEl.textContent = lobbyId.slice(0, 6).toUpperCase();
  }
}

// ── Phase 8b — host-only arrow affordances ─────────────────
function syncHostArrows(isHost: boolean): void {
  const hostArrows = [
    document.getElementById('lobby-bestof-left'), document.getElementById('lobby-bestof-right'),
    document.getElementById('lobby-size-left'), document.getElementById('lobby-size-right'),
    document.getElementById('lobby-invite-perm-left'), document.getElementById('lobby-invite-perm-right'),
  ];
  for (const arrow of hostArrows) {
    if (!arrow) continue;
    arrow.style.pointerEvents = isHost ? 'auto' : 'none';
    arrow.style.opacity = isHost ? '1' : '0.3';
  }
}

// ── Phase 9 — party HUD ────────────────────────────────────
function syncPartyHud(data: LobbyData, ctx: LobbyContext): void {
  ctx.updatePartyHud(data);
  ctx.updatePartyChip(data);
  ctx.renderPartySheet(data);
  ctx.renderLobbyParty(data);
}

// ── Phase 10 — match lifecycle transitions ─────────────────
function syncMatchStatus(data: LobbyData, ctx: LobbyContext, hooks: LobbyUpdateHooks): void {
  const uid = ctx.getCurrentUid();
  const lobbyId = ctx.getCurrentLobbyId();

  // Check if we're a spectating guest (joined mid-match)
  const isSpectatingGuest = ctx.getMyRole() === 'guest' && uid && getGuestByUid(data, uid)?.spectating;

  // Match starting — spectating guests skip this (they watch instead of playing)
  if (data.status === 'starting' && !ctx.isLobbyMatchStarting() && !isSpectatingGuest) {
    ctx.setLobbyMatchStarting(true);
    hooks.clearAutostart();
    hooks.startLobbyMatch(data).catch(err => {
      console.warn('lobby: match start failed', err);
      ctx.setLobbyMatchStarting(false);
    });
  }

  // Active match detected — spectating guest sees match-in-progress screen
  if ((data.status === 'active' || data.status === 'starting') && isSpectatingGuest && !hooks.isSpectatingMatch()) {
    hooks.setSpectatingMatch(true);
    hooks.showMatchInProgress(data);
    if (!hooks.isJoinGameNotifPushed()) {
      hooks.setJoinGameNotifPushed(true);
      pushNotif({
        id: `join-game-${lobbyId}`,
        type: 'join-game',
        message: 'Your party is in a match!',
        createdAt: Date.now(),
        lobbyId: lobbyId!,
      });
    }
  }

  // Host returning party to lobby after a match
  if (data.status === 'returning' && (ctx.isLobbyMatchStarting() || hooks.isSpectatingMatch())) {
    if (hooks.isSpectatingMatch()) hooks.hideMatchInProgress();
    hooks.handleReturnToLobby();
  }

  // Lobby returned to waiting — spectators also come back to lobby screen
  if (data.status === 'waiting' && hooks.isSpectatingMatch()) {
    hooks.hideMatchInProgress();
    ctx.navigateTo('lobby');
  }
}

// ── Heartbeat — periodic lobby health check ────────────────
const HEARTBEAT_INTERVAL_MS = 10_000; // check every 10s
const HEARTBEAT_MAX_FAILURES = 3;     // kick after 3 failures (~30s)

export interface HeartbeatDeps {
  getCurrentLobbyId(): string | null;
  getMyRole(): 'host' | 'guest' | null;
  leaveLobby(): void;
  navigateReset(screen: string): void;
}

let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _heartbeatFailures = 0;
let _heartbeatDeps: HeartbeatDeps | null = null;

export function startHeartbeat(deps: HeartbeatDeps): void {
  stopHeartbeat();
  _heartbeatDeps = deps;
  _heartbeatFailures = 0;
  _heartbeatInterval = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  _heartbeatFailures = 0;
}

async function heartbeatTick(): Promise<void> {
  const deps = _heartbeatDeps;
  if (!deps) { stopHeartbeat(); return; }
  const lobbyId = deps.getCurrentLobbyId();
  if (!lobbyId) { stopHeartbeat(); return; }
  try {
    const data = await checkLobby(lobbyId);
    if (!data) {
      // Lobby gone
      stopHeartbeat();
      deps.leaveLobby();
      deps.navigateReset('main');
      return;
    }
    // Host disconnect is handled by _onLobbyUpdate promotion flow; reset failure counter on any snapshot.
    _heartbeatFailures = 0;
  } catch {
    _heartbeatFailures++;
    if (_heartbeatFailures >= HEARTBEAT_MAX_FAILURES) {
      stopHeartbeat();
      deps.leaveLobby();
      deps.navigateReset('main');
    }
  }
}

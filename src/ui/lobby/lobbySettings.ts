// ── Lobby Settings ───────────────────────────────────────
// Handles bestof/size/invite-permission arrows and localStorage sync.

import type { LobbyContext } from './lobbyContext';
import { BESTOF_OPTIONS, LOBBY_SIZE_OPTIONS, INVITE_PERM_OPTIONS, ALLOW_ANON_OPTIONS } from './lobbyContext';
import { notifySettingChanged } from '../../settingsSync';
import { updateLobbySettings } from '../../lobby';
import { getHumanCount } from '../../types/index';
import type { DisposableBag } from '../../disposables';

// ── Cached DOM elements ──────────────────────────────────
let _bestofLabelEl: HTMLElement | null = null;
let _sizeLabelEl: HTMLElement | null = null;
let _invitePermLabelEl: HTMLElement | null = null;
let _anonLabelEl: HTMLElement | null = null;

function _getBestofLabel(): HTMLElement | null {
  if (!_bestofLabelEl) _bestofLabelEl = document.getElementById('lobby-bestof-label');
  return _bestofLabelEl;
}
function _getSizeLabel(): HTMLElement | null {
  if (!_sizeLabelEl) _sizeLabelEl = document.getElementById('lobby-size-label');
  return _sizeLabelEl;
}
function _getInvitePermLabel(): HTMLElement | null {
  if (!_invitePermLabelEl) _invitePermLabelEl = document.getElementById('lobby-invite-perm-label');
  return _invitePermLabelEl;
}
function _getAnonLabel(): HTMLElement | null {
  if (!_anonLabelEl) _anonLabelEl = document.getElementById('lobby-anon-label');
  return _anonLabelEl;
}

// ── Persistence helpers ──────────────────────────────────

export function syncBestofToQuickStart(ctx: LobbyContext): void {
  localStorage.setItem('luminal-lobby-bestof', String(ctx.getLobbyBestofIndex()));
  notifySettingChanged();
}

export function syncSizeToQuickStart(ctx: LobbyContext): void {
  localStorage.setItem('luminal-lobby-opponents', String(ctx.getLobbySizeIndex()));
  notifySettingChanged();
}

// ── Public setters (called from external code, e.g. quickStart) ──

export function setLobbyBestofIndex(index: number, ctx: LobbyContext): void {
  ctx.setLobbyBestofIndex(Math.max(0, Math.min(BESTOF_OPTIONS.length - 1, index)));
  const label = _getBestofLabel();
  if (label) label.textContent = BESTOF_OPTIONS[ctx.getLobbyBestofIndex()].label;
}

export function setLobbySizeIndex(index: number, ctx: LobbyContext): void {
  ctx.setLobbySizeIndex(Math.max(0, Math.min(LOBBY_SIZE_OPTIONS.length - 1, index)));
  const label = _getSizeLabel();
  if (label) label.textContent = LOBBY_SIZE_OPTIONS[ctx.getLobbySizeIndex()].label;
}

export function setAllowAnonIndex(index: number, ctx: LobbyContext): void {
  ctx.setAllowAnonIndex(Math.max(0, Math.min(ALLOW_ANON_OPTIONS.length - 1, index)));
  const label = _getAnonLabel();
  if (label) label.textContent = ALLOW_ANON_OPTIONS[ctx.getAllowAnonIndex()].label;
}

// ── Change lobby size from party HUD quick toggle ────────

function _getPlayerCount(ctx: LobbyContext): number {
  const data = ctx.getLastLobbyData();
  if (!data) return 1;
  return getHumanCount(data);
}

export function changeLobbySize(direction: number, ctx: LobbyContext): void {
  const lobbyId = ctx.getCurrentLobbyId();
  if (!lobbyId || ctx.getMyRole() !== 'host') return;
  const newIndex = ctx.getLobbySizeIndex() + direction;
  if (newIndex < 0 || newIndex >= LOBBY_SIZE_OPTIONS.length) return;
  const newSize = LOBBY_SIZE_OPTIONS[newIndex].size;
  if (newSize < _getPlayerCount(ctx)) return;
  ctx.setLobbySizeIndex(newIndex);
  // Clean up AI slots beyond new size
  let aisTrimmed = false;
  const aiSlots = ctx.getAiSlots();
  for (const [slot] of aiSlots) { if (slot >= newSize) { aiSlots.delete(slot); aisTrimmed = true; } }
  ctx.setAiSlots(aiSlots);
  syncSizeToQuickStart(ctx);
  updateLobbySettings(lobbyId, { lobbySize: newSize }).catch(() => {});
  if (aisTrimmed) ctx.syncAisToServer();
  // Update lobby size label in settings panel too
  const label = _getSizeLabel();
  if (label) label.textContent = LOBBY_SIZE_OPTIONS[ctx.getLobbySizeIndex()].label;
}

// ── Event-listener wiring ────────────────────────────────

export function initLobbySettings(ctx: LobbyContext, bag: DisposableBag): void {
  const _wire = (id: string, handler: () => void): void => {
    const el = document.getElementById(id);
    if (el) bag.addEventListener(el, 'click', handler);
  };

  // Bestof arrows (host only)
  _wire('lobby-bestof-left', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    ctx.setLobbyBestofIndex((ctx.getLobbyBestofIndex() - 1 + BESTOF_OPTIONS.length) % BESTOF_OPTIONS.length);
    const opt = BESTOF_OPTIONS[ctx.getLobbyBestofIndex()];
    const lbl = _getBestofLabel(); if (lbl) lbl.textContent = opt.label;
    syncBestofToQuickStart(ctx);
    updateLobbySettings(lobbyId, { seriesLength: opt.rounds }).catch(() => {});
  });

  _wire('lobby-bestof-right', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    ctx.setLobbyBestofIndex((ctx.getLobbyBestofIndex() + 1) % BESTOF_OPTIONS.length);
    const opt = BESTOF_OPTIONS[ctx.getLobbyBestofIndex()];
    const lbl = _getBestofLabel(); if (lbl) lbl.textContent = opt.label;
    syncBestofToQuickStart(ctx);
    updateLobbySettings(lobbyId, { seriesLength: opt.rounds }).catch(() => {});
  });

  // Lobby size arrows (host only)
  _wire('lobby-size-left', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    const newIndex = (ctx.getLobbySizeIndex() - 1 + LOBBY_SIZE_OPTIONS.length) % LOBBY_SIZE_OPTIONS.length;
    const newSize = LOBBY_SIZE_OPTIONS[newIndex].size;
    if (newSize < _getPlayerCount(ctx)) return; // can't shrink below player count
    ctx.setLobbySizeIndex(newIndex);
    // Clean up AI slots beyond new size
    let aisTrimmed = false;
    const aiSlots = ctx.getAiSlots();
    for (const [slot] of aiSlots) { if (slot >= newSize) { aiSlots.delete(slot); aisTrimmed = true; } }
    ctx.setAiSlots(aiSlots);
    const opt = LOBBY_SIZE_OPTIONS[ctx.getLobbySizeIndex()];
    const lbl = _getSizeLabel(); if (lbl) lbl.textContent = opt.label;
    syncSizeToQuickStart(ctx);
    updateLobbySettings(lobbyId, { lobbySize: opt.size }).catch(() => {});
    if (aisTrimmed) ctx.syncAisToServer();
  });

  _wire('lobby-size-right', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    ctx.setLobbySizeIndex((ctx.getLobbySizeIndex() + 1) % LOBBY_SIZE_OPTIONS.length);
    const opt = LOBBY_SIZE_OPTIONS[ctx.getLobbySizeIndex()];
    const lbl = _getSizeLabel(); if (lbl) lbl.textContent = opt.label;
    syncSizeToQuickStart(ctx);
    updateLobbySettings(lobbyId, { lobbySize: opt.size }).catch(() => {});
  });

  // Invite permission arrows (host only)
  _wire('lobby-invite-perm-left', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    ctx.setInvitePermIndex((ctx.getInvitePermIndex() - 1 + INVITE_PERM_OPTIONS.length) % INVITE_PERM_OPTIONS.length);
    const opt = INVITE_PERM_OPTIONS[ctx.getInvitePermIndex()];
    const lbl = _getInvitePermLabel(); if (lbl) lbl.textContent = opt.label;
    updateLobbySettings(lobbyId, { invitePermission: opt.value }).catch(() => {});
  });

  _wire('lobby-invite-perm-right', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    ctx.setInvitePermIndex((ctx.getInvitePermIndex() + 1) % INVITE_PERM_OPTIONS.length);
    const opt = INVITE_PERM_OPTIONS[ctx.getInvitePermIndex()];
    const lbl = _getInvitePermLabel(); if (lbl) lbl.textContent = opt.label;
    updateLobbySettings(lobbyId, { invitePermission: opt.value }).catch(() => {});
  });

  // Allow anonymous arrows (host only)
  _wire('lobby-anon-left', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    ctx.setAllowAnonIndex((ctx.getAllowAnonIndex() - 1 + ALLOW_ANON_OPTIONS.length) % ALLOW_ANON_OPTIONS.length);
    const opt = ALLOW_ANON_OPTIONS[ctx.getAllowAnonIndex()];
    const lbl = _getAnonLabel(); if (lbl) lbl.textContent = opt.label;
    updateLobbySettings(lobbyId, { allowAnonymous: opt.value }).catch(() => {});
  });

  _wire('lobby-anon-right', () => {
    const lobbyId = ctx.getCurrentLobbyId();
    if (ctx.getMyRole() !== 'host' || !lobbyId) return;
    ctx.setAllowAnonIndex((ctx.getAllowAnonIndex() + 1) % ALLOW_ANON_OPTIONS.length);
    const opt = ALLOW_ANON_OPTIONS[ctx.getAllowAnonIndex()];
    const lbl = _getAnonLabel(); if (lbl) lbl.textContent = opt.label;
    updateLobbySettings(lobbyId, { allowAnonymous: opt.value }).catch(() => {});
  });
}

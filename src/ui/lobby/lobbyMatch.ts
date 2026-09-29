// ── lobbyMatch.ts ────────────────────────────────────────
// Match start, autostart countdown, and match-in-progress spectator screen.
// Extracted from lobbyUI.ts as part of the god-file split.

import type { LobbyContext } from './lobbyContext';
import type { DisposableBag } from '../../disposables';
import type { LobbyData, VehicleType, MapType, MatchFoundData } from '../../types/index';
import { COLOR_MAP, _swallow } from './lobbyContext';
import { ref, set as rtdbSet, get as rtdbGet, onValue } from 'firebase/database';
import { rtdb as rtdbInstance } from '../../firebase';
import { OnlineMatch } from '../../onlineMatch';
import { startLobbyMatch as startLobbyMatchFB, stopListening as stopLobbyListening, migrateLobbyData } from '../../lobby';
import { clearUserLobby } from '../../auth';
import { getGuestList, getGuestByUid, getGuestCount, MAPS } from '../../types/index';
import { resolveMapWinner, setSelectedMap, DEFAULT_MAP } from '../mapSelectUI';
import { playMapWheel } from '../mapWheel';
import type { MapWheelCandidate } from '../mapWheel';
import { show, hide, escapeHtml } from '../dom';
import { destroyLobbyChatIntegration } from './lobbyChat';

// ── Autostart state ──────────────────────────────────────
let _autostartTimer: ReturnType<typeof setInterval> | null = null;
let _autostartSeconds = 0;
let _autostartCancelled = false;

// ── Cached DOM elements ──────────────────────────────────
let _autostartBannerEl: HTMLElement | null = null;
function _getAutostartBanner(): HTMLElement | null {
  if (!_autostartBannerEl) _autostartBannerEl = document.getElementById('lobby-autostart-banner');
  return _autostartBannerEl;
}

// ── Match-in-progress state ──────────────────────────────
let _spectatingMatch = false;
let _matchScoreUnsub: (() => void) | null = null;
let _joinGameNotifPushed = false;

// ── State accessors ──────────────────────────────────────
export function isSpectatingMatch(): boolean { return _spectatingMatch; }
export function setSpectatingMatch(v: boolean): void { _spectatingMatch = v; }
export function isJoinGameNotifPushed(): boolean { return _joinGameNotifPushed; }
export function setJoinGameNotifPushed(v: boolean): void { _joinGameNotifPushed = v; }

// ── Autostart functions ──────────────────────────────────

function _allPlayersReady(data: LobbyData, ctx: LobbyContext): boolean {
  if (!data.host.vehicle || !data.host.ready) return false;
  for (const guest of getGuestList(data)) {
    if (!guest.vehicle || !guest.ready) return false;
  }
  const hasOpponent = getGuestCount(data) > 0 || ctx.getAiSlots().size > 0;
  return hasOpponent;
}

function _showAutostartBanner(): void {
  const el = _getAutostartBanner();
  if (!el) return;
  if (_autostartSeconds <= 0) { hide(el); return; }
  el.textContent = `STARTING IN ${_autostartSeconds}`;
  show(el);
}

function _startAutostart(ctx: LobbyContext): void {
  if (_autostartTimer || ctx.isLobbyMatchStarting()) return;
  _autostartSeconds = 5;
  _autostartCancelled = false;
  _showAutostartBanner();
  _autostartTimer = setInterval(() => {
    _autostartSeconds--;
    if (_autostartSeconds <= 0) {
      clearAutostart();
      const lobbyId = ctx.getCurrentLobbyId();
      if (lobbyId && ctx.getMyRole() === 'host' && !ctx.isLobbyMatchStarting()) {
        startLobbyMatchFB(lobbyId);
      }
    } else {
      _showAutostartBanner();
    }
  }, 1000);
}

export function clearAutostart(): void {
  if (_autostartTimer) { clearInterval(_autostartTimer); _autostartTimer = null; }
  const el = _getAutostartBanner();
  if (el) hide(el);
}

export function cancelAutostart(): void {
  _autostartCancelled = true;
  clearAutostart();
}

export function checkAutostart(data: LobbyData, ctx: LobbyContext): void {
  if (ctx.isLobbyMatchStarting()) return;
  if (_allPlayersReady(data, ctx)) {
    if (!_autostartCancelled && !_autostartTimer) _startAutostart(ctx);
  } else {
    _autostartCancelled = false; // reset cancel when conditions break
    clearAutostart();
  }
}

// ── Match-in-progress UI ─────────────────────────────────

function _updateMatchInProgressUI(
  meta: { players?: string[]; round?: number; seriesLength?: number; ais?: Record<string, { name: string }> },
  scores: Record<string, number> | null,
  lobbyData: LobbyData,
): void {
  const roundEl = document.getElementById('mip-round');
  const scoresEl = document.getElementById('mip-scores');
  if (!roundEl || !scoresEl) return;

  const seriesLen = meta.seriesLength || 1;
  const round = meta.round || 1;
  roundEl.textContent = seriesLen > 1 ? `ROUND ${round} / BEST OF ${seriesLen}` : `ROUND ${round}`;

  // Build score rows from player UIDs
  scoresEl.innerHTML = '';
  const players = meta.players || [];
  for (const uid of players) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:10px; font-family:Rajdhani,sans-serif; font-size:16px; letter-spacing:1px;';

    // Resolve player name from lobby data
    let name = 'PLAYER';
    let colorHex = '#fff';
    if (uid === lobbyData.host.uid) {
      name = lobbyData.host.username;
      colorHex = COLOR_MAP[lobbyData.host.color] || '#fff';
    } else {
      const guest = getGuestByUid(lobbyData, uid);
      if (guest) {
        name = guest.username;
        colorHex = COLOR_MAP[guest.color] || '#fff';
      }
    }

    const score = scores?.[uid] ?? 0;
    row.innerHTML = `<span style="color:${colorHex}; min-width:120px; text-align:right;">${escapeHtml(name)}</span>`
      + `<span style="color:rgba(var(--c-white),0.8); font-family:Orbitron,sans-serif; font-size:20px;">${score}</span>`;
    scoresEl.appendChild(row);
  }

  // Show AI names below players if any
  if (meta.ais) {
    for (const [, ai] of Object.entries(meta.ais)) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:10px; font-family:Rajdhani,sans-serif; font-size:14px; letter-spacing:1px; opacity:0.5;';
      row.innerHTML = `<span style="min-width:120px; text-align:right;">${escapeHtml(ai.name)} (AI)</span><span>-</span>`;
      scoresEl.appendChild(row);
    }
  }
}

export function showMatchInProgress(data: LobbyData, ctx: LobbyContext): void {
  const lobbyId = ctx.getCurrentLobbyId();
  if (!lobbyId) return;

  // Navigate to the match-in-progress screen
  ctx.navigateTo('matchInProgress');

  // Wire up leave button
  const leaveBtn = document.getElementById('btn-mip-leave');
  if (leaveBtn) {
    leaveBtn.onclick = () => {
      hideMatchInProgress();
      ctx.leaveLobby();
    };
  }

  // Listen for live scores from the match (matchId === lobbyId)
  const scoresRef = ref(rtdbInstance, `matches/${lobbyId}/scores`);
  const metaRef = ref(rtdbInstance, `matches/${lobbyId}/meta`);

  // Fetch meta once (player names, series info) — cache for score updates
  let cachedMeta: { players?: string[]; round?: number; seriesLength?: number; ais?: Record<string, { name: string }> } | null = null;
  rtdbGet(metaRef).then(snap => {
    cachedMeta = snap.val();
    if (cachedMeta) _updateMatchInProgressUI(cachedMeta, null, data);
  }).catch(() => {});

  // Listen for score updates — reuse cached meta
  const unsubScores = onValue(scoresRef, (snap) => {
    const scores = snap.val();
    if (cachedMeta) _updateMatchInProgressUI(cachedMeta, scores, data);
  });

  // Also listen for meta changes (round increments)
  const unsubMeta = onValue(metaRef, (snap) => {
    cachedMeta = snap.val();
  });

  _matchScoreUnsub = () => { unsubScores(); unsubMeta(); };
}

export function hideMatchInProgress(): void {
  if (_matchScoreUnsub) { _matchScoreUnsub(); _matchScoreUnsub = null; }
  _spectatingMatch = false;
  _joinGameNotifPushed = false;
}

// ── Return to lobby ──────────────────────────────────────

export function handleReturnToLobby(ctx: LobbyContext, rejoinFn: (lobbyId: string, role: 'host' | 'guest') => void): void {
  const lobbyId = ctx.getCurrentLobbyId();
  const role = ctx.getMyRole();
  if (!lobbyId || !role) return;

  // Stop the current online match
  ctx.setCurrentOnlineMatch(null);
  ctx.setLobbyMatchStarting(false);

  // Re-enter the lobby
  rejoinFn(lobbyId, role);
}

// ── Start match from lobby data ──────────────────────────

export async function startLobbyMatch(data: LobbyData, ctx: LobbyContext, clearLobbyLocally: () => void): Promise<void> {
  const isHost = ctx.getMyRole() === 'host';
  const lobbyId = ctx.getCurrentLobbyId()!;

  // Re-fetch lobby data to verify guest hasn't left since the cached update (#5)
  const freshSnap = await rtdbGet(ref(rtdbInstance, `lobbies/${lobbyId}`));
  const freshData = freshSnap.val() as LobbyData | null;
  if (freshData) data = migrateLobbyData(freshData);
  const guestList = getGuestList(data);
  const guest = guestList[0] || null; // primary opponent for 2-player match

  const game = ctx.getGame();
  const currentUid = ctx.getCurrentUid();
  const aiSlots = ctx.getAiSlots();

  // Solo host + AI only — start a local game instead of an OnlineMatch
  if (!guest) {
    // Close lobby overlay
    stopLobbyListening();
    ctx.stopHeartbeat();
    destroyLobbyChatIntegration();
    const aiSlotsCopy = new Map(aiSlots);
    aiSlots.clear();
    ctx.setSelectedAiSlot(null);
    ctx.setHostAiHydrated(false);
    ctx.setLastLobbyData(null);
    if (currentUid) clearUserLobby(currentUid).catch(() => {});
    ctx.hideChatForMatch();
    ctx.updatePartyHud(null);
    ctx.showScreen(null);

    // Configure game for local AI match with lobby settings
    game.mode = 'local';
    game._onlineMatch = null;
    game.opponentCount = Math.max(1, aiSlotsCopy.size);
    game.seriesLength = data.settings.seriesLength || 1;

    // Build lobby AI config for persistence across series
    const lobbyAiColors: { color: number; emissive: number }[] = [];
    const lobbyAiVehicles: VehicleType[] = [];
    for (const [, ai] of aiSlotsCopy) {
      const colorEntry = game._colorMap[ai.color] || game._colorMap.red;
      lobbyAiColors.push(colorEntry);
      lobbyAiVehicles.push((ai.vehicle || 'bike') as VehicleType);
    }

    // Store lobby origin so AI settings persist and return-to-lobby works
    game._lobbyOrigin = { lobbyId, role: 'host', aiColors: lobbyAiColors, aiVehicles: lobbyAiVehicles };

    // startSeries picks random AI colors — _lobbyOrigin overrides them at the end
    game.startSeries();

    // First series: also override immediately
    game._seriesAiColors = [...lobbyAiColors];
    game._seriesAiVehicles = [...lobbyAiVehicles];
    game._updateSeriesHUD();
    ctx.setCurrentScreen(null);

    // Don't delete lobby from Firebase — player may return
    ctx.setCurrentLobbyId(null);
    ctx.setLobbyMatchStarting(false);
    clearLobbyLocally();
    return;
  }

  let seed = 0;
  const matchId = lobbyId;

  // Build array of all human UIDs and per-opponent info
  const allHumanUids = [data.host.uid, ...guestList.map(g => g.uid)];

  // Snapshot AI slots before clearing (need to pass to OnlineMatch)
  let lobbyAis: Record<string, { name: string; color: string; vehicle: string }> | null =
    aiSlots.size > 0 ? Object.fromEntries([...aiSlots].map(([k, v]) => [String(k), v])) : null;

  if (isHost) {
    seed = Math.floor(Math.random() * 2147483647);
    const scores: Record<string, number> = {};
    for (const uid of allHumanUids) scores[uid] = 0;
    await rtdbSet(ref(rtdbInstance, `matches/${matchId}/meta`), {
      players: allHumanUids,
      seriesLength: data.settings.seriesLength || 1,
      status: 'pending',
      round: 1,
      scores,
      seed,
      ais: lobbyAis,
    });
  }

  if (!isHost) {
    // Poll for host's match metadata with retry instead of fixed 500ms wait.
    // Host writes seed + AI data — guest must wait until it's available.
    let meta: { seed?: number; ais?: Record<string, { name: string; color: string; vehicle: string }> } | null = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise<void>(r => setTimeout(r, 200));
      const metaSnap = await rtdbGet(ref(rtdbInstance, `matches/${matchId}/meta`));
      meta = metaSnap.val();
      if (meta?.seed) break;
    }
    if (!meta?.seed) {
      console.warn('lobby: guest failed to read match metadata after retries');
      ctx.setLobbyMatchStarting(false);
      return;
    }
    seed = meta.seed;
    if (meta.ais && !lobbyAis) lobbyAis = meta.ais;
  } else {
    // Host waits briefly for write propagation
    await new Promise<void>(r => setTimeout(r, 300));
  }

  // ── Map wheel tiebreaker ──
  const voteResult = resolveMapWinner(data);
  let activeMap: MapType;

  if (voteResult.isTie) {
    const candidates: MapWheelCandidate[] = voteResult.tiedMaps.map(mapId => {
      const mapDef = MAPS.find(m => m.id === mapId)!;
      const voterUids = voteResult.votesByMap.get(mapId) || [];
      const playerNames = voterUids.map(uid => {
        if (uid === data.host.uid) return data.host.username;
        const g = getGuestList(data).find(guest => guest.uid === uid);
        return g?.username || 'ANON';
      });
      return { mapId, label: mapDef.label, playerNames };
    });
    activeMap = await playMapWheel(candidates, seed);
  } else {
    activeMap = voteResult.winner || DEFAULT_MAP;
  }

  setSelectedMap(activeMap);

  // Close lobby overlay but keep lobby listener alive for return-to-lobby
  ctx.stopHeartbeat();
  destroyLobbyChatIntegration();
  aiSlots.clear();
  ctx.setSelectedAiSlot(null);
  ctx.setHostAiHydrated(false);
  ctx.setLastLobbyData(null);
  if (currentUid) clearUserLobby(currentUid).catch(() => {});
  ctx.hideChatForMatch();
  ctx.updatePartyHud(null);
  ctx.showScreen(null);

  // Build opponents array: if I'm host, all guests are opponents; if guest, host + other guests
  const opponents: Array<{ uid: string; name: string; color: string; vehicle?: VehicleType }> = [];
  if (isHost) {
    for (const g of guestList) {
      opponents.push({ uid: g.uid, name: g.username, color: g.color, vehicle: (g.vehicle || 'bike') as VehicleType });
    }
  } else {
    opponents.push({ uid: data.host.uid, name: data.host.username, color: data.host.color, vehicle: (data.host.vehicle || 'bike') as VehicleType });
    for (const g of guestList) {
      if (g.uid !== currentUid) {
        opponents.push({ uid: g.uid, name: g.username, color: g.color, vehicle: (g.vehicle || 'bike') as VehicleType });
      }
    }
  }

  const matchInfo: MatchFoundData = {
    matchId,
    seed,
    opponents,
    isInitiator: isHost,
  };

  const onlineMatch = new OnlineMatch(matchInfo, currentUid!, game);
  onlineMatch.lobbyId = lobbyId;
  onlineMatch.lobbyRole = isHost ? 'host' : 'guest';
  onlineMatch.lobbyAis = lobbyAis;
  // Set state change handler BEFORE start() so no events are lost
  onlineMatch.onStateChange = (state: string, stateData?: unknown): void => {
    ctx.handleOnlineStateChange(state, stateData);
  };
  ctx.setCurrentOnlineMatch(onlineMatch);
  onlineMatch.start();

  // Mark lobby as active so late joiners can detect the in-progress match
  if (isHost) {
    rtdbSet(ref(rtdbInstance, `lobbies/${lobbyId}/status`), 'active').catch(_swallow('status write'));
  }

  await onlineMatch.accept();
}

// ── Init match listeners ─────────────────────────────────

/** Wire up the autostart banner click handler. Call from initLobbyUI(). */
export function initMatchListeners(ctx: LobbyContext, bag: DisposableBag): void {
  const el = _getAutostartBanner();
  if (el) bag.addEventListener(el, 'click', () => {
    if (ctx.getMyRole() === 'host') cancelAutostart();
  });
}

// ── joinMatchAsSpectator ─────────────────────────────────

/** Called from JOIN GAME notification — spectating guest wants to see the match-in-progress screen. */
export function joinMatchAsSpectator(lobbyId: string, ctx: LobbyContext): void {
  if (ctx.getCurrentLobbyId() !== lobbyId) return;
  if (!_spectatingMatch && ctx.getLastLobbyData()) {
    _spectatingMatch = true;
    showMatchInProgress(ctx.getLastLobbyData()!, ctx);
  }
}

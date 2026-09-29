// ── Mock LobbyContext builder ──────────────────────────
// Provides a test double for the LobbyContext interface with sensible defaults
// and vi.fn() stubs for all methods. Per-test overrides can be passed.

import { vi } from 'vitest';
import type { LobbyContext } from '../../lobbyContext';
import type { LobbyData, VehicleType } from '../../../../types/index';

export interface MockLobbyContextOverrides {
  currentLobbyId?: string | null;
  myRole?: 'host' | 'guest' | null;
  currentUid?: string | null;
  currentUsername?: string | null;
  lastLobbyData?: LobbyData | null;
  aiSlots?: Map<number, { name: string; color: string; vehicle: VehicleType }>;
  selectedAiSlot?: number | null;
  ready?: boolean;
  playerColorKey?: string;
  playerIcon?: string | null;
  lobbyBestofIndex?: number;
  lobbySizeIndex?: number;
  invitePermIndex?: number;
  allowAnonIndex?: number;
  game?: unknown;
  hostAiHydrated?: boolean;
  onProfileClick?: ((uid: string) => void) | null;
  lobbyMatchStarting?: boolean;
}

/** Creates a mocked LobbyContext with `vi.fn()` stubs on every method.
 *  State fields are closed over so setters mutate in place, enabling reads
 *  through the getters to reflect test-driven changes. */
export function makeMockCtx(overrides: MockLobbyContextOverrides = {}): LobbyContext {
  const state = {
    currentLobbyId: overrides.currentLobbyId ?? null,
    myRole: overrides.myRole ?? null,
    currentUid: overrides.currentUid ?? null,
    currentUsername: overrides.currentUsername ?? null,
    lastLobbyData: overrides.lastLobbyData ?? null,
    aiSlots: overrides.aiSlots ?? new Map<number, { name: string; color: string; vehicle: VehicleType }>(),
    selectedAiSlot: overrides.selectedAiSlot ?? null,
    ready: overrides.ready ?? false,
    playerColorKey: overrides.playerColorKey ?? 'red',
    playerIcon: overrides.playerIcon ?? null,
    lobbyBestofIndex: overrides.lobbyBestofIndex ?? 0,
    lobbySizeIndex: overrides.lobbySizeIndex ?? 0,
    invitePermIndex: overrides.invitePermIndex ?? 0,
    allowAnonIndex: overrides.allowAnonIndex ?? 0,
    game: overrides.game ?? {},
    hostAiHydrated: overrides.hostAiHydrated ?? false,
    onProfileClick: overrides.onProfileClick ?? null,
    lobbyMatchStarting: overrides.lobbyMatchStarting ?? false,
    opponentColor: null as string | null,
  };

  const ctx: LobbyContext = {
    // Getters
    getCurrentLobbyId: vi.fn(() => state.currentLobbyId),
    getMyRole: vi.fn(() => state.myRole),
    getCurrentUid: vi.fn(() => state.currentUid),
    getCurrentUsername: vi.fn(() => state.currentUsername),
    getLastLobbyData: vi.fn(() => state.lastLobbyData),
    getAiSlots: vi.fn(() => state.aiSlots),
    getSelectedAiSlot: vi.fn(() => state.selectedAiSlot),
    isReady: vi.fn(() => state.ready),
    getPlayerColorKey: vi.fn(() => state.playerColorKey),
    getPlayerIcon: vi.fn(() => state.playerIcon),
    getLobbyBestofIndex: vi.fn(() => state.lobbyBestofIndex),
    getLobbySizeIndex: vi.fn(() => state.lobbySizeIndex),
    getInvitePermIndex: vi.fn(() => state.invitePermIndex),
    getAllowAnonIndex: vi.fn(() => state.allowAnonIndex),
    getGame: vi.fn(() => state.game),
    isHostAiHydrated: vi.fn(() => state.hostAiHydrated),
    getOnProfileClick: vi.fn(() => state.onProfileClick),
    isLobbyMatchStarting: vi.fn(() => state.lobbyMatchStarting),

    // Setters
    setAiSlots: vi.fn((v) => { state.aiSlots = v; }),
    setSelectedAiSlot: vi.fn((v) => { state.selectedAiSlot = v; }),
    setLobbyBestofIndex: vi.fn((v) => { state.lobbyBestofIndex = v; }),
    setLobbySizeIndex: vi.fn((v) => { state.lobbySizeIndex = v; }),
    setInvitePermIndex: vi.fn((v) => { state.invitePermIndex = v; }),
    setAllowAnonIndex: vi.fn((v) => { state.allowAnonIndex = v; }),
    setReady: vi.fn((v) => { state.ready = v; }),
    setLastLobbyData: vi.fn((v) => { state.lastLobbyData = v; }),
    setHostAiHydrated: vi.fn((v) => { state.hostAiHydrated = v; }),
    setLobbyMatchStarting: vi.fn((v) => { state.lobbyMatchStarting = v; }),
    setCurrentLobbyId: vi.fn((v) => { state.currentLobbyId = v; }),
    setMyRole: vi.fn((v) => { state.myRole = v; }),
    setOpponentColor: vi.fn((v) => { state.opponentColor = v; }),

    // Dep actions
    showScreen: vi.fn(),
    navigateTo: vi.fn(),
    navigateReset: vi.fn(),
    handleOnlineStateChange: vi.fn(),
    setCurrentOnlineMatch: vi.fn(),
    ensureAudio: vi.fn(),
    hideChatForMatch: vi.fn(),
    setCurrentScreen: vi.fn(),

    // Cross-module refs
    renderLobbyCards: vi.fn(),
    renderVehicleGrid: vi.fn(),
    renderMapGrid: vi.fn(),
    updatePartyHud: vi.fn(),
    syncAisToServer: vi.fn(),
    renderColorPickerForSelection: vi.fn(),
    leaveLobby: vi.fn(),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    clearAutostart: vi.fn(),
    selectAiSlot: vi.fn(),
    syncSizeToQuickStart: vi.fn(),
    syncBestofToQuickStart: vi.fn(),
    checkAutostart: vi.fn(),
    renderLobbyFriends: vi.fn(),
    renderLobbyParty: vi.fn(),
    updatePartyChip: vi.fn(),
    renderPartySheet: vi.fn(),

    // Optional coordinator actions
    openLobbyAsHost: vi.fn(),
    toggleReady: vi.fn(),
  };

  return ctx;
}

/** Build a minimal LobbyData with sensible defaults and optional guest/AI overrides. */
export function makeLobby(opts: {
  hostUid?: string;
  hostUsername?: string;
  hostColor?: string;
  hostVehicle?: VehicleType | null;
  hostReady?: boolean;
  hostIcon?: string;
  guests?: Array<{
    uid?: string;
    username?: string;
    color?: string;
    vehicle?: VehicleType | null;
    ready?: boolean;
    presence?: boolean;
    mapVote?: string | null;
  }>;
  seriesLength?: number;
  lobbySize?: number;
  invitePermission?: 'invite' | 'private' | 'public';
  allowAnonymous?: boolean;
  status?: 'waiting' | 'starting' | 'active' | 'returning';
  hostMapVote?: string | null;
  hostPresence?: boolean;
} = {}): LobbyData {
  const guests: Record<string, unknown> = {};
  (opts.guests ?? []).forEach((g, i) => {
    const uid = g.uid ?? `guest${i}`;
    guests[uid] = {
      uid,
      username: g.username ?? `GUEST${i}`,
      color: g.color ?? 'cyan',
      vehicle: g.vehicle ?? 'bike',
      ready: g.ready ?? false,
      presence: g.presence ?? true,
      mapVote: g.mapVote ?? null,
    };
  });
  return {
    host: {
      uid: opts.hostUid ?? 'host',
      username: opts.hostUsername ?? 'HOST',
      color: opts.hostColor ?? 'red',
      vehicle: opts.hostVehicle ?? 'bike',
      ready: opts.hostReady ?? false,
      icon: opts.hostIcon,
      presence: opts.hostPresence ?? true,
      mapVote: opts.hostMapVote ?? null,
    },
    guests,
    settings: {
      seriesLength: opts.seriesLength ?? 1,
      lobbySize: opts.lobbySize ?? 2,
      invitePermission: opts.invitePermission,
      allowAnonymous: opts.allowAnonymous,
    },
    status: opts.status ?? 'waiting',
    createdAt: Date.now(),
  } as unknown as LobbyData;
}

import type { LobbyData, VehicleType } from '../../types/index';
import type { OnlineMatch } from '../../onlineMatch';
import { PLAYER_COLOR_CSS_MAP, PLAYER_COLOR_KEYS } from '../../playerColors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameInstance = any;

// ── Constants shared across lobby modules ──────────────
export const COLOR_MAP: Record<string, string> = PLAYER_COLOR_CSS_MAP;
export const COLOR_KEYS = [...PLAYER_COLOR_KEYS];

export const BESTOF_OPTIONS = [
  { label: 'SINGLE MATCH', rounds: 1 },
  { label: 'BEST OF 3', rounds: 3 },
  { label: 'BEST OF 5', rounds: 5 },
];

export const LOBBY_SIZE_OPTIONS = [
  { label: '1v1', size: 2 },
  { label: '3 PLAYERS', size: 3 },
  { label: '4 PLAYERS', size: 4 },
];

export const MAX_LOBBY_SIZE = 4;

export const INVITE_PERM_OPTIONS = [
  { label: 'INVITE ONLY', value: 'invite' as const },
  { label: 'PRIVATE', value: 'private' as const },
  { label: 'PUBLIC', value: 'public' as const },
];

export const ALLOW_ANON_OPTIONS = [
  { label: 'ALLOW', value: true },
  { label: 'BLOCK', value: false },
];

export const AI_NAMES = [
  'NEON', 'CIPHER', 'GLITCH', 'ZERO', 'FLUX', 'VOLT', 'PRISM', 'ECHO',
  'NOVA', 'PHANTOM', 'SURGE', 'APEX', 'BYTE', 'CRASH', 'DRIFT', 'EMBER',
  'GHOST', 'HAZE', 'ION', 'JADE', 'KIRA', 'LYNX', 'MACH', 'NEXUS',
  'ONYX', 'PIXEL', 'QUASAR', 'RAZE', 'SHARD', 'TRACE', 'UMBRA', 'VIPER',
  'WARP', 'XENON', 'ZEPHYR', 'AXION', 'BLITZ', 'CORTEX', 'DAEMON', 'EDGE',
  'FLARE', 'GRID', 'HELIX', 'IMPULSE', 'JET', 'KARMA', 'LASER', 'MATRIX',
  'NUKE', 'ORACLE', 'PULSE', 'RAZOR', 'STATIC', 'TURBO', 'ULTRA', 'VECTOR',
  'WRAITH', 'XYLO', 'ZENITH', 'ARC', 'BINARY', 'CHROME', 'DIODE', 'ETHER',
];

export const ICON_TOOLTIPS: Record<string, string> = { star: 'EARLY ADOPTER' };

export const LOADOUTS: VehicleType[] = ['bike', 'car', 'hoverboard'];

/** Vehicles that appear in the grid but cannot be selected (view-only). */
export const DISABLED_LOADOUTS: ReadonlySet<VehicleType> = new Set<VehicleType>([]);

/** Helper shared across modules for swallowed errors */
export const _swallow = (label: string) => (e: unknown): void => {
  if (import.meta.env.DEV) console.warn(`[lobby] ${label}`, e);
};

// ── Shared context interface ────────────────────────────
// Provides access to coordinator state for extracted modules.
// The coordinator creates a concrete implementation wrapping its let-variables.

export interface LobbyContext {
  // ── Getters ──
  getCurrentLobbyId(): string | null;
  getMyRole(): 'host' | 'guest' | null;
  getCurrentUid(): string | null;
  getCurrentUsername(): string | null;
  getLastLobbyData(): LobbyData | null;
  getAiSlots(): Map<number, { name: string; color: string; vehicle: VehicleType }>;
  getSelectedAiSlot(): number | null;
  isReady(): boolean;
  getPlayerColorKey(): string;
  getPlayerIcon(): string | null;
  getLobbyBestofIndex(): number;
  getLobbySizeIndex(): number;
  getInvitePermIndex(): number;
  getAllowAnonIndex(): number;
  getGame(): GameInstance;
  isHostAiHydrated(): boolean;
  getOnProfileClick(): ((uid: string) => void) | null;
  isLobbyMatchStarting(): boolean;

  // ── Setters ──
  setAiSlots(slots: Map<number, { name: string; color: string; vehicle: VehicleType }>): void;
  setSelectedAiSlot(slot: number | null): void;
  setLobbyBestofIndex(index: number): void;
  setLobbySizeIndex(index: number): void;
  setInvitePermIndex(index: number): void;
  setAllowAnonIndex(index: number): void;
  setReady(ready: boolean): void;
  setLastLobbyData(data: LobbyData | null): void;
  setHostAiHydrated(v: boolean): void;
  setLobbyMatchStarting(v: boolean): void;
  setCurrentLobbyId(id: string | null): void;
  setMyRole(role: 'host' | 'guest' | null): void;
  setOpponentColor(color: string | null): void;

  // ── Dep actions ──
  showScreen(screen: string | null): void;
  navigateTo(screen: string): void;
  navigateReset(screen: string): void;
  handleOnlineStateChange(state: string, data?: unknown): void;
  setCurrentOnlineMatch(match: OnlineMatch | null): void;
  ensureAudio(): void;
  hideChatForMatch(): void;
  setCurrentScreen(s: string | null): void;

  // ── Cross-module calls (filled by coordinator after all modules init) ──
  renderLobbyCards(data: LobbyData): void;
  renderVehicleGrid(data: LobbyData): void;
  renderMapGrid(data: LobbyData): void;
  updatePartyHud(data: LobbyData | null): void;
  syncAisToServer(): void;
  renderColorPickerForSelection(data: LobbyData): void;
  leaveLobby(): void;
  startHeartbeat(): void;
  stopHeartbeat(): void;
  clearAutostart(): void;
  selectAiSlot(slot: number | null): void;
  syncSizeToQuickStart(): void;
  syncBestofToQuickStart(): void;
  checkAutostart(data: LobbyData): void;
  renderLobbyFriends(): void;
  renderLobbyParty(data: LobbyData): void;
  updatePartyChip(data: LobbyData): void;
  renderPartySheet(data: LobbyData): void;

  // ── Optional coordinator actions (wired by lobbyUI) ──
  openLobbyAsHost?(): void;
  toggleReady?(): void;
}

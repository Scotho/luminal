// ── Shared Type Definitions for Luminal ──────────────────

export type VehicleType = 'bike' | 'car' | 'hoverboard';
export type MapType = 'synth_pit' | 'midtown_bowl' | 'synth_city';

export interface MapMeta {
  id: MapType;
  label: string;
  preview: string;
}

export const MAPS: MapMeta[] = [
  { id: 'midtown_bowl', label: 'MIDTOWN BOWL', preview: '/images/maps/midtown_bowl.webp' },
  { id: 'synth_pit', label: 'THE PIT', preview: '/images/maps/synth_pit.webp' },
  { id: 'synth_city', label: 'SYNTH CITY', preview: '/images/maps/synth_city.webp' },
];

import type * as THREE from 'three';

// ── Player / Game State ──────────────────────────────────

export interface PlayerState {
  x: number;
  z: number;
  angle: number;
  speed: number;
  boosting: boolean;
  dashing: boolean;
  alive: boolean;
}

export interface ColorEntry {
  color: number;
  emissive: number;
}

// ── AI ───────────────────────────────────────────────────

export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface AIPersonality {
  aggression: number;
  wallFear: number;
  straightBias: number;
  jitterAmount: number;
  dashAggression: number;
  moodSwingRate: number;
  turniness: number;
  cutoffSkill: number;
  escapeSkill: number;
}

export interface AIManeuver {
  type: 'snake' | 'swerve' | 'attack' | 'uturn';
  timer: number;
  duration: number;
  freq?: number;
  dir?: 1 | -1;
}

export interface AIState {
  personality: AIPersonality | null;
  personalityTimer: number;
  maneuver: AIManeuver | null;
  maneuverCooldown: number;
  trappedTimer: number;
  trappedSuicideAt: number;
  fidgetTimer: number;
  fidgetValue: number;
  fidgetDuration: number;
  lastPlayerAngle: number | null;
  lastPlayerPos: { x: number; z: number } | null;
  reactionDelay: number;
  accelCommit: number;
  accelCooldown: number;
  dashCommit?: number;
  dashCooldown?: number;
  driftCommit: number;
  driftCooldown: number;
  driftExitTimer: number;
  rng: (() => number) & { readonly originalSeed?: number; readonly callCount?: number };
  difficulty: AIDifficulty;
}

export interface AIInput {
  turn: number;
  accelerate: boolean;
  dash: boolean;
  brake: boolean;
  special?: boolean;
}

// ── Structural Interfaces (avoid circular imports) ───────
// These define the shapes that cross-cutting systems (collision, AI)
// need from Player and Trail without importing the actual classes.

export interface ITrail {
  points: TrailPoint[];
  readonly _segCount: number;
  wallMesh: THREE.InstancedMesh;
  wallMat: THREE.MeshStandardMaterial & { _baseEmissiveColor?: THREE.Color };
  color: { r: number; g: number; b: number };
  // VFX state — optionally set by proximity system
  _glowingIdxs?: number[] | null;
  _baseEmissive?: number;
  _darkBoost?: number;
  setInstanceY?(idx: number, y: number): void;
  getInstanceOrigY?(idx: number): number;
  setSlipstream?(value: number): void;
}

export interface IPlayer {
  alive: boolean;
  angle: number;
  speed: number;
  meter: number;
  boosting: boolean;
  dashing: boolean;
  proximitySpeedBoost: number;
  trail: ITrail;
  getPosition(): { x: number; z: number };
  kill(): void;
}

// Slim subset for AI — only what getAIInput reads
export interface IAIPlayer {
  getPosition(): { x: number; z: number };
  angle: number;
  speed: number;
  dashing: boolean;
  boosting: boolean;
  drifting: boolean;
  meter: number;
  vehicleType: VehicleType;
  // Hoverboard grind state — optional; populated only for hoverboard players
  grinding?: boolean;
  grindBalance?: number;
  grindCooldown?: number;
  grindDuration?: number;
  airborne?: boolean;
  recovery?: boolean;
  // TASK-267: lets the AI see an inbound grind opportunity without having to
  // recompute nearest-trail distance — the sim already sets this each tick.
  grindSnapAvailable?: boolean;
}

export interface ITrailLike {
  points: TrailPoint[];
}

// ── Trail / Spatial Grid ─────────────────────────────────

export interface TrailPoint {
  x: number;
  z: number;
}

export interface GridSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  trail: ITrail;
  segIndex: number;
}

export interface NearestResult {
  dist: number;
  seg: GridSegment | null;
}

// ── Graphics Settings ────────────────────────────────────

export type BloomLevel = 'off' | 'low' | 'high' | 'ultra';
export type DetailLevel = 'minimal' | 'reduced' | 'full';
export type VFXLevel = 'off' | 'reduced' | 'full';
export type AtmosphereLevel = 'off' | 'haze' | 'full';
export type ReflectionLevel = 'off' | 'high' | 'ultra';
export type PresetName = 'low' | 'medium' | 'high' | 'ultra' | 'custom';

export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
  vehiclesMul: number;
  trailsMul: number;
  environmentMul: number;
  lightsMul: number;
  enabled: boolean;
  vehiclesOn: boolean;
  trailsOn: boolean;
  environmentOn: boolean;
  lightsOn: boolean;
}

export interface GfxSettings {
  preset: PresetName;
  bloom: BloomSettings;
  antialias: boolean;
  pixelRatio: number;
  arenaDetail: DetailLevel;
  raveSpotlights: number;
  audioReactivity: VFXLevel;
  playerVFX: VFXLevel;
  lighting: DetailLevel;
  atmosphere: AtmosphereLevel;
  reflections: ReflectionLevel;
}

export type SettingsListener = (settings: GfxSettings) => void;

// ── Replay ───────────────────────────────────────────────

export interface ReplayFrame {
  t: number;
  player: PlayerState;
  ais: PlayerState[];
}

export interface ReplaySnapshot {
  frames: ReplayFrame[];
  playerColor: number;
  playerEmissive: number;
  playerVehicle?: VehicleType;
  mapType?: MapType;
  aiColors: ColorEntry[];
  aiVehicles?: VehicleType[];
  duration: number;
}

export interface InterpolatedReplayFrame {
  time: number;
  duration: number;
  player: PlayerState;
  ais: PlayerState[];
  progress: number;
}

// ── Replay Storage ───────────────────────────────────────

export interface CompressedFrame {
  t: number;
  p: number[] | null;
  a: Array<number[] | null>;
}

export interface SeriesInfo {
  length: number;
  playerWins: number;
  aiWins: number[];
  roundIndex: number;
  /** Unique id linking all rounds of a best-of; null for BO1 or pre-migration entries. */
  seriesId: string | null;
}

export interface ReplayEntry {
  id: string;
  timestamp: number;
  favorite: boolean;
  result: 'player' | 'ai' | 'draw';
  matchType: 'ai' | 'casual';
  winnerName: string;
  opponentName: string;
  duration: number;
  playerColor: number;
  playerEmissive: number;
  playerVehicle?: VehicleType;
  aiColors: ColorEntry[];
  aiVehicles?: VehicleType[];
  seriesInfo: SeriesInfo | null;
  frames: CompressedFrame[];
}

/** A ReplayEntry after decompression — frames are full ReplayFrame[], not compressed. */
export interface LoadedReplayEntry extends Omit<ReplayEntry, 'frames'> {
  frames: ReplayFrame[];
}

export interface ReplayListEntry {
  id: string;
  timestamp: number;
  favorite: boolean;
  result: string;
  duration: number;
  playerColor: number;
  aiColors: ColorEntry[];
  seriesInfo: SeriesInfo | null;
  matchType: string;
  winnerName: string;
  opponentName: string;
}

export interface MatchInfo {
  result: 'player' | 'ai' | 'draw';
  matchType?: 'ai' | 'casual';
  winnerName?: string;
  opponentName?: string;
  seriesInfo?: SeriesInfo | null;
}

// ── Netcode ──────────────────────────────────────────────

export interface RemoteState {
  x: number;
  z: number;
  angle: number;
  speed: number;
  meter: number;
  alive: boolean;
  boosting: boolean;
  dashing: boolean;
  seq?: number;
  ts?: number;
  _receivedAt?: number;
}

export interface NetcodeDeathEvent {
  type: 'death';
  uid: string;
  reportedBy: string;
  round: number;
  roundTime: number;
  ts: number;
}

export interface NetcodeRoundEndEvent {
  type: 'roundEnd';
  winner?: string;
  ts?: number;
}

export type NetcodeEvent = NetcodeDeathEvent | NetcodeRoundEndEvent;

// ── Gamepad ──────────────────────────────────────────────

export interface GamepadState {
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  lb: boolean;
  rb: boolean;
  lt: boolean;
  rt: boolean;
  select: boolean;
  start: boolean;
  dpadUp: boolean;
  dpadDown: boolean;
  dpadLeft: boolean;
  dpadRight: boolean;
  _edges: Record<number, boolean>;
}

export interface UINav {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  select: boolean;
  start: boolean;
  lb: boolean;
  rb: boolean;
}

// ── Scene ────────────────────────────────────────────────

/** Bloom pass proxy: abstracts pmndrs BloomEffect behind a simple
 *  strength/radius/threshold/enabled surface used by all call-sites
 *  (game.ts, adminPanel.ts, atmosphere.ts, Trail Lab, etc.). */
export interface BloomPassLike {
  strength: number;
  radius: number;
  threshold: number;
  enabled: boolean;
}

/** Minimal composer interface used by the game loop.
 *  External consumers only need render() + setSize(). */
export interface RenderComposer {
  render(): void;
  setSize(width: number, height: number): void;
}

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  composer: RenderComposer;
  bloomPass: BloomPassLike;
}

// ── Input / Keybinds ─────────────────────────────────────

export type ActionName =
  | 'left' | 'right' | 'accelerate' | 'brake' | 'dash'
  | 'rPlayPause' | 'rCamPrev' | 'rCamNext'
  | 'rSkipBack' | 'rSkipFwd' | 'rFineBack' | 'rFineFwd'
  | 'rToggleUI';

export type Keybinds = Record<ActionName, [string, string]>;

// ── Online Match ─────────────────────────────────────────

export interface SpawnPosition {
  x: number;
  z: number;
  angle: number;
}


export type OnlineMatchState =
  | 'pending' | 'countdown' | 'playing'
  | 'roundOver' | 'finished' | 'disconnected';

export interface RoundResult {
  winner: string;
  scores: Record<string, number>;
  round: number;
  seriesOver: boolean;
  iWon: boolean;
  isDraw: boolean;
}

// ── Matchmaking ──────────────────────────────────────────

export interface QueueEntry {
  uid: string;
  username: string;
  color: string;
  vehicle?: VehicleType;
  status: 'waiting' | 'matched';
  joinedAt: number;
  matchId?: string;
  mapVote?: MapType | null;
}

export interface MatchFoundData {
  matchId: string;
  seed: number;
  opponents: Array<{ uid: string; name: string; color: string; vehicle?: VehicleType; mapVote?: MapType | null }>;
  isInitiator: boolean;
  myMapVote?: MapType | null;
}

export interface OnlineMatchDoc {
  id: string;
  players: Array<{ uid: string; username: string; color: string; mapVote?: MapType | null }>;
  seed: number;
  seriesLength?: number;
  status: string;
  createdAt: number;
}

// ── Lobby ────────────────────────────────────────────────

export interface LobbyPlayer {
  uid: string;
  username: string;
  color: string;
  icon?: string;
  vehicle?: VehicleType | null;
  ready?: boolean;
  presence?: boolean;
  disconnectedAt?: number;
  spectating?: boolean;
  mapVote?: MapType | null;
}

export interface LobbyAi {
  name: string;
  color: string;
  vehicle: string;
}

export interface LobbyData {
  host: LobbyPlayer;
  guests?: Record<string, LobbyPlayer>;
  settings: {
    seriesLength: number;
    lobbySize?: number;
    invitePermission?: 'invite' | 'private' | 'public';
    allowAnonymous?: boolean;
    map?: MapType;
  };
  ais?: Record<string, LobbyAi>;
  status: 'waiting' | 'starting' | 'active' | 'returning';
  createdAt: number;
  /** @deprecated migration only — old single-guest field */
  guest?: LobbyPlayer | null;
}

/** Lightweight lobby info for the open lobbies browser */
export interface PublicLobbyInfo {
  lobbyId: string;
  hostName: string;
  hostColor: string;
  seriesLength: number;
  lobbySize: number;
  playerCount: number;
  allowAnonymous: boolean;
  status: 'waiting' | 'active';
  createdAt: number;
}

// ── Lobby helpers ───────────────────────────────────────

export function getGuestList(data: LobbyData): LobbyPlayer[] {
  return Object.values(data.guests || {});
}
export function getGuestByUid(data: LobbyData, uid: string): LobbyPlayer | null {
  return data.guests?.[uid] ?? null;
}
export function getGuestCount(data: LobbyData): number {
  return Object.keys(data.guests || {}).length;
}
export function getHumanCount(data: LobbyData): number {
  return 1 + getGuestCount(data);
}
export function hasGuest(data: LobbyData, uid: string): boolean {
  return !!(data.guests?.[uid]);
}

// ── Notifications ───────────────────────────────────────

export type NotifType = 'friend-request' | 'lobby-invite' | 'join-game' | 'info';

export interface AppNotif {
  id: string;
  type: NotifType;
  message: string;
  createdAt: number;
  fromUid?: string;
  fromUsername?: string;
  lobbyId?: string;
  silent?: boolean;
}

// ── Leaderboard ──────────────────────────────────────────

export interface LeaderboardEntry {
  uid: string;
  username: string;
  color: number;
  icon?: string;
  series: number;
  matchType: 'ai' | 'casual';
  wins: number;
  losses: number;
  draws: number;
  totalTime: number;
  matchCount: number;
  bestStreak: number;
  currentStreak: number;
  currentStreakBrokenAt?: number;
  currentStreakPeak?: number;
  fastestWin: number;
  winRate: number;
  lastUpdated: number;
  lastReplayId: string;
  bestStreakReplayId: string;
  fastestWinReplayId: string;
  lifetimeFlow?: number;
}

// ── Ghost (replay/demo visuals) ─────────────────────────

// ── Demo Mode Host ──────────────────────────────────────
// Narrow interface for fields/methods that DemoMode needs from its host (Game).
// Avoids circular imports: modes/ → types/, game.ts implements the interface.

export interface IDemoModeHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  settingsOpen: boolean;
  adminFreecam: boolean;

  // Methods
  cleanup(): void;
  _drawSettingsPreview(): void;
  _updateAdminFreecam(dt: number): void;
}

// ── Streak ──

export interface StreakModeData {
  currentStreak: number;
  bestStreak: number;
}

export interface StreakData {
  bo1: StreakModeData;
  bo3: StreakModeData;
  bo5: StreakModeData;
}

// ── Friends ──────────────────────────────────────────────

export interface FriendRequest {
  fromUid: string;
  fromUsername: string;
  timestamp: { toMillis(): number };
}

export interface FriendEntry {
  uid: string;
  username: string;
  addedAt: { toMillis(): number };
}

// ── Chat ─────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  uid: string;
  username: string;
  text: string;
  timestamp: number;
  icon?: string;
}

// ── Presence ─────────────────────────────────────────────

export interface PresenceEntry {
  online: boolean;
  ts: number;
}

// ── Game State Machines ─────────────────────────────────

export type GameState = 'menu' | 'countdown' | 'playing' | 'paused' | 'gameover' | 'replay' | 'transition' | 'waitingOnline';

export type KillcamPhase = 'none' | 'slowmo' | 'orbit' | 'spectating';

// ── Shared Game Interfaces ──────────────────────────────

export interface KillcamData {
  roundResult: string;
  playerWonSeries: boolean;
  anyAiWonSeries: boolean;
}

export interface GameStats {
  wins: number;
  losses: number;
  draws: number;
  bestStreak: number;
  totalTime: number;
  matchCount: number;
}

export interface FreeCamInput {
  fast?: boolean;
  forward?: boolean;
  backward?: boolean;
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
  lookX?: number;
  lookY?: number;
  dpadLookX?: number;
  dpadLookY?: number;
  zoomDelta?: number;
}

export interface ColorMap {
  [key: string]: ColorEntry;
}

export interface PrebuiltResultState {
  resultText: string;
  resultColor: string;
  seriesHTML: string | null;
  seriesLabelHTML: string;
  continueText: string;
  showStreak: boolean;
  streakNum: string;
  showStreakEnded: boolean;
  statsJSON: string;
  matchSelectorVisible: boolean;
  matchSelectorLabel: string;
  durationText: string;
  audioCall: 'victory' | 'defeat' | 'draw';
  playGameOver: boolean;
  playWinScreen: boolean;
}

// ── Vehicle Audio ───────────────────────────────────────

export interface Keyframe {
  at: number;
  value: number;
}

export interface SweepConfig {
  idleSample: string;
  sweepSample: string;
  idleFadeEnd: number;
  sweepFadeStart: number;
  sweepPositionCurve: Keyframe[];
  playbackRateRange: [number, number];
  noiseCurve: Keyframe[];
  filterCurve: Keyframe[];
  boostQCurve: Keyframe[];
  /** LP filter curve for the engine signal path (separate from noise filterCurve). */
  engineFilterCurve?: Keyframe[];
  /** Speed-dependent master volume multiplier (default: flat 1.0). */
  volumeCurve?: Keyframe[];
}

export interface RpmBandSample {
  bandName: string;
  onSample: string | null;
  offSample: string | null;
  loopSample: string;
}

export interface RpmBandConfig {
  bandBoundaries: number[];
  bandSamples: RpmBandSample[];
  crossfadeWidth: number;
  windSamples: string[];
  windBoundaries: number[];
  windGainCurve: Keyframe[];
  aggroOnSample: string;
  aggroOffSample: string;
  aggroFadeIn: number;
  aggroFadeOut: number;
  playbackRateRange: [number, number];
  filterCurve: Keyframe[];
}

export interface ProceduralConfig {
  basePitchIdle: number;
  basePitchScale: number;
  lpFreqIdle: number;
  lpFreqScale: number;
  boostQ: number;
  idleQ: number;
  masterGainIdle: number;
  masterGainScale: number;
  noiseGainIdle: number;
  noiseGainScale: number;
  noiseBpFreqIdle: number;
  noiseBpFreqScale: number;
  harmonicGainIdle: number;
  harmonicGainScale: number;
  smoothing: number;
}

export interface PassByConfig {
  slowSamples: string[];
  mediumSamples: string[];
  fastSamples: string[];
  speedThresholds: [number, number];
  triggerRange: number;
  cooldown: number;
}

export interface VehicleAudioProfile {
  vehicleType: VehicleType;
  strategy: 'sweep' | 'rpm-band' | 'procedural';
  startup: string;
  shutdown: string;
  sweepConfig?: SweepConfig;
  rpmBandConfig?: RpmBandConfig;
  proceduralConfig?: ProceduralConfig;
  passByConfig?: PassByConfig;
  proceduralLayer?: {
    noiseCurve: Keyframe[];
    filterCurve: Keyframe[];
    boostQCurve: Keyframe[];
  };
}

// ── Online Match Lifecycle ────────────────────────────────
import type { SpawnPosition, OnlineMatchState, VehicleType, LobbyAi, MapType } from './types/index';
import type { LockstepManager } from './core/lockstepManager';
import type { DelayAdvisor } from './core/inputBuffer';
import { NetcodeSession } from './netcode';
import { getSpawnPositions } from './net/spawns';
import { rtdb, functions } from './firebase';
import { ref, set } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { net } from './netLog';
import type { TransportKind } from './net/matchTransport';
import {
  startOnlineMatch,
  acceptOnlineMatch,
  setupOnlineMatchTransport,
  writeOnlineMatchReady,
} from './net/onlineMatchStart';
import {
  setupNextRound,
  setupRematch,
  setupOppRoundEndListener,
  showRoundResult,
} from './net/onlineMatchRounds';

interface MatchInfo {
  matchId: string;
  opponents: Array<{ uid: string; name: string; color: string | number; vehicle?: VehicleType; mapVote?: MapType | null }>;
  seed?: number;
  myMapVote?: MapType | null;
}

interface GameRef {
  matchTime: number;
  _lockstep: LockstepManager | null;
  _delayAdvisor: DelayAdvisor;
}

interface OpponentReadyData { readyCount: number; totalOpponents: number; readyNames: string[]; }
// Exported so helper modules share the same callback shape without re-declaring it.
export type StateChangeCallback =
  (event: string, data?: import('./types/index').RoundResult | number | OpponentReadyData) => void;

export class OnlineMatch {
  // ── Truth Hierarchy ────────────────────────────────────────
  // LOCKSTEP MODE: Deterministic sim state is the sole source of truth
  //   for human deaths and round results. Firebase death events and
  //   roundEnd writes are bookkeeping/diagnostics only — they never
  //   decide correctness.
  // STATE-STREAM MODE: Networked death reports and roundEnd confirmations
  //   drive outcome. Grace windows and majority vote handle timing skew.
  // DISCONNECT / FORFEIT: Separate path independent of gameplay mode.
  //   Handled by heartbeat timeout and Cloud Function validation.

  matchId: string;
  myUid: string;
  opponents: Array<{ uid: string; name: string; color: string | number; vehicle?: VehicleType; mapVote?: MapType | null }>;
  allPlayerUids: string[];
  seed: number;
  /** Local player's committed map pick, captured at queue/lobby entry. Null when no preference. */
  myMapVote: MapType | null;
  game: GameRef;
  netcode: NetcodeSession;
  round: number;
  scores: Record<string, number>;
  seriesLength: number;
  state: OnlineMatchState;
  onStateChange: StateChangeCallback | null;
  /** Set by lobby matches — the lobby ID and role for return-to-lobby flow. */
  lobbyId: string | null;
  lobbyRole: 'host' | 'guest' | null;
  /** AI bots from the lobby — both clients read this to spawn deterministic AIs. */
  lobbyAis: Record<string, LobbyAi> | null;

  // ── Internal state (underscore prefix = "don't touch from outside the class
  //    or the net/onlineMatch* helpers"). These are accessed by the extracted
  //    helper modules in src/net/onlineMatch{Start,Rounds}.ts. They were
  //    previously `private`; the access level was relaxed purely to enable
  //    splitting the file — no test touches these fields on the instance.
  _nextRoundTimer: ReturnType<typeof setInterval> | null;
  _deathsThisRound: Set<string>;
  _countdownStarted: boolean;
  _listeners: Array<() => void>;
  _disconnectCheckInterval: ReturnType<typeof setInterval> | null;
  _roundEndProcessed: boolean;
  _roundEndTimeout: ReturnType<typeof setTimeout> | null;
  _oppRoundEndTimeout: ReturnType<typeof setTimeout> | null;
  _roundEndDebounce: ReturnType<typeof setTimeout> | null;
  _pendingWinner: string | null;
  _readyWritten: boolean;
  _loadedTimeout: ReturnType<typeof setTimeout> | null;
  /** Grace window (ms) for simultaneous death detection. Adjustable based on RTT. */
  deathGraceMs: number;
  /** Generation counter — incremented on each new round/rematch to ignore stale events. */
  _roundGen: number;
  /** Set when return-to-lobby is signalled — prevents next-round auto-start race. */
  _returningToLobby: boolean;
  /** Total entity count (humans + AIs) for free-for-all round-end detection. */
  totalEntityCount: number;
  /** Number of AI deaths this round (tracked locally, deterministic on both clients). */
  _aiDeathsThisRound: number;
  /** Tracks UIDs of players who disconnected — grace period before confirmed forfeit. */
  _forfeitedUids: Map<string, { at: number; confirmed: boolean }>;
  /** Stalemate timer — forces draw after 60s of no deaths. */
  private _stalemateTimer: ReturnType<typeof setTimeout> | null;
  /** Peer death reports received via netcode — separate from authoritative _deathsThisRound
   *  so lockstep bookkeeping never suppresses the deterministic sim path. */
  _peerDeathReports: Set<string>;
  /** Buffered remote roundEnd claims that arrived before local _pendingWinner was set.
   *  Rechecked when local resolution completes, so early races don't lose diagnostics. */
  _bufferedRemoteRoundEnd: Record<string, { round?: number; winner?: string; ts?: number }> | null;
  /** Count of state-stream fallback activations (oppRoundEnd timeout or roundEnd timeout). */
  _fallbackActivationCount: number;
  // ── Per-round debug stats ─────────────────────────────────
  _roundStartRollbacks: number;
  _roundMaxPredictAhead: number;
  /** Desync count tracked in OnlineMatch (lockstep getter resets on recovery). */
  _roundDesyncCount: number;
  /** Tracked per-round listener unsubs — cleaned up between rounds to prevent accumulation. */
  _perRoundUnsubs: Array<() => void>;

  // ── State Machine ─────────────────────────────────────────
  //
  // Valid state graph (audit P6.3):
  //
  //   pending ──────────────────────────────────────────────────────┐
  //     │                                                           │ (rematch)
  //     └─→ countdown ──→ playing ──→ roundOver ──→ finished ──────┘
  //              │            │           │              │
  //              └────────────┴───────────┴──────────────┴──→ disconnected
  //
  // Notes:
  //   - 'pending' is the initial state and also the reset target on rematch.
  //   - Any state can transition to 'disconnected' (opponent leaves at any point).
  //   - 'roundOver' → 'countdown' is NOT a direct edge; it goes via 'pending'
  //     (reset in onAllNextRound before _startCountdown) or stays implicit through
  //     the cleanup reset (_roundEndProcessed = false, state = 'pending').
  //   - 'finished' → 'pending' only on rematch (onAllRematch handler).

  /** All valid state transitions: Map<from, Set<to>>. */
  private static readonly _VALID_TRANSITIONS: ReadonlyMap<OnlineMatchState, ReadonlySet<OnlineMatchState>> = new Map([
    ['pending',      new Set<OnlineMatchState>(['countdown', 'disconnected'])],
    ['countdown',    new Set<OnlineMatchState>(['playing', 'disconnected'])],
    ['playing',      new Set<OnlineMatchState>(['roundOver', 'disconnected'])],
    ['roundOver',    new Set<OnlineMatchState>(['finished', 'pending', 'countdown', 'disconnected'])],
    ['finished',     new Set<OnlineMatchState>(['pending', 'disconnected'])],
    ['disconnected', new Set<OnlineMatchState>()],
  ]);

  /**
   * Validates and performs a state transition.
   *
   * In DEV mode, logs a warning if the transition is not in the valid graph.
   * Invalid transitions PROCEED regardless — this is a safety net for diagnostics,
   * not a blocker. Blocking would risk breaking live games on edge cases.
   */
  _transition(newState: OnlineMatchState): void {
    const validNext = OnlineMatch._VALID_TRANSITIONS.get(this.state);
    if (import.meta.env.DEV && validNext && !validNext.has(newState)) {
      console.warn(`[OnlineMatch] invalid state transition: '${this.state}' → '${newState}' (match=${this.matchId})`);
    }
    this.state = newState;
  }

  // ── Backward-compat getters — return opponents[0] only. Use opponents[] for N-player. ──
  /** @deprecated Use opponents[] for N-player support. */
  get opponentUid(): string { return this.opponents[0]?.uid || ''; }
  /** @deprecated Use opponents[] for N-player support. */
  get opponentName(): string { return this.opponents[0]?.name || ''; }
  /** @deprecated Use opponents[] for N-player support. */
  get opponentColor(): string | number { return this.opponents[0]?.color || 'cyan'; }
  /** @deprecated Use opponents[] for N-player support. */
  get opponentVehicle(): VehicleType { return (this.opponents[0]?.vehicle || 'bike') as VehicleType; }

  constructor(matchInfo: MatchInfo, myUid: string, game: GameRef) {
    this.matchId = matchInfo.matchId;
    this.myUid = myUid;
    this.opponents = matchInfo.opponents;
    this.allPlayerUids = [myUid, ...matchInfo.opponents.map(o => o.uid)];
    this.seed = matchInfo.seed || Math.floor(Math.random() * 2147483647);
    this.myMapVote = matchInfo.myMapVote ?? null;
    this.game = game;

    // Initialize NetcodeSession with all player UIDs
    this.netcode = new NetcodeSession(this.matchId, myUid, this.allPlayerUids);
    this.round = 1;
    this.scores = {};
    for (const uid of this.allPlayerUids) this.scores[uid] = 0;
    this.seriesLength = 3;
    this.state = 'pending';

    this._nextRoundTimer = null;
    this._deathsThisRound = new Set();
    this._countdownStarted = false;
    this._listeners = [];
    this._disconnectCheckInterval = null;
    this._roundEndProcessed = false; // prevent double processing of round end
    this._roundEndTimeout = null; // fallback timeout for missing death events
    this._oppRoundEndTimeout = null; // fallback: trust opponent's roundEnd if we missed the death
    this._roundEndDebounce = null;
    this._pendingWinner = null;
    this._readyWritten = false;
    this._loadedTimeout = null;
    this.deathGraceMs = 150; // default 150ms — set higher for high-RTT connections
    this._roundGen = 0;
    this._returningToLobby = false;
    this._forfeitedUids = new Map();
    this._stalemateTimer = null;
    this._peerDeathReports = new Set();
    this._bufferedRemoteRoundEnd = null;
    this._fallbackActivationCount = 0;
    this._roundStartRollbacks = 0;
    this._roundMaxPredictAhead = 0;
    this._roundDesyncCount = 0;
    this._perRoundUnsubs = [];

    this.onStateChange = null;
    this.lobbyId = null;
    this.lobbyRole = null;
    this.lobbyAis = null;
    this.totalEntityCount = this.allPlayerUids.length; // default: human player count
    this._aiDeathsThisRound = 0;
  }

  start(): void {
    startOnlineMatch(this);
  }

  /** Host signals all players to return to the lobby. */
  signalReturnToLobby(): void {
    // Immediately kill the next-round timer so the countdown can't fire
    // before the Firebase round-trip delivers the signal back to us.
    this._returningToLobby = true;
    if (this._nextRoundTimer) {
      clearInterval(this._nextRoundTimer);
      this._nextRoundTimer = null;
    }
    set(ref(rtdb, `matches/${this.matchId}/returnToLobby`), true);
  }

  stop(): void {
    this.netcode.stop();
    if (this._nextRoundTimer) clearInterval(this._nextRoundTimer);
    if (this._disconnectCheckInterval) clearInterval(this._disconnectCheckInterval);
    if (this._roundEndTimeout) clearTimeout(this._roundEndTimeout);
    if (this._roundEndDebounce) clearTimeout(this._roundEndDebounce);
    if (this._oppRoundEndTimeout) clearTimeout(this._oppRoundEndTimeout);
    if (this._loadedTimeout) clearTimeout(this._loadedTimeout);
    this._clearStalemateTimer();
    this._disconnectCheckInterval = null;
    this._roundEndTimeout = null;
    this._roundEndDebounce = null;
    this._oppRoundEndTimeout = null;
    this._loadedTimeout = null;
    for (const unsub of this._listeners) unsub();
    this._listeners = [];
    for (const unsub of this._perRoundUnsubs) unsub();
    this._perRoundUnsubs = [];
    // Match data is NOT deleted here — the cleanupStaleMatches Cloud Function
    // handles removal (24h TTL, runs every 6 hours).  Client-side deletion
    // created a race: the cleanup owner could delete /meta before the other
    // player finished writing, causing cascading permission_denied errors and
    // a false "opponent disconnected" screen.
  }

  /** Claim forfeit via server-validated Cloud Function (F6). */
  async claimForfeit(): Promise<boolean> {
    try {
      const fn = httpsCallable(functions, 'claimForfeit');
      const result = await fn({ matchId: this.matchId });
      const data = result.data as { success?: boolean };
      if (data.success) {
        net.info(`forfeit claimed for match ${this.matchId}`);
      }
      return !!data.success;
    } catch (err) {
      net.error('forfeit claim failed:', err);
      return false;
    }
  }

  /** Retry a Firebase write with exponential backoff. Bails if match ends. */
  async _retryWrite(fn: () => Promise<void>, maxRetries: number, baseDelay: number): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await fn();
        return;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        const s = this.state as string;
        if (s === 'finished' || s === 'disconnected') throw err;
        const delay = baseDelay * Math.pow(2, attempt);
        net.warn(`retryWrite attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        const s2 = this.state as string;
        if (s2 === 'finished' || s2 === 'disconnected') throw err;
      }
    }
  }

  _handleOpponentDisconnect(): void {
    if (this.state === 'finished' || this.state === 'disconnected') return;
    net.warn(`opponent disconnect — state was '${this.state}', forfeited=[${[...this._forfeitedUids.keys()].join(',')}]`);
    this._transition('disconnected');
    if (this._nextRoundTimer) { clearInterval(this._nextRoundTimer); this._nextRoundTimer = null; }
    if (this.onStateChange) this.onStateChange('opponentDisconnected');
  }

  // Called by game.ts when local player dies — reports own death via netcode
  reportLocalDeath(diedUid: string): void {
    if (this._deathsThisRound.has(diedUid)) return;
    net.log(`reportLocalDeath uid=${diedUid} isSelf=${diedUid === this.myUid}`);
    this._deathsThisRound.add(diedUid);

    // Anticheat: only send death reports for own player
    // Opponent's death is detected via their alive:false state sync or their own report
    if (diedUid === this.myUid) {
      this.netcode.reportDeath(diedUid, this.game.matchTime).catch(() => {});
    }

    this._evaluateRoundEnd();
  }

  // Called by game.ts when opponent death is detected locally via collision
  // Does NOT send via netcode — we wait for opponent's own report or alive:false
  registerLocalOpponentDeath(opponentUid: string): void {
    if (this._deathsThisRound.has(opponentUid)) return;
    this._deathsThisRound.add(opponentUid);
    this._evaluateRoundEnd();
  }

  /** Update death grace window from measured RTT. Call periodically during gameplay. */
  updateGraceFromRtt(): void {
    const rtt = this.netcode.estimatedRttMs;
    // Grace = RTT + 50ms safety margin, clamped to [100, 500]
    this.deathGraceMs = Math.max(100, Math.min(500, rtt + 50));
  }

  /** Sample peak predict-ahead from lockstep. Call ~once per second during gameplay. */
  samplePredictAhead(): void {
    const ahead = this.game._lockstep?.predictAhead ?? 0;
    if (ahead > this._roundMaxPredictAhead) this._roundMaxPredictAhead = ahead;
  }

  /** Increment desync counter (called from game.ts onDesync callback). */
  recordDesync(): void { this._roundDesyncCount++; }

  // Evaluate whether the round should end based on known deaths
  /** Called by game.ts when a lobby AI bot dies (deterministic — both clients call this identically). */
  registerAiDeath(): void {
    if (this._roundEndProcessed) return;
    this._aiDeathsThisRound++;
    this._evaluateRoundEnd();
  }

  _evaluateRoundEnd(): void {
    if (this._roundEndProcessed) return;

    const humanUids = this.allPlayerUids;
    const humanDeaths: number = humanUids.filter(uid => this._deathsThisRound.has(uid)).length;
    const totalDeaths: number = humanDeaths + this._aiDeathsThisRound;
    const aliveCount: number = this.totalEntityCount - totalDeaths;

    // Reset stalemate timer on every death — restart 60s window
    this._startStalemateWatch();

    // Free-for-all: round ends when at most 1 entity remains alive
    if (aliveCount > 1) return; // still entities competing

    // All humans dead — draw regardless of AI status
    if (humanDeaths === humanUids.length) {
      this._commitRoundEnd('draw');
      return;
    }

    // At least one human dead — determine winner
    if (humanDeaths > 0) {
      // Lockstep: both clients detect death on the same tick deterministically.
      // Use setTimeout(0) instead of the full grace window — just enough to let all
      // same-tick death callbacks fire before evaluating (onDeath fires sequentially,
      // so a head-on collision registers deaths one at a time within the same loop).
      const debounceMs = this.useLockstep ? 0 : this.deathGraceMs;
      if (this._roundEndDebounce) return; // already deferred
      this._roundEndDebounce = setTimeout(() => {
        this._roundEndDebounce = null;
        if (this._roundEndProcessed) return;
        const deadNow = humanUids.filter(uid => this._deathsThisRound.has(uid));
        if (deadNow.length === humanUids.length) {
          this._commitRoundEnd('draw');
        } else {
          const survivor = humanUids.find(uid => !this._deathsThisRound.has(uid));
          this._commitRoundEnd(survivor || 'draw');
        }
      }, debounceMs);
      return;
    }

    // Only AIs died, all humans alive — round continues (shouldn't reach here if aliveCount <= 1 and all humans alive)
  }

  /** Start or restart the 60s stalemate timer. Both clients fire at the same time
   *  because the timer resets from the same events (round start, death). */
  private _startStalemateWatch(): void {
    this._clearStalemateTimer();
    this._stalemateTimer = setTimeout(() => {
      if (this.state !== 'playing' || this._roundEndProcessed) return;
      const humanDeaths = this.allPlayerUids.filter(uid => this._deathsThisRound.has(uid)).length;
      const totalDeaths = humanDeaths + this._aiDeathsThisRound;
      const aliveCount = this.totalEntityCount - totalDeaths;
      if (aliveCount >= 2) {
        net.info(`stalemate timer expired — forcing draw (aliveCount=${aliveCount})`);
        this._commitRoundEnd('draw');
      }
    }, 60_000);
  }

  private _clearStalemateTimer(): void {
    if (this._stalemateTimer) { clearTimeout(this._stalemateTimer); this._stalemateTimer = null; }
  }

  private _commitRoundEnd(winner: string): void {
    if (this._roundEndProcessed) return;
    if (this._roundEndDebounce) { clearTimeout(this._roundEndDebounce); this._roundEndDebounce = null; }
    this._clearStalemateTimer();
    const stateDigest = this.game._lockstep?.getStateDigest();
    net.log(`commitRoundEnd R${this.round} winner=${winner} deaths=[${[...this._deathsThisRound].join(',')}] aiDeaths=${this._aiDeathsThisRound} lockstep=${this.useLockstep}`);

    this._transition('roundOver');
    this._pendingWinner = winner;

    // Recheck buffered remote roundEnd claims that arrived before local resolution
    if (this._bufferedRemoteRoundEnd) {
      const val = this._bufferedRemoteRoundEnd;
      this._bufferedRemoteRoundEnd = null;
      for (const uid of this.allPlayerUids) {
        const remoteWinner = val[uid]?.winner;
        if (remoteWinner && remoteWinner !== winner) {
          net.warn(`lockstep integrity (deferred): ${uid} claims winner='${remoteWinner}' but local sim determined '${winner}'`);
        }
      }
    }

    // In lockstep, both clients determine the winner deterministically on the same tick.
    // Show result immediately — don't wait for Firebase roundEnd sync.
    if (this.useLockstep) {
      this._roundEndProcessed = true;
      this._updateScoresFromWinner();
      showRoundResult(this);
      // Still write roundEnd for the record, but don't gate the UI on it
      this.netcode.writeRoundEnd(this.round, winner, stateDigest).catch(() => {});
      return;
    }

    // State-streaming: write roundEnd and wait for opponent confirmation
    this.netcode.writeRoundEnd(this.round, winner, stateDigest).catch(() => {});

    // Set a fallback timeout — if opponent never confirms roundEnd, proceed anyway
    if (!this._roundEndTimeout) {
      this._roundEndTimeout = setTimeout(() => {
        if (!this._roundEndProcessed) {
          this._fallbackActivationCount++;
          net.warn(`state-stream fallback: proceeding without opponent confirmation after 3s (activation #${this._fallbackActivationCount})`);
          this._roundEndProcessed = true;
          this._updateScoresFromWinner();
          showRoundResult(this);
        }
      }, 3000);
    }
  }

  // Update scores from the reconciled winner and persist to Firebase
  _updateScoresFromWinner(): void {
    // Guard: don't update scores if we're in an invalid state for round end
    if (this.state === 'countdown' || this.state === 'playing' || this.state === 'pending') return;
    const winner = this._pendingWinner || 'draw';
    if (winner !== 'draw' && this.scores[winner] !== undefined) {
      this.scores[winner]++;
    }
    set(ref(rtdb, `matches/${this.matchId}/scores`), { ...this.scores }).catch(() => {});
  }

  // ── Accept + Sync Flow ─────────────────────────────────

  /** Whether both clients support lockstep (negotiated during accept). */
  useLockstep = false;

  /** Selected transport kind for this match (for debug/observability). */
  transportKind: TransportKind = 'firebase';

  async accept(): Promise<void> {
    await acceptOnlineMatch(this);
  }

  /** Internal helper exposed for the start helper module. */
  _setupTransport(): Promise<void> {
    return setupOnlineMatchTransport(this);
  }

  _writeReady(): Promise<void> {
    return writeOnlineMatchReady(this);
  }

  _startCountdown(): void {
    if (this.state === 'countdown' || this.state === 'playing') return;
    net.info(`countdown R${this.round} seed=${this.seed} entities=${this.totalEntityCount} lockstep=${this.useLockstep}`);
    this._transition('countdown');
    this._deathsThisRound = new Set();
    this._peerDeathReports = new Set();
    this._bufferedRemoteRoundEnd = null;
    this._aiDeathsThisRound = 0;
    this._roundEndProcessed = false;
    this._pendingWinner = null;
    this._countdownStarted = true;
    if (this._oppRoundEndTimeout) { clearTimeout(this._oppRoundEndTimeout); this._oppRoundEndTimeout = null; }
    if (this._roundEndTimeout) { clearTimeout(this._roundEndTimeout); this._roundEndTimeout = null; }
    if (this._roundEndDebounce) { clearTimeout(this._roundEndDebounce); this._roundEndDebounce = null; }
    if (this.onStateChange) this.onStateChange('countdown');
  }

  startPlaying(): void {
    net.info(`playing R${this.round} rtt=${this.netcode.estimatedRttMs}ms grace=${this.deathGraceMs}ms`);
    this._transition('playing');
    this._startStalemateWatch();
    if (this.onStateChange) this.onStateChange('playing');
  }

  // Signal that local scene is loaded and ready — wait for opponent before countdown
  async signalLoaded(): Promise<void> {
    // Set up listener FIRST so we never miss the opponent's signal
    let loaded: boolean = false;
    this._loadedTimeout = setTimeout(() => {
      if (!loaded) {
        // Opponent never loaded — treat as disconnect
        if (this.onStateChange) this.onStateChange('opponentDisconnected');
      }
    }, 15000);
    this.netcode.onAllLoaded((delayMs: number) => {
      loaded = true;
      clearTimeout(this._loadedTimeout!);
      // Delay countdown start so both clients begin at the same server-clock time
      setTimeout(() => {
        if (this.onStateChange) this.onStateChange('bothLoaded');
      }, delayMs);
    });
    // Then write our loaded flag — if this fails, the error propagates to caller for retry
    await this.netcode.writeLoaded();
    net.info('[barrier] writeLoaded round=' + this.netcode.currentRound);
  }

  async clickNextRound(): Promise<void> {
    await this._retryWrite(() => this.netcode.writeNextRound(), 2, 800);
  }

  /** @internal re-exposed for the rounds helper which must set up the next round's
   *  countdown after cleanup. Not part of the public API. */
  _setupNextRound(): void {
    setupNextRound(this);
  }

  _setupRematch(): void {
    setupRematch(this);
  }

  _setupOppRoundEndListener(): void {
    setupOppRoundEndListener(this);
  }

  async requestRematch(): Promise<void> {
    await this._retryWrite(() => this.netcode.writeRematch(), 2, 800);
  }

  getSpawns(): SpawnPosition[] {
    const humanCount = this.allPlayerUids.length;
    const aiCount = this.lobbyAis ? Object.keys(this.lobbyAis).length : 0;
    const totalEntities = humanCount + aiCount;
    return getSpawnPositions(this.seed, totalEntities);
  }

  _deterministicSeed(round: number): number {
    let hash: number = 0;
    const str: string = this.matchId + ':' + round;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) || 1;
  }
}

// Used only by the class-internal _showRoundResult (now removed); re-exported
// so helper modules can import a single shared shape without cycles.
// Kept as internal utility in onlineMatchRounds.ts.

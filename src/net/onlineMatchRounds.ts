// ── Online Match Round Lifecycle Helpers ─────────────────────
// Extracted from onlineMatch.ts to keep that file under the LOC budget.
// These helpers act on an OnlineMatch instance — access state via `m.*`.
// They intentionally live in a sibling module rather than on the class
// so the class file stays short; behavior is unchanged.
import type { OnlineMatch } from '../onlineMatch';
import type { RoundResult } from '../types/index';
import { classifyHealth } from '../core/lockstepManager';
import { rtdb } from '../firebase';
import { ref, set, onValue, get, type DataSnapshot } from 'firebase/database';
import { net } from '../netLog';

interface RoundEndEntry {
  round?: number;
  winner?: string;
  ts?: number;
}

/** Print a structured netcode diagnostic summary to the console at round end. */
export function logRoundStats(m: OnlineMatch, winner: string, seriesOver: boolean): void {
  const ls = m.game._lockstep;
  const rtt = m.netcode.estimatedRttMs;
  const inputDelay = ls?.inputBuffer.inputDelay ?? 0;
  const finalTick = ls?.tick ?? 0;
  const duration = m.game.matchTime;
  const t = ls?.getTelemetry();

  const rollbacks = t ? t.rollbackCount - m._roundStartRollbacks : 0;
  const desyncs = m._roundDesyncCount;

  const winLabel = winner === m.myUid ? 'WIN' : winner === 'draw' ? 'DRAW' : 'LOSS';
  const roundLabel = `R${m.round}${seriesOver ? ' (series end)' : ''}`;

  const scoreStr = m.allPlayerUids
    .map(uid => `${uid.slice(0, 6)}: ${m.scores[uid]}`)
    .join(' | ');

  net.group(`${roundLabel} — ${winLabel} — ${duration.toFixed(1)}s`);
  net.log(`  scores      : ${scoreStr}`);
  net.log(`  rtt         : ${rtt} ms`);
  net.log(`  grace       : ${m.deathGraceMs} ms`);
  net.log(`  input delay : ${inputDelay} ticks`);
  net.log(`  final tick  : ${finalTick}`);
  net.log(`  desyncs     : ${desyncs}`);
  net.log(`  rollbacks   : ${rollbacks}`);
  if (t) {
    const depthStr = Object.entries(t.rollbackDepths)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([d, n]) => `${d}t:${n}`)
      .join(' ');
    net.log(`  rb depths   : ${depthStr || 'none'} (max=${t.rollbackMaxDepth} avg=${t.rollbackAvgDepth.toFixed(1)})`);
    net.log(`  predict peak: ${t.peakPredictAhead} ticks`);
    net.log(`  late inputs : ${t.lateInputCount}`);
    net.log(`  recoveries  : ${t.recoveryCount}`);
    net.log(`  stalls      : ${t.stallCount}`);
  }
  if (m._fallbackActivationCount > 0) {
    net.log(`  fallbacks   : ${m._fallbackActivationCount} (state-stream timeout activations)`);
  }
  if (m._peerDeathReports.size > 0) {
    net.log(`  peer deaths : ${m._peerDeathReports.size} (bookkeeping only, not authoritative)`);
  }
  // ── Health classification ──
  // Recovery and fallback are resilience tools, not proof of health.
  // Classify and surface instability so it's never silently counted as success.
  if (t) {
    const health = classifyHealth(t);
    const label = health.level === 'healthy' ? '✓ healthy'
      : health.level === 'degraded' ? '⚠ DEGRADED'
      : '✖ UNSTABLE';
    net.log(`  health      : ${label}`);
    for (const reason of health.reasons) {
      net.warn(`    → ${reason}`);
    }
  }
  if (rollbacks > 20) net.warn(`  ⚠ high rollback count (${rollbacks}) — remote input arriving late`);
  net.groupEnd();

  // Feed delivery telemetry into delay advisor for next-round tuning
  if (t && finalTick > 0) {
    m.game._delayAdvisor.recordRound({
      lateInputCount: t.lateInputCount,
      totalTicks: finalTick,
      peakPredictAhead: t.peakPredictAhead,
      stallCount: t.stallCount,
      previousDelay: inputDelay,
    });
  }
}

/** Show round result UI and either set up next round or rematch. */
export function showRoundResult(m: OnlineMatch): void {
  if (m.state === 'countdown' || m.state === 'playing' || m.state === 'pending') return;
  const winner: string = m._pendingWinner || 'draw';

  const winsNeeded: number = Math.ceil(m.seriesLength / 2);
  const seriesOver: boolean = Object.values(m.scores).some(s => s >= winsNeeded);

  logRoundStats(m, winner, seriesOver);

  if (m.onStateChange) {
    m.onStateChange('roundOver', {
      winner,
      scores: { ...m.scores },
      round: m.round,
      seriesOver,
      iWon: winner === m.myUid,
      isDraw: winner === 'draw',
    } as RoundResult);
  }

  if (!seriesOver) {
    setupNextRound(m);
  } else {
    m._transition('finished');
    setupRematch(m);
  }
}

/** Set up per-round RTDB listener for opponent roundEnd fallback.
 *  Pushed to _perRoundUnsubs so it is torn down between rounds / on rematch. */
export function setupOppRoundEndListener(m: OnlineMatch): void {
  const roundEndRef = ref(rtdb, `matches/${m.matchId}/roundEnd`);
  const oppRoundEndUnsub = onValue(roundEndRef, (snap: DataSnapshot) => {
    const val = snap.val();
    if (!val) return;
    if (m.useLockstep) return; // Lockstep: sim is authoritative — do not trust peer claims
    if (m._roundEndProcessed) return;
    if (m.state !== 'playing' && m.state !== 'roundOver') return;

    // Collect all opponent entries that have a winner claim
    const oppEntries: Array<{ uid: string; winner: string }> = [];
    for (const opp of m.opponents) {
      const entry = val[opp.uid];
      if (entry && entry.winner !== undefined) {
        oppEntries.push({ uid: opp.uid, winner: entry.winner });
      }
    }
    if (oppEntries.length === 0) return;

    // For N-player (3+), require majority of opponents to have written before trusting
    const is1v1 = m.opponents.length === 1;
    if (!is1v1 && oppEntries.length < Math.ceil(m.opponents.length / 2)) return;

    // Opponent(s) confirmed round end — give ourselves 2s to also detect it, then force-proceed
    if (!m._oppRoundEndTimeout) {
      // Determine winner by majority vote across opponent claims
      const votes: Record<string, number> = {};
      for (const entry of oppEntries) {
        votes[entry.winner] = (votes[entry.winner] || 0) + 1;
      }
      const sorted = Object.entries(votes).sort((a, b) =>
        b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1,
      );
      const fallbackWinner = sorted[0][0];

      m._oppRoundEndTimeout = setTimeout(() => {
        m._oppRoundEndTimeout = null;
        if (m._roundEndProcessed) return;
        m._fallbackActivationCount++;
        net.warn(`state-stream fallback: trusting opponent roundEnd after 2s timeout (activation #${m._fallbackActivationCount})`);
        // Validate the winner is a known UID or 'draw'
        if (fallbackWinner === 'draw' || m.allPlayerUids.includes(fallbackWinner)) {
          m._pendingWinner = fallbackWinner;
        } else {
          m._pendingWinner = 'draw';
        }
        m._transition('roundOver');
        // Write our own roundEnd to unblock onAllRoundEnd for opponents
        const fallbackDigest = m.game._lockstep?.getStateDigest();
        m.netcode.writeRoundEnd(m.round, m._pendingWinner!, fallbackDigest).catch(() => {});
        m._roundEndProcessed = true;
        if (m._roundEndTimeout) { clearTimeout(m._roundEndTimeout); m._roundEndTimeout = null; }
        if (m._roundEndDebounce) { clearTimeout(m._roundEndDebounce); m._roundEndDebounce = null; }
        m._updateScoresFromWinner();
        showRoundResult(m);
      }, 2000);
    }
  });
  m._perRoundUnsubs.push(oppRoundEndUnsub);
}

/** Start the countdown + per-round listeners for the next round. */
export function setupNextRound(m: OnlineMatch): void {
  net.info(`setupNextRound R${m.round}→R${m.round + 1} scores=${JSON.stringify(m.scores)}`);
  // Guard: clear any pre-existing timer to prevent interval leak
  if (m._nextRoundTimer) {
    clearInterval(m._nextRoundTimer);
    m._nextRoundTimer = null;
  }
  let countdown: number = 10;
  const intervalId = setInterval(() => {
    countdown--;
    if (m.onStateChange) m.onStateChange('nextRoundTimer', countdown);
    if (countdown <= 0) {
      clearInterval(intervalId);
      m._nextRoundTimer = null;
      m._retryWrite(() => m.netcode.writeNextRound(), 3, 1000).catch((err) => {
        net.warn('writeNextRound failed after retries:', err);
        m._handleOpponentDisconnect();
      });
    }
  }, 1000);
  m._nextRoundTimer = intervalId;

  // Clean up per-round listeners from previous round to prevent accumulation
  for (const unsub of m._perRoundUnsubs) unsub();
  m._perRoundUnsubs = [];

  // Listen for opponents' nextRound flag to show ready status (fires for each new ready opponent)
  const nrRef = ref(rtdb, `matches/${m.matchId}/nextRound`);
  let lastReadyCount = 0;
  const oppReadyUnsub = onValue(nrRef, (snap: DataSnapshot) => {
    const val = snap.val();
    if (!val) return;
    const readyOpponents = m.opponents.filter(o => val[o.uid]);
    if (readyOpponents.length > lastReadyCount) {
      lastReadyCount = readyOpponents.length;
      if (m.onStateChange) m.onStateChange('opponentReady', {
        readyCount: readyOpponents.length,
        totalOpponents: m.opponents.length,
        readyNames: readyOpponents.map(o => o.name),
      });
    }
  });
  m._perRoundUnsubs.push(oppReadyUnsub);

  m.netcode.onAllNextRound(async (delayMs: number) => {
    if (m._returningToLobby) return; // host signalled return-to-lobby — abort
    await advanceToNextRound(m, delayMs);
  });
}

/** Reset state and schedule the next round's countdown after cleanup. */
async function advanceToNextRound(m: OnlineMatch, delayMs: number): Promise<void> {
  if (m._nextRoundTimer) clearInterval(m._nextRoundTimer);
  m._nextRoundTimer = null;
  m.round++;
  m._roundGen++;
  m.seed = m._deterministicSeed(m.round);
  m._countdownStarted = false;
  m._deathsThisRound = new Set();
  m._peerDeathReports = new Set();
  m._bufferedRemoteRoundEnd = null;
  m._aiDeathsThisRound = 0;
  m._forfeitedUids = new Map();
  m._pendingWinner = null;
  // Keep _roundEndProcessed true during async cleanup to block stale callbacks
  m.netcode.resetForNewRound(m.round);
  // New LockstepManager is created each round (rollbackCount resets to 0)
  m._roundStartRollbacks = 0;
  m._roundMaxPredictAhead = 0;
  m._roundDesyncCount = 0;
  const cleanupStart: number = Date.now();
  const cleanupResults = await Promise.allSettled([
    set(ref(rtdb, `matches/${m.matchId}/ready`), null),
    set(ref(rtdb, `matches/${m.matchId}/roundEnd`), null),
    set(ref(rtdb, `matches/${m.matchId}/nextRound`), null),
    set(ref(rtdb, `matches/${m.matchId}/loaded`), null),
    set(ref(rtdb, `matches/${m.matchId}/inputs`), null),
    set(ref(rtdb, `matches/${m.matchId}/hashes`), null),
    set(ref(rtdb, `matches/${m.matchId}/snapshot`), null),
  ]);
  const anyCleanupFailed = cleanupResults.some(r => r.status === 'rejected');
  if (anyCleanupFailed) {
    // Retry meta check — Firebase might be momentarily unavailable
    let metaExists = false;
    for (let i = 0; i < 2; i++) {
      try {
        const metaSnap = await get(ref(rtdb, `matches/${m.matchId}/meta`));
        metaExists = metaSnap.exists();
        break;
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[match] meta-exists retry failed', e);
        if (i === 0) await new Promise(r => setTimeout(r, 500));
      }
    }
    if (!metaExists) {
      net.warn('Round cleanup failed and meta gone — treating as disconnect');
      m._handleOpponentDisconnect();
      return;
    }
    // Meta still exists but writes failed — proceed anyway (non-fatal)
    net.warn('Round cleanup had failures but meta exists — proceeding');
  }
  // Reset AFTER cleanup — the generation counter (_roundGen) already protects
  // against stale onAllRoundEnd events, but this closes the async gap fully
  m._roundEndProcessed = false;
  // Re-attach per-round oppRoundEnd listener for the new round
  setupOppRoundEndListener(m);
  // Recompute delay: the original delayMs was computed before the cleanup await,
  // so subtract the time spent cleaning up to stay on schedule
  const elapsed: number = Date.now() - cleanupStart;
  const adjustedDelay: number = Math.max(0, delayMs - elapsed);
  setTimeout(() => m._startCountdown(), adjustedDelay);
}

/** Set up rematch listeners after a series ends. */
export function setupRematch(m: OnlineMatch): void {
  net.info(`setupRematch — series complete, scores=${JSON.stringify(m.scores)}`);
  // Clean up per-round listeners from previous round
  for (const unsub of m._perRoundUnsubs) unsub();
  m._perRoundUnsubs = [];

  // Listen for opponents' rematch flag to show ready status (fires for each new ready opponent)
  const rmRef = ref(rtdb, `matches/${m.matchId}/rematch`);
  let lastRematchReadyCount = 0;
  const oppRematchUnsub = onValue(rmRef, (snap: DataSnapshot) => {
    const val = snap.val();
    if (!val) return;
    const readyOpponents = m.opponents.filter(o => val[o.uid]);
    if (readyOpponents.length > lastRematchReadyCount) {
      lastRematchReadyCount = readyOpponents.length;
      if (m.onStateChange) m.onStateChange('opponentReady', {
        readyCount: readyOpponents.length,
        totalOpponents: m.opponents.length,
        readyNames: readyOpponents.map(o => o.name),
      });
    }
  });
  m._perRoundUnsubs.push(oppRematchUnsub);

  m.netcode.onAllRematch(async () => {
    await applyRematchReset(m);
  });
}

/** Reset match state for a fresh series after both players requested rematch. */
async function applyRematchReset(m: OnlineMatch): Promise<void> {
  // Clear event dedup BEFORE deleting Firebase paths to prevent stale events
  // from being re-processed when the events node is set to null
  m.netcode._processedEventKeys.clear();
  m.round = 1;
  m._roundGen++;
  m.scores = {};
  for (const uid of m.allPlayerUids) m.scores[uid] = 0;
  m.game._delayAdvisor.clear(); // fresh series — reset delivery history
  m.seed = m._deterministicSeed(1);
  m._deathsThisRound = new Set();
  m._peerDeathReports = new Set();
  m._bufferedRemoteRoundEnd = null;
  m._fallbackActivationCount = 0;
  m._aiDeathsThisRound = 0;
  m._forfeitedUids = new Map();
  m._countdownStarted = false;
  m._roundEndProcessed = false;
  m._pendingWinner = null;
  m._transition('pending'); // guard: death/roundEnd handlers check state
  m.netcode.resetForNewRound(1);
  m._roundStartRollbacks = 0;
  m._roundMaxPredictAhead = 0;
  m._roundDesyncCount = 0;
  // Clear all match paths — await cleanup to prevent race with signalLoaded
  await Promise.all([
    set(ref(rtdb, `matches/${m.matchId}/events`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/ready`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/roundEnd`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/nextRound`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/rematch`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/loaded`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/inputs`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/hashes`), null).catch(() => {}),
    set(ref(rtdb, `matches/${m.matchId}/snapshot`), null).catch(() => {}),
  ]);
  // Re-attach per-round oppRoundEnd listener for the new series
  setupOppRoundEndListener(m);
  m._startCountdown();
}

// Re-export the RoundEndEntry type for start.ts helpers
export type { RoundEndEntry };

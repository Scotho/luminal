// ── Online Match Start/Setup Helpers ─────────────────────────
// Extracted from onlineMatch.ts to keep that file under the LOC budget.
// These helpers act on an OnlineMatch instance — access state via `m.*`.
// They cover the lifecycle up to the countdown barrier: start → accept →
// transport setup → ready → countdown. Behavior is unchanged; this is
// pure extraction, not a redesign.
import type { OnlineMatch } from '../onlineMatch';
import type { NetcodeDeathEvent, VehicleType } from '../types/index';
import type { TransportCandidate } from '../net/transportNegotiation';
import type { TransportCapabilities } from '../net/protocol';
import { getLocalCapabilities, resolveTransport } from '../net/transportNegotiation';
import { FirebaseMatchTransport } from '../net/firebaseMatchTransport';
import { WebSocketMatchTransport } from '../net/webSocketMatchTransport';
import { setupOppRoundEndListener, showRoundResult, type RoundEndEntry } from './onlineMatchRounds';
import { rtdb } from '../firebase';
import { ref, set, onValue, serverTimestamp, type DataSnapshot } from 'firebase/database';
import { net } from '../netLog';

/** Start the match: kick off netcode, wire listeners, schedule disconnect checks. */
export function startOnlineMatch(m: OnlineMatch): void {
  net.info(`match start id=${m.matchId} players=[${m.allPlayerUids.join(',')}] lobby=${m.lobbyId ?? 'none'} role=${m.lobbyRole ?? 'n/a'} entities=${m.totalEntityCount}`);
  m.netcode.start();

  wireDeathListeners(m);
  wireRoundEndListener(m);

  // Fallback: if opponents wrote roundEnd but we haven't processed, trust them after 2s.
  // State-stream only — lockstep determines results deterministically.
  // Per-round listener — torn down between rounds to prevent stale callbacks.
  setupOppRoundEndListener(m);

  startDisconnectCheck(m);
  wireReturnToLobbyListener(m);
}

/** Wire up death-event handlers from the netcode session. */
function wireDeathListeners(m: OnlineMatch): void {
  // Death events from netcode (opponent self-reports their death)
  m.netcode.onDeath((ev: NetcodeDeathEvent) => {
    if (m._deathsThisRound.has(ev.uid)) return;
    // Accept deaths during 'playing' or 'roundOver' (second death in draw)
    if (m.state !== 'playing' && m.state !== 'roundOver') return;

    if (m.useLockstep) {
      // Lockstep: sim state is authoritative. Don't immediately add to _deathsThisRound
      // because that would suppress the deterministic sim callback (reportLocalDeath /
      // registerLocalOpponentDeath check _deathsThisRound and early-return).
      // Instead, defer: give the sim a short window to confirm the death. If it doesn't
      // (desync — local sim diverged and never killed this player), promote to authoritative
      // set as a fallback so the round still ends.
      net.log(`lockstep: peer death event uid=${ev.uid} — deferred (sim has 500ms to confirm)`);
      m._peerDeathReports.add(ev.uid);
      setTimeout(() => {
        if (m._deathsThisRound.has(ev.uid)) return; // sim confirmed it — no action needed
        if (m.state !== 'playing' && m.state !== 'roundOver') return;
        net.warn(`lockstep: peer death uid=${ev.uid} not confirmed by local sim after 500ms — promoting as fallback`);
        m._deathsThisRound.add(ev.uid);
        m._evaluateRoundEnd();
      }, 500);
      return;
    }

    net.log(`death event uid=${ev.uid} round=${m.round} deaths=[${[...m._deathsThisRound].join(',')}]+1 aiDeaths=${m._aiDeathsThisRound}`);
    m._deathsThisRound.add(ev.uid);
    m._evaluateRoundEnd();
  });

  // Backup: detect opponent death from their state sync (alive: false).
  // Only fires in state-streaming mode. During lockstep, sim state is authoritative.
  m.netcode.onRemoteDead((uid: string) => {
    if (m.useLockstep) return; // Lockstep: sim is sole authority — ignore state-sync deaths
    if (m._deathsThisRound.has(uid)) return;
    if (m.state !== 'playing' && m.state !== 'roundOver') return;
    net.log(`remoteDead (state sync fallback) uid=${uid}`);
    m._deathsThisRound.add(uid);
    m._evaluateRoundEnd();
  });
}

/** Wire up the onAllRoundEnd listener that reconciles round results across clients. */
function wireRoundEndListener(m: OnlineMatch): void {
  m.netcode.onAllRoundEnd((val: Record<string, RoundEndEntry>) => {
    const evRound = Object.values(val).map(e => e?.round || 0).find(r => r > 0) || 0;

    // Lockstep: sim already decided the result. Use remote claims for integrity check only.
    if (m.useLockstep) {
      if (evRound !== m.round) return;
      if (m._pendingWinner) {
        // Local result is ready — compare remote claims against it
        for (const uid of m.allPlayerUids) {
          const remoteWinner = val[uid]?.winner;
          if (remoteWinner && remoteWinner !== m._pendingWinner) {
            net.warn(`lockstep integrity: ${uid} claims winner='${remoteWinner}' but local sim determined '${m._pendingWinner}'`);
          }
        }
      } else {
        // Local result not yet determined — buffer remote claims for deferred check.
        // Without this, early remote arrivals would bypass the integrity check entirely.
        m._bufferedRemoteRoundEnd = val;
        net.log('lockstep integrity: buffered early remote roundEnd claims for deferred check');
      }
      return;
    }

    // State-stream: reconcile via majority vote
    // All clients confirmed round end — proceed with UI
    // Check round matches current generation to ignore stale events from cleanup races
    if (!m._roundEndProcessed && evRound === m.round) {
      m._roundEndProcessed = true;
      if (m._roundEndTimeout) { clearTimeout(m._roundEndTimeout); m._roundEndTimeout = null; }
      if (m._roundEndDebounce) { clearTimeout(m._roundEndDebounce); m._roundEndDebounce = null; }
      if (m._oppRoundEndTimeout) { clearTimeout(m._oppRoundEndTimeout); m._oppRoundEndTimeout = null; }
      // Reconcile: N-player majority vote on winner
      const myWinner: string | undefined = val[m.myUid]?.winner;
      const votes: Record<string, number> = {};
      for (const uid of m.allPlayerUids) {
        const w = val[uid]?.winner;
        if (w) votes[w] = (votes[w] || 0) + 1;
      }
      // If all agree, use that. Otherwise use majority, falling back to draw.
      const sorted = Object.entries(votes).sort((a, b) =>
        b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1,
      );
      if (sorted.length === 1) {
        m._pendingWinner = sorted[0][0];
      } else if (sorted.length > 1 && sorted[0][1] > sorted[1][1]) {
        m._pendingWinner = sorted[0][0];
      } else {
        // Tie in votes — if our vote is 'draw' or there's a draw vote, use draw
        if (myWinner === 'draw' || votes['draw']) {
          m._pendingWinner = 'draw';
        } else {
          // Trust self-reports of death: if someone says they lost, believe them
          const selfReportedLosers = m.allPlayerUids.filter(uid => {
            const w = val[uid]?.winner;
            return w && w !== uid && w !== 'draw';
          });
          if (selfReportedLosers.length > 0) {
            // The non-loser with most votes wins
            m._pendingWinner = sorted[0][0];
          } else {
            m._pendingWinner = 'draw'; // fallback
          }
        }
      }
      m._updateScoresFromWinner();
      showRoundResult(m);
    }
  });
}

/** Start the 3s disconnect-check interval. See the detailed atomicity note in
 *  onlineMatch.ts prior to extraction — the interval is safe single-threaded. */
function startDisconnectCheck(m: OnlineMatch): void {
  // Check for opponent disconnects every 3s — grace period before confirmed forfeit.
  //
  // ATOMICITY REVIEW (audit P6.1): This check is safe as-is — no additional locking needed.
  //
  // JavaScript is single-threaded: the setInterval callback runs to completion before any
  // other JS executes, so there is no true race window between "checking confirmed" and
  // "acting on it". Specifically:
  //   - `entry.confirmed = true` and the subsequent `_evaluateRoundEnd()` call happen
  //     in the same synchronous turn of the event loop — nothing can interleave them.
  //   - The `allConfirmedForfeit` check at the end of the loop reads the same in-memory
  //     Map that was just mutated; no concurrent write is possible.
  //   - `_evaluateRoundEnd()` and `_handleOpponentDisconnect()` both guard against
  //     double-firing via `_roundEndProcessed` and the state check respectively.
  //
  // The only remaining concern is the interval firing again before the previous forfeit
  // path completes — but `entry.confirmed = true` is set synchronously before
  // `_evaluateRoundEnd()` is called, so the next tick will see `confirmed === true`
  // and skip re-entry. This constitutes a sufficient atomic guard.
  // ── Reviewed 2026-04-05 ──────────────────────────────────────────────────────────────
  m._disconnectCheckInterval = setInterval(() => {
    if (m.state === 'disconnected') return;
    const isPostMatch = m.state === 'finished';
    for (const opp of m.opponents) {
      const connected = m.netcode.isPlayerConnected(opp.uid);
      const entry = m._forfeitedUids.get(opp.uid);

      if (!connected && !entry) {
        // Heartbeat stale, not yet tracked — start grace period
        m._forfeitedUids.set(opp.uid, { at: Date.now(), confirmed: false });
        net.log(`disconnect grace started for uid=${opp.uid}${isPostMatch ? ' (post-match)' : ''}`);
      } else if (!connected && entry && !entry.confirmed) {
        // Still disconnected — check if grace period (20s) has elapsed
        if (Date.now() - entry.at > 20_000) {
          // Set confirmed=true BEFORE calling _evaluateRoundEnd — acts as an atomic
          // guard: if this interval fires again before _evaluateRoundEnd returns
          // (not possible in JS single-threaded model, but explicit for clarity),
          // the `!entry.confirmed` check above would prevent re-entry.
          entry.confirmed = true;
          net.warn(`disconnect grace expired for uid=${opp.uid} — confirmed forfeit${isPostMatch ? ' (post-match)' : ''}`);
          if (!isPostMatch && !m._deathsThisRound.has(opp.uid)) {
            m._deathsThisRound.add(opp.uid);
            m._evaluateRoundEnd();
          }
        }
      } else if (connected && entry && !entry.confirmed) {
        // Heartbeat recovered before grace expired — player reconnected!
        m._forfeitedUids.delete(opp.uid);
        net.info(`disconnect grace cancelled for uid=${opp.uid} — player reconnected`);
      }
    }
    // If ALL opponents have confirmed forfeit, trigger disconnect handler
    const allConfirmedForfeit = m.opponents.every(opp => m._forfeitedUids.get(opp.uid)?.confirmed);
    if (allConfirmedForfeit) {
      if (isPostMatch) {
        // Post-match: signal UI to disable rematch button
        m._transition('disconnected');
        net.warn(`all opponents left post-match — signalling opponentLeftPostMatch`);
        if (m.onStateChange) m.onStateChange('opponentLeftPostMatch');
      } else {
        m._handleOpponentDisconnect();
      }
    }
  }, 3000);
}

/** Listen for the host's return-to-lobby signal. */
function wireReturnToLobbyListener(m: OnlineMatch): void {
  const returnRef = ref(rtdb, `matches/${m.matchId}/returnToLobby`);
  const returnUnsub = onValue(returnRef, (snap: DataSnapshot) => {
    if (snap.val() === true) {
      // Immediately kill next-round timer to prevent auto-start race
      net.info(`returnToLobby signal received — lobby=${m.lobbyId} role=${m.lobbyRole}`);
      m._returningToLobby = true;
      if (m._nextRoundTimer) {
        clearInterval(m._nextRoundTimer);
        m._nextRoundTimer = null;
      }
      if (m.onStateChange) m.onStateChange('returnToLobby');
    }
  });
  m._listeners.push(returnUnsub);
}

/** Run the accept barrier: write accept, wait for all, negotiate lockstep/transport. */
export async function acceptOnlineMatch(m: OnlineMatch): Promise<void> {
  // Write accept with protocol version and vehicle type
  const myVehicle: string = (typeof localStorage !== 'undefined' && localStorage.getItem('luminal-vehicle')) || 'bike';
  const myCaps = getLocalCapabilities();
  try {
    await m.netcode.writeAccept(myVehicle, 1, myCaps);
    net.info('[barrier] writeAccept v=1 caps=' + JSON.stringify(myCaps));
  } catch (e) {
    net.error('writeAccept failed:', e);
    return;
  }

  // Listen for all accepts — unsub once triggered
  let acceptFired: boolean = false;
  const acceptRef = ref(rtdb, `matches/${m.matchId}/accept`);
  const unsub = onValue(acceptRef, (snap: DataSnapshot) => {
    if (acceptFired) return;
    const val = snap.val();
    if (!val || !val[m.myUid]) return;
    // Check all players have accepted
    const allAccepted = m.allPlayerUids.every(uid => !!val[uid]);
    if (!allAccepted) return;
    acceptFired = true;
    unsub(); // stop listening — all accepted

    negotiateAndStartReady(m, val);
  });
  m._listeners.push(() => { if (!acceptFired) unsub(); });
}

/** After all clients accepted, negotiate protocol/transport and begin the ready barrier. */
function negotiateAndStartReady(m: OnlineMatch, val: Record<string, unknown>): void {
  // Extract each opponent's accept data for protocol negotiation
  let minVersion = Infinity;
  for (const opp of m.opponents) {
    const oppAccept = val[opp.uid];
    if (typeof oppAccept === 'object' && oppAccept !== null) {
      const oppObj = oppAccept as { vehicle?: string; v?: number };
      if (oppObj.vehicle) {
        opp.vehicle = oppObj.vehicle as VehicleType;
      }
      const oppVersion: number = oppObj.v || 0;
      minVersion = Math.min(minVersion, oppVersion);
    } else {
      // Old client wrote boolean true — no lockstep support
      minVersion = 0;
    }
  }
  // Lockstep requires: all players on protocol v1+
  m.useLockstep = minVersion >= 1;

  // ── Transport negotiation ──────────────────────────
  const candidates: TransportCandidate[] = m.allPlayerUids.map(uid => {
    const acceptData = val[uid];
    const caps: TransportCapabilities | undefined =
      (typeof acceptData === 'object' && acceptData !== null && (acceptData as { transport?: TransportCapabilities }).transport)
        ? (acceptData as { transport: TransportCapabilities }).transport
        : undefined;
    return { uid, caps };
  });
  m.transportKind = resolveTransport(candidates);
  net.info('[barrier] all-accepted lockstep=' + m.useLockstep + ' transport=' + m.transportKind);

  // Write selected transport to meta for observability
  set(ref(rtdb, `matches/${m.matchId}/meta/transport`), m.transportKind).catch(() => {});

  // Measure RTT before starting gameplay — feeds adaptive input delay
  m.netcode.measureRtt().catch(() => {}).then(() => {
    setupOnlineMatchTransport(m).then(() => {
      writeOnlineMatchReady(m);
    }).catch((e) => {
      net.error('Transport setup failed, proceeding without transport:', e);
      writeOnlineMatchReady(m);
    });
  });
}

/** Attach the negotiated transport (WebSocket or Firebase) to the netcode session. */
export async function setupOnlineMatchTransport(m: OnlineMatch): Promise<void> {
  if (!m.useLockstep) return; // State-stream mode doesn't use MatchTransport

  const sortedUids = [...m.allPlayerUids].sort();
  const uidToIndex = new Map(sortedUids.map((uid, i) => [uid, i] as const));

  if (m.transportKind === 'websocket') {
    const relayUrl = getRelayUrl();
    if (!relayUrl) {
      net.warn('No VITE_RELAY_URL configured, falling back to Firebase');
      m.transportKind = 'firebase';
    } else {
      const opponentUids = m.allPlayerUids.filter(uid => uid !== m.myUid);
      const wsTransport = new WebSocketMatchTransport(
        m.matchId, m.myUid, opponentUids, uidToIndex, relayUrl,
      );
      try {
        await wsTransport.connect();
        m.netcode.attachTransport(wsTransport);
        net.info('WebSocket transport connected');
        return;
      } catch (e) {
        net.warn('WebSocket transport failed, falling back to Firebase:', e);
        m.transportKind = 'firebase';
        set(ref(rtdb, `matches/${m.matchId}/meta/transport`), 'firebase').catch(() => {});
      }
    }
  }

  // Firebase transport (default or fallback)
  const opponentUids = m.allPlayerUids.filter(uid => uid !== m.myUid);
  const fbTransport = new FirebaseMatchTransport(m.matchId, m.myUid, opponentUids, uidToIndex);
  await fbTransport.connect();
  m.netcode.attachTransport(fbTransport);
  net.info('Firebase transport connected');
}

function getRelayUrl(): string {
  // WebSocket must connect directly to Cloud Run — Firebase Hosting
  // rewrites don't support WebSocket protocol upgrade.
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RELAY_URL) {
    return import.meta.env.VITE_RELAY_URL;
  }
  return '';
}

/** Write our ready flag and wait for all clients ready → schedule countdown start. */
export async function writeOnlineMatchReady(m: OnlineMatch): Promise<void> {
  if (m._countdownStarted) return;
  m._readyWritten = true; // prevent duplicate writeOnlineMatchReady calls

  try {
    await set(ref(rtdb, `matches/${m.matchId}/ready/${m.myUid}`), {
      ts: serverTimestamp(),
      clientTs: Date.now(),
    });
  } catch (e) {
    net.error('writeReady failed:', e);
  }
  net.info('[barrier] writeReady');

  // Listen for all ready — unsub once triggered
  let readyFired: boolean = false;
  const readyRef = ref(rtdb, `matches/${m.matchId}/ready`);
  const unsub = onValue(readyRef, (snap: DataSnapshot) => {
    if (readyFired || m._countdownStarted) return;
    const val = snap.val();
    if (!val || !val[m.myUid]) return;
    const allReady = m.allPlayerUids.every(uid => !!val[uid]);
    if (!allReady) return;
    readyFired = true;
    unsub(); // stop listening — all ready
    m._countdownStarted = true;
    // Compute synchronized start using server timestamps
    let laterTs = 0;
    for (const uid of m.allPlayerUids) {
      const ts: number = val[uid]?.ts || 0;
      if (ts > laterTs) laterTs = ts;
    }
    const offset: number = m.netcode._serverTimeOffset || 0;
    const serverNow: number = Date.now() + offset;
    const startAt: number = laterTs + 500;
    const delayMs: number = Math.max(50, startAt - serverNow);
    net.info('[barrier] all-ready delayMs=' + delayMs);
    setTimeout(() => m._startCountdown(), delayMs);
  });
  m._listeners.push(() => { if (!readyFired) unsub(); });
}

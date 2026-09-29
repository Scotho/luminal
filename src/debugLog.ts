// ── Debug Log Commands ────────────────────────────────────
// Collects diagnostic info for /log (netcode) and /gfx (graphics) chat commands.

import type { OnlineMatch } from './onlineMatch';
import type { LockstepManager } from './core/lockstepManager';
import { classifyHealth, type ExtendedHealthSignals } from './core/lockstepManager';
import type { NetcodeSession } from './netcode';
import { getPerfTelemetry } from './ui/perfStats';
import { registerGfxRefs } from './gfxLog';
import { getProgressionState } from './progression/progressionManager';
import { addUnlock } from './progression/xpState';
import type * as THREE from 'three';

export { getGfxLog } from './gfxLog';
export type { NetcodeStatsSnapshot } from './netcodeStatsTypes';

// ── Registration — game/renderer inject their references ──
interface GameLike {
  state: string;
  mode: string;
  matchTime: number;
  _onlineMatch: OnlineMatch | null;
  _lockstep: LockstepManager | null;
  scene?: THREE.Scene;
  player?: {
    vehicleType: string;
    isGrinding: boolean;
    grindBalanceValue: number;
    grindStreakCount: number;
    isAirborne: boolean;
    isRecovery: boolean;
    trickName: string;
    speed: number;
    meter: number;
    alive: boolean;
    getPosition?: () => { x: number; z: number };
    teleportForTest?: (x: number, z: number, angle: number) => void;
    forceGrindBailForTest?: () => boolean;
  } | null;
  ais?: Array<{ player: { trail: { points: Array<{ x: number; z: number }> } } }>;
}

let _game: GameLike | null = null;

export function registerDebugRefs(
  game: GameLike | null,
  renderer: THREE.WebGLRenderer,
): void {
  _game = game;
  registerGfxRefs(game, renderer);

  // Expose telemetry getters for e2e tests and admin dashboard
  (window as unknown as Record<string, unknown>).__luminalGetNetcodeStats = getNetcodeStats;
  (window as unknown as Record<string, unknown>).__luminalGetPerfTelemetry = getPerfTelemetry;
  (window as unknown as Record<string, unknown>).__luminalGetGrindState = getGrindState;
  // Test-only hooks for headed browser tests (SPEC-81, SPEC-82)
  (window as unknown as Record<string, unknown>).__luminalTestHook_teleportPlayer = testHookTeleportPlayer;
  (window as unknown as Record<string, unknown>).__luminalTestHook_findNearestAiTrailSegment = testHookFindNearestAiTrailSegment;
  (window as unknown as Record<string, unknown>).__luminalTestHook_forceGrindBail = testHookForceGrindBail;
  // Test-only: unlock a vehicle (for grind / hoverboard e2e flows). Mutates
  // the in-memory progression state and character-select DOM so the vehicle
  // tile becomes selectable without waiting on XP/Firestore round-trips.
  (window as unknown as Record<string, unknown>).luminalUnlock = luminalUnlock;
}

/** Test-only: add an unlock (e.g. `luminalUnlock('hoverboard')`) so subsequent
 *  getSelectedVehicle/getSelectedMap calls treat it as available. Mutates the
 *  in-memory progression state; if no state is loaded yet (e.g. pre-auth),
 *  isUnlocked(null) already returns true, so the call is a no-op. */
export function luminalUnlock(itemName: string): void {
  const state = getProgressionState();
  if (!state) return;
  const candidates = [`vehicle:${itemName}`, `map:${itemName}`, `color:${itemName}`, `emissive:${itemName}`, itemName];
  for (const id of candidates) addUnlock(state, id);
}

/** Test-only: teleport the local player. Returns true on success. */
export function testHookTeleportPlayer(x: number, z: number, angle: number): boolean {
  if (!_game || !_game.player || !_game.player.teleportForTest) return false;
  _game.player.teleportForTest(x, z, angle);
  return true;
}

/** Test-only (SPEC-82): force a grind bail by pushing grindBalance past the bail threshold.
 *  Returns true if the player was grinding and the bail was injected. */
export function testHookForceGrindBail(): boolean {
  if (!_game || !_game.player || !_game.player.forceGrindBailForTest) return false;
  return _game.player.forceGrindBailForTest();
}

/**
 * Test-only: find a point 2.5 units perpendicular to the midpoint of an AI
 * trail segment. Returns {x, z, angle} suitable for teleportForTest, or null
 * if no AI trail segments exist yet. The returned position is within
 * GRIND_SNAP_RANGE (6.0) of the segment but outside HIT_RADIUS (0.8), and
 * the angle is aligned with the segment direction so grind init picks the
 * correct traversal direction.
 */
export function testHookFindNearestAiTrailSegment(): { x: number; z: number; angle: number; segX: number; segZ: number; diag: string } | null {
  const diag: string[] = [];
  if (!_game) { diag.push('no _game'); return null; }
  if (!_game.ais) { diag.push('no _game.ais'); return null; }
  diag.push(`ais.length=${_game.ais.length}`);
  let aiIdx = 0;
  // Find the AI with the MOST trail points, and pick a segment near the START
  // of that trail (oldest segment — furthest from the AI's current position,
  // safer to teleport to because the AI has moved on).
  let bestAi: typeof _game.ais[0] | null = null;
  let bestLen = 0;
  for (const ai of _game.ais) {
    const pts = ai.player.trail.points;
    diag.push(`ai[${aiIdx}].trail.points.length=${pts.length}`);
    aiIdx++;
    if (pts.length > bestLen) {
      bestLen = pts.length;
      bestAi = ai;
    }
  }
  if (!bestAi || bestLen < 2) {
    console.log('[testHook] findNearestAiTrailSegment returning null —', diag.join('; '));
    return null;
  }
  const pts = bestAi.player.trail.points;
  // Use segment at index 1 (one past the very start — oldest, most stable).
  // The AI has long since moved away from the first segment so we won't be
  // head-on with them.
  const segIdx = Math.min(1, pts.length - 2);
  const a = pts[segIdx];
  const b = pts[segIdx + 1];
  if (!a || !b) { diag.push(`no adjacent pts at segIdx=${segIdx}`); return null; }
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.1) { diag.push(`segment too short len=${len}`); return null; }
  // Midpoint of segment
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  // Perpendicular direction (right of segment)
  const perpX = -dz / len;
  const perpZ = dx / len;
  // Teleport target: 2.5 units perpendicular to the midpoint
  const tx = mx + perpX * 2.5;
  const tz = mz + perpZ * 2.5;
  // Angle: align with segment direction. Player angle convention is
  // velocity = (-sin(angle), -cos(angle)) per simulation.ts grind init.
  const angle = Math.atan2(-dx / len, -dz / len);
  return { x: tx, z: tz, angle, segX: mx, segZ: mz, diag: diag.join('; ') };
}

/** Grind state probe for e2e tests. Returns local player grind/trick/airborne state. */
export function getGrindState(): {
  registered: boolean;
  gameState: string;
  gameMode: string;
  playerAlive: boolean;
  vehicleType: string;
  isGrinding: boolean;
  grindBalance: number;
  grindStreakCount: number;
  isAirborne: boolean;
  isRecovery: boolean;
  trickName: string;
  speed: number;
  meter: number;
  hudVisible: boolean;
  comboHudVisible: boolean;
  alertOverlayPresent: boolean;
  nearestTrailDistance: number;
} {
  const hudVisible = !!document.querySelector('.grind-combo-root');
  const comboHudRoot = document.querySelector('.grind-combo-root') as HTMLElement | null;
  const comboHudVisible = !!(comboHudRoot && comboHudRoot.style.display !== 'none' && comboHudRoot.offsetParent !== null);
  const alertOverlayPresent = !!document.querySelector('.grind-alert-edge');
  if (!_game || !_game.player) {
    return {
      registered: false, gameState: 'none', gameMode: 'none',
      playerAlive: false, vehicleType: 'none',
      isGrinding: false, grindBalance: 0, grindStreakCount: 0,
      isAirborne: false, isRecovery: false, trickName: '',
      speed: 0, meter: 0,
      hudVisible, comboHudVisible, alertOverlayPresent,
      nearestTrailDistance: Infinity,
    };
  }
  const p = _game.player;
  // Compute nearest enemy trail distance (for test steering in T8)
  let nearestTrailDistance = Infinity;
  if (p.getPosition && _game.ais) {
    const pos = p.getPosition();
    for (const ai of _game.ais) {
      const pts = ai.player.trail.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq === 0) continue;
        const t = Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / lenSq));
        const cx = a.x + t * dx;
        const cz = a.z + t * dz;
        const dist = Math.hypot(pos.x - cx, pos.z - cz);
        if (dist < nearestTrailDistance) nearestTrailDistance = dist;
      }
    }
  }
  return {
    registered: true,
    gameState: _game.state,
    gameMode: _game.mode,
    playerAlive: p.alive,
    vehicleType: p.vehicleType,
    isGrinding: p.isGrinding,
    grindBalance: p.grindBalanceValue,
    grindStreakCount: p.grindStreakCount,
    isAirborne: p.isAirborne,
    isRecovery: p.isRecovery,
    trickName: p.trickName,
    speed: p.speed,
    meter: p.meter,
    hudVisible, comboHudVisible, alertOverlayPresent,
    nearestTrailDistance,
  };
}

// ── /log — Network diagnostics ────────────────────────────

type LockstepTelemetry = ReturnType<NonNullable<GameLike['_lockstep']>['getTelemetry']>;
type PacketSnap = ReturnType<NetcodeSession['getPacketTelemetry']>;
type PerfSnap = ReturnType<typeof getPerfTelemetry>;

function _pushMatchIdentity(lines: string[], om: NonNullable<GameLike['_onlineMatch']>, game: GameLike): void {
  lines.push(`matchId: ${om.matchId}`);
  lines.push(`me: ${om.myUid.slice(0, 8)}… | opp: ${om.opponentUid.slice(0, 8)}… (${om.opponentName})`);
  lines.push(`round: ${om.round}/${om.seriesLength} | matchState: ${om.state}`);
  const myScore = om.scores[om.myUid] ?? 0;
  const oppScore = om.scores[om.opponentUid] ?? 0;
  lines.push(`score: ${myScore}-${oppScore} | matchTime: ${game.matchTime.toFixed(1)}s`);
}

function _pushConnection(lines: string[], nc: NetcodeSession, om: NonNullable<GameLike['_onlineMatch']>, pktSnap: PacketSnap): void {
  lines.push(`rtt: ${nc.estimatedRttMs}ms | jitter: ${nc.jitterMs}ms`);
  lines.push(`packetLoss: ${nc.packetLossCount} (${(nc.packetLossRate * 100).toFixed(1)}%) | reorder: ${pktSnap.packetReorderCount} | recv: ${nc.packetsReceived}`);
  lines.push(`oppConnected: ${nc.isOpponentConnected()}`);
  const ncAny = nc as unknown as Record<string, unknown>;
  lines.push(`seqNum: ${ncAny._seqNum} | lastRemoteSeqMap size: ${(ncAny._lastRemoteSeqMap as Map<string, number>).size}`);
  lines.push(`remoteStatesMap peers: ${(ncAny._remoteStatesMap as Map<string, unknown>).size}`);
  lines.push(`serverTimeOffset: ${nc._serverTimeOffset}ms`);
  const firstHb = (ncAny._lastHeartbeats as Map<string, number>).values().next().value ?? 0;
  const hbAge = Date.now() - firstHb;
  lines.push(`oppHeartbeat: ${hbAge}ms ago`);
  lines.push(`deathGraceMs: ${om.deathGraceMs}`);
}

function _pushLockstepTelemetry(lines: string[], t: LockstepTelemetry): void {
  lines.push(`rollbacks: ${t.rollbackCount} | desyncs: ${t.desyncCount}`);
  const depthStr = Object.entries(t.rollbackDepths)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, n]) => `${d}t:${n}`)
    .join(' ');
  if (depthStr) lines.push(`rbDepths: ${depthStr} (max=${t.rollbackMaxDepth} avg=${t.rollbackAvgDepth.toFixed(1)})`);
  lines.push(`predictPeak: ${t.peakPredictAhead} | lateInputs: ${t.lateInputCount} | bufferDepth: ${t.inputBufferDepth}`);
  const totalPredictions = t.mispredictionCount + t.correctPredictionCount;
  const accuracy = totalPredictions > 0 ? ((t.correctPredictionCount / totalPredictions) * 100).toFixed(1) : '—';
  lines.push(`predictions: ${totalPredictions} (correct=${t.correctPredictionCount} mis=${t.mispredictionCount} accuracy=${accuracy}%)`);
  const stallInfo = t.avgStallDurationMs > 0 ? ` avgDur=${t.avgStallDurationMs}ms peak=${t.peakStallDurationMs}ms` : '';
  lines.push(`recoveries: ${t.recoveryCount} | stalls: ${t.stallCount}${stallInfo}`);
  lines.push(`simCost: avg=${t.avgSimTickCostMs}ms peak=${t.peakSimTickCostMs}ms p50=${t.simTickP50Ms}ms p95=${t.simTickP95Ms}ms p99=${t.simTickP99Ms}ms`);
  lines.push(`rbCost: avg=${t.avgRollbackCostMs}ms peak=${t.peakRollbackCostMs}ms p50=${t.rollbackP50Ms}ms p95=${t.rollbackP95Ms}ms p99=${t.rollbackP99Ms}ms`);
  lines.push(`recoveryCost: avg=${t.avgRecoveryCostMs}ms peak=${t.peakRecoveryCostMs}ms`);
  if (t.snapshotMissCount > 0) {
    lines.push(`snapshotMisses: ${t.snapshotMissCount}`);
  }
  if (t.avgHashCostMs > 0) {
    lines.push(`hashCost: avg=${t.avgHashCostMs}ms peak=${t.peakHashCostMs}ms`);
  }
  if (t.avgQuantizeCostMs > 0) {
    lines.push(`quantizeCost: avg=${t.avgQuantizeCostMs}ms peak=${t.peakQuantizeCostMs}ms`);
  }
  if (t.avgRecoverySnapshotBytes > 0) {
    const serdeInfo = (t.snapshotSerdeCostAvgMs ?? 0) > 0
      ? ` serde=${t.snapshotSerdeCostAvgMs}ms peak=${t.snapshotSerdeCostPeakMs}ms` : '';
    const deserdeInfo = (t.snapshotDeserdeCostAvgMs ?? 0) > 0
      ? ` clone=${t.snapshotDeserdeCostAvgMs}ms peak=${t.snapshotDeserdeCostPeakMs}ms` : '';
    lines.push(`recoverySnapshot: avg=${t.avgRecoverySnapshotBytes}B${serdeInfo}${deserdeInfo}`);
  }
  // Rollback cost-per-depth breakdown
  if (t.rollbackCostByDepth) {
    const depthCostEntries = Object.entries(t.rollbackCostByDepth)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([d, v]) => `${d}t:avg=${v.avgMs}ms peak=${v.peakMs}ms(n=${v.count})`);
    if (depthCostEntries.length > 0) lines.push(`rbCostByDepth: ${depthCostEntries.join(' ')}`);
  }
  // Input latency distribution
  const latBuckets = Object.entries(t.inputLatencyBuckets)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, n]) => `${d}t:${n}`)
    .join(' ');
  if (latBuckets) lines.push(`inputLatency: ${latBuckets}`);
  if (t.lateInputBurstCount > 0) {
    lines.push(`lateInputBursts: ${t.lateInputBurstCount} (peakStreak=${t.lateInputPeakStreak})`);
  }
  if (t.avgVisualCorrectionDist > 0) {
    lines.push(`visualCorrection: avg=${t.avgVisualCorrectionDist} peak=${t.peakVisualCorrectionDist} units`);
  }
  const health = classifyHealth(t);
  const healthLabel = health.level === 'healthy' ? '✓ healthy'
    : health.level === 'degraded' ? '⚠ DEGRADED'
    : '✖ UNSTABLE';
  lines.push(`health: ${healthLabel}`);
  for (const reason of health.reasons) {
    lines.push(`  → ${reason}`);
  }
}

function _pushLockstepPlayers(lines: string[], ls: NonNullable<GameLike['_lockstep']>): void {
  const myP = ls.getMyPlayer();
  lines.push(`myPos: (${myP.x.toFixed(1)}, ${myP.z.toFixed(1)}) spd=${myP.speed.toFixed(1)} alive=${myP.alive}`);
  for (let pi = 0; pi < ls.playerCount; pi++) {
    if (pi === ls.myIndex) continue;
    const p = ls.getPlayerByIndex(pi);
    lines.push(`opp${pi}Pos: (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) spd=${p.speed.toFixed(1)} alive=${p.alive}`);
  }

  const myOff = ls.myVisualOffset;
  if (Math.abs(myOff.x) > 0.01 || Math.abs(myOff.z) > 0.01) {
    lines.push(`myVisualOffset: (${myOff.x.toFixed(2)}, ${myOff.z.toFixed(2)})`);
  }
  for (let pi = 0; pi < ls.playerCount; pi++) {
    if (pi === ls.myIndex) continue;
    const off = ls.getVisualOffset(pi);
    if (Math.abs(off.x) > 0.01 || Math.abs(off.z) > 0.01) {
      lines.push(`opp${pi}VisualOffset: (${off.x.toFixed(2)}, ${off.z.toFixed(2)})`);
    }
  }
}

function _pushLockstepSection(lines: string[], ls: NonNullable<GameLike['_lockstep']>): void {
  lines.push('── LOCKSTEP ──');
  lines.push(`tick: ${ls.tick} | started: ${ls.started}`);
  lines.push(`inputDelay: ${ls.inputBuffer.inputDelay}`);
  lines.push(`renderAlpha: ${ls.renderAlpha.toFixed(3)}`);

  const t = ls.getTelemetry();
  _pushLockstepTelemetry(lines, t);
  _pushLockstepPlayers(lines, ls);
}

function _pushPacketTelemetry(lines: string[], nc: NetcodeSession, pkt: PacketSnap): void {
  const ack = nc.inputAckStats;
  lines.push(`inputAck: avg=${ack.avgLatencyMs}ms acked=${ack.ackCount} missed=${ack.missCount} pending=${ack.pendingCount}`);

  lines.push(`rttPct: p50=${pkt.rttP50Ms}ms p95=${pkt.rttP95Ms}ms p99=${pkt.rttP99Ms}ms`);
  lines.push(`jitterPct: p50=${pkt.jitterP50Ms}ms p95=${pkt.jitterP95Ms}ms p99=${pkt.jitterP99Ms}ms`);
  lines.push(`ackPct: p50=${pkt.inputAckP50Ms}ms p95=${pkt.inputAckP95Ms}ms p99=${pkt.inputAckP99Ms}ms`);
  if (pkt.heartbeatMissCount > 0 || pkt.heartbeatAvgMs > 0) {
    lines.push(`heartbeat: avg=${pkt.heartbeatAvgMs}ms p95=${pkt.heartbeatP95Ms}ms p99=${pkt.heartbeatP99Ms}ms missed=${pkt.heartbeatMissCount}`);
  }
  if (pkt.transportBytes) {
    lines.push(`transport: sent=${pkt.transportBytes.sent}B recv=${pkt.transportBytes.received}B`);
  }
  if (pkt.sendRateBps > 0 || pkt.recvRateBps > 0) {
    lines.push(`bandwidth: send=${pkt.sendRateBps}B/s recv=${pkt.recvRateBps}B/s`);
  }
  if (pkt.messageTypes) {
    const types = Object.entries(pkt.messageTypes)
      .map(([k, v]) => `${k}:${v.bytesSent}B↑/${v.bytesReceived}B↓(n=${v.count})`)
      .join(' ');
    lines.push(`msgTypes: ${types}`);
  }
  if (pkt.transportReconnects > 0) {
    lines.push(`reconnects: ${pkt.transportReconnects}`);
  }
  if (pkt.transportConnectMs > 0) {
    lines.push(`connectLatency: ${pkt.transportConnectMs}ms`);
  }
  if (pkt.serializeCostAvgMs > 0 || pkt.deserializeCostAvgMs > 0) {
    lines.push(`serde: serialize=${pkt.serializeCostAvgMs}ms deserialize=${pkt.deserializeCostAvgMs}ms`);
    if (pkt.serializeCostP95Ms > 0 || pkt.deserializeCostP95Ms > 0) {
      lines.push(`serdePct: ser-p95=${pkt.serializeCostP95Ms}ms ser-p99=${pkt.serializeCostP99Ms}ms deser-p95=${pkt.deserializeCostP95Ms}ms deser-p99=${pkt.deserializeCostP99Ms}ms`);
    }
  }
  if (pkt.transportBufferedBytes > 0) {
    lines.push(`sendBuffer: ${pkt.transportBufferedBytes}B pending`);
  }
  if (pkt.transportDowntimeMs > 0) {
    lines.push(`downtime: ${Math.round(pkt.transportDowntimeMs)}ms total`);
  }
  if (pkt.reconnectAvgMs > 0) {
    lines.push(`reconnectDuration: avg=${pkt.reconnectAvgMs}ms peak=${pkt.reconnectPeakMs}ms`);
  }
  if (pkt.reconnectSuccessCount > 0 || pkt.reconnectFailCount > 0) {
    lines.push(`reconnectOutcomes: success=${pkt.reconnectSuccessCount} fail=${pkt.reconnectFailCount}`);
  }
  if (pkt.backpressureTotalMs > 0) {
    lines.push(`backpressure: ${Math.round(pkt.backpressureTotalMs)}ms total`);
  }
  if (pkt.packetLossBurstCount > 0) {
    lines.push(`lossBursts: ${pkt.packetLossBurstCount} (peakStreak=${pkt.packetLossPeakBurst})`);
  }
  if (pkt.stuckInputCount > 0) {
    lines.push(`stuckInputs: ${pkt.stuckInputCount} pending >1s`);
  }
  if (pkt.serverTimeOffsetMs !== 0) {
    lines.push(`serverTimeOffset: ${pkt.serverTimeOffsetMs}ms`);
  }
}

function _pushRenderTelemetry(lines: string[], perf: PerfSnap): void {
  if (perf.totalFrames > 0) {
    lines.push(`frameTimes: p50=${perf.p50Ms}ms p95=${perf.p95Ms}ms p99=${perf.p99Ms}ms peak=${perf.peakFrameTimeMs}ms stddev=${perf.frameTimeStdDevMs}ms (n=${perf.totalFrames})`);
    const b = perf.frameTimeBuckets;
    lines.push(`ftBuckets: <16ms:${b.under16ms} <33ms:${b.under33ms} <50ms:${b.under50ms} >50ms:${b.over50ms}`);
  }
  if (perf.jankEventCount > 0) {
    lines.push(`jank: ${perf.jankEventCount} events peakStreak=${perf.jankPeakStreak}`);
  }
  if (perf.gcPauseCount > 0) {
    const h = perf.gcPauseHistogram;
    lines.push(`gcPauses: ${perf.gcPauseCount} totalMs=${perf.gcPauseTotalMs} (minor=${h.minor} moderate=${h.moderate} major=${h.major})`);
  }
  if (perf.heapPressure > 0) {
    lines.push(`heapPressure: ${(perf.heapPressure * 100).toFixed(1)}%`);
  }
  if (perf.heapDeltaAvgKB !== 0 || perf.heapDeltaPeakKB > 0) {
    lines.push(`heapDelta: avg=${perf.heapDeltaAvgKB}KB peak=${perf.heapDeltaPeakKB}KB`);
  }
}

export function getNetLog(): string {
  const lines: string[] = ['── NETLOG ──'];
  const ts = new Date().toISOString().slice(11, 23);
  lines.push(`time: ${ts}`);

  if (!_game) {
    lines.push('game: not registered');
    return lines.join('\n');
  }

  lines.push(`state: ${_game.state} | mode: ${_game.mode}`);

  const om = _game._onlineMatch;
  if (!om) {
    lines.push('match: none');
    return lines.join('\n');
  }

  const nc: NetcodeSession = om.netcode;
  _pushMatchIdentity(lines, om, _game);

  const pktSnap = nc.getPacketTelemetry();
  _pushConnection(lines, nc, om, pktSnap);

  const ls = _game._lockstep;
  if (ls) {
    _pushLockstepSection(lines, ls);
  } else {
    lines.push('lockstep: inactive');
  }

  _pushPacketTelemetry(lines, nc, pktSnap);
  _pushRenderTelemetry(lines, getPerfTelemetry());

  return lines.join('\n');
}

// ── Admin panel netcode summary ──────────────────────────
import type { NetcodeStatsSnapshot } from './netcodeStatsTypes';

interface NetcodeStatsHealth {
  health: string;
  simCost?: { avg: number; peak: number; p95: number; p99: number };
  rollbackCost?: { avg: number; peak: number; p50: number; p95: number; p99: number };
  recoveryCost?: { avg: number; peak: number; snapshotBytes: number };
}

function _computeNetcodeHealth(
  nc: NetcodeSession,
  ls: NonNullable<GameLike['_lockstep']> | null,
  t: LockstepTelemetry | null,
  pkt: PacketSnap,
  perf: PerfSnap,
): NetcodeStatsHealth {
  if (ls && t) {
    const totalPredictions = t.mispredictionCount + t.correctPredictionCount;
    const ext: ExtendedHealthSignals = {
      jitterP95Ms: pkt.jitterP95Ms,
      jitterP99Ms: pkt.jitterP99Ms,
      heartbeatMissCount: pkt.heartbeatMissCount,
      heartbeatP95Ms: pkt.heartbeatP95Ms,
      gcPauseCount: perf.gcPauseCount,
      gcPauseTotalMs: perf.gcPauseTotalMs,
      heapPressure: perf.heapPressure,
      frameTimeP95Ms: perf.p95Ms,
      frameTimeStdDevMs: perf.frameTimeStdDevMs,
      jankEventCount: perf.jankEventCount,
      jankPeakStreak: perf.jankPeakStreak,
      transportReconnects: pkt.transportReconnects,
      mispredictionRate: totalPredictions > 0 ? t.mispredictionCount / totalPredictions : 0,
      packetReorderCount: pkt.packetReorderCount,
      packetsReceived: pkt.packetsReceived,
      transportBufferedBytes: pkt.transportBufferedBytes,
      serverTimeOffsetMs: pkt.serverTimeOffsetMs,
      stuckInputCount: pkt.stuckInputCount,
    };
    const h = classifyHealth(t, ext);
    const simCost = { avg: t.avgSimTickCostMs, peak: t.peakSimTickCostMs, p95: t.simTickP95Ms, p99: t.simTickP99Ms };
    const rollbackCost = { avg: t.avgRollbackCostMs, peak: t.peakRollbackCostMs, p50: t.rollbackP50Ms, p95: t.rollbackP95Ms, p99: t.rollbackP99Ms };
    const recoveryCost = t.recoveryCount > 0
      ? { avg: t.avgRecoveryCostMs, peak: t.peakRecoveryCostMs, snapshotBytes: t.avgRecoverySnapshotBytes }
      : undefined;
    return { health: h.level, simCost, rollbackCost, recoveryCost };
  }
  return { health: nc.isOpponentConnected() ? 'connected' : 'waiting' };
}

function _buildCoreStats(
  nc: NetcodeSession,
  hc: NetcodeStatsHealth,
): Pick<NetcodeStatsSnapshot, 'rtt' | 'jitter' | 'packetLossRate' | 'health' | 'connected' | 'debug' | 'simCost' | 'rollbackCost' | 'recoveryCost' | 'inputAckAvgMs' | 'inputAckMissCount'> {
  const ack = nc.inputAckStats;
  return {
    rtt: nc.estimatedRttMs ?? 0,
    jitter: nc.jitterMs,
    packetLossRate: nc.packetLossRate,
    health: hc.health,
    connected: nc.isOpponentConnected(),
    debug: !!window.NETCODE_DEBUG,
    simCost: hc.simCost,
    rollbackCost: hc.rollbackCost,
    recoveryCost: hc.recoveryCost,
    inputAckAvgMs: ack.avgLatencyMs,
    inputAckMissCount: ack.missCount,
  };
}

function _buildPacketStats(pkt: PacketSnap, perf: PerfSnap): Partial<NetcodeStatsSnapshot> {
  return {
    jitterP95: pkt.jitterP95Ms ?? undefined,
    jitterP99: pkt.jitterP99Ms ?? undefined,
    inputAckP95: pkt.inputAckP95Ms ?? undefined,
    inputAckP99: pkt.inputAckP99Ms ?? undefined,
    frameTimeP95: perf.p95Ms ?? undefined,
    gcPauseCount: perf.gcPauseCount ?? undefined,
    gcPauseTotalMs: perf.gcPauseTotalMs ?? undefined,
    heapDeltaAvgKB: perf.heapDeltaAvgKB ?? undefined,
    heapPressure: perf.heapPressure ?? undefined,
    frameTimeStdDevMs: perf.frameTimeStdDevMs ?? undefined,
    transportBytesSent: pkt.transportBytes?.sent,
    transportBytesRecv: pkt.transportBytes?.received,
    transportReconnects: pkt.transportReconnects,
    transportConnectMs: pkt.transportConnectMs,
    heartbeatMissCount: pkt.heartbeatMissCount ?? undefined,
    heartbeatAvgMs: pkt.heartbeatAvgMs ?? undefined,
    jankEventCount: perf.jankEventCount ?? undefined,
    jankPeakStreak: perf.jankPeakStreak ?? undefined,
    sendRateBps: pkt.sendRateBps ?? undefined,
    recvRateBps: pkt.recvRateBps ?? undefined,
    rttP50: pkt.rttP50Ms ?? undefined,
    rttP95: pkt.rttP95Ms ?? undefined,
    rttP99: pkt.rttP99Ms ?? undefined,
    packetReorderCount: pkt.packetReorderCount ?? undefined,
    serializeCostAvgMs: pkt.serializeCostAvgMs ?? undefined,
    deserializeCostAvgMs: pkt.deserializeCostAvgMs ?? undefined,
    transportBufferedBytes: pkt.transportBufferedBytes > 0 ? pkt.transportBufferedBytes : undefined,
    heartbeatP95: pkt.heartbeatP95Ms > 0 ? pkt.heartbeatP95Ms : undefined,
    heartbeatP99: pkt.heartbeatP99Ms > 0 ? pkt.heartbeatP99Ms : undefined,
    transportDowntimeMs: pkt.transportDowntimeMs > 0 ? pkt.transportDowntimeMs : undefined,
    reconnectAvgMs: pkt.reconnectAvgMs > 0 ? pkt.reconnectAvgMs : undefined,
    reconnectPeakMs: pkt.reconnectPeakMs > 0 ? pkt.reconnectPeakMs : undefined,
    gcPauseHistogram: perf.gcPauseCount > 0 ? perf.gcPauseHistogram : undefined,
    packetLossBurstCount: pkt.packetLossBurstCount > 0 ? pkt.packetLossBurstCount : undefined,
    packetLossPeakBurst: pkt.packetLossPeakBurst > 0 ? pkt.packetLossPeakBurst : undefined,
    backpressureTotalMs: pkt.backpressureTotalMs > 0 ? pkt.backpressureTotalMs : undefined,
    reconnectSuccessCount: pkt.reconnectSuccessCount > 0 ? pkt.reconnectSuccessCount : undefined,
    reconnectFailCount: pkt.reconnectFailCount > 0 ? pkt.reconnectFailCount : undefined,
    serverTimeOffsetMs: pkt.serverTimeOffsetMs !== 0 ? pkt.serverTimeOffsetMs : undefined,
    stuckInputCount: pkt.stuckInputCount > 0 ? pkt.stuckInputCount : undefined,
    serializeCostP95Ms: pkt.serializeCostP95Ms > 0 ? pkt.serializeCostP95Ms : undefined,
    serializeCostP99Ms: pkt.serializeCostP99Ms > 0 ? pkt.serializeCostP99Ms : undefined,
    deserializeCostP95Ms: pkt.deserializeCostP95Ms > 0 ? pkt.deserializeCostP95Ms : undefined,
    deserializeCostP99Ms: pkt.deserializeCostP99Ms > 0 ? pkt.deserializeCostP99Ms : undefined,
  };
}

function _buildLockstepStats(t: LockstepTelemetry | null): Partial<NetcodeStatsSnapshot> {
  if (!t) {
    return {
      mispredictionCount: undefined,
      correctPredictionCount: undefined,
      inputBufferDepth: undefined,
    };
  }
  return {
    mispredictionCount: t.mispredictionCount,
    correctPredictionCount: t.correctPredictionCount,
    inputBufferDepth: t.inputBufferDepth,
    hashCost: t.avgHashCostMs > 0 ? { avg: t.avgHashCostMs, peak: t.peakHashCostMs } : undefined,
    snapshotMissCount: t.snapshotMissCount ?? undefined,
    rollbackCostByDepth: t.rollbackCostByDepth && Object.keys(t.rollbackCostByDepth).length > 0 ? t.rollbackCostByDepth : undefined,
    snapshotSerdeCostAvgMs: t.snapshotSerdeCostAvgMs > 0 ? t.snapshotSerdeCostAvgMs : undefined,
    stallAvgMs: t.avgStallDurationMs > 0 ? t.avgStallDurationMs : undefined,
    stallPeakMs: t.peakStallDurationMs > 0 ? t.peakStallDurationMs : undefined,
    stallCount: t.stallCount ?? undefined,
    lateInputRate: t.totalTicks > 0 ? Math.round(t.lateInputCount / t.totalTicks * 10000) / 10000 : undefined,
    quantizeCostAvgMs: t.avgQuantizeCostMs > 0 ? t.avgQuantizeCostMs : undefined,
    quantizeCostPeakMs: t.peakQuantizeCostMs > 0 ? t.peakQuantizeCostMs : undefined,
    lateInputBurstCount: t.lateInputBurstCount ?? undefined,
    lateInputPeakStreak: t.lateInputPeakStreak > 0 ? t.lateInputPeakStreak : undefined,
    visualCorrectionAvg: t.avgVisualCorrectionDist > 0 ? t.avgVisualCorrectionDist : undefined,
    visualCorrectionPeak: t.peakVisualCorrectionDist > 0 ? t.peakVisualCorrectionDist : undefined,
    snapshotDeserdeCostAvgMs: t.snapshotDeserdeCostAvgMs > 0 ? t.snapshotDeserdeCostAvgMs : undefined,
    snapshotDeserdeCostPeakMs: t.snapshotDeserdeCostPeakMs > 0 ? t.snapshotDeserdeCostPeakMs : undefined,
  };
}

export function getNetcodeStats(): NetcodeStatsSnapshot | null {
  if (!_game?._onlineMatch?.netcode) return null;
  const nc = _game._onlineMatch.netcode;
  const ls = _game._lockstep;
  const t = ls?.getTelemetry() ?? null;
  const pkt = nc.getPacketTelemetry();
  const perf = getPerfTelemetry();

  const hc = _computeNetcodeHealth(nc, ls, t, pkt, perf);
  return {
    ..._buildCoreStats(nc, hc),
    ..._buildPacketStats(pkt, perf),
    ..._buildLockstepStats(t),
  } as NetcodeStatsSnapshot;
}


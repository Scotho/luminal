// ── Netcode Barriers ─────────────────────────────────────
// Extracted from netcode.ts for file size compliance.
// All barrier methods share the same pattern: write to RTDB at
// matches/{matchId}/{path}/{uid}, listen for all players to confirm.

import { rtdb } from '../firebase';
import { ref, set, update, onValue, off, serverTimestamp } from 'firebase/database';
import type { DatabaseReference, Unsubscribe as FirebaseUnsubscribe } from 'firebase/database';
import { net } from '../netLog';

interface ListenerEntry {
  ref: DatabaseReference;
  cb: FirebaseUnsubscribe;
}

/** Narrow context from NetcodeSession that barriers need. */
export interface BarrierContext {
  readonly matchId: string;
  readonly myUid: string;
  readonly allPlayerUids: string[];
  readonly serverTimeOffset: number;
  addListener(entry: ListenerEntry): void;
  removeListener(r: DatabaseReference): void;
}

/** Typed payload for round-end confirmations. */
interface RoundEndPayload {
  [uid: string]: { round?: number; winner?: string; ts?: number };
}

/** Typed payload for timestamp-bearing confirmations. */
interface TimestampPayload {
  [uid: string]: { ts?: number; round?: number; clientTs?: number };
}

/** Manages RTDB barrier synchronization between match players. */
export class NetcodeBarriers {
  private _nextRoundListenerRef: DatabaseReference | null = null;
  private _loadedListenerRef: DatabaseReference | null = null;
  private _rematchListenerRef: DatabaseReference | null = null;

  // ── Generic all-players-confirmed barrier ──────────────

  private _onAllConfirmed(
    ctx: BarrierContext,
    path: string,
    callback: (val: Record<string, unknown>) => void,
    opts?: {
      fired?: { value: boolean };
      trackedRef?: { current: DatabaseReference | null };
      computeDelay?: boolean;
    },
  ): void {
    // If we have a tracked ref, clean up previous listener
    if (opts?.trackedRef?.current) {
      off(opts.trackedRef.current);
      ctx.removeListener(opts.trackedRef.current);
      opts.trackedRef.current = null;
    }

    const nodeRef = ref(rtdb, `matches/${ctx.matchId}/${path}`);
    const cb = onValue(nodeRef, (snap) => {
      if (opts?.fired && opts.fired.value) return;
      const val = snap.val();
      if (!val) return;
      if (ctx.allPlayerUids.every(uid => val[uid])) {
        if (opts?.fired) opts.fired.value = true;
        callback(val);
      }
    });

    if (opts?.trackedRef) opts.trackedRef.current = nodeRef;
    ctx.addListener({ ref: nodeRef, cb });
  }

  // ── Round end ──────────────────────────────────────────

  onAllRoundEnd(ctx: BarrierContext, callback: (val: RoundEndPayload) => void): void {
    this._onAllConfirmed(ctx, 'roundEnd', callback as (val: Record<string, unknown>) => void);
  }

  // ── Accept ─────────────────────────────────────────────

  async writeAccept(
    ctx: BarrierContext,
    vehicleType: string = 'bike',
    protocolVersion: number = 1,
    transport?: { websocket: boolean; wsProtocol: number },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      v: protocolVersion,
      vehicle: vehicleType,
      ts: Date.now(),
    };
    if (transport) payload.transport = transport;
    await set(ref(rtdb, `matches/${ctx.matchId}/accept/${ctx.myUid}`), payload);
  }

  onAllAccepted(ctx: BarrierContext, callback: () => void): void {
    this._onAllConfirmed(ctx, 'accept', () => { net.info('[barrier] all-accepted'); callback(); });
  }

  // ── Next round ─────────────────────────────────────────

  async writeNextRound(ctx: BarrierContext, currentRound: number): Promise<void> {
    await set(ref(rtdb, `matches/${ctx.matchId}/nextRound/${ctx.myUid}`), {
      ts: serverTimestamp(),
      round: currentRound,
    });
  }

  onAllNextRound(ctx: BarrierContext, currentRound: number, callback: (delayMs: number) => void): void {
    if (this._nextRoundListenerRef) {
      off(this._nextRoundListenerRef);
      ctx.removeListener(this._nextRoundListenerRef);
      this._nextRoundListenerRef = null;
    }
    const nrRef = ref(rtdb, `matches/${ctx.matchId}/nextRound`);
    let fired = false;
    const cb = onValue(nrRef, (snap) => {
      if (fired) return;
      const val = snap.val() as TimestampPayload | null;
      if (val && ctx.allPlayerUids.every(uid =>
        val[uid] && (val[uid].round === undefined || val[uid].round === currentRound)
      )) {
        fired = true;
        const delayMs = this._computeSyncDelay(ctx, val);
        net.info('[barrier] all-nextRound delayMs=' + delayMs);
        callback(delayMs);
      }
    });
    this._nextRoundListenerRef = nrRef;
    ctx.addListener({ ref: nrRef, cb });
  }

  // ── Loaded ─────────────────────────────────────────────

  async writeLoaded(ctx: BarrierContext, currentRound: number): Promise<void> {
    await set(ref(rtdb, `matches/${ctx.matchId}/loaded/${ctx.myUid}`), {
      ts: serverTimestamp(),
      clientTs: Date.now(),
      round: currentRound,
    });
  }

  onAllLoaded(ctx: BarrierContext, currentRound: number, callback: (delayMs: number) => void): void {
    if (this._loadedListenerRef) {
      off(this._loadedListenerRef);
      ctx.removeListener(this._loadedListenerRef);
      this._loadedListenerRef = null;
    }
    const loadedRef = ref(rtdb, `matches/${ctx.matchId}/loaded`);
    let fired = false;
    const cb = onValue(loadedRef, (snap) => {
      if (fired) return;
      const val = snap.val() as TimestampPayload | null;
      if (val && ctx.allPlayerUids.every(uid =>
        val[uid] && (val[uid].round === undefined || val[uid].round === currentRound)
      )) {
        fired = true;
        const delayMs = this._computeSyncDelay(ctx, val);
        net.info('[barrier] all-loaded delayMs=' + delayMs);
        callback(delayMs);
      }
    });
    this._loadedListenerRef = loadedRef;
    ctx.addListener({ ref: loadedRef, cb });
  }

  // ── Rematch ────────────────────────────────────────────

  async writeRematch(ctx: BarrierContext): Promise<void> {
    await set(ref(rtdb, `matches/${ctx.matchId}/rematch/${ctx.myUid}`), true);
  }

  onAllRematch(ctx: BarrierContext, callback: () => void): void {
    if (this._rematchListenerRef) {
      off(this._rematchListenerRef);
      ctx.removeListener(this._rematchListenerRef);
      this._rematchListenerRef = null;
    }
    const rmRef = ref(rtdb, `matches/${ctx.matchId}/rematch`);
    let fired = false;
    const cb = onValue(rmRef, (snap) => {
      if (fired) return;
      const val = snap.val();
      if (val && ctx.allPlayerUids.every(uid => val[uid])) {
        fired = true;
        net.info('[barrier] all-rematch'); callback();
      }
    });
    this._rematchListenerRef = rmRef;
    ctx.addListener({ ref: rmRef, cb });
  }

  // ── Meta ───────────────────────────────────────────────

  async updateMeta(ctx: BarrierContext, updates: Record<string, unknown>): Promise<void> {
    const metaRef = ref(rtdb, `matches/${ctx.matchId}/meta`);
    await update(metaRef, updates);
  }

  // ── Shared delay computation ───────────────────────────

  private _computeSyncDelay(ctx: BarrierContext, val: TimestampPayload): number {
    let laterTs = 0;
    for (const uid of ctx.allPlayerUids) {
      const playerTs: number = typeof val[uid] === 'object' ? val[uid].ts || 0 : 0;
      if (playerTs > laterTs) laterTs = playerTs;
    }
    const offset: number = ctx.serverTimeOffset || 0;
    const serverNow: number = Date.now() + offset;
    const startAt: number = laterTs + 500;
    return Math.max(50, startAt - serverNow);
  }

  /** Clean up tracked barrier listener refs. */
  cleanupTrackedRefs(removeListener: (r: DatabaseReference) => void): void {
    if (this._nextRoundListenerRef) {
      off(this._nextRoundListenerRef);
      removeListener(this._nextRoundListenerRef);
      this._nextRoundListenerRef = null;
    }
    if (this._loadedListenerRef) {
      off(this._loadedListenerRef);
      removeListener(this._loadedListenerRef);
      this._loadedListenerRef = null;
    }
    if (this._rematchListenerRef) {
      off(this._rematchListenerRef);
      removeListener(this._rematchListenerRef);
      this._rematchListenerRef = null;
    }
  }
}

// ── Lockstep Hash Sync ────────────────────────────────────
// Extracted from NetcodeSession for file size compliance.

import { rtdb } from '../firebase';
import { ref, set, onValue, off } from 'firebase/database';
import type { SyncContext, ListenerEntry } from './lockstepInputSync';
import { net } from '../netLog';

/** Manages lockstep state hash exchange for desync detection. */
export class LockstepHashSync {
  private _listeners = new Map<string, ListenerEntry>();

  startSync(ctx: SyncContext, onRemote: (tick: number, hash: number) => void): void {
    net.info('[hash] sync-start');
    if (ctx.transport) return;

    for (const [, entry] of this._listeners) {
      off(entry.ref);
      ctx.removeListener(entry.ref);
    }
    this._listeners.clear();

    for (const oppUid of ctx.opponentUids) {
      const hashRef = ref(rtdb, `matches/${ctx.matchId}/hashes/${oppUid}`);
      const cb = onValue(hashRef, (snap) => {
        const val = snap.val();
        if (!val || typeof val.tick !== 'number' || typeof val.hash !== 'number') return;
        onRemote(val.tick, val.hash);
      });
      const entry: ListenerEntry = { ref: hashRef, cb };
      this._listeners.set(oppUid, entry);
      ctx.addListener(entry);
    }
  }

  sendHash(ctx: SyncContext, tick: number, hash: number): void {
    if (ctx.transport) {
      ctx.transport.sendHash(tick, hash);
      net.log('[hash] send tick=' + tick + ' hash=0x' + hash.toString(16) + ' via=transport');
      return;
    }
    set(ref(rtdb, `matches/${ctx.matchId}/hashes/${ctx.myUid}`), { tick, hash }).catch(() => {});
    net.log('[hash] send tick=' + tick + ' hash=0x' + hash.toString(16) + ' via=firebase');
  }
}

// ── Lockstep Recovery Snapshot Sync ───────────────────────
// Extracted from NetcodeSession for file size compliance.

import { rtdb } from '../firebase';
import { ref, set, onValue, off } from 'firebase/database';
import type { SyncContext, ListenerEntry } from './lockstepInputSync';
import { net } from '../netLog';

/** Manages desync recovery snapshot exchange. */
export class LockstepRecoverySync {
  private _listeners = new Map<string, ListenerEntry>();

  startSync(ctx: SyncContext, onRemote: (data: unknown) => void): void {
    net.info('[recovery] snapshot-sync-start');
    if (ctx.transport) return;

    for (const [, entry] of this._listeners) {
      off(entry.ref);
      ctx.removeListener(entry.ref);
    }
    this._listeners.clear();

    for (const oppUid of ctx.opponentUids) {
      const snapRef = ref(rtdb, `matches/${ctx.matchId}/snapshot/${oppUid}`);
      const cb = onValue(snapRef, (snap) => {
        const val = snap.val();
        if (!val || typeof val.tick !== 'number') return;
        onRemote(val);
      });
      const entry: ListenerEntry = { ref: snapRef, cb };
      this._listeners.set(oppUid, entry);
      ctx.addListener(entry);
    }
  }

  sendSnapshot(ctx: SyncContext, data: unknown): void {
    if (ctx.transport) {
      ctx.transport.sendSnapshot(data);
      net.info('[recovery] send-snapshot via=transport');
      return;
    }
    set(ref(rtdb, `matches/${ctx.matchId}/snapshot/${ctx.myUid}`), data).catch(() => {});
    net.info('[recovery] send-snapshot via=firebase');
  }
}

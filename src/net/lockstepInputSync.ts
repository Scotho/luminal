// ── Lockstep Input Sync ───────────────────────────────────
// Extracted from NetcodeSession for file size compliance.

import { rtdb } from '../firebase';
import { ref, set, onValue, off } from 'firebase/database';
import type { DatabaseReference, Unsubscribe as FirebaseUnsubscribe } from 'firebase/database';
import type { InputFrame } from '../core/simulation';
import type { MatchTransport } from './matchTransport';
import { net } from '../netLog';

export interface ListenerEntry {
  ref: DatabaseReference;
  cb: FirebaseUnsubscribe;
}

/** Narrow interface for the parts of NetcodeSession that sync modules need. */
export interface SyncContext {
  matchId: string;
  myUid: string;
  opponentUids: string[];
  transport: MatchTransport | null;
  addListener(entry: ListenerEntry): void;
  removeListener(ref: DatabaseReference): void;
}

/** Manages lockstep input packet exchange between players. */
export class LockstepInputSync {
  private _listeners = new Map<string, ListenerEntry>();

  startSync(
    ctx: SyncContext,
    uidToIndex: Map<string, number>,
    onRemote: (playerIndex: number, frames: InputFrame[]) => void,
  ): void {
    net.info('[input] sync-start opponents=' + ctx.opponentUids.length);
    if (ctx.transport) return;

    for (const [, entry] of this._listeners) {
      off(entry.ref);
      ctx.removeListener(entry.ref);
    }
    this._listeners.clear();

    for (const oppUid of ctx.opponentUids) {
      const inputRef = ref(rtdb, `matches/${ctx.matchId}/inputs/${oppUid}`);
      const cb = onValue(inputRef, (snap) => {
        const val = snap.val();
        if (!val || !Array.isArray(val)) return;
        const idx = uidToIndex.get(oppUid);
        if (idx !== undefined) {
          onRemote(idx, val as InputFrame[]);
        }
      });
      const entry: ListenerEntry = { ref: inputRef, cb };
      this._listeners.set(oppUid, entry);
      ctx.addListener(entry);
    }
  }

  sendInputs(ctx: SyncContext, packet: InputFrame[]): void {
    if (ctx.transport) {
      ctx.transport.sendInputs(packet);
      net.log('[input] send frames=' + packet.length + ' via=transport');
      return;
    }
    const base = `matches/${ctx.matchId}`;
    set(ref(rtdb, `${base}/inputs/${ctx.myUid}`), packet).catch((err) => {
      net.warn('[input] firebase write failed: ' + (err as Error)?.message);
    });
    net.log('[input] send frames=' + packet.length + ' via=firebase');
  }
}

// ── Match Room Manager ───────────────────────────────────
// Ephemeral in-memory room tracking. Sockets join a matchId room
// after auth. Messages relay to other sockets in the same room.

import type { WebSocket } from 'ws';

interface RoomMember {
  uid: string;
  ws: WebSocket;
}

export class RoomManager {
  /** matchId → Map<uid, RoomMember> */
  private _rooms: Map<string, Map<string, RoomMember>> = new Map();
  /** ws → matchId (reverse lookup for leave) */
  private _socketToRoom: Map<WebSocket, string> = new Map();
  /** matchId → last activity timestamp (epoch ms) */
  private _lastActivity: Map<string, number> = new Map();

  join(matchId: string, uid: string, ws: WebSocket): void {
    if (!this._rooms.has(matchId)) {
      this._rooms.set(matchId, new Map());
    }
    const room = this._rooms.get(matchId)!;

    // If this uid already has a socket (reconnect), terminate the old one
    // so it can't keep injecting packets for the same uid
    const existing = room.get(uid);
    if (existing && existing.ws !== ws) {
      this._socketToRoom.delete(existing.ws);
      try { existing.ws.terminate(); } catch { /* already closed */ }
    }

    room.set(uid, { uid, ws });
    this._socketToRoom.set(ws, matchId);
    this._lastActivity.set(matchId, Date.now());
  }

  leave(ws: WebSocket): void {
    const matchId = this._socketToRoom.get(ws);
    if (!matchId) return;

    const room = this._rooms.get(matchId);
    if (room) {
      for (const [uid, member] of room) {
        if (member.ws === ws) {
          room.delete(uid);
          break;
        }
      }
      if (room.size === 0) {
        this._rooms.delete(matchId);
        this._lastActivity.delete(matchId);
      }
    }
    this._socketToRoom.delete(ws);
  }

  /** Relay a message to all other sockets in the same room, injecting fromUid. */
  relay(matchId: string, fromUid: string, msg: Record<string, unknown>): void {
    const room = this._rooms.get(matchId);
    if (!room) return;

    this._lastActivity.set(matchId, Date.now());
    const envelope = JSON.stringify({ ...msg, fromUid });

    for (const [uid, member] of room) {
      if (uid !== fromUid) {
        try {
          member.ws.send(envelope);
        } catch {
          // Socket may have closed — will be cleaned up on close event
        }
      }
    }
  }

  getRoomSize(matchId: string): number {
    return this._rooms.get(matchId)?.size ?? 0;
  }

  get roomCount(): number {
    return this._rooms.size;
  }

  /** Reap rooms that have been idle longer than maxIdleMs. Returns count of rooms reaped. */
  reap(maxIdleMs: number): number {
    const now = Date.now();
    let reaped = 0;

    for (const [matchId, room] of this._rooms) {
      const lastActive = this._lastActivity.get(matchId) ?? 0;
      if (now - lastActive > maxIdleMs) {
        for (const [, member] of room) {
          try { member.ws.terminate(); } catch { /* already closed */ }
          this._socketToRoom.delete(member.ws);
        }
        this._rooms.delete(matchId);
        this._lastActivity.delete(matchId);
        reaped++;
      }
    }

    return reaped;
  }

  /** Start a periodic reaper that cleans up idle rooms. */
  startReaper(intervalMs: number, maxIdleMs: number): void {
    setInterval(() => this.reap(maxIdleMs), intervalMs);
  }
}

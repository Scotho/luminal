// ── Luminal WebSocket Relay Server ───────────────────────
// Authenticates via Firebase, rooms sockets by matchId,
// relays lockstep packets between match participants.

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import admin from 'firebase-admin';
import { verifyAndAuthorize } from './auth.js';
import { RoomManager } from './rooms.js';
import { RateLimiter } from './rateLimit.js';
import { isAuthMessage, isValidGameMessage, LIMITS } from './protocol.js';

// ── Firebase Admin init ──────────────────────────────────
try {
  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL || undefined,
  });
} catch (error) {
  console.error('Firebase initialization failed:', error);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '8080', 10);
const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30_000;

const rooms = new RoomManager();
rooms.startReaper(5 * 60_000, 30 * 60_000); // check every 5 min, reap after 30 min idle

// ── Per-socket metadata ──────────────────────────────────
interface SocketMeta {
  uid: string;
  matchId: string;
  rateLimiter: RateLimiter;
  alive: boolean;
}
const socketMeta = new WeakMap<WebSocket, SocketMeta>();

// ── HTTP + WebSocket Server ──────────────────────────────
const server = createServer((_req, res) => {
  // Health check for Cloud Run
  res.writeHead(200);
  res.end('ok');
});

const wss = new WebSocketServer({ server });

function safeSend(ws: WebSocket, data: string): void {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  } catch {
    // Socket may have closed
  }
}

wss.on('connection', (ws: WebSocket) => {
  let authenticated = false;
  let authenticating = false;

  // Auth timeout — close if no auth message within AUTH_TIMEOUT_MS
  const authTimer = setTimeout(() => {
    if (!authenticated) {
      log('auth-timeout', {});
      ws.close(4001, 'auth timeout');
    }
  }, AUTH_TIMEOUT_MS);

  ws.on('message', async (raw: Buffer | string) => {
    // Size check
    const size = typeof raw === 'string' ? raw.length : raw.byteLength;
    if (size > LIMITS.maxMessageBytes) {
      ws.close(4002, 'message too large');
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
    } catch {
      return; // Ignore malformed JSON
    }

    // ── Auth phase ──────────────────────────────────────
    if (!authenticated) {
      if (authenticating) return; // Drop messages during concurrent auth
      if (!isAuthMessage(msg)) {
        ws.close(4003, 'expected auth message');
        return;
      }

      authenticating = true;
      const result = await verifyAndAuthorize(msg.token, msg.matchId, msg.uid);
      authenticating = false;
      clearTimeout(authTimer);

      // Socket may have closed during async auth verification
      if (ws.readyState !== WebSocket.OPEN) return;

      if (!result.ok) {
        log('auth-fail', { matchId: msg.matchId, uid: msg.uid, reason: result.reason });
        safeSend(ws, JSON.stringify({ kind: 'auth-fail', reason: result.reason }));
        ws.close(4004, 'auth failed');
        return;
      }

      authenticated = true;
      const meta: SocketMeta = {
        uid: msg.uid,
        matchId: msg.matchId,
        rateLimiter: new RateLimiter(LIMITS.maxMessagesPerSecond),
        alive: true,
      };
      socketMeta.set(ws, meta);

      rooms.join(msg.matchId, msg.uid, ws);
      log('joined', { matchId: msg.matchId, uid: msg.uid, roomSize: rooms.getRoomSize(msg.matchId) });

      safeSend(ws, JSON.stringify({ kind: 'auth-ok' }));
      return;
    }

    // ── Game phase ──────────────────────────────────────
    const meta = socketMeta.get(ws);
    if (!meta) return;

    // Rate limit
    if (!meta.rateLimiter.check()) {
      return; // Silently drop
    }

    // Handle ping/pong locally (don't relay)
    if (msg.kind === 'ping') {
      safeSend(ws, JSON.stringify({ kind: 'pong', ts: msg.ts }));
      return;
    }

    // Validate game message
    if (!isValidGameMessage(msg)) return;

    // Relay to other sockets in the same match room
    rooms.relay(meta.matchId, meta.uid, msg);
  });

  ws.on('close', (code: number) => {
    clearTimeout(authTimer);
    const meta = socketMeta.get(ws);
    if (meta) {
      log('left', { matchId: meta.matchId, uid: meta.uid, code });
      rooms.leave(ws);
    }
  });

  ws.on('pong', () => {
    const meta = socketMeta.get(ws);
    if (meta) meta.alive = true;
  });
});

// ── Server-side heartbeat (ws ping/pong) ─────────────────
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const meta = socketMeta.get(ws);
    if (meta && !meta.alive) {
      log('heartbeat-timeout', { matchId: meta.matchId, uid: meta.uid });
      rooms.leave(ws);
      ws.terminate();
      return;
    }
    if (meta) meta.alive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ── Graceful shutdown ────────────────────────────────────
process.on('SIGTERM', () => {
  log('shutdown', { reason: 'SIGTERM' });
  clearInterval(heartbeatInterval);
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

// ── Logging ──────────────────────────────────────────────
function log(event: string, data: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), event, ...data };
  console.log(JSON.stringify(entry));
}

// ── Start ────────────────────────────────────────────────
server.listen(PORT, () => {
  log('relay-start', { port: PORT });
});

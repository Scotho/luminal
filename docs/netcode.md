# Netcode Architecture

Reference for AI agents working on the multiplayer netcode stack. Focuses on architectural relationships and design invariants that aren't obvious from reading source files.

---

## Match Lifecycle Flow

```
matchmaking queue pop
  → negotiate transport (onlineMatch.ts accept())
  → connect transport (firebaseMatchTransport.ts or webSocketMatchTransport.ts)
  → accept barrier (netcode.ts)
  → ready / loaded barriers (netcode.ts)
  → countdown (onlineMatch.ts)
  → input exchange + lockstep sim (lockstepManager.ts, inputBuffer.ts)
  → hash verification every 60 ticks (lockstepManager.ts)
  → desync recovery if needed (lockstepManager.ts, game.ts)
  → death detection from sim state (lockstepManager.ts)
  → round end + majority-vote reconciliation (onlineMatch.ts)
  → next round / rematch / disconnect
```

---

## Transport Layer

The netcode has a hard split between two traffic lanes:

**RTDB lane (always):** Barriers (accept, ready, loaded, nextRound, roundEnd, rematch), death event bookkeeping, heartbeat, match metadata, state-stream mode. These stay on Firebase RTDB regardless of transport choice.

**Transport lane (pluggable):** Input packets, hash packets, snapshot packets, ping/pong RTT. These flow through whichever `MatchTransport` implementation is active — either `FirebaseMatchTransport` (RTDB listeners) or `WebSocketMatchTransport` (Cloud Run relay).

### Why this split matters

Changing barrier or event logic? Work in `netcode.ts` — it always uses RTDB. Changing packet delivery? Work in the transport implementations. Mixing these up breaks the abstraction.

### Transport Negotiation

`resolveTransport()` in `src/net/transportNegotiation.ts` runs during the RTDB accept handshake. **Unanimous WebSocket support is required** — any client without it forces Firebase for all players. This means new transport features must be backwards-compatible or gated behind capability flags.

### Heartbeat Mirroring

WebSocket transport mirrors heartbeat writes to RTDB every 3s. This exists because `claimForfeit` Cloud Function reads heartbeat staleness from RTDB. If you remove or change heartbeat mirroring, forfeit detection breaks for WebSocket matches.

---

## NetcodeSession Facade

`src/netcode.ts` is a facade, not a transport. Understanding what it owns vs. delegates prevents putting logic in the wrong place.

**Owns:** RTDB barriers, event bookkeeping, heartbeat, state-stream mode, RTT measurement. These are always RTDB-based and don't change with transport.

**Delegates:** Live lockstep packets (inputs, hashes, snapshots) to whichever `MatchTransport` is attached via `attachTransport()`. Before this call, packet listeners are per-opponent RTDB refs. After, they go through the transport.

**State-stream mode** (`useLockstep = false`): Legacy fallback that sends full position state at 20Hz via RTDB. Only active for protocol v0 clients. All new code should assume lockstep mode.

---

## Lockstep Manager

`src/core/lockstepManager.ts` drives the deterministic simulation. Constants and formulas are at the top of the file — read them there. What matters here is the design invariants.

### Truth Model

**Sim-authoritative death:** A player is dead because the deterministic sim's `alive` state became `false` on a given tick. Lockstep mode does **not** depend on peer death claims or Firebase death events for correctness. Firebase writes are bookkeeping only.

**Round-end truth:** Winner/draw is derived from deterministic sim state in lockstep mode. The majority-vote reconciliation in `onlineMatch.ts` handles edge cases (desync disagreements) with deterministic tie-breaking (descending vote count, then lexicographic UID).

If you're changing death or round-end logic, the sim is the source of truth. Don't re-introduce dependence on peer claims — that was explicitly removed.

### Desync Recovery Precision

When player 0 sends a recovery snapshot, they also snap their own state to serialized precision: `deserializeSimState(serializeSimState(state))`. This is a correctness invariant — without it, the sender keeps full-precision floats while the receiver gets rounded values, and they immediately diverge again on the next tick.

### Input Delay Invariant

Input delay is recalculated **between rounds only**, never mid-round. The formula is in `computeInputDelay()` in `inputBuffer.ts`. If you add dynamic delay adjustment, it must respect this boundary — changing delay mid-round breaks the lockstep contract.

---

## Match Lifecycle

`src/onlineMatch.ts` orchestrates the match from queue pop to teardown.

### Cleanup Ownership

Match document deletion is **not** done client-side. The `cleanupStaleMatches` Cloud Function handles RTDB removal on a 24h TTL (runs every 6 hours). Client-side deletion was removed because it created a race: the cleanup owner could delete `/meta` before the other player finished writing, producing cascading `permission_denied` errors and a false "opponent disconnected" screen. See the comment in `onlineMatch.ts` around the `_cleanup` method. Don't reintroduce client-side deletion — if you need a new cleanup path, add it to the Cloud Function instead.

### Forfeit

Server-validated via `claimForfeit()` Cloud Function — separate from sim-derived death. The Cloud Function checks heartbeat staleness in RTDB, which is why heartbeat mirroring (see Transport Layer) must keep working.

---

## Key Files

Transport: `src/net/matchTransport.ts` (interface), `src/net/firebaseMatchTransport.ts`, `src/net/webSocketMatchTransport.ts`, `src/net/transportNegotiation.ts`, `src/net/protocol.ts`, `src/net/firebasePaths.ts`, `src/net/disconnectPolicy.ts`

Relay: `relay/src/index.ts`, `relay/src/rooms.ts`, `relay/src/auth.ts`

Core: `src/core/lockstepManager.ts`, `src/core/simulation.ts`, `src/core/inputBuffer.ts`, `src/core/collisionSystem.ts`

Orchestration: `src/netcode.ts`, `src/onlineMatch.ts`, `src/game.ts`

Rules: `database.rules.json`

// admin/src/config.ts — Centralized configuration constants for the admin dashboard.
// All hardcoded ports, URLs, timeouts, and session thresholds live here.

// ── Ports ──────────────────────────────────────────────────
export const PORTS = {
  admin: 5175,
  game: 5173,
  preview: 5174,
  adminAlt: 5176,
  functions: 5001,
  ollama: 11434,
  emulatorAuth: 9099,
  emulatorRtdb: 9000,
  emulatorFirestore: 8080,
} as const;

// ── Base URLs ──────────────────────────────────────────────
export const ADMIN_BASE = `http://localhost:${PORTS.admin}`;
export const GAME_DEV_BASE = `http://localhost:${PORTS.game}`;
export const OLLAMA_BASE = `http://localhost:${PORTS.ollama}`;

// ── Timeouts (ms) ──────────────────────────────────────────
export const TIMEOUTS = {
  test: 5 * 60_000,          // 5 min
  claude: 30 * 60_000,       // 30 min
  script: 30_000,            // 30 sec
  aider: 20 * 60_000,        // 20 min
  git: 30_000,               // 30 sec
  idle: 5 * 60_000,          // 5 min idle watchdog
  killGrace: 3_000,          // 3 sec SIGTERM→SIGKILL
  shell: 30_000,             // 30 sec shell commands
  depInfo: 10_000,           // 10 sec dependency info
} as const;

// ── Session Thresholds ─────────────────────────────────────
export const SESSION = {
  staleThresholdMs: 24 * 60 * 60_000,    // 24 hours
  archiveAgeMs: 7 * 24 * 60 * 60_000,    // 7 days
} as const;

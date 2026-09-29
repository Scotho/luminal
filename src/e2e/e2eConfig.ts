// src/e2e/e2eConfig.ts
// Shared constants for E2E test harness.

export const E2E_RELAY_PORT = 9876;
export const E2E_RELAY_URL = `ws://localhost:${E2E_RELAY_PORT}`;

/** Max ticks before a scenario is considered hung. */
export const MAX_SCENARIO_TICKS = 3600; // 60s at 60Hz

/** Default soak test duration in ms. */
export const DEFAULT_SOAK_DURATION_MS = 60_000;

/** Tick interval for state recording (every N ticks). 1 = every tick. */
export const RECORD_INTERVAL = 1;

/** Tick interval for hash comparison across clients. Matches HASH_INTERVAL in lockstepManager. */
export const HASH_CHECK_INTERVAL = 60;

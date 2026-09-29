/**
 * SPEC-89: All tunable FLOW constants.
 * One file to re-balance everything during a game-feel pass.
 */

/** Seconds between passive flow ticks */
export const FLOW_TICK_INTERVAL_SEC = 0.25;

/** Per-tick passive amounts (rate * FLOW_TICK_INTERVAL_SEC, rounded to spec values) */
export const FLOW_TICK_AMOUNT = {
  slipstream: 5,
  grind: 5,
  'drift-low': 3,
  'drift-med': 4,
  'drift-high': 5,
} as const;

/** One-shot bonus amounts */
export const FLOW_BONUS = {
  elimination: 125,
  survivalPerSec: 3,
  boostPerSec: 8,
  nearMiss: 40,
} as const;

/** Soft cap: gains above this are sqrt-compressed */
export const FLOW_SOFT_CAP = 2000;

/** Hard cap: gains above this are zeroed */
export const FLOW_HARD_CAP = 2500;

/** Whether to show banked FLOW teaser in round-end reveal (SPEC-91) */
export const FLOW_REVEAL_SHOW_BANK_TEASER = false;

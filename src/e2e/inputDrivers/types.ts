// src/e2e/inputDrivers/types.ts
import type { InputFrame, SimState } from '../../core/simulation';

/** Drives input for a headless client — either scripted or bot AI. */
export interface InputDriver {
  /** Return the input for this tick given current sim state. */
  getInput(tick: number, state: SimState, playerIndex: number): InputFrame;

  /** Whether this driver has completed its scenario (always false for bots). */
  isDone(tick: number): boolean;
}

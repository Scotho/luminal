import type { SimState } from '../core/simulation';
import { cloneSimState } from '../core/simulation';

export class StateRecorder {
  private _states = new Map<number, SimState>();
  private _deaths: Array<{ playerIndex: number; tick: number }> = [];
  private _hashes: Array<{ tick: number; hash: number }> = [];

  record(state: SimState): void {
    this._states.set(state.tick, cloneSimState(state));
  }

  getStateAt(tick: number): SimState | undefined {
    return this._states.get(tick);
  }

  getAllStates(): Map<number, SimState> {
    return this._states;
  }

  recordDeath(playerIndex: number, tick: number): void {
    this._deaths.push({ playerIndex, tick });
  }

  getDeaths(): Array<{ playerIndex: number; tick: number }> {
    return this._deaths;
  }

  recordHash(tick: number, hash: number): void {
    this._hashes.push({ tick, hash });
  }

  getHashes(): Array<{ tick: number; hash: number }> {
    return this._hashes;
  }

  clear(): void {
    this._states.clear();
    this._deaths.length = 0;
    this._hashes.length = 0;
  }
}

import type { InputFrame, SimState } from '../../core/simulation';
import type { InputDriver } from './types';

interface ScriptEntry {
  tick: number;
  input: Partial<InputFrame>;
}

function neutralInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
}

export class ScriptedInputDriver implements InputDriver {
  private _script: ScriptEntry[];
  private _holdAfterLast: number;

  constructor(script: ScriptEntry[], holdAfterLast = 120) {
    this._script = script.slice().sort((a, b) => a.tick - b.tick);
    this._holdAfterLast = holdAfterLast;
  }

  getInput(tick: number, _state: SimState, _playerIndex: number): InputFrame {
    let active: ScriptEntry | null = null;
    for (const entry of this._script) {
      if (entry.tick <= tick) active = entry;
      else break;
    }
    if (!active) return neutralInput(tick);
    return {
      ...neutralInput(tick),
      ...active.input,
      tick,
    };
  }

  isDone(tick: number): boolean {
    if (this._script.length === 0) return true;
    const lastTick = this._script[this._script.length - 1].tick;
    return tick > lastTick + this._holdAfterLast;
  }
}

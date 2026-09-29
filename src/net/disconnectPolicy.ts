// ── Graduated Disconnect Policy ────────────────────────────
// State machine that tracks opponent connectivity via confirmed input receipts.
// Transitions: connected → warning (5s) → critical (10s) → forfeit (20/30s)

export type DisconnectLevel = 'connected' | 'warning' | 'critical' | 'forfeit';

export interface DisconnectPolicyConfig {
  warningMs: number;
  criticalMs: number;
  forfeitMs: number;
}

export const CASUAL_POLICY: DisconnectPolicyConfig = {
  warningMs: 5_000,
  criticalMs: 10_000,
  forfeitMs: 20_000,
};

// ts-prune-ignore-next
export const RANKED_POLICY: DisconnectPolicyConfig = {
  warningMs: 5_000,
  criticalMs: 10_000,
  forfeitMs: 30_000,
};

export class DisconnectPolicy {
  private _config: DisconnectPolicyConfig;
  private _lastInputWallClock: number = Date.now();
  private _level: DisconnectLevel = 'connected';
  private _onLevelChange: ((level: DisconnectLevel, elapsedMs: number) => void) | null = null;

  constructor(config: DisconnectPolicyConfig) {
    this._config = config;
  }

  /** Register callback for level transitions. */
  onLevelChange(cb: (level: DisconnectLevel, elapsedMs: number) => void): void {
    this._onLevelChange = cb;
  }

  /** Call when confirmed remote input is received. Resets timer and transitions back to connected. */
  recordInput(): void {
    this._lastInputWallClock = Date.now();
    if (this._level !== 'connected') {
      this._level = 'connected';
      if (this._onLevelChange) this._onLevelChange('connected', 0);
    }
  }

  /** Call each frame. Returns current disconnect level. */
  update(): DisconnectLevel {
    const elapsed = Date.now() - this._lastInputWallClock;
    let newLevel: DisconnectLevel;

    if (elapsed >= this._config.forfeitMs) {
      newLevel = 'forfeit';
    } else if (elapsed >= this._config.criticalMs) {
      newLevel = 'critical';
    } else if (elapsed >= this._config.warningMs) {
      newLevel = 'warning';
    } else {
      newLevel = 'connected';
    }

    if (newLevel !== this._level) {
      this._level = newLevel;
      if (this._onLevelChange) this._onLevelChange(newLevel, elapsed);
    }

    return this._level;
  }

  get level(): DisconnectLevel { return this._level; }
  get elapsed(): number { return Date.now() - this._lastInputWallClock; }

  /** Reset to initial state (new round / match). */
  reset(): void {
    this._lastInputWallClock = Date.now();
    this._level = 'connected';
  }
}

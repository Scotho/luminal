// ── Online Mode Types ────────────────────────────────────
// Shared host interface used by onlineMode and its extracted
// phase/tick helpers. Declared in a separate module to avoid
// circular imports between onlineMode.ts and its helpers.

import { Player } from '../player';
import { LockstepManager } from '../core/lockstepManager';
import { ReplayRecorder } from '../replay';
import { DemoMode } from './demoMode';
import type { AIState, ColorMap } from '../types/index';
import type { IGameCore } from './index';
import type { DelayAdvisor } from '../core/inputBuffer';
import * as THREE from 'three';

/** Narrow host interface — fields/methods OnlineMode needs from Game. */
export interface IOnlineModeHost extends IGameCore {
  opponent: Player | null;
  matchTime: number;

  // Online / lockstep state
  _lockstep: LockstepManager | null;
  _delayAdvisor: DelayAdvisor;
  _lockstepMyIndex: number;
  _lockstepHumanCount: number;
  _lockstepAiStates: AIState[];

  // Color
  _colorMap: ColorMap;
  playerColor: number;
  playerEmissive: number;

  // Transition
  _transitionCamStart: THREE.Vector3;
  _transitionFovStart: number;
  _transitionTimer: number;
  _transitionDuration: number;
  _victoryFireworks: boolean;

  // Radar
  _radarCtx: CanvasRenderingContext2D | null;

  // Replay
  _replayRecorder: ReplayRecorder;

  // Sub-modes
  _demoMode: DemoMode;

  // Timing / frame counters
  _lastTurnSwooshTime: number;
  _aiFrame: number;

  // Admin
  adminGodMode: boolean;

  // Methods
  _refreshPlayerColor(): void;
  stopBgReplay(): void;
  stopMenuReplay(): void;
  _beginCountdown(): void;
}

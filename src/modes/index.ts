import type { Player } from '../player';
import type { GameState, KillcamPhase, AIState, AIInput } from '../types/index';
import type { OnlineMatch } from '../onlineMatch';
import type * as THREE from 'three';

/** Shared core fields that every mode's host interface needs from Game.
 *  Each I*Host extends this and adds mode-specific fields. */
export interface IGameCore {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  state: GameState;
  mode: string;
  _fading: boolean;
  player: Player | null;
  ais: Array<{ player: Player; aiState: AIState | null; colorHex: number; uid?: string; _lastInput?: AIInput }>;

  // Online
  _onlineMatch: OnlineMatch | null;

  // Killcam (read/written by multiple modes)
  _killcamPhase: KillcamPhase;
  _killcamActive: boolean;
  _killcamPos: THREE.Vector3 | null;
  _killcamStartCamPos: THREE.Vector3 | null;
  _killcamTimer: number;
  _killcamDelayTimer: number;
  _spectating: boolean;

  // Common methods
  cleanup(): void;
  _sceneFade(toBlack: boolean, label?: string): Promise<void>;
}


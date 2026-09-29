import type { InputDriver } from '../inputDrivers/types';
import type { InputFrame, SimState, PlayerSpawn } from '../../core/simulation';
import type { VehiclePhysics } from '../../vehicleConfig';
import type { LoopbackConfig } from '../loopbackTransport';
import type { HeadlessClient } from '../headlessClient';
import type { NetLogEntry } from '../../netLog';

export type MatchType = 'casual' | 'lobby';

export interface PlayerConfig {
  driver: InputDriver;
  physics?: VehiclePhysics;
}

export interface AiConfig {
  physics?: VehiclePhysics;
}

export interface ScenarioConfig {
  name: string;
  matchType: MatchType;
  seed: number;
  humans: PlayerConfig[];
  ais?: AiConfig[];
  network?: LoopbackConfig;
  maxTicks?: number;
  spawns?: PlayerSpawn[];
  stopWhen?: (clients: HeadlessClient[], tick: number) => boolean;
  assert: (clients: HeadlessClient[]) => void;
  assertLogs?: (logs: NetLogEntry[]) => void;
}

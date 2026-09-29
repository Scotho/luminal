import { LockstepManager, type LockstepCallbacks } from '../core/lockstepManager';
import { SIM_DT, type SimState, type InputFrame } from '../core/simulation';
import type { VehiclePhysics } from '../vehicleConfig';
import type { MatchTransport } from '../net/matchTransport';
import type { InputDriver } from './inputDrivers/types';
import { StateRecorder } from './stateRecorder';
import { RECORD_INTERVAL } from './e2eConfig';

export interface HeadlessClientConfig {
  myIndex: number;
  playerCount: number;
  humanCount: number;
  startState: SimState;
  cfgs: VehiclePhysics[];
  transport: MatchTransport;
  inputDriver: InputDriver;
  aiInputProvider?: (playerIndex: number, state: SimState, tick: number) => InputFrame;
  recordInterval?: number;
}

export class HeadlessClient {
  private _lockstep: LockstepManager;
  private _transport: MatchTransport;
  private _inputDriver: InputDriver;
  private _myIndex: number;
  private _recordInterval: number;
  private _tickCount = 0;
  private _disconnected = false;

  readonly recorder: StateRecorder;

  constructor(config: HeadlessClientConfig) {
    this.recorder = new StateRecorder();
    this._transport = config.transport;
    this._inputDriver = config.inputDriver;
    this._myIndex = config.myIndex;
    this._recordInterval = config.recordInterval ?? RECORD_INTERVAL;

    const callbacks: LockstepCallbacks = {
      onSendInputs: (packet) => {
        this._transport.sendInputs(packet);
      },
      onDeath: (playerIndex) => {
        this.recorder.recordDeath(playerIndex, this._lockstep.tick);
      },
      onSendHash: (tick, hash) => {
        this.recorder.recordHash(tick, hash);
        this._transport.sendHash(tick, hash);
      },
      onDesync: (_tick, _localHash, _remoteHash) => {
        // Recorded via hashes — no action needed
      },
      onDesyncRecovery: (localState) => {
        this._transport.sendSnapshot(localState);
      },
      aiInputProvider: config.aiInputProvider,
    };

    this._lockstep = new LockstepManager(
      config.myIndex,
      config.playerCount,
      config.startState,
      config.cfgs,
      callbacks,
      config.humanCount,
    );

    // Wire transport -> lockstep
    this._transport.onRemoteInputs((playerIndex, frames) => {
      this._lockstep.receiveRemoteInputs(playerIndex, frames);
    });
    this._transport.onRemoteHash((tick, hash) => {
      this._lockstep.receiveRemoteHash(tick, hash);
    });
    this._transport.onRemoteSnapshot((data) => {
      this._lockstep.receiveRecoverySnapshot(data as SimState);
    });
    this._transport.onDisconnect(() => {
      this._disconnected = true;
    });
  }

  async start(): Promise<void> {
    await this._transport.connect();
    this._lockstep.start();
  }

  tick(): void {
    if (this._disconnected) return;

    this._tickCount++;
    const state = this._lockstep.state;
    const input = this._inputDriver.getInput(this._tickCount, state, this._myIndex);

    this._lockstep.update(
      SIM_DT,
      input.turnDir,
      input.accelerate,
      input.dash,
      input.brake,
      input.special,
    );

    // Record state at interval
    if (this._tickCount % this._recordInterval === 0) {
      this.recorder.record(this._lockstep.state);
    }
  }

  get currentTick(): number {
    return this._lockstep.tick;
  }

  get isDisconnected(): boolean {
    return this._disconnected;
  }

  get inputDriver(): InputDriver {
    return this._inputDriver;
  }

  stop(): void {
    this._transport.disconnect();
  }
}

import { getVehicleAudioProfile } from './vehicleAudioProfiles';
import { ProceduralEngine } from './engineStrategyProcedural';
import { SweepEngine } from './engineStrategySweep';
import { RpmBandEngine } from './engineStrategyRpmBand';
import { getVehicleBuffer } from './vehicleSfxLoader';
import { getCtx, getSfxOutput, getSfxVolume, noiseBuf } from './sfxContext';
import type { VehicleType, VehicleAudioProfile } from './types/index';

interface EngineStrategy {
  start(dest?: AudioNode): void;
  update(speedFactor: number, accelDir?: number, boosting?: boolean): void;
  stop(): void;
  isRunning(): boolean;
}

interface StrategyWithNodes {
  nodes?: { master?: GainNode };
}

function hasNodes(s: EngineStrategy): s is EngineStrategy & StrategyWithNodes {
  return 'nodes' in s;
}

let _activeStrategy: EngineStrategy | null = null;
let _activeVehicle: VehicleType | null = null;
let _lastSpeedFactor = 0;

// ── Shared boost layer — procedural hoverboard tone at max speed ─────────
// Created alongside the engine, starts silent, fades in when boosting.
interface BoostNodes {
  saw: OscillatorNode;
  saw2: OscillatorNode;
  sawLP: BiquadFilterNode;
  saw2Gain: GainNode;
  noiseSrc: AudioBufferSourceNode;
  noiseBP: BiquadFilterNode;
  noiseGain: GainNode;
  master: GainNode;
}

const BOOST_SMOOTHING = 0.08;
const BOOST_GAIN = 0.0875; // target master gain multiplied by sfxVolume

let _boostNodes: BoostNodes | null = null;

function _createBoostLayer(dest: AudioNode): void {
  _destroyBoostLayer();
  try {
    const c = getCtx();

    const saw = c.createOscillator();
    saw.type = 'triangle';
    saw.frequency.value = 130;

    const sawLP = c.createBiquadFilter();
    sawLP.type = 'lowpass';
    sawLP.frequency.value = 650;
    sawLP.Q.value = 3.0;

    const saw2 = c.createOscillator();
    saw2.type = 'sine';
    saw2.frequency.value = 260;

    const saw2Gain = c.createGain();
    saw2Gain.gain.value = 0.095;

    const noiseSrc = c.createBufferSource();
    noiseSrc.buffer = noiseBuf(c, 3);
    noiseSrc.loop = true;

    const noiseBP = c.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = 1200;
    noiseBP.Q.value = 0.3;

    const noiseGain = c.createGain();
    noiseGain.gain.value = 0.058;

    const master = c.createGain();
    master.gain.value = 0; // starts silent

    saw.connect(sawLP);
    sawLP.connect(master);
    saw2.connect(saw2Gain);
    saw2Gain.connect(master);
    noiseSrc.connect(noiseBP);
    noiseBP.connect(noiseGain);
    noiseGain.connect(master);
    master.connect(dest);

    // Assign BEFORE starting so _destroyBoostLayer can clean up on partial failure
    _boostNodes = { saw, saw2, sawLP, saw2Gain, noiseSrc, noiseBP, noiseGain, master };

    saw.start();
    saw2.start();
    noiseSrc.start();
  } catch {
    // If anything failed after assignment, clean up whatever was created
    _destroyBoostLayer();
  }
}

function _destroyBoostLayer(): void {
  if (!_boostNodes) return;
  const n = _boostNodes;
  _boostNodes = null;
  for (const src of [n.saw, n.saw2, n.noiseSrc] as (OscillatorNode | AudioBufferSourceNode)[]) {
    try { src.stop(); } catch { /* already stopped or never started */ }
  }
  for (const node of [n.saw, n.sawLP, n.saw2, n.saw2Gain, n.noiseSrc, n.noiseBP, n.noiseGain, n.master]) {
    try { node.disconnect(); } catch { /* already disconnected */ }
  }
}

function _updateBoostLayer(boosting: boolean): void {
  if (!_boostNodes) return;
  const target = boosting ? BOOST_GAIN * getSfxVolume() : 0;
  _boostNodes.master.gain.value += (target - _boostNodes.master.gain.value) * BOOST_SMOOTHING;
}

// ── Engine lifecycle ─────────────────────────────────────────────────────

function createStrategy(profile: VehicleAudioProfile): EngineStrategy {
  switch (profile.strategy) {
    case 'sweep':
      return new SweepEngine(profile);
    case 'rpm-band':
      return new RpmBandEngine(profile);
    case 'procedural':
      return new ProceduralEngine(profile.proceduralConfig!);
    default:
      return new ProceduralEngine(profile.proceduralConfig!);
  }
}

export function startVehicleEngine(vehicleType: VehicleType, dest?: AudioNode): void {
  if (_activeStrategy && _activeVehicle !== vehicleType) {
    _activeStrategy.stop();
    _destroyBoostLayer();
    _activeStrategy = null;
    _activeVehicle = null;
  }
  if (_activeStrategy) return;

  const profile = getVehicleAudioProfile(vehicleType);
  _activeStrategy = createStrategy(profile);
  _activeVehicle = vehicleType;
  _lastSpeedFactor = 0;
  _activeStrategy.start(dest);
  _createBoostLayer(dest ?? getSfxOutput(getCtx()));
}

export function updateVehicleEngine(
  speedFactor: number,
  boosting: boolean = false,
): void {
  if (!_activeStrategy) return;
  const accelDir = speedFactor > _lastSpeedFactor ? 1
    : speedFactor < _lastSpeedFactor ? -1
    : 0;
  _activeStrategy.update(speedFactor, accelDir, boosting);
  _updateBoostLayer(boosting);
  _lastSpeedFactor = speedFactor;
}

/** Stop the engine. Plays a shutdown one-shot unless `skipShutdown` is set
 *  (used by the showroom to avoid orphaned audio through getSfxOutput). */
export function stopVehicleEngine(skipShutdown = false): void {
  if (_activeVehicle && !skipShutdown) {
    const profile = getVehicleAudioProfile(_activeVehicle);
    if (profile.shutdown) {
      const buf = getVehicleBuffer(_activeVehicle, profile.shutdown);
      if (buf) {
        try {
          const ctx = getCtx();
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const gain = ctx.createGain();
          gain.gain.value = 0.56 * getSfxVolume();
          src.connect(gain);
          gain.connect(getSfxOutput(ctx));
          src.start();
        } catch { /* expected: audio ctx closed or buffer unavailable during shutdown */ }
      }
    }
  }
  _destroyBoostLayer();
  if (_activeStrategy) {
    _activeStrategy.stop();
    _activeStrategy = null;
  }
  _activeVehicle = null;
  _lastSpeedFactor = 0;
}

/** Fade the engine to silence over `duration` seconds, then fully stop. */
export function fadeOutVehicleEngine(duration: number, onComplete?: () => void): void {
  if (!_activeStrategy) {
    onComplete?.();
    return;
  }
  // Grab refs before clearing so stopVehicleEngine can't run twice
  const strategy = _activeStrategy;
  const boost = _boostNodes;
  _activeStrategy = null;
  _boostNodes = null;
  _activeVehicle = null;
  _lastSpeedFactor = 0;

  // Fade both strategy master and boost master to 0
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    if (hasNodes(strategy)) {
      const master = strategy.nodes?.master;
      if (master instanceof GainNode) {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + duration);
      }
    }
    if (boost?.master) {
      boost.master.gain.cancelScheduledValues(now);
      boost.master.gain.setValueAtTime(boost.master.gain.value, now);
      boost.master.gain.linearRampToValueAtTime(0, now + duration);
    }
  } catch { /* expected: audio ctx may be closed mid-fade */ }

  setTimeout(() => {
    strategy.stop();
    if (boost) {
      for (const src of [boost.saw, boost.saw2, boost.noiseSrc] as (OscillatorNode | AudioBufferSourceNode)[]) {
        try { src.stop(); } catch { /* already stopped */ }
      }
      for (const node of [boost.saw, boost.sawLP, boost.saw2, boost.saw2Gain, boost.noiseSrc, boost.noiseBP, boost.noiseGain, boost.master]) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
    }
    onComplete?.();
  }, duration * 1000 + 50);
}

// ts-prune-ignore-next
export function getActiveVehicleType(): VehicleType | null {
  return _activeVehicle;
}

// ── HMR cleanup — stop orphaned audio on hot reload ──────────────────────
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _destroyBoostLayer();
    if (_activeStrategy) {
      _activeStrategy.stop();
      _activeStrategy = null;
    }
    _activeVehicle = null;
  });
}

import { getCtx, getSfxOutput, getSfxVolume } from './sfxContext';
import { warnDev } from './swallow';
import type { ProceduralConfig } from './types/index';

interface EngineNodes {
  saw: OscillatorNode;
  saw2: OscillatorNode;
  sawLP: BiquadFilterNode;
  saw2Gain: GainNode;
  noiseBP: BiquadFilterNode;
  noiseGain: GainNode;
  master: GainNode;
  noiseSrc: AudioBufferSourceNode;
}

export class ProceduralEngine {
  private nodes: EngineNodes | null = null;
  private running = false;
  private config: ProceduralConfig;

  constructor(config: ProceduralConfig) {
    this.config = config;
  }

  start(dest?: AudioNode): void {
    if (this.running) return;
    try {
      const c = getCtx();
      this.running = true;

      const saw = c.createOscillator();
      saw.type = 'triangle';
      saw.frequency.value = this.config.basePitchIdle;
      const sawLP = c.createBiquadFilter();
      sawLP.type = 'lowpass';
      sawLP.frequency.value = this.config.lpFreqIdle;
      sawLP.Q.value = this.config.idleQ;

      const saw2 = c.createOscillator();
      saw2.type = 'sine';
      saw2.frequency.value = this.config.basePitchIdle * 2;
      const saw2Gain = c.createGain();
      saw2Gain.gain.value = this.config.harmonicGainIdle;

      const noiseSrc = c.createBufferSource();
      const nLen = c.sampleRate * 3;
      const nBuf = c.createBuffer(1, nLen, c.sampleRate);
      const nData = nBuf.getChannelData(0);
      for (let i = 0; i < nLen; i++) nData[i] = Math.random() * 2 - 1;
      noiseSrc.buffer = nBuf;
      noiseSrc.loop = true;
      const noiseBP = c.createBiquadFilter();
      noiseBP.type = 'bandpass';
      noiseBP.frequency.value = this.config.noiseBpFreqIdle;
      noiseBP.Q.value = 0.3;
      const noiseGain = c.createGain();
      noiseGain.gain.value = this.config.noiseGainIdle;

      const master = c.createGain();
      master.gain.value = 0;

      saw.connect(sawLP);
      sawLP.connect(master);
      saw2.connect(saw2Gain);
      saw2Gain.connect(master);
      noiseSrc.connect(noiseBP);
      noiseBP.connect(noiseGain);
      noiseGain.connect(master);
      master.connect(dest ?? getSfxOutput(c));

      saw.start();
      saw2.start();
      noiseSrc.start();

      this.nodes = { saw, saw2, sawLP, saw2Gain, noiseBP, noiseGain, master, noiseSrc };
    } catch {
      this.running = false;
    }
  }

  update(speedFactor: number): void {
    if (!this.nodes) return;
    const n = this.nodes;
    const t = this.config.smoothing;
    const cfg = this.config;

    const basePitch = cfg.basePitchIdle + speedFactor * cfg.basePitchScale;
    n.saw.frequency.value += (basePitch - n.saw.frequency.value) * t;
    n.saw2.frequency.value += (basePitch * 2 - n.saw2.frequency.value) * t;

    const lpFreq = cfg.lpFreqIdle + speedFactor * cfg.lpFreqScale;
    n.sawLP.frequency.value += (lpFreq - n.sawLP.frequency.value) * t;

    const targetQ = speedFactor > 1.0 ? cfg.boostQ : cfg.idleQ;
    n.sawLP.Q.value += (targetQ - n.sawLP.Q.value) * t;

    const vol = (cfg.masterGainIdle + speedFactor * cfg.masterGainScale) * 0.8 * 1.089 * getSfxVolume();
    n.master.gain.value += (vol - n.master.gain.value) * t;

    const noiseVol = (cfg.noiseGainIdle + speedFactor * cfg.noiseGainScale) * 0.8;
    n.noiseGain.gain.value += (noiseVol - n.noiseGain.gain.value) * t;
    n.noiseBP.frequency.value += ((cfg.noiseBpFreqIdle + speedFactor * cfg.noiseBpFreqScale) - n.noiseBP.frequency.value) * t;

    n.saw2Gain.gain.value += ((cfg.harmonicGainIdle + speedFactor * cfg.harmonicGainScale) - n.saw2Gain.gain.value) * t;
  }

  stop(): void {
    if (!this.nodes) return;
    const n = this.nodes;
    try { n.saw.stop(); n.saw2.stop(); n.noiseSrc.stop(); } catch (e) { warnDev('proceduralEngine', e); }
    try {
      n.saw.disconnect(); n.sawLP.disconnect(); n.saw2.disconnect();
      n.saw2Gain.disconnect(); n.noiseSrc.disconnect(); n.noiseBP.disconnect();
      n.noiseGain.disconnect(); n.master.disconnect();
    } catch (e) { warnDev('proceduralEngine', e); }
    this.nodes = null;
    this.running = false;
  }

  isRunning(): boolean { return this.running; }
}

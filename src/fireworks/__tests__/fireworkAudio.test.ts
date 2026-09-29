import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

const fakeCtx = {
  sampleRate: 44100,
  destination: {},
  currentTime: 0,
  state: 'running',
  createBufferSource: vi.fn(),
  createGain: vi.fn(),
  createPanner: vi.fn(),
  createBuffer: vi.fn(),
  resume: vi.fn(),
};
const fakeOutput = { connect: vi.fn() };

vi.mock('../../sfxContext', () => ({
  getCtx: vi.fn(() => fakeCtx),
  getSfxOutput: vi.fn(() => fakeOutput),
  noiseBuf: vi.fn(() => ({ duration: 0.2, getChannelData: () => new Float32Array(8820) })),
}));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  return actual;
});

// Dynamically create fake audio nodes for each create* call.
function makeNode(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
    detune: { value: 0 },
    gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    frequency: { value: 1000, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    onended: null as (() => void) | null,
    ...extra,
  };
}

describe('FireworkAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // AudioBuffer stub returned from createBuffer
    fakeCtx.createBuffer.mockImplementation((ch: number, length: number, rate: number) => ({
      length, sampleRate: rate, numberOfChannels: ch, getChannelData: () => new Float32Array(length),
    }));
    fakeCtx.createBufferSource.mockImplementation(() => makeNode({ buffer: null }));
    fakeCtx.createGain.mockImplementation(() => makeNode());
    fakeCtx.createPanner.mockImplementation(() => makeNode({
      panningModel: '', distanceModel: '', refDistance: 0, maxDistance: 0, rolloffFactor: 0,
    }));
  });

  it('constructs without throwing and fetches ctx + output', async () => {
    const { FireworkAudio } = await import('../fireworkAudio');
    const audio = new FireworkAudio();
    expect(audio).toBeDefined();
  });

  it('play creates source + panner + gain and connects through output', async () => {
    const { FireworkAudio } = await import('../fireworkAudio');
    const audio = new FireworkAudio();
    audio.play('launch0', new THREE.Vector3(10, 20, 30), 0.5, 100);
    expect(fakeCtx.createBufferSource).toHaveBeenCalled();
    expect(fakeCtx.createPanner).toHaveBeenCalled();
    expect(fakeCtx.createGain).toHaveBeenCalled();
  });

  it('play respects per-sound instance cap of 6', async () => {
    const { FireworkAudio } = await import('../fireworkAudio');
    const audio = new FireworkAudio();
    const v = new THREE.Vector3();
    for (let i = 0; i < 10; i++) audio.play('boom0', v, 0.5, 0);
    // After the cap (6) is reached, no new source nodes should be created.
    const bufferSourceCalls = fakeCtx.createBufferSource.mock.calls.length;
    expect(bufferSourceCalls).toBe(6);
  });

  it('play positions the panner at the given coordinates', async () => {
    const { FireworkAudio } = await import('../fireworkAudio');
    const audio = new FireworkAudio();
    audio.play('pop0', new THREE.Vector3(5, 15, 25), 0.5, 0);
    const lastPanner = fakeCtx.createPanner.mock.results[fakeCtx.createPanner.mock.results.length - 1].value;
    expect(lastPanner.positionX.value).toBe(5);
    expect(lastPanner.positionY.value).toBe(15);
    expect(lastPanner.positionZ.value).toBe(25);
  });

  it('source onended decrements the active instance count', async () => {
    const { FireworkAudio } = await import('../fireworkAudio');
    const audio = new FireworkAudio();
    const v = new THREE.Vector3();
    audio.play('boom0', v, 0.5, 0);
    const src = fakeCtx.createBufferSource.mock.results.slice(-1)[0].value;
    // Simulate the source ending
    if (src.onended) src.onended();
    // Then 6 more plays should still all succeed (cap not exceeded)
    for (let i = 0; i < 6; i++) audio.play('boom0', v, 0.5, 0);
    expect(fakeCtx.createBufferSource.mock.calls.length).toBeGreaterThanOrEqual(7);
  });
});

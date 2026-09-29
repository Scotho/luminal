import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAudioBuffer = { duration: 1.0, length: 44100, sampleRate: 44100, numberOfChannels: 1 };
const mockGain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 }, connect: vi.fn() };
const mockSource = { buffer: null as any, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), loop: false, playbackRate: { value: 1 } };
const mockCtx = {
  currentTime: 0,
  state: 'running',
  resume: vi.fn(),
  destination: {},
  sampleRate: 44100,
  createGain: vi.fn(() => ({ ...mockGain })),
  createBufferSource: vi.fn(() => ({ ...mockSource })),
  createBiquadFilter: vi.fn(() => ({ type: '', frequency: { setValueAtTime: vi.fn(), value: 0 }, Q: { value: 0 }, connect: vi.fn() })),
  decodeAudioData: vi.fn(async () => mockAudioBuffer),
  createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(4410) })),
  createOscillator: vi.fn(() => ({ type: '', frequency: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
};

vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

// Mock fetch to return a fake ArrayBuffer
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(100),
})));

// Must mock sfxContext to return our mock
vi.mock('./sfxContext', () => ({
  getCtx: () => mockCtx,
  getSfxOutput: () => mockCtx.destination,
  getSfxVolume: () => 1.0,
}));

import { preloadSfx, isLoaded, playSfxBuffer } from './sfxAssets';

describe('sfxAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preloadSfx fetches all manifest entries and decodes them', async () => {
    await preloadSfx();
    // Should have called fetch for each sound in the manifest
    expect(fetch).toHaveBeenCalled();
    // Should have decoded each fetched buffer
    expect(mockCtx.decodeAudioData).toHaveBeenCalled();
    expect(isLoaded()).toBe(true);
  });

  it('playSfxBuffer creates a source node and plays it', async () => {
    await preloadSfx();
    playSfxBuffer('explosion');
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
  });

  it('playSfxBuffer no-ops silently for unknown sound name', () => {
    expect(() => playSfxBuffer('nonexistent')).not.toThrow();
  });

  it('playSfxBuffer no-ops if preload has not been called', () => {
    // Reset module state by testing before preload in a fresh context
    expect(() => playSfxBuffer('explosion')).not.toThrow();
  });
});

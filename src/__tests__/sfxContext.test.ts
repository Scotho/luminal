// ── sfxContext unit tests ─────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock factories ───────────────────────────────────────

function createMockGainNode() {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
  };
}

function createMockFilterNode() {
  return {
    type: '',
    frequency: {
      value: 22050,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    Q: { value: 0 },
    connect: vi.fn(),
  };
}

function createMockAudioContext() {
  return {
    state: 'running' as string,
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createBiquadFilter: vi.fn(() => createMockFilterNode()),
    createGain: vi.fn(() => createMockGainNode()),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => ({
      numberOfChannels: _channels,
      length,
      sampleRate: rate,
      getChannelData: vi.fn(() => new Float32Array(length)),
    })),
  };
}

/**
 * Install a constructable AudioContext mock on globalThis.
 * The source uses `new (window.AudioContext || ...)()` so arrow fns won't work.
 * We use `function` syntax and copy all mock properties onto `this`.
 */
function stubAudioContext(mockCtx: ReturnType<typeof createMockAudioContext>) {
  function MockAudioContext(this: Record<string, unknown>) {
    Object.assign(this, mockCtx);
  }
  vi.stubGlobal('AudioContext', MockAudioContext);
  return MockAudioContext;
}

// ─────────────────────────────────────────────────────────
// 1. setSfxVolume / getSfxVolume
// ─────────────────────────────────────────────────────────
describe('setSfxVolume / getSfxVolume', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('defaults to 0.5', async () => {
    const { getSfxVolume } = await import('../sfxContext');
    expect(getSfxVolume()).toBe(0.5);
  });

  it('sets to 0.5 and reads back', async () => {
    const { setSfxVolume, getSfxVolume } = await import('../sfxContext');
    setSfxVolume(0.5);
    expect(getSfxVolume()).toBe(0.5);
  });

  it('clamps below 0 to 0', async () => {
    const { setSfxVolume, getSfxVolume } = await import('../sfxContext');
    setSfxVolume(-5);
    expect(getSfxVolume()).toBe(0);
  });

  it('clamps above 1 to 1', async () => {
    const { setSfxVolume, getSfxVolume } = await import('../sfxContext');
    setSfxVolume(42);
    expect(getSfxVolume()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────
// 2. getSfxOutput
// ─────────────────────────────────────────────────────────
describe('getSfxOutput', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns a filter node and creates expected audio nodes', async () => {
    const mockCtx = createMockAudioContext();
    const { getSfxOutput } = await import('../sfxContext');

    const node = getSfxOutput(mockCtx as unknown as AudioContext);
    // The implementation creates a BiquadFilter, sets type to 'lowpass', and returns it
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledOnce();
    expect(mockCtx.createGain).toHaveBeenCalledOnce();
    expect(node).toBeDefined();
  });

  it('returns same node on second call (caching)', async () => {
    const mockCtx = createMockAudioContext();
    const { getSfxOutput } = await import('../sfxContext');

    const first = getSfxOutput(mockCtx as unknown as AudioContext);
    const second = getSfxOutput(mockCtx as unknown as AudioContext);
    expect(first).toBe(second);
    // Should only have created nodes once
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────
// 3. noiseBuf
// ─────────────────────────────────────────────────────────
describe('noiseBuf', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns an AudioBuffer of correct length', async () => {
    const mockCtx = createMockAudioContext();
    const { noiseBuf } = await import('../sfxContext');

    const buf = noiseBuf(mockCtx as unknown as AudioContext, 1.0);
    // createBuffer called with (1, sampleRate * duration, sampleRate)
    expect(mockCtx.createBuffer).toHaveBeenCalledWith(1, 44100, 44100);
    expect(buf.length).toBe(44100);
    expect(buf.sampleRate).toBe(44100);
  });

  it('caches by duration key — same duration returns same buffer', async () => {
    const mockCtx = createMockAudioContext();
    const { noiseBuf } = await import('../sfxContext');

    const first = noiseBuf(mockCtx as unknown as AudioContext, 0.5);
    const second = noiseBuf(mockCtx as unknown as AudioContext, 0.5);
    expect(first).toBe(second);
    // createBuffer only called once for the same duration
    expect(mockCtx.createBuffer).toHaveBeenCalledTimes(1);
  });

  it('different durations return different buffers', async () => {
    const mockCtx = createMockAudioContext();
    const { noiseBuf } = await import('../sfxContext');

    const short = noiseBuf(mockCtx as unknown as AudioContext, 0.1);
    const long = noiseBuf(mockCtx as unknown as AudioContext, 2.0);
    expect(short).not.toBe(long);
    expect(mockCtx.createBuffer).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────
// 4. getCtx
// ─────────────────────────────────────────────────────────
describe('getCtx', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates AudioContext on first call', async () => {
    const mockCtx = createMockAudioContext();
    stubAudioContext(mockCtx);

    const { getCtx } = await import('../sfxContext');
    const result = getCtx();
    // The returned ctx should have the mock's methods
    expect(result.createBuffer).toBe(mockCtx.createBuffer);
  });

  it('resumes if suspended', async () => {
    const mockCtx = createMockAudioContext();
    mockCtx.state = 'suspended';
    stubAudioContext(mockCtx);

    const { getCtx } = await import('../sfxContext');
    getCtx();
    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it('pre-generates noise buffers (durations 0.08, 0.6, 1.0, 2.0)', async () => {
    const mockCtx = createMockAudioContext();
    stubAudioContext(mockCtx);

    const { getCtx } = await import('../sfxContext');
    getCtx();

    // Should create 4 noise buffers with specific durations
    expect(mockCtx.createBuffer).toHaveBeenCalledTimes(4);

    const calls = mockCtx.createBuffer.mock.calls;
    const durations = calls.map(
      (c: [number, number, number]) => c[1] / mockCtx.sampleRate,
    );
    expect(durations).toContain(0.08);
    expect(durations).toContain(0.6);
    expect(durations).toContain(1.0);
    expect(durations).toContain(2.0);
  });

  it('returns cached context on subsequent calls', async () => {
    const mockCtx = createMockAudioContext();
    stubAudioContext(mockCtx);

    const { getCtx } = await import('../sfxContext');
    const first = getCtx();
    const second = getCtx();
    expect(first).toBe(second);
  });
});

// ─────────────────────────────────────────────────────────
// 5. setSfxDampen
// ─────────────────────────────────────────────────────────
describe('setSfxDampen', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('no-op if ctx is null (does not throw)', async () => {
    // Import fresh module without calling getCtx — ctx stays null
    const { setSfxDampen } = await import('../sfxContext');
    expect(() => setSfxDampen(true)).not.toThrow();
    expect(() => setSfxDampen(false)).not.toThrow();
  });

  it('engages dampen when called with true after ctx is initialised', async () => {
    const mockCtx = createMockAudioContext();
    // Use specific filter/gain nodes so we can inspect them
    const filterNode = createMockFilterNode();
    const gainNode = createMockGainNode();
    mockCtx.createBiquadFilter = vi.fn(() => filterNode);
    mockCtx.createGain = vi.fn(() => gainNode);
    stubAudioContext(mockCtx);

    const { getCtx, getSfxOutput, setSfxDampen } = await import('../sfxContext');
    const ctx = getCtx(); // initialise ctx
    getSfxOutput(ctx); // initialise filter/gain chain

    setSfxDampen(true);

    // Should ramp frequency down and gain down
    expect(filterNode.frequency.cancelScheduledValues).toHaveBeenCalled();
    expect(filterNode.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      2200,
      expect.any(Number),
    );
    expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.85,
      expect.any(Number),
    );
  });

  it('disengages dampen when called with false after being engaged', async () => {
    const filterNode = createMockFilterNode();
    const gainNode = createMockGainNode();
    const mockCtx = createMockAudioContext();
    mockCtx.createBiquadFilter = vi.fn(() => filterNode);
    mockCtx.createGain = vi.fn(() => gainNode);
    stubAudioContext(mockCtx);

    const { getCtx, getSfxOutput, setSfxDampen } = await import('../sfxContext');
    const ctx = getCtx();
    getSfxOutput(ctx);

    setSfxDampen(true);
    // Clear mocks to isolate the disengage call
    filterNode.frequency.exponentialRampToValueAtTime.mockClear();
    gainNode.gain.linearRampToValueAtTime.mockClear();

    setSfxDampen(false);
    expect(filterNode.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      22050,
      expect.any(Number),
    );
    expect(gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1.0,
      expect.any(Number),
    );
  });

  it('is a no-op when called with same state twice', async () => {
    const filterNode = createMockFilterNode();
    const gainNode = createMockGainNode();
    const mockCtx = createMockAudioContext();
    mockCtx.createBiquadFilter = vi.fn(() => filterNode);
    mockCtx.createGain = vi.fn(() => gainNode);
    stubAudioContext(mockCtx);

    const { getCtx, getSfxOutput, setSfxDampen } = await import('../sfxContext');
    const ctx = getCtx();
    getSfxOutput(ctx);

    setSfxDampen(true);
    filterNode.frequency.cancelScheduledValues.mockClear();

    // Second call with same value should be a no-op
    setSfxDampen(true);
    expect(filterNode.frequency.cancelScheduledValues).not.toHaveBeenCalled();
  });
});

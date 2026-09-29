// src/__tests__/gameLoopFixedStep.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE imports — vi.mock is hoisted, so factories must be self-contained
vi.mock('../graphics', () => ({
  getGfx: vi.fn(() => ({ audioReactivity: 'off', reflections: 'high' })),
}));
vi.mock('../ui/effects', () => ({
  drawPulseCanvas: vi.fn(),
  updateAmbientEQ: vi.fn(),
}));
vi.mock('../grid', () => ({
  getArenaReactive: vi.fn(() => ({ reflector: { forceUpdate: false } })),
}));

import { stepAndRender, _resetReflectFrame } from '../gameLoopFixedStep';
import { getGfx } from '../graphics';
import { getArenaReactive } from '../grid';

// Shared reflector object — we point mocks at this to observe mutations
const mockReflector = { forceUpdate: false };

function makeDeps() {
  return {
    game: { state: 'playing', update: vi.fn(), _lastBands: null },
    composer: { render: vi.fn() },
    sanitizeRenderState: vi.fn(),
    isAudioStarted: () => false,
  };
}

describe('reflector frame-skipping', () => {
  beforeEach(() => {
    _resetReflectFrame();
    mockReflector.forceUpdate = false;
    vi.mocked(getArenaReactive).mockReturnValue({ reflector: mockReflector } as ReturnType<typeof getArenaReactive>);
    vi.mocked(getGfx).mockReturnValue({ audioReactivity: 'off', reflections: 'high' } as ReturnType<typeof getGfx>);
  });

  it('sets forceUpdate=true on interval frames (high=every 3rd)', () => {
    const deps = makeDeps();
    // Frame 1: not an interval frame
    stepAndRender(0.016, deps);
    expect(mockReflector.forceUpdate).toBe(false);
    // Frame 2: not an interval frame
    stepAndRender(0.016, deps);
    expect(mockReflector.forceUpdate).toBe(false);
    // Frame 3: interval frame
    stepAndRender(0.016, deps);
    expect(mockReflector.forceUpdate).toBe(true);
  });

  it('uses interval=2 for ultra reflections', () => {
    vi.mocked(getGfx).mockReturnValue({
      audioReactivity: 'off', reflections: 'ultra',
    } as ReturnType<typeof getGfx>);
    const deps = makeDeps();
    // Frame 1: not interval
    stepAndRender(0.016, deps);
    expect(mockReflector.forceUpdate).toBe(false);
    // Frame 2: interval frame for ultra
    stepAndRender(0.016, deps);
    expect(mockReflector.forceUpdate).toBe(true);
  });

  it('does not crash when no reflector exists', () => {
    vi.mocked(getArenaReactive).mockReturnValue(null);
    const deps = makeDeps();
    expect(() => stepAndRender(0.016, deps)).not.toThrow();
  });

  it('cycles correctly across multiple intervals (high preset)', () => {
    const deps = makeDeps();
    const results: boolean[] = [];
    for (let i = 0; i < 9; i++) {
      stepAndRender(0.016, deps);
      results.push(mockReflector.forceUpdate as boolean);
    }
    // Frames 1-9: forceUpdate true at frames 3, 6, 9
    expect(results).toEqual([false, false, true, false, false, true, false, false, true]);
  });
});

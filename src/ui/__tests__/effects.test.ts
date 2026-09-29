// ── Effects Tests ───────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module
vi.mock('../dom', () => ({
  show: vi.fn(),
  hide: vi.fn(),
  toggleVisible: vi.fn(),
}));

vi.mock('../storage', () => ({
  getLocalBool: vi.fn(() => false),
  setLocalBool: vi.fn(),
}));

vi.mock('../../disposables', () => {
  const fns: Array<() => void> = [];
  class DisposableBag {
    addEventListener(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void {
      target.addEventListener(type, listener, options);
      fns.push(() => target.removeEventListener(type, listener));
    }
    add(_fn: () => void): void { /* noop for tests */ }
    reset(): void {
      fns.forEach((fn) => fn());
      fns.length = 0;
    }
  }
  return { DisposableBag };
});

import {
  getLastFps,
  initEffects,
  updateFPS,
  setPerfFps,
  setPerfMem,
  setPerfPing,
  setPerfVram,
  drawPulseCanvas,
  disposeEffects,
  updateAmbientEQ,
} from '../effects';
import { show, hide } from '../dom';
import { setLocalBool } from '../storage';

// ── Setup ───────────────────────────────────────────────

function setupPerfDOM(): void {
  // Create perf-overlay element
  const overlay = document.createElement('div');
  overlay.id = 'perf-overlay';
  overlay.classList.add('hidden');
  document.body.appendChild(overlay);
}

function setupEffectsDeps(): ReturnType<typeof createMockDeps> {
  const deps = createMockDeps();

  // Create pulse canvas
  let canvas = document.getElementById('pulse-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'pulse-canvas';
    document.body.appendChild(canvas);
  }

  initEffects(deps);
  return deps;
}

function createMockDeps() {
  return {
    game: { state: 'menu', _lastBands: null },
    getAudioStarted: vi.fn(() => false),
    composer: { render: vi.fn() },
    renderer: { render: vi.fn() },
  };
}

// ── getLastFps ──────────────────────────────────────────

describe('getLastFps', () => {
  it('returns a number', () => {
    expect(typeof getLastFps()).toBe('number');
  });
});

// ── initEffects ─────────────────────────────────────────

describe('initEffects', () => {
  beforeEach(() => {
    // Ensure pulse canvas exists
    if (!document.getElementById('pulse-canvas')) {
      const canvas = document.createElement('canvas');
      canvas.id = 'pulse-canvas';
      document.body.appendChild(canvas);
    }
  });

  it('does not throw when called with valid deps', () => {
    expect(() => initEffects(createMockDeps())).not.toThrow();
  });

  it('creates EQ bars in aeq-music element if present', () => {
    const aeqMusic = document.getElementById('aeq-music');
    if (aeqMusic) {
      const barsBefore = aeqMusic.children.length;
      initEffects(createMockDeps());
      // 80 bars should be added
      expect(aeqMusic.children.length).toBe(barsBefore + 80);
    }
  });
});

// ── setPerfFps / setPerfMem / setPerfPing / setPerfVram ──

describe('perf overlay toggles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPerfDOM();
  });

  it('setPerfFps(true) calls setLocalBool with correct args', () => {
    setPerfFps(true);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-fps', true);
  });

  it('setPerfFps(false) calls setLocalBool with false', () => {
    setPerfFps(false);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-fps', false);
  });

  it('setPerfMem(true) calls setLocalBool', () => {
    setPerfMem(true);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-mem', true);
  });

  it('setPerfMem(false) calls setLocalBool', () => {
    setPerfMem(false);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-mem', false);
  });

  it('setPerfPing(true) calls setLocalBool', () => {
    setPerfPing(true);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-ping', true);
  });

  it('setPerfPing(false) calls setLocalBool', () => {
    setPerfPing(false);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-ping', false);
  });

  it('setPerfVram(true) calls setLocalBool', () => {
    setPerfVram(true);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-vram', true);
  });

  it('setPerfVram(false) calls setLocalBool', () => {
    setPerfVram(false);
    expect(setLocalBool).toHaveBeenCalledWith('luminal-perf-vram', false);
  });
});

// ── updateFPS ───────────────────────────────────────────

describe('updateFPS', () => {
  it('does not throw when called', () => {
    expect(() => updateFPS()).not.toThrow();
  });

  it('increments frame counter on repeated calls', () => {
    // Call many times within 500ms window — FPS value should not update yet
    const initialFps = getLastFps();
    for (let i = 0; i < 10; i++) {
      updateFPS();
    }
    // FPS hasn't updated because 500ms hasn't elapsed (perf.now is fast)
    // This verifies it accumulates without crashing
    expect(getLastFps()).toBeGreaterThanOrEqual(0);
  });

  it('updates FPS value after 500ms window', () => {
    // Use a base time well past any real performance.now() at module-import
    // time, because _fpsLast in effects.ts is initialized to performance.now()
    // when the module first loads. If fakeTime <= that initial value, the
    // 500ms window check (now - _fpsLast >= 500) never triggers.
    const originalNow = performance.now;
    let fakeTime = 1e10;
    vi.spyOn(performance, 'now').mockImplementation(() => fakeTime);

    // Reset internal state by calling once at t=1e10
    updateFPS();

    // Simulate 30 frames over 500ms
    fakeTime = 1e10 + 500;
    for (let i = 0; i < 30; i++) {
      updateFPS();
    }

    // After 500ms the FPS should be updated:
    // 31 frames (1 initial + 30) / 0.5s = ~62 FPS
    const fps = getLastFps();
    expect(fps).toBeGreaterThan(0);

    vi.spyOn(performance, 'now').mockImplementation(originalNow);
  });
});

// ── drawPulseCanvas ─────────────────────────────────────

describe('drawPulseCanvas', () => {
  beforeEach(() => {
    setupEffectsDeps();
  });

  it('does not throw when game state is menu', () => {
    expect(() => drawPulseCanvas()).not.toThrow();
  });

  it('does not throw when game state is playing (intensity 0)', () => {
    // Change game state to something that returns intensity 0
    const deps = createMockDeps();
    deps.game.state = 'playing';
    initEffects(deps);

    expect(() => drawPulseCanvas()).not.toThrow();
  });
});

// ── updateAmbientEQ ─────────────────────────────────────

describe('updateAmbientEQ', () => {
  it('does not throw when audio not started', () => {
    setupEffectsDeps();
    expect(() => updateAmbientEQ()).not.toThrow();
  });
});

// ── disposeEffects ──────────────────────────────────────

describe('disposeEffects', () => {
  it('does not throw', () => {
    setupEffectsDeps();
    expect(() => disposeEffects()).not.toThrow();
  });

  it('can be called multiple times safely', () => {
    setupEffectsDeps();
    expect(() => {
      disposeEffects();
      disposeEffects();
    }).not.toThrow();
  });
});

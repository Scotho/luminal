import { warnDev } from '../swallow';
import { computePercentiles, RingBuffer } from '../telemetry';

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

interface PerfStatsDeps {
  renderer: {
    info: {
      memory: { geometries: number; textures: number };
      render: { calls: number; triangles: number };
    };
    getContext(): WebGLRenderingContext;
  };
}

// ── Frame-time histogram + GC pause detection ────────────

export interface PerfTelemetry {
  /** Frame-time buckets: count of frames in each range. */
  frameTimeBuckets: {
    under16ms: number;   // <16.67ms (60+ fps)
    under33ms: number;   // 16.67–33ms (30–60 fps)
    under50ms: number;   // 33–50ms (20–30 fps)
    over50ms: number;    // >50ms (<20 fps, stutter)
  };
  /** Total frames sampled. */
  totalFrames: number;
  /** Peak frame time in ms. */
  peakFrameTimeMs: number;
  /** Number of detected GC pauses (heap drop > 1MB between samples). */
  gcPauseCount: number;
  /** Cumulative GC pause duration in ms (sum of frame times during detected pauses). */
  gcPauseTotalMs: number;
  /** Average frame time in ms (rolling window). */
  avgFrameTimeMs: number;
  /** Frame-time standard deviation (ms) — measures framerate stability. */
  frameTimeStdDevMs: number;
  /** Frame-time percentiles (ms) from rolling window. */
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** Average heap growth per frame in KB (positive = growing, negative = shrinking). */
  heapDeltaAvgKB: number;
  /** Peak single-frame heap allocation in KB. */
  heapDeltaPeakKB: number;
  /** Heap pressure: usedJSHeapSize / jsHeapSizeLimit (0–1). */
  heapPressure: number;
  /** Number of jank events (3+ consecutive frames above 33ms). */
  jankEventCount: number;
  /** Longest jank streak (consecutive frames above 33ms). */
  jankPeakStreak: number;
  /** GC pause severity histogram: minor (<5ms), moderate (5-16ms), major (>16ms). */
  gcPauseHistogram: { minor: number; moderate: number; major: number };
}

const FRAME_HISTORY_SIZE = 300; // ~5s at 60fps
const _frameTimeSamples = new RingBuffer<number>(FRAME_HISTORY_SIZE);
let _frameTimeBuckets = { under16ms: 0, under33ms: 0, under50ms: 0, over50ms: 0 };
let _peakFrameTimeMs = 0;
let _totalFrames = 0;
let _gcPauseCount = 0;
let _lastHeapUsed = 0;
const _heapDeltaSamples = new RingBuffer<number>(FRAME_HISTORY_SIZE);
let _peakHeapDeltaKB = 0;
let _gcPauseTotalMs = 0;
let _jankStreak = 0;          // current consecutive frames > 33ms
let _jankEventCount = 0;      // completed jank events (streak reached 3+)
let _jankPeakStreak = 0;      // longest jank streak observed

/** Record one frame's delta-time sample into the rolling telemetry buffers.
 *  Call once per game-loop tick. Without this, totalFrames stays at 0 and the
 *  e2e telemetry capture test has no data to assert against. */
export function recordFrameSample(dtMs: number): void {
  _totalFrames++;
  _frameTimeSamples.push(dtMs);
  if (dtMs > _peakFrameTimeMs) _peakFrameTimeMs = dtMs;
  if (dtMs < 16.67) _frameTimeBuckets.under16ms++;
  else if (dtMs < 33) _frameTimeBuckets.under33ms++;
  else if (dtMs < 50) _frameTimeBuckets.under50ms++;
  else _frameTimeBuckets.over50ms++;

  // Jank streak tracking (3+ consecutive >33ms frames = one jank event)
  if (dtMs > 33) {
    _jankStreak++;
    if (_jankStreak > _jankPeakStreak) _jankPeakStreak = _jankStreak;
    if (_jankStreak === 3) _jankEventCount++;
  } else {
    _jankStreak = 0;
  }

  // Heap-delta sampling for GC pause detection
  if (performance.memory) {
    const used = performance.memory.usedJSHeapSize;
    if (_lastHeapUsed > 0) {
      const deltaKB = (used - _lastHeapUsed) / 1024;
      _heapDeltaSamples.push(deltaKB);
      if (Math.abs(deltaKB) > _peakHeapDeltaKB) _peakHeapDeltaKB = Math.abs(deltaKB);
      // Heap drop > 1MB between samples indicates a GC pass
      if (deltaKB < -1024) {
        _gcPauseCount++;
        _gcPauseTotalMs += dtMs;
      }
    }
    _lastHeapUsed = used;
  }
}

/** Snapshot of performance telemetry for external consumption. */
export function getPerfTelemetry(): PerfTelemetry {
  const samples = _frameTimeSamples;
  const avg = samples.length > 0
    ? samples.reduce((a: number, b: number) => a + b, 0) / samples.length : 0;
  // Standard deviation of frame times — measures stability
  let stddev = 0;
  if (samples.length > 1) {
    const variance = samples.reduce((sum: number, v: number) => sum + (v - avg) ** 2, 0) / samples.length;
    stddev = Math.sqrt(variance);
  }
  const pct = computePercentiles(samples);
  const heapAvg = _heapDeltaSamples.length > 0
    ? _heapDeltaSamples.reduce((a: number, b: number) => a + b, 0) / _heapDeltaSamples.length : 0;
  // Heap pressure: fraction of limit in use
  let heapPressure = 0;
  if (performance.memory && performance.memory.jsHeapSizeLimit > 0) {
    heapPressure = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;
  }
  return {
    frameTimeBuckets: { ..._frameTimeBuckets },
    totalFrames: _totalFrames,
    peakFrameTimeMs: Math.round(_peakFrameTimeMs * 100) / 100,
    gcPauseCount: _gcPauseCount,
    gcPauseTotalMs: Math.round(_gcPauseTotalMs * 100) / 100,
    avgFrameTimeMs: Math.round(avg * 100) / 100,
    frameTimeStdDevMs: Math.round(stddev * 100) / 100,
    p50Ms: pct.p50,
    p95Ms: pct.p95,
    p99Ms: pct.p99,
    heapDeltaAvgKB: Math.round(heapAvg * 100) / 100,
    heapDeltaPeakKB: Math.round(_peakHeapDeltaKB * 100) / 100,
    heapPressure: Math.round(heapPressure * 1000) / 1000,
    jankEventCount: _jankEventCount + (_jankStreak >= 3 ? 1 : 0), // include in-progress jank
    jankPeakStreak: _jankPeakStreak,
    gcPauseHistogram: { minor: 0, moderate: 0, major: 0 },
  };
}


export function initPerfStats(deps: PerfStatsDeps): void {
  const { renderer } = deps;

  const memEl: HTMLElement = document.getElementById('tb-mem')!;
  const vramEl: HTMLElement = document.getElementById('tb-vram')!;
  const pingEl: HTMLElement = document.getElementById('tb-ping')!;
  const memWrap: HTMLElement = document.getElementById('tb-mem-wrap')!;
  const vramWrap: HTMLElement = document.getElementById('tb-vram-wrap')!;
  const pingWrap: HTMLElement = document.getElementById('tb-ping-wrap')!;
  const _pingHistory: number[] = [];
  const _perfStart: number = Date.now();
  setInterval(() => {
    // Always update — data is consumed by the perf overlay (effects.ts)
    // Memory (JS heap)
    if (performance.memory && performance.memory.usedJSHeapSize > 0) {
      const used: number = performance.memory.usedJSHeapSize;
      const total: number = performance.memory.totalJSHeapSize;
      const limit: number = performance.memory.jsHeapSizeLimit;
      const usedMB: number = Math.round(used / 1048576);
      const totalMB: number = Math.round(total / 1048576);
      const limitMB: number = Math.round(limit / 1048576);
      memEl.textContent = String(usedMB);
      memWrap.setAttribute('data-tip',
        `Heap: ${usedMB} / ${totalMB} MB\nLimit: ${limitMB} MB\nUptime: ${Math.floor((Date.now() - _perfStart) / 60000)}m`);
    } else {
      memEl.textContent = '\u2014';
    }
    // VRAM (WebGL)
    try {
      const info = renderer.info;
      const gl = renderer.getContext();
      const gpuName: string = gl.getParameter(gl.RENDERER) || 'Unknown GPU';
      const geom: number = info.memory.geometries;
      const tex: number = info.memory.textures;
      // Rough VRAM estimate: textures dominate, assume avg 2 MB/texture + 0.5 MB/geometry
      const estimateMB: number = Math.round(tex * 2 + geom * 0.5);
      vramEl.textContent = String(estimateMB);
      vramWrap.setAttribute('data-tip',
        `GPU: ${gpuName}\nGeometries: ${geom}\nTextures: ${tex}\nEstimated VRAM: ~${estimateMB} MB\nDraw calls: ${info.render.calls}\nTriangles: ${info.render.triangles}`);
    } catch (e) { warnDev('perfStats', e); }
    // Ping — measure round-trip to Firebase RTDB
    const t0: number = performance.now();
    fetch('/music/Protocol.mp3', { method: 'HEAD', cache: 'no-cache' })
      .then(() => {
        const ms: number = Math.round(performance.now() - t0);
        pingEl.textContent = String(ms);
        _pingHistory.push(ms);
        if (_pingHistory.length > 20) _pingHistory.shift();
        const avg: number = Math.round(_pingHistory.reduce((a: number, b: number) => a + b, 0) / _pingHistory.length);
        const min: number = Math.min(..._pingHistory);
        const max: number = Math.max(..._pingHistory);
        pingWrap.setAttribute('data-tip',
          `Avg: ${avg} ms\nMin: ${min} ms\nMax: ${max} ms\nSamples: ${_pingHistory.length}`);
      })
      .catch(() => { pingEl.textContent = '—'; });
  }, 3000);
}

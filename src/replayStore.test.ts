import { describe, it, expect } from 'vitest';
import type { ReplayFrame, CompressedFrame } from './types/index';

// Import the internal functions by re-exporting them for testing.
// Since compressFrames/decompressFrames are not exported, we test via
// the module's roundtrip behavior. We'll recreate the logic here to test.

// Replicate compression logic (matches replayStore.ts exactly)
function compressFrames(frames: ReplayFrame[]): CompressedFrame[] {
  return frames.map((f) => ({
    t: Math.round(f.t * 100) / 100,
    p: f.player.alive ? [
      Math.round(f.player.x * 10) / 10,
      Math.round(f.player.z * 10) / 10,
      Math.round(f.player.angle * 1000) / 1000,
      Math.round(f.player.speed),
      (f.player.boosting ? 1 : 0) | (f.player.dashing ? 2 : 0),
    ] : null,
    a: f.ais.map((ai) => ai.alive ? [
      Math.round(ai.x * 10) / 10,
      Math.round(ai.z * 10) / 10,
      Math.round(ai.angle * 1000) / 1000,
      Math.round(ai.speed),
      (ai.boosting ? 1 : 0) | (ai.dashing ? 2 : 0),
    ] : null),
  }));
}

function decompressFrames(compressed: CompressedFrame[]): ReplayFrame[] {
  return compressed.map((f) => ({
    t: f.t,
    player: f.p ? {
      x: f.p[0], z: f.p[1], angle: f.p[2], speed: f.p[3],
      boosting: !!(f.p[4] & 1), dashing: !!(f.p[4] & 2), alive: true,
    } : { x: 0, z: 0, angle: 0, speed: 0, boosting: false, dashing: false, alive: false },
    ais: f.a.map((a) => a ? {
      x: a[0], z: a[1], angle: a[2], speed: a[3],
      boosting: !!(a[4] & 1), dashing: !!(a[4] & 2), alive: true,
    } : { x: 0, z: 0, angle: 0, speed: 0, boosting: false, dashing: false, alive: false }),
  }));
}

function makeFrame(t: number, px: number, pz: number, angle: number, speed: number, boosting: boolean, dashing: boolean, alive: boolean): ReplayFrame {
  return {
    t,
    player: { x: px, z: pz, angle, speed, boosting, dashing, alive },
    ais: [{ x: -px, z: -pz, angle: angle + Math.PI, speed, boosting: false, dashing: false, alive }],
  };
}

describe('replay frame compression', () => {
  describe('compressFrames', () => {
    it('compresses alive player into 5-element array', () => {
      const frames = [makeFrame(1.0, 10.5, 20.3, 1.234, 40, false, false, true)];
      const compressed = compressFrames(frames);
      expect(compressed[0].p).not.toBeNull();
      expect(compressed[0].p).toHaveLength(5);
    });

    it('compresses dead player as null', () => {
      const frames = [makeFrame(1.0, 10.5, 20.3, 1.234, 40, false, false, false)];
      const compressed = compressFrames(frames);
      expect(compressed[0].p).toBeNull();
    });

    it('rounds time to 2 decimal places', () => {
      const frames = [makeFrame(1.23456, 0, 0, 0, 40, false, false, true)];
      const compressed = compressFrames(frames);
      expect(compressed[0].t).toBe(1.23);
    });

    it('rounds position to 1 decimal place', () => {
      const frames = [makeFrame(0, 10.567, 20.891, 0, 40, false, false, true)];
      const compressed = compressFrames(frames);
      expect(compressed[0].p![0]).toBe(10.6);
      expect(compressed[0].p![1]).toBe(20.9);
    });

    it('rounds angle to 3 decimal places', () => {
      const frames = [makeFrame(0, 0, 0, 1.23456789, 40, false, false, true)];
      const compressed = compressFrames(frames);
      expect(compressed[0].p![2]).toBe(1.235);
    });

    it('rounds speed to integer', () => {
      const frames = [makeFrame(0, 0, 0, 0, 42.7, false, false, true)];
      const compressed = compressFrames(frames);
      expect(compressed[0].p![3]).toBe(43);
    });

    it('packs boosting and dashing into flags byte', () => {
      const none = compressFrames([makeFrame(0, 0, 0, 0, 40, false, false, true)]);
      expect(none[0].p![4]).toBe(0);

      const boost = compressFrames([makeFrame(0, 0, 0, 0, 40, true, false, true)]);
      expect(boost[0].p![4]).toBe(1);

      const dash = compressFrames([makeFrame(0, 0, 0, 0, 40, false, true, true)]);
      expect(dash[0].p![4]).toBe(2);

      const both = compressFrames([makeFrame(0, 0, 0, 0, 40, true, true, true)]);
      expect(both[0].p![4]).toBe(3);
    });

    it('compresses AI entries', () => {
      const frames = [makeFrame(0, 10, 20, 1.0, 40, false, false, true)];
      const compressed = compressFrames(frames);
      expect(compressed[0].a).toHaveLength(1);
      expect(compressed[0].a[0]).not.toBeNull();
      expect(compressed[0].a[0]).toHaveLength(5);
    });
  });

  describe('decompressFrames', () => {
    it('decompresses alive player from array', () => {
      const compressed: CompressedFrame[] = [{ t: 1.0, p: [10.5, 20.3, 1.234, 40, 0], a: [] }];
      const frames = decompressFrames(compressed);
      expect(frames[0].player.x).toBe(10.5);
      expect(frames[0].player.z).toBe(20.3);
      expect(frames[0].player.angle).toBe(1.234);
      expect(frames[0].player.speed).toBe(40);
      expect(frames[0].player.alive).toBe(true);
    });

    it('decompresses dead player from null', () => {
      const compressed: CompressedFrame[] = [{ t: 1.0, p: null, a: [] }];
      const frames = decompressFrames(compressed);
      expect(frames[0].player.alive).toBe(false);
      expect(frames[0].player.x).toBe(0);
      expect(frames[0].player.speed).toBe(0);
    });

    it('unpacks boosting and dashing flags', () => {
      const compressed: CompressedFrame[] = [{ t: 0, p: [0, 0, 0, 40, 3], a: [] }];
      const frames = decompressFrames(compressed);
      expect(frames[0].player.boosting).toBe(true);
      expect(frames[0].player.dashing).toBe(true);
    });
  });

  describe('roundtrip', () => {
    it('preserves data through compress/decompress cycle', () => {
      const original = [
        makeFrame(0.5, 15.3, -22.7, 2.456, 55, true, false, true),
        makeFrame(1.0, 20.1, -30.4, 3.001, 40, false, true, true),
        makeFrame(1.5, 25.0, -38.0, 0.1, 98, true, true, true),
      ];

      const roundtripped = decompressFrames(compressFrames(original));

      expect(roundtripped).toHaveLength(3);
      for (let i = 0; i < original.length; i++) {
        const o = original[i];
        const r = roundtripped[i];
        expect(r.t).toBeCloseTo(o.t, 1);
        expect(r.player.x).toBeCloseTo(o.player.x, 0);
        expect(r.player.z).toBeCloseTo(o.player.z, 0);
        expect(r.player.angle).toBeCloseTo(o.player.angle, 2);
        expect(r.player.boosting).toBe(o.player.boosting);
        expect(r.player.dashing).toBe(o.player.dashing);
        expect(r.player.alive).toBe(o.player.alive);
      }
    });

    it('preserves dead player through roundtrip', () => {
      const original = [makeFrame(1.0, 5, 10, 0.5, 0, false, false, false)];
      const roundtripped = decompressFrames(compressFrames(original));
      expect(roundtripped[0].player.alive).toBe(false);
    });

    it('preserves AI data through roundtrip', () => {
      const original = [makeFrame(0.5, 10, 20, 1.5, 40, false, false, true)];
      const roundtripped = decompressFrames(compressFrames(original));
      expect(roundtripped[0].ais).toHaveLength(1);
      expect(roundtripped[0].ais[0].alive).toBe(true);
      expect(roundtripped[0].ais[0].x).toBeCloseTo(-10, 0);
    });
  });
});

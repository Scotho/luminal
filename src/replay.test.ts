import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayRecorder, ReplayPlayer } from './replay';
import { getPlayerColor } from './playerColors';
import type { PlayerState, ReplaySnapshot, ColorEntry } from './types/index';

// Mock player/AI objects matching what ReplayRecorder.record() reads
function mockPlayer(x: number, z: number, angle: number, alive = true) {
  return {
    mesh: { position: { x, z } },
    angle, speed: 40, boosting: false, dashing: false, alive,
  };
}
function mockAI(x: number, z: number, angle: number, alive = true) {
  return { player: mockPlayer(x, z, angle, alive) };
}

function makeSnapshot(frameCount: number, duration: number): ReplaySnapshot {
  const playerColor = getPlayerColor('cyan');
  const aiColor = getPlayerColor('magenta');
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const t = (i / (frameCount - 1)) * duration;
    frames.push({
      t,
      player: { x: i, z: 0, angle: 0, speed: 40, boosting: false, dashing: false, alive: true },
      ais: [{ x: -i, z: 0, angle: Math.PI, speed: 40, boosting: false, dashing: false, alive: true }],
    });
  }
  return { frames, playerColor: playerColor.color, playerEmissive: playerColor.emissive, aiColors: [{ color: aiColor.color, emissive: aiColor.emissive }], duration };
}

describe('ReplayRecorder', () => {
  let recorder: ReplayRecorder;

  beforeEach(() => {
    recorder = new ReplayRecorder();
    const playerColor = getPlayerColor('cyan');
    const aiColor = getPlayerColor('magenta');
    recorder.reset(playerColor.color, playerColor.emissive, [{ color: aiColor.color, emissive: aiColor.emissive }]);
  });

  it('starts with no frames', () => {
    expect(recorder.frames).toHaveLength(0);
    expect(recorder.hasData()).toBe(false);
  });

  it('records frames at 30fps intervals', () => {
    const player = mockPlayer(0, 0, 0);
    const ais = [mockAI(10, 10, Math.PI)];

    // Push enough dt to trigger one frame (~33ms interval)
    recorder.record(0.04, player, ais, 0.04);
    expect(recorder.frames).toHaveLength(1);
  });

  it('skips recording when under interval threshold', () => {
    const player = mockPlayer(0, 0, 0);
    recorder.record(0.01, player, [], 0.01);
    expect(recorder.frames).toHaveLength(0);
  });

  it('captures player state correctly', () => {
    const player = mockPlayer(5, 10, 1.5);
    player.speed = 55;
    player.boosting = true;
    recorder.record(0.04, player, [], 1.0);

    const frame = recorder.frames[0];
    expect(frame.player.x).toBe(5);
    expect(frame.player.z).toBe(10);
    expect(frame.player.angle).toBe(1.5);
    expect(frame.player.speed).toBe(55);
    expect(frame.player.boosting).toBe(true);
    expect(frame.player.alive).toBe(true);
  });

  it('captures dead player state', () => {
    const player = mockPlayer(5, 10, 1.5, false);
    recorder.record(0.04, player, [], 1.0);

    const frame = recorder.frames[0];
    expect(frame.player.alive).toBe(false);
    expect(frame.player.speed).toBe(0);
  });

  it('captures AI states', () => {
    const player = mockPlayer(0, 0, 0);
    const ais = [mockAI(20, 30, 2.0), mockAI(40, 50, 3.0)];
    recorder.record(0.04, player, ais, 0.5);

    expect(recorder.frames[0].ais).toHaveLength(2);
    expect(recorder.frames[0].ais[0].x).toBe(20);
    expect(recorder.frames[0].ais[1].x).toBe(40);
  });

  it('hasData returns true after enough frames', () => {
    const player = mockPlayer(0, 0, 0);
    for (let i = 0; i < 12; i++) {
      recorder.record(0.04, player, [], i * 0.04);
    }
    expect(recorder.hasData()).toBe(true);
  });

  it('getSnapshot returns correct metadata', () => {
    const player = mockPlayer(0, 0, 0);
    recorder.record(0.04, player, [], 1.0);
    recorder.record(0.04, player, [], 2.0);

    const snap = recorder.getSnapshot();
    const playerColor = getPlayerColor('cyan');
    expect(snap.playerColor).toBe(playerColor.color);
    expect(snap.playerEmissive).toBe(playerColor.emissive);
    expect(snap.aiColors).toHaveLength(1);
    expect(snap.duration).toBe(2.0);
  });

  it('reset clears all state', () => {
    const player = mockPlayer(0, 0, 0);
    recorder.record(0.04, player, [], 1.0);
    recorder.reset(0xff0000, 0x880000, []);
    expect(recorder.frames).toHaveLength(0);
    expect(recorder.playerColor).toBe(0xff0000);
  });
});

describe('ReplayPlayer', () => {
  let player: ReplayPlayer;
  let snapshot: ReplaySnapshot;

  beforeEach(() => {
    player = new ReplayPlayer();
    snapshot = makeSnapshot(30, 1.0); // 30 frames over 1 second
  });

  it('starts not playing', () => {
    expect(player.playing).toBe(false);
    expect(player.update(0.016)).toBeNull();
  });

  it('loads snapshot and starts playing', () => {
    player.load(snapshot);
    expect(player.playing).toBe(true);
    expect(player.time).toBe(0);
  });

  it('advances time on update', () => {
    player.load(snapshot);
    const result = player.update(0.5);
    expect(result).not.toBeNull();
    expect(result!.time).toBeCloseTo(0.5);
    expect(result!.progress).toBeCloseTo(0.5);
  });

  it('returns interpolated player position', () => {
    player.load(snapshot);
    const result = player.update(0.5);
    expect(result!.player.x).toBeGreaterThan(0);
    expect(result!.player.alive).toBe(true);
  });

  it('returns interpolated AI positions', () => {
    player.load(snapshot);
    const result = player.update(0.5);
    expect(result!.ais).toHaveLength(1);
    expect(result!.ais[0].x).toBeLessThan(0); // AI moves in -x
  });

  it('stops at end when loop is off', () => {
    player.load(snapshot);
    player.update(1.5); // past duration
    expect(player.playing).toBe(false);
    expect(player.isFinished()).toBe(true);
  });

  it('loops when loop is on', () => {
    player.load(snapshot);
    player.loop = true;
    player.update(1.5);
    expect(player.playing).toBe(true);
    expect(player.isFinished()).toBe(false);
    expect(player.time).toBeCloseTo(0);
  });

  it('seekTo sets position correctly', () => {
    player.load(snapshot);
    player.seekTo(0.5);
    expect(player.time).toBeCloseTo(0.5);
    expect(player.isFinished()).toBe(false);
  });

  it('seekTo(0) resets to beginning', () => {
    player.load(snapshot);
    player.update(0.5);
    player.seekTo(0);
    expect(player.time).toBe(0);
    expect(player.frameIndex).toBe(0);
  });

  it('seekTo(1) goes to end', () => {
    player.load(snapshot);
    player.seekTo(1);
    expect(player.time).toBeCloseTo(1.0);
  });

  it('handles speed changes', () => {
    player.load(snapshot);
    player.speed = 2;
    const result = player.update(0.25);
    expect(result!.time).toBeCloseTo(0.5); // 0.25 * 2x speed
  });

  it('handles reverse playback', () => {
    player.load(snapshot);
    player.update(0.5); // advance to middle
    player.speed = -1;
    player.update(0.2); // go backward
    expect(player.time).toBeCloseTo(0.3);
  });

  it('returns duration and progress in result', () => {
    player.load(snapshot);
    const result = player.update(0.016);
    expect(result!.duration).toBe(1.0);
    expect(result!.progress).toBeGreaterThanOrEqual(0);
    expect(result!.progress).toBeLessThanOrEqual(1);
  });
});

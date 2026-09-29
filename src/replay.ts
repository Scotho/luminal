// ── Replay System ────────────────────────────────────────
// Records per-frame snapshots during gameplay and plays them back
import { lerpAngle } from './utils';
import { DEFAULT_PLAYER_COLOR_KEY, getPlayerColor } from './playerColors';
import { getSelectedMap } from './ui/mapSelectUI';
import type { PlayerState, ReplayFrame, ReplaySnapshot, InterpolatedReplayFrame, ColorEntry, VehicleType, MapType } from './types/index';

interface ReplayRecordable {
  mesh: { position: { x: number; z: number } };
  angle: number;
  speed: number;
  boosting: boolean;
  dashing: boolean;
  alive: boolean;
}

const RECORD_INTERVAL: number = 1 / 30; // 30fps recording (every ~33ms)

export class ReplayRecorder {
  frames: ReplayFrame[];
  timer: number;
  playerColor: number;
  playerEmissive: number;
  playerVehicle: VehicleType;
  _mapType: MapType | undefined;
  aiColors: ColorEntry[];
  aiVehicles: VehicleType[];

  constructor() {
    this.frames = [];
    this.timer = 0;
    this.playerColor = 0;
    this.playerEmissive = 0;
    this.playerVehicle = 'bike';
    this._mapType = undefined;
    this.aiColors = [];
    this.aiVehicles = [];
  }

  reset(playerColor: number, playerEmissive: number, aiColors: ColorEntry[], playerVehicle: VehicleType = 'bike', aiVehicles: VehicleType[] = []): void {
    this.frames = [];
    this.timer = 0;
    this.playerColor = playerColor;
    this.playerEmissive = playerEmissive;
    this.playerVehicle = playerVehicle;
    this._mapType = getSelectedMap();
    this.aiColors = aiColors.map((c: ColorEntry) => ({ color: c.color, emissive: c.emissive }));
    this.aiVehicles = aiVehicles;
  }

  record(dt: number, player: ReplayRecordable | null, ais: { player: ReplayRecordable | null }[], matchTime: number): void {
    this.timer += dt;
    if (this.timer < RECORD_INTERVAL) return;
    this.timer -= RECORD_INTERVAL;

    const frame: ReplayFrame = {
      t: matchTime,
      player: player && player.alive ? {
        x: player.mesh.position.x,
        z: player.mesh.position.z,
        angle: player.angle,
        speed: player.speed,
        boosting: player.boosting,
        dashing: player.dashing,
        alive: true,
      } : {
        x: player ? player.mesh.position.x : 0,
        z: player ? player.mesh.position.z : 0,
        angle: player ? player.angle : 0,
        speed: 0,
        boosting: false,
        dashing: false,
        alive: false,
      },
      ais: ais.map((ai: { player: ReplayRecordable | null }) => {
        const p = ai.player;
        return p && p.alive ? {
          x: p.mesh.position.x,
          z: p.mesh.position.z,
          angle: p.angle,
          speed: p.speed,
          boosting: p.boosting,
          dashing: p.dashing,
          alive: true,
        } : {
          x: p ? p.mesh.position.x : 0,
          z: p ? p.mesh.position.z : 0,
          angle: p ? p.angle : 0,
          speed: 0,
          boosting: false,
          dashing: false,
          alive: false,
        };
      }),
    };

    this.frames.push(frame);
  }

  hasData(): boolean {
    return this.frames.length > 10;
  }

  getSnapshot(): ReplaySnapshot {
    return {
      frames: this.frames,
      playerColor: this.playerColor,
      playerEmissive: this.playerEmissive,
      playerVehicle: this.playerVehicle,
      mapType: this._mapType || undefined,
      aiColors: this.aiColors,
      aiVehicles: this.aiVehicles,
      duration: this.frames.length > 0 ? this.frames[this.frames.length - 1].t : 0,
    };
  }
}

export class ReplayPlayer {
  data: ReplaySnapshot | null;
  time: number;
  playing: boolean;
  speed: number;
  frameIndex: number;
  loop: boolean;
  _finished: boolean;
  _seekDirty: boolean;

  constructor() {
    this.data = null;
    this.time = 0;
    this.playing = false;
    this.speed = 1;
    this.frameIndex = 0;
    this.loop = false;
    this._finished = false;
    this._seekDirty = false;
  }

  load(snapshot: ReplaySnapshot): void {
    // Normalize snapshot — old replays may be missing fields
    if (!snapshot.duration && snapshot.frames.length > 0) {
      snapshot.duration = snapshot.frames[snapshot.frames.length - 1].t || 0;
    }
    if (!snapshot.aiColors) snapshot.aiColors = [];
    if (!snapshot.playerColor) snapshot.playerColor = getPlayerColor(DEFAULT_PLAYER_COLOR_KEY).color;
    if (!snapshot.playerEmissive) snapshot.playerEmissive = snapshot.playerColor;
    this.data = snapshot;
    this.time = 0;
    this.playing = true;
    this.speed = 1;
    this.frameIndex = 0;
    this._finished = false;
  }

  update(dt: number): InterpolatedReplayFrame | null {
    const seeked: boolean = this._seekDirty;
    this._seekDirty = false;
    if (!this.data) return null;
    if (!this.playing && !seeked) return null;

    if (!seeked) this.time += dt * this.speed;
    const duration: number = this.data.duration;

    // Clamp at boundaries
    if (this.time >= duration) {
      if (this.loop) {
        this.time = 0;
        this.frameIndex = 0;
        this._finished = false;
      } else {
        this.time = duration;
        this.playing = false;
        this._finished = true;
      }
    } else if (this.time < 0) {
      if (this.loop) {
        this.time = duration;
        this.frameIndex = this.data.frames.length - 2;
        this._finished = false;
      } else {
        this.time = 0;
        this.frameIndex = 0;
        this.playing = false;
        this._finished = true;
      }
    } else {
      this._finished = false;
    }

    // Find the two frames to interpolate between
    const frames: ReplayFrame[] = this.data.frames;
    // Scan forward or backward depending on direction
    if (this.speed >= 0) {
      while (this.frameIndex < frames.length - 1 && frames[this.frameIndex + 1].t <= this.time) {
        this.frameIndex++;
      }
    } else {
      while (this.frameIndex > 0 && frames[this.frameIndex].t > this.time) {
        this.frameIndex--;
      }
    }

    if (this.frameIndex >= frames.length) this.frameIndex = frames.length - 1;
    if (this.frameIndex < 0) this.frameIndex = 0;
    const f0: ReplayFrame = frames[this.frameIndex];
    const f1: ReplayFrame = frames[Math.min(this.frameIndex + 1, frames.length - 1)];
    if (!f0 || !f1) return null; // corrupt/empty replay data
    const segDur: number = f1.t - f0.t;
    const frac: number = segDur > 0 ? Math.max(0, Math.min(1, (this.time - f0.t) / segDur)) : 0;

    return {
      time: this.time,
      duration,
      player: lerpState(f0.player, f1.player, frac),
      ais: (f0.ais || []).map((a: PlayerState, i: number) => lerpState(a, f1.ais?.[i] || a, frac)),
      progress: duration > 0 ? this.time / duration : 0,
    };
  }

  seekTo(progress: number): void {
    if (!this.data) return;
    this.time = progress * this.data.duration;
    this._finished = false;
    this._seekDirty = true;
    // Reset frame index and search forward
    this.frameIndex = 0;
    const frames: ReplayFrame[] = this.data.frames;
    while (this.frameIndex < frames.length - 1 && frames[this.frameIndex + 1].t <= this.time) {
      this.frameIndex++;
    }
  }

  isFinished(): boolean {
    return this._finished;
  }
}

function lerpState(a: PlayerState, b: PlayerState, t: number): PlayerState {
  // Don't interpolate if one is dead and other alive
  if (!a.alive && !b.alive) return { ...a };
  if (!b.alive) return { ...a, alive: t < 0.99 };

  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    angle: lerpAngle(a.angle, b.angle, t),
    speed: a.speed + (b.speed - a.speed) * t,
    boosting: t < 0.5 ? a.boosting : b.boosting,
    dashing: t < 0.5 ? a.dashing : b.dashing,
    alive: a.alive,
  };
}

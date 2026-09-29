// ── Animation viewer helpers ─────────────────────────────
// Pure data/functions extracted from viewer.ts to keep it under the 400-line limit.

import {
  HoverAnimState,
  BikeAnimState,
  CarAnimState,
  PRESET_NAMES,
  LOADOUT_DISPLAY_NAMES,
} from '@main/viewerExports';
import type {
  HoverAnimInput,
  BikeAnimInput,
  CarAnimInput,
  VehiclePhysics,
  VehicleType,
  PresetName,
  HoverboardAnimator,
  BikeAnimator,
  CarAnimator,
} from '@main/viewerExports';
import type * as THREE from 'three';

export function buildViewerMarkup(currentPreset: PresetName, currentColor: string): string {
  return `
    <div class="viewer-toolbar">
      <span class="viewer-title">Model Viewer</span>
      <span class="viewer-sep">|</span>
      <div class="viewer-vehicle-tabs">
        <button class="viewer-vehicle-tab active" data-vehicle="bike">${LOADOUT_DISPLAY_NAMES.bike}</button>
        <button class="viewer-vehicle-tab" data-vehicle="car">${LOADOUT_DISPLAY_NAMES.car}</button>
        <button class="viewer-vehicle-tab" data-vehicle="hoverboard">${LOADOUT_DISPLAY_NAMES.hoverboard}</button>
      </div>
      <span class="viewer-sep">|</span>
      <label>Preset</label>
      <select id="viewer-preset">
        ${PRESET_NAMES.map(p => `<option value="${p}"${p === currentPreset ? ' selected' : ''}>${p}</option>`).join('')}
      </select>
      <span class="viewer-sep">|</span>
      <label>Color</label>
      <input type="color" id="viewer-color" value="${currentColor}">
      <span class="viewer-sep">|</span>
      <button class="viewer-vehicle-tab" id="viewer-turntable" title="Auto-rotate">&#x21bb; Turntable</button>
      <button class="viewer-vehicle-tab" id="viewer-wireframe" title="Wireframe">&#x25a1; Wireframe</button>
      <button class="viewer-vehicle-tab" id="viewer-pose-toggle" title="Pose Values">&#x1f4ca; Pose</button>
      <button class="viewer-vehicle-tab" id="viewer-screenshot" title="Screenshot">&#x1f4f7; Capture</button>
    </div>
    <div class="viewer-anim-bar" id="viewer-anim-bar" style="display:none">
      <label>Animation</label>
      <select id="viewer-anim-state"></select>
      <span class="viewer-sep">|</span>
      <label>Param</label>
      <input type="range" id="viewer-anim-param" min="-1" max="1" step="0.01" value="0">
      <span id="viewer-anim-param-val">0.00</span>
      <span class="viewer-sep">|</span>
      <label><input type="checkbox" id="viewer-anim-loop" checked> Loop</label>
      <span class="viewer-sep">|</span>
      <label>Speed</label>
      <input type="range" id="viewer-anim-speed" min="0.1" max="3" step="0.1" value="1">
      <span id="viewer-anim-speed-val">1.0x</span>
      <span class="viewer-sep">|</span>
      <button class="viewer-vehicle-tab" id="viewer-freeze" title="Freeze Frame">&#x23F8; Freeze</button>
      <span class="viewer-sep">|</span>
      <span id="viewer-anim-current-state" class="viewer-anim-state-label"></span>
    </div>
    <div class="viewer-info-panel" id="viewer-info-panel">
      <button class="viewer-info-toggle" id="viewer-info-toggle">Vehicle Stats &#x25BC;</button>
      <div class="viewer-info-body" id="viewer-info-body">
        <div id="viewer-phys-stats"></div>
        <div class="viewer-desc" id="viewer-desc"></div>
      </div>
    </div>
    <div class="viewer-canvas-wrap" id="viewer-canvas-wrap">
      <div class="viewer-pose-overlay" id="viewer-pose-overlay" style="display:none"></div>
      <div class="viewer-stats" id="viewer-stats"></div>
    </div>
  `;
}

export const ANIM_STATE_LABELS: { value: HoverAnimState; label: string }[] = [
  { value: HoverAnimState.Idle, label: 'Idle' },
  { value: HoverAnimState.Accel, label: 'Accel Crouch' },
  { value: HoverAnimState.Boost, label: 'Boost Tuck' },
  { value: HoverAnimState.Turn, label: 'Turn Sway' },
  { value: HoverAnimState.BoardGrab, label: 'Board Grab' },
  { value: HoverAnimState.GrindEntry, label: 'Grind Entry' },
  { value: HoverAnimState.GrindRide, label: 'Grind Balance' },
  { value: HoverAnimState.GrindExit, label: 'Grind Exit' },
  { value: HoverAnimState.Airborne, label: 'Airborne' },
  { value: HoverAnimState.Recovery, label: 'Recovery' },
  { value: HoverAnimState.Bail, label: 'Bail' },
];

export const BIKE_STATE_LABELS: { value: BikeAnimState; label: string }[] = [
  { value: BikeAnimState.Idle, label: 'Idle' },
  { value: BikeAnimState.Accel, label: 'Accel' },
  { value: BikeAnimState.Boost, label: 'Boost' },
  { value: BikeAnimState.Turn, label: 'Turn' },
  { value: BikeAnimState.Brake, label: 'Brake' },
];

export const CAR_STATE_LABELS: { value: CarAnimState; label: string }[] = [
  { value: CarAnimState.Idle, label: 'Idle' },
  { value: CarAnimState.Accel, label: 'Accel' },
  { value: CarAnimState.Boost, label: 'Boost' },
  { value: CarAnimState.Turn, label: 'Turn' },
  { value: CarAnimState.Drift, label: 'Drift' },
  { value: CarAnimState.Brake, label: 'Brake' },
  { value: CarAnimState.Airborne, label: 'Airborne' },
];

export const VEHICLE_DESCRIPTIONS: Record<VehicleType, string> = {
  bike: 'Agile lightcycle. Best turn rate, balanced speed. No drift, no grind.',
  car: 'Drift-capable muscle car. Highest dash speed. Drift for meter regen.',
  hoverboard: 'Grind-capable hoverboard. Can grind enemy trails. Unique trick system.',
};

export function rad2deg(r: number): string { return (r * 180 / Math.PI).toFixed(1); }

export function buildStatsHTML(p: VehiclePhysics): string {
  return `<div class="viewer-stats-grid">
    <span class="viewer-stat-label">Base</span><span>${p.baseSpeed}</span>
    <span class="viewer-stat-label">Boost</span><span>${p.boostSpeed}</span>
    <span class="viewer-stat-label">Dash</span><span>${p.dashSpeed}</span>
    <span class="viewer-stat-label">Brake</span><span>${p.brakeSpeed}</span>
    <span class="viewer-stat-label">Turn</span><span>${rad2deg(p.turnSpeed)}°/s</span>
    <span class="viewer-stat-label">Lean</span><span>${rad2deg(p.maxLean)}°</span>
    <span class="viewer-stat-label">Drift</span><span>${p.canDrift ? 'Yes' : 'No'}</span>
    <span class="viewer-stat-label">Grind</span><span>${p.canGrind ? 'Yes' : 'No'}</span>
    <span class="viewer-stat-label">Trail</span><span>${p.trailRear}</span>
  </div>`;
}

export function buildHoverInput(dt: number, state: HoverAnimState, animParam: number): HoverAnimInput {
  const base: HoverAnimInput = {
    dt, speed: 45, baseSpeed: 45, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0, grinding: false, grindBalance: 0,
    airborne: false, airborneTimer: 0, airborneDuration: 0.3, airbornePeak: 0,
    recovery: false, landingPenalty: false,
  };
  switch (state) {
    case HoverAnimState.Idle: break;
    case HoverAnimState.Accel: base.boosting = true; break;
    case HoverAnimState.Boost: base.dashing = true; break;
    case HoverAnimState.Turn: base.turnRamp = animParam; break;
    case HoverAnimState.BoardGrab:
      base.turnRamp = animParam >= 0 ? 0.85 : -0.85; base.speed = 50; break;
    case HoverAnimState.GrindEntry:
    case HoverAnimState.GrindRide:
      base.grinding = true; base.grindBalance = animParam; break;
    case HoverAnimState.GrindExit:
      base.grinding = false; base.turnRamp = animParam; break;
    case HoverAnimState.Airborne:
      base.airborne = true; base.airbornePeak = 0.8;
      base.airborneTimer = (1 - Math.abs(animParam)) * 0.3;
      base.airborneDuration = 0.3; base.turnRamp = animParam; break;
    case HoverAnimState.Recovery: base.recovery = true; break;
    case HoverAnimState.Bail:
      base.airborne = true; base.landingPenalty = true;
      base.airbornePeak = 1.2; base.airborneTimer = 0.2; base.airborneDuration = 0.4; break;
  }
  return base;
}

export function buildBikeInput(dt: number, state: BikeAnimState, animParam: number): BikeAnimInput {
  const base: BikeAnimInput = {
    dt, speed: 45, baseSpeed: 45, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0,
  };
  switch (state) {
    case BikeAnimState.Idle: break;
    case BikeAnimState.Accel: base.boosting = true; break;
    case BikeAnimState.Boost: base.dashing = true; break;
    case BikeAnimState.Turn: base.turnRamp = animParam; break;
    case BikeAnimState.Brake: base.brakeBlend = Math.abs(animParam) || 0.5; break;
  }
  return base;
}

export interface PoseOverlayContext {
  currentVehicle: VehicleType;
  currentModel: THREE.Object3D;
  hoverAnimator: HoverboardAnimator | null;
  bikeAnimator: BikeAnimator | null;
  carAnimator: CarAnimator | null;
}

export function buildPoseOverlayHTML(ctx: PoseOverlayContext): string {
  const { currentVehicle, currentModel, hoverAnimator, bikeAnimator, carAnimator } = ctx;
  const lines: string[] = [];
  if (currentVehicle === 'hoverboard' && hoverAnimator) {
    const s = ANIM_STATE_LABELS.find(l => l.value === hoverAnimator.getState());
    lines.push(`State: ${s?.label ?? '?'}`);
    lines.push(`innerY: ${currentModel.position.y.toFixed(4)}`);
    lines.push(`innerRollZ: ${currentModel.rotation.z.toFixed(4)}`);
  } else if (currentVehicle === 'bike' && bikeAnimator) {
    const s = BIKE_STATE_LABELS.find(l => l.value === bikeAnimator.getState());
    lines.push(`State: ${s?.label ?? '?'}`);
    lines.push(`Y: ${currentModel.position.y.toFixed(4)}`);
    lines.push(`Roll: ${currentModel.rotation.z.toFixed(4)}`);
    lines.push(`Pitch: ${currentModel.rotation.x.toFixed(4)}`);
  } else if (currentVehicle === 'car' && carAnimator) {
    const s = CAR_STATE_LABELS.find(l => l.value === carAnimator.getState());
    lines.push(`State: ${s?.label ?? '?'}`);
    lines.push(`Y: ${currentModel.position.y.toFixed(4)}`);
    lines.push(`Roll: ${currentModel.rotation.z.toFixed(4)}`);
    lines.push(`Pitch: ${currentModel.rotation.x.toFixed(4)}`);
  }
  return lines.join('<br>');
}

export function buildCarInput(dt: number, state: CarAnimState, animParam: number): CarAnimInput {
  const base: CarAnimInput = {
    dt, speed: 45, baseSpeed: 45, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0, drifting: false, driftDirection: 0,
    airborne: false, airborneTimer: 0, airborneDuration: 0.3, airbornePeak: 0,
  };
  switch (state) {
    case CarAnimState.Idle: break;
    case CarAnimState.Accel: base.boosting = true; break;
    case CarAnimState.Boost: base.dashing = true; break;
    case CarAnimState.Turn: base.turnRamp = animParam; break;
    case CarAnimState.Drift:
      base.drifting = true;
      base.driftDirection = animParam >= 0 ? 1 : -1;
      base.turnRamp = animParam;
      break;
    case CarAnimState.Brake: base.brakeBlend = Math.abs(animParam) || 0.5; break;
    case CarAnimState.Airborne:
      base.airborne = true; base.airbornePeak = 2.0;
      base.airborneTimer = (1 - Math.abs(animParam)) * 0.3;
      base.airborneDuration = 0.3;
      break;
  }
  return base;
}

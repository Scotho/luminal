export type HudState = 'dash' | 'driftBoost' | 'drift' | 'wBoost' | 'idle';

export interface MeterHUDState {
  hudState: HudState | null;
  hudStateTimer: number;
  sparkBurst: number;
  prevLocked: boolean;
}

export interface MeterHUDElements {
  fill: HTMLElement;
  bar: HTMLElement;
  spark: HTMLElement;
  label: HTMLElement;
}

export interface PlayerMeterState {
  meterPercent: number;
  dashing: boolean;
  driftBoosting: boolean;
  drifting: boolean;
  wBoosting: boolean;
  boostLocked: boolean;
  meterGaining: boolean;
  proximitySpeedBoost: number;
}

export function updateMeterHUD(
  player: PlayerMeterState,
  elements: MeterHUDElements,
  state: MeterHUDState,
): MeterHUDState {
  const pct: number = player.meterPercent * 100;
  const fill = elements.fill;
  fill.style.width = pct + '%';

  const meterBar = elements.bar;
  const spark = elements.spark;
  const label = elements.label;

  let hudState = state.hudState;
  let hudStateTimer = state.hudStateTimer;
  let sparkBurst = state.sparkBurst ?? 1;
  const prevLocked = state.prevLocked ?? false;

  // Determine HUD state — use hysteresis to prevent label flicker
  // when states oscillate rapidly (e.g. meter draining to 0 while holding drift+boost+W)
  let current: HudState = 'idle';
  if (player.dashing) current = 'dash';
  else if (player.driftBoosting) current = 'driftBoost';
  else if (player.drifting) current = 'drift';
  else if (player.wBoosting) current = 'wBoost';

  if (current !== hudState) {
    // Only switch away from a state if we've been in the new state for a few frames
    hudStateTimer = (hudStateTimer || 0) + 1;
    if (hudStateTimer < 4) current = (hudState as HudState) || current;
    else {
      // State actually changed — trigger spark burst + pop
      if (current === 'dash' || current === 'driftBoost') {
        sparkBurst = 1.6;
      }
      fill.classList.remove('meter-fill--pop');
      void fill.offsetWidth;
      fill.classList.add('meter-fill--pop');
      hudState = current;
      hudStateTimer = 0;
    }
  } else {
    hudStateTimer = 0;
  }

  // Decay spark burst toward 1.0
  if (sparkBurst > 1) {
    sparkBurst = Math.max(1, sparkBurst - 3.0 * (1 / 60));
  }

  if (current === 'dash') {
    fill.style.background = 'linear-gradient(90deg, rgb(var(--c-orange)), rgb(var(--c-gold)))';
    fill.style.boxShadow = '0 0 8px rgb(var(--c-orange)), 0 0 16px rgb(var(--c-orange-deep))';
    meterBar.style.borderColor = 'rgba(var(--c-orange), 0.7)';
    label.textContent = 'BOOST';
    label.style.color = 'rgb(var(--c-orange))';
  } else if (current === 'driftBoost') {
    fill.style.background = 'linear-gradient(90deg, rgb(var(--c-magenta)), #ff4df2, rgb(var(--c-magenta)))';
    fill.style.boxShadow = '0 0 10px rgb(var(--c-magenta)), 0 0 22px rgba(var(--c-magenta), 0.4)';
    meterBar.style.borderColor = 'rgba(var(--c-magenta), 0.6)';
    label.textContent = 'DRIFT BOOST';
    label.style.color = 'rgb(var(--c-magenta))';
  } else if (current === 'drift') {
    fill.style.background = 'linear-gradient(90deg, rgb(var(--c-hot-deep)), rgb(var(--c-hot-light)), rgb(var(--c-hot-deep)))';
    fill.style.boxShadow = '0 0 8px rgba(var(--c-hot-deep),0.5), 0 0 18px rgba(var(--c-hot-deep),0.25)';
    meterBar.style.borderColor = 'rgba(var(--c-hot-deep), 0.5)';
    label.textContent = 'DRIFT';
    label.style.color = 'rgb(var(--c-hot-light))';
  } else if (current === 'wBoost') {
    fill.style.background = 'linear-gradient(90deg, rgba(0,120,180,0.6), rgba(0,180,220,0.7))';
    fill.style.boxShadow = '0 0 4px rgba(0, 180, 255, 0.3)';
    meterBar.style.borderColor = 'rgba(80, 40, 180, 0.3)';
    label.textContent = 'BOOST';
    label.style.color = 'rgb(var(--c-teal))';
  } else if (player.boostLocked) {
    fill.style.background = 'linear-gradient(90deg, rgba(200,40,40,0.7), rgba(255,60,60,0.8))';
    fill.style.boxShadow = '0 0 6px rgba(255, 40, 40, 0.4)';
    meterBar.style.borderColor = 'rgba(255, 50, 50, 0.5)';
    label.textContent = 'RECHARGING';
    label.style.color = 'rgb(255, 80, 80)';
  } else {
    if (pct > 60) {
      fill.style.background = 'linear-gradient(90deg, rgba(0,180,255,0.8), rgba(var(--c-teal), 0.9))';
      fill.style.boxShadow = '0 0 6px rgba(var(--c-teal), 0.4), 0 0 12px rgba(0, 200, 255, 0.2)';
    } else if (pct > 25) {
      fill.style.background = 'rgb(var(--c-teal-shadow))';
      fill.style.boxShadow = '0 0 6px rgb(var(--c-teal-shadow))';
    } else {
      fill.style.background = 'rgb(var(--bg-dark-cyan))';
      fill.style.boxShadow = '0 0 4px rgb(var(--bg-dark-cyan))';
    }
    meterBar.style.borderColor = 'rgba(var(--c-hot-dim), 0.3)';
    label.textContent = 'BOOST';
    label.style.color = 'rgb(var(--c-teal))';
  }

  // Lock-state pulse class
  if (player.boostLocked && !prevLocked) {
    fill.classList.add('meter-fill--locked');
  } else if (!player.boostLocked && prevLocked) {
    fill.classList.remove('meter-fill--locked');
    fill.style.opacity = '';
  }

  // Spark at fill edge
  const isCharging: boolean = player.meterGaining && !player.dashing && pct < 99;
  if (isCharging && !player.boostLocked) {
    spark.classList.add('active');
    const t: number = performance.now() * 0.001;
    const flicker: number = Math.sin(t * 14) * 0.15 + Math.sin(t * 23) * 0.1 + Math.sin(t * 37) * 0.08;
    const sparkOpacity: number = 0.6 + flicker + player.proximitySpeedBoost * 0.3;
    spark.style.opacity = String(Math.max(0.3, Math.min(1, sparkOpacity)));
    const h: number = (14 + flicker * 20 + player.proximitySpeedBoost * 8) * sparkBurst;
    spark.style.height = h + 'px';
    spark.style.top = -(h / 2 - 4) + 'px';
  } else {
    spark.classList.remove('active');
    spark.style.opacity = '0';
  }

  return { hudState, hudStateTimer, sparkBurst, prevLocked: player.boostLocked };
}

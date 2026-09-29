import { playNewRecord, playStreakLoss, playStreakTick } from '../sfx';
import { spawnKillcamSparkles, fadeKillcamSparkles, clearKillcamSparkles } from './streakUI';

export interface StreakCeremony {
  streak: number;
  wasRecord: boolean;
  distanceToBest: number;
  phase: 'pending' | 'hitstop' | 'record' | 'vaporize' | 'done';
}

export interface StreakIncrementAnim {
  prevStreak: number;
  newStreak: number;
  phase: 'pending' | 'showing' | 'done';
}

export interface StreakCeremonyState {
  ceremony: StreakCeremony | null;
  timer: number;
}

export interface StreakIncrementState {
  anim: StreakIncrementAnim | null;
  timer: number;
  sparklesSpawned: boolean;
}

export interface HandleStreakLossResult {
  ceremony: StreakCeremony;
  lastStreakEnd: { streak: number; wasRecord: boolean; distanceToBest: number };
  killcamDurationDelta: number;
}

export function handleStreakLoss(
  streak: number,
  wasRecord: boolean,
  distanceToBest: number,
): HandleStreakLossResult {
  const killcamDurationDelta = wasRecord ? 2.0 : 0.8;
  const ceremony: StreakCeremony = {
    streak,
    wasRecord,
    distanceToBest,
    phase: 'pending',
  };
  return {
    ceremony,
    lastStreakEnd: { streak, wasRecord, distanceToBest },
    killcamDurationDelta,
  };
}

export function updateStreakCeremony(
  c: StreakCeremony,
  dt: number,
  timer: number,
  killcamTimer: number,
  killcamDuration: number,
  startVaporize: (streak: number) => void,
): StreakCeremonyState {
  timer += dt;

  const overlay = document.getElementById('killcam-streak-overlay');
  const recordEl = document.getElementById('killcam-new-record');
  const valueEl = document.getElementById('killcam-streak-value');
  const numEl = document.getElementById('killcam-streak-num');

  switch (c.phase) {
    case 'pending':
      c.phase = 'hitstop';
      timer = 0;
      break;

    case 'hitstop':
      if (timer >= 0.02) {
        c.phase = c.wasRecord ? 'record' : 'vaporize';
        timer = 0;
        if (overlay) overlay.classList.add('visible');
        if (valueEl) valueEl.textContent = String(c.streak);
        if (numEl) numEl.style.opacity = '1';
        if (c.wasRecord) {
          playNewRecord();
          if (recordEl) recordEl.classList.add('active');
        } else {
          playStreakLoss();
        }
      }
      break;

    case 'record':
      if (timer >= 1.0) {
        c.phase = 'vaporize';
        timer = 0;
        startVaporize(c.streak);
        playStreakLoss();
      }
      break;

    case 'vaporize':
      if (timer >= 2.0
          && killcamTimer >= killcamDuration - 0.1) {
        c.phase = 'done';
        if (overlay) overlay.classList.remove('visible');
        if (recordEl) recordEl.classList.remove('active');
        return { ceremony: null, timer };
      }
      break;
  }

  return { ceremony: c, timer };
}

export function updateStreakIncrement(
  a: StreakIncrementAnim,
  dt: number,
  timer: number,
  sparklesSpawned: boolean,
  killcamTimer: number,
  killcamDuration: number,
): StreakIncrementState {
  timer += dt;

  const overlay = document.getElementById('killcam-streak-overlay');
  const numEl = document.getElementById('killcam-streak-num');
  const valueEl = document.getElementById('killcam-streak-value');

  switch (a.phase) {
    case 'pending':
      if (overlay) overlay.classList.add('visible');
      if (numEl) numEl.style.opacity = '1';
      if (valueEl) {
        valueEl.textContent = a.prevStreak >= 1 ? String(a.prevStreak) : String(a.newStreak);
        valueEl.classList.remove('streak-slide-down');
      }
      a.phase = 'showing';
      timer = 0;
      break;

    case 'showing': {
      if (timer >= 0.15 && valueEl && !valueEl.classList.contains('streak-slide-down')) {
        valueEl.classList.add('streak-slide-down');
        playStreakTick();
      }
      if (timer >= 0.4 && valueEl && valueEl.textContent !== String(a.newStreak)) {
        valueEl.textContent = String(a.newStreak);
      }
      if (timer >= 0.55 && !sparklesSpawned) {
        sparklesSpawned = true;
        spawnKillcamSparkles();
      }
      if (timer >= 1.4 && sparklesSpawned) {
        fadeKillcamSparkles();
      }
      if (timer >= 2.0
          && killcamTimer >= killcamDuration - 0.1) {
        a.phase = 'done';
        if (overlay) overlay.classList.remove('visible');
        if (valueEl) valueEl.classList.remove('streak-slide-down');
        clearKillcamSparkles();
        return { anim: null, timer, sparklesSpawned: false };
      }
      break;
    }
  }

  return { anim: a, timer, sparklesSpawned };
}

export function startStreakVaporize(streak: number): void {
  const canvas = document.getElementById('killcam-streak-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  import('./vaporText').then(({ startVaporText: startVapor, triggerVaporText: triggerVapor }) => {
    startVapor(canvas, `STREAK ${streak}`, {
      fontSize: 28,
      fontWeight: 900,
      color: 'rgba(255, 200, 50, 0.95)',
      vaporizeDuration: 1.5,
      fadeInDuration: 0,
      holdDuration: 0.1,
    });
    triggerVapor();
    const numEl = document.getElementById('killcam-streak-num');
    if (numEl) numEl.style.opacity = '0';
  });
}

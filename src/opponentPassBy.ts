import type { PassByConfig } from './types/index';

const _cooldowns: Map<string, number> = new Map();

export function shouldTriggerPassBy(
  id: string,
  prevRadialV: number,
  currentRadialV: number,
  distance: number,
  config: PassByConfig,
  time: number,
): boolean {
  if (distance > config.triggerRange) return false;
  if (!(prevRadialV < 0 && currentRadialV > 0)) return false;
  const lastTrigger = _cooldowns.get(id) ?? -Infinity;
  if (time - lastTrigger < config.cooldown) return false;
  _cooldowns.set(id, time);
  return true;
}

export function selectPassByVariant(config: PassByConfig, speedFactor: number): string {
  const [slowToMed, medToFast] = config.speedThresholds;
  let pool: string[];
  if (speedFactor >= medToFast) {
    pool = config.fastSamples;
  } else if (speedFactor >= slowToMed) {
    pool = config.mediumSamples;
  } else {
    pool = config.slowSamples;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

export function resetPassByCooldowns(): void {
  _cooldowns.clear();
}

import { getCtx } from './sfxContext';
import { getVehicleAudioProfile } from './vehicleAudioProfiles';
import type { VehicleType, VehicleAudioProfile } from './types/index';

let _vehicleBuffers: Map<string, Map<string, AudioBuffer>> = new Map();
let _loaded: Set<VehicleType> = new Set();
let _loading: Map<VehicleType, Promise<void>> = new Map();

/** Reset all loader state — for testing only. */
// ts-prune-ignore-next
export function resetLoader(): void {
  _vehicleBuffers = new Map();
  _loaded = new Set();
  _loading = new Map();
}

/** Collect all sample keys a profile references. */
function getSampleKeys(profile: VehicleAudioProfile): string[] {
  const keys: string[] = [];

  if (profile.startup) keys.push(profile.startup);
  if (profile.shutdown) keys.push(profile.shutdown);

  if (profile.sweepConfig) {
    keys.push(profile.sweepConfig.idleSample);
    keys.push(profile.sweepConfig.sweepSample);
  }

  if (profile.rpmBandConfig) {
    for (const band of profile.rpmBandConfig.bandSamples) {
      keys.push(band.loopSample);
      if (band.onSample) keys.push(band.onSample);
      if (band.offSample) keys.push(band.offSample);
    }
    keys.push(...profile.rpmBandConfig.windSamples);
    keys.push(profile.rpmBandConfig.aggroOnSample);
    keys.push(profile.rpmBandConfig.aggroOffSample);
  }

  if (profile.passByConfig) {
    keys.push(...profile.passByConfig.slowSamples);
    keys.push(...profile.passByConfig.mediumSamples);
    keys.push(...profile.passByConfig.fastSamples);
  }

  return [...new Set(keys.filter(k => k.length > 0))];
}

/** Resolve sample key → asset paths based on vehicle type. */
function getAssetPaths(vehicleType: VehicleType, sampleKey: string): string[] {
  // Hoverboard startup reuses existing sfx path
  if (sampleKey === 'bikeStart') {
    return ['/sfx/bike-start.webm', '/sfx/bike-start.mp3'];
  }

  const dir = vehicleType === 'bike' ? 'spectre'
            : vehicleType === 'car' ? 'slingshot'
            : 'hoverboard';

  return [
    `/sfx/vehicles/${dir}/${sampleKey}.webm`,
    `/sfx/vehicles/${dir}/${sampleKey}.mp3`,
  ];
}

async function loadSample(
  ctx: AudioContext,
  vehicleType: VehicleType,
  sampleKey: string,
  bufferMap: Map<string, AudioBuffer>,
): Promise<void> {
  const paths = getAssetPaths(vehicleType, sampleKey);
  for (const path of paths) {
    try {
      const resp = await fetch(path);
      if (!resp.ok) continue;
      const arrayBuf = await resp.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      bufferMap.set(sampleKey, audioBuf);
      return;
    } catch {
      continue;
    }
  }
}

export async function preloadVehicleAudio(vehicleType: VehicleType): Promise<void> {
  if (_loaded.has(vehicleType)) return;
  if (_loading.has(vehicleType)) return _loading.get(vehicleType);

  const profile = getVehicleAudioProfile(vehicleType);

  if (profile.strategy === 'procedural') {
    _loaded.add(vehicleType);
    return;
  }

  const promise = (async () => {
    const ctx = getCtx();
    const bufferMap = new Map<string, AudioBuffer>();
    const keys = getSampleKeys(profile);

    await Promise.allSettled(
      keys.map(key => loadSample(ctx, vehicleType, key, bufferMap))
    );

    _vehicleBuffers.set(vehicleType, bufferMap);
    _loaded.add(vehicleType);
  })();

  _loading.set(vehicleType, promise);
  await promise;
  _loading.delete(vehicleType);
}

export function getVehicleBuffer(vehicleType: VehicleType, sampleKey: string): AudioBuffer | null {
  return _vehicleBuffers.get(vehicleType)?.get(sampleKey) ?? null;
}

// ts-prune-ignore-next
export function isVehicleLoaded(vehicleType: VehicleType): boolean {
  return _loaded.has(vehicleType);
}

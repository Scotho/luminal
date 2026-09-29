// Helpers ported from synthcity/src/classes/GeneratorUtils.js.
// The only behaviour that matters here is fixNoise's remap curve — it massages
// Perlin's bell-shaped output into a more uniform [0, 1) distribution, which
// is what every building-type threshold in GeneratorCityBlock relies on.

/** Remap Perlin output from its typical [0.2, 0.75] range onto [0, 0.9999]. */
export function fixNoise(n: number): number {
  const inMin = 0.2;
  const inMax = 0.75;
  const outMin = 0;
  const outMax = 0.9999;
  let r = ((n - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  if (r < outMin) r = outMin;
  if (r > outMax) r = outMax;
  return r;
}

/** Snap a noise sample to one of the four cardinal rotations. */
export function getBuildingRotation(noise: number): number {
  const angles = [0, 90, 180, 270];
  return angles[Math.floor(noise * angles.length)];
}

/** Pick a building material id from the standard set based on a noise sample. */
export function pickBuildingMatId(noise: number): string {
  const mats = [
    'building_01',
    'building_02',
    'building_03',
    'building_04',
    'building_05',
    'building_07',
  ];
  return mats[Math.floor(noise * mats.length)];
}

/** Pick a big-building material id. `rare` flips to a rarer exotic palette. */
export function pickBigBuildingMatId(noise: number, rare: boolean): string {
  const mats = ['building_01', 'building_02', 'building_03', 'building_04', 'building_05'];
  const matsRare = ['building_06', 'building_08', 'building_09', 'building_10'];
  if (!rare) return mats[Math.floor(noise * mats.length)];
  return matsRare[Math.floor(noise * matsRare.length)];
}

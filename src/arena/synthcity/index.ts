// Barrel for the synthcity procgen + assets subsystem.
// Import from here — never from individual files — so the public surface
// stays obvious and the internal reorganisation is easy.
//
// Original models, textures, and procedural generation by Jeff Beene
// https://github.com/jeffbeene/synthcity

export { Perlin } from './perlin';
export { createAlea, type AleaRandom } from './alea';
export {
  fixNoise,
  getBuildingRotation,
  pickBuildingMatId,
  pickBigBuildingMatId,
} from './GeneratorUtils';
export { Generator, type GeneratorItem, type GeneratorOptions } from './Generator';
export { GeneratorCityBlock, type CityBlockContext } from './GeneratorCityBlock';
export { GeneratorCityLight, type LightPoolEntry } from './GeneratorCityLight';
export { GeneratorTraffic } from './GeneratorTraffic';
export { getSynthCityAssets, type SynthCityAssets, __resetSynthCityAssetsCache } from './SynthCityAssets';
export * as SynthCityConstants from './constants';

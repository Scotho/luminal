import * as THREE from 'three';
import type { GeneratorItem } from './Generator';
import type { Perlin } from './perlin';
import { fixNoise } from './GeneratorUtils';
import { NOISE_FACTOR } from './constants';

export interface LightPoolEntry {
  light: THREE.PointLight;
  free: boolean;
}

/**
 * Streamed city light — picks a free slot from a shared light pool and
 * positions it at a point in the city grid, colouring by noise. On remove
 * the slot is released back to the pool.
 *
 * Ported from synthcity/src/classes/GeneratorItem_CityLight.js.
 */
export class GeneratorCityLight implements GeneratorItem {
  private lightIndex: number | null = null;

  constructor(
    public readonly x: number,
    public readonly z: number,
    private readonly pool: LightPoolEntry[],
    private readonly noise: Perlin,
  ) {
    const typeNoise = fixNoise(this.noise.noise(this.x * NOISE_FACTOR, this.z * NOISE_FACTOR));

    // Only "notable" cells (low or high noise) get a light.
    if (typeNoise < 0.2 || typeNoise > 0.8) {
      for (let i = 0; i < this.pool.length; i++) {
        const slot = this.pool[i];
        if (slot.free) {
          const colorNoise = fixNoise(this.noise.noise(this.x * 4, this.z * 4));
          const hue = 0.5 + colorNoise / 2;
          slot.light.position.set(this.x, 100, this.z);
          slot.light.color.setHSL(hue, 1, 0.5);
          slot.free = false;
          this.lightIndex = i;
          break;
        }
      }
    }
  }

  remove(): void {
    if (this.lightIndex !== null) {
      this.pool[this.lightIndex].free = true;
      this.lightIndex = null;
    }
  }

  update(): void {
    // Lights are static per cell — nothing to tick.
  }
}

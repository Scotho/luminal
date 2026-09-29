// Perlin noise — ported from the standalone synthcity/js/proc-noise.js, which
// is itself a JavaScript port of Processing's PApplet.noise implementation.
// Do not alter the algorithm — the curated seed (4217) depends on bit-for-bit
// identical output at every sample point.

import { createAlea, type AleaRandom } from './alea';

const PERLIN_YWRAPB = 4;
const PERLIN_YWRAP = 1 << PERLIN_YWRAPB;
const PERLIN_ZWRAPB = 8;
const PERLIN_ZWRAP = 1 << PERLIN_ZWRAPB;
const PERLIN_SIZE = 4095;

// Cosine LUT (Processing uses a 720-entry table keyed by degrees × 2).
const DEG_TO_RAD = 0.0174532925;
const SINCOS_PRECISION = 0.5;
const SINCOS_LENGTH = Math.floor(360 / SINCOS_PRECISION);
const COS_LUT = new Array<number>(SINCOS_LENGTH);
for (let i = 0; i < SINCOS_LENGTH; i++) {
  COS_LUT[i] = Math.cos(i * DEG_TO_RAD * SINCOS_PRECISION);
}
const PERLIN_TWOPI = SINCOS_LENGTH;
const PERLIN_PI = SINCOS_LENGTH >> 1;

export class Perlin {
  private aleaRand: AleaRandom;
  private perlinOctaves = 4;
  private perlinAmpFalloff = 0.5;
  private perlinArray: number[] = [];

  constructor(seed?: number) {
    this.aleaRand = seed !== undefined ? createAlea(seed) : createAlea();
  }

  noiseSeed(seed: number): void {
    this.aleaRand = createAlea(seed);
    this.perlinArray = [];
  }

  noiseDetail(lod: number, falloff?: number): void {
    if (Math.floor(lod) > 0) this.perlinOctaves = Math.floor(lod);
    if (falloff !== undefined && falloff > 0) this.perlinAmpFalloff = falloff;
  }

  private noise_fsc(i: number): number {
    return 0.5 * (1.0 - COS_LUT[Math.floor(i * PERLIN_PI) % PERLIN_TWOPI]);
  }

  noise(x: number, y = 0, z = 0): number {
    if (this.perlinArray.length === 0) {
      this.perlinArray = new Array<number>(PERLIN_SIZE + 1);
      for (let i = 0; i < PERLIN_SIZE + 1; i++) {
        this.perlinArray[i] = this.aleaRand();
      }
    }

    let xi = Math.floor(x);
    let yi = Math.floor(y);
    let zi = Math.floor(z);
    let xf = x - xi;
    let yf = y - yi;
    let zf = z - zi;
    let r = 0;
    let ampl = 0.5;

    for (let i = 0; i < this.perlinOctaves; i++) {
      let of = xi + (yi << PERLIN_YWRAPB) + (zi << PERLIN_ZWRAPB);
      const rxf = this.noise_fsc(xf);
      const ryf = this.noise_fsc(yf);

      let n1 = this.perlinArray[of & PERLIN_SIZE];
      n1 += rxf * (this.perlinArray[(of + 1) & PERLIN_SIZE] - n1);
      let n2 = this.perlinArray[(of + PERLIN_YWRAP) & PERLIN_SIZE];
      n2 += rxf * (this.perlinArray[(of + PERLIN_YWRAP + 1) & PERLIN_SIZE] - n2);
      n1 += ryf * (n2 - n1);

      of += PERLIN_ZWRAP;
      n2 = this.perlinArray[of & PERLIN_SIZE];
      n2 += rxf * (this.perlinArray[(of + 1) & PERLIN_SIZE] - n2);
      let n3 = this.perlinArray[(of + PERLIN_YWRAP) & PERLIN_SIZE];
      n3 += rxf * (this.perlinArray[(of + PERLIN_YWRAP + 1) & PERLIN_SIZE] - n3);
      n2 += ryf * (n3 - n2);

      n1 += this.noise_fsc(zf) * (n2 - n1);
      r += n1 * ampl;
      ampl *= this.perlinAmpFalloff;

      xi <<= 1;
      xf *= 2;
      yi <<= 1;
      yf *= 2;
      zi <<= 1;
      zf *= 2;
      if (xf >= 1) { xi++; xf--; }
      if (yf >= 1) { yi++; yf--; }
      if (zf >= 1) { zi++; zf--; }
    }

    return r;
  }
}

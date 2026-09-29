import * as THREE from 'three';
import type { GeneratorItem } from './Generator';
import type { SynthCityAssets } from './SynthCityAssets';
import type { Perlin } from './perlin';
import {
  fixNoise,
  getBuildingRotation,
  pickBuildingMatId,
  pickBigBuildingMatId,
} from './GeneratorUtils';
import {
  BLOCK_SIZE,
  ROAD_WIDTH,
  NOISE_FACTOR,
  CLEAR_CENTER_X,
  CLEAR_CENTER_Z,
} from './constants';

const CELL_STEP = BLOCK_SIZE + ROAD_WIDTH; // 152
const MEGA_STEP = CELL_STEP * 6;           // mega buildings spawn on a 6× grid

export interface CityBlockContext {
  root: THREE.Object3D;
  assets: SynthCityAssets;
  noise: Perlin;
  spotLights: boolean;
  /** For smoke billboards — returns the world-space point the smoke should face. */
  getLookAtTarget: () => THREE.Vector3;
}

/**
 * Streams a single city block's buildings, ground, adverts, toppers, smoke and
 * spotlights. Ported from synthcity/src/classes/GeneratorItem_CityBlock.js —
 * the thresholds and bucket assignments are held byte-for-byte identical so
 * curated seed 4217 produces the same world.
 */
export class GeneratorCityBlock implements GeneratorItem {
  private meshes: THREE.Object3D[] = [];          // no-collision scenery
  private meshesCollid: THREE.Mesh[] = [];        // collision-eligible geometry
  private updateables: DecorItem[] = [];

  constructor(
    public readonly x: number,
    public readonly z: number,
    private readonly ctx: CityBlockContext,
  ) {
    const { noise, assets, root } = ctx;

    // Clearing — blocks within 1 cell of the start block are stripped of
    // buildings so the hand-built base box has a clean pocket to sit in.
    const inClearArea =
      Math.abs(x - CLEAR_CENTER_X) <= CELL_STEP &&
      Math.abs(z - CLEAR_CENTER_Z) <= CELL_STEP;

    let typeNoise = fixNoise(noise.noise(x * NOISE_FACTOR, z * NOISE_FACTOR));
    let subtypeNoise = fixNoise(noise.noise(x * 5, z * 5));

    // ── rare mega building ────────────────────────────────────
    if (!inClearArea && typeNoise < 0.2) {
      if (x % MEGA_STEP === 0 && z % MEGA_STEP === 0) {
        const xOff = BLOCK_SIZE / 2;
        const zOff = BLOCK_SIZE / 2;
        // don't place too close to path of player car
        if (!(x + xOff < 128 && x + xOff > -128)) {
          const rotateNoise = fixNoise(noise.noise((x + xOff) * 5, (z + zOff) * 5));
          const rotate = getBuildingRotation(rotateNoise);
          const scale = 0.75 + rotateNoise * 0.25;

          let type: string;
          if (subtypeNoise < 0.16) type = 'mega_01';
          else if (subtypeNoise < 0.32) type = 'mega_02';
          else if (subtypeNoise < 0.48) type = 'mega_03';
          else if (subtypeNoise < 0.64) type = 'mega_04';
          else if (subtypeNoise < 0.80) type = 'mega_05';
          else type = 'mega_06';

          const mesh = new THREE.Mesh(
            assets.getModel(type),
            assets.getMaterial('mega_building_01'),
          );
          mesh.position.set(x + xOff, 0, z + zOff);
          mesh.scale.set(1, scale, 1);
          mesh.rotateY((rotate * Math.PI) / 180);
          this.meshesCollid.push(mesh);
        }
      }
    }

    if (inClearArea) {
      // No small/big buildings in the spawn clearing.
    } else if (typeNoise < 0.1) {
      // nothing
    } else if (typeNoise < 0.8) {
      // ── 2×2 grid of small buildings ────────────────────────
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const xOff = i * (BLOCK_SIZE / 2) + BLOCK_SIZE / 4;
          const zOff = j * (BLOCK_SIZE / 2) + BLOCK_SIZE / 4;
          const rotateNoise = fixNoise(noise.noise((x + xOff) * 5, (z + zOff) * 5));
          const rotate = getBuildingRotation(rotateNoise);
          const scale = 0.75 + rotateNoise * 0.45;

          // Re-sample noise at the subdivided centre.
          typeNoise = fixNoise(noise.noise((x + xOff) * NOISE_FACTOR, (z + zOff) * NOISE_FACTOR));
          subtypeNoise = fixNoise(noise.noise((x + xOff) * 5, (z + zOff) * 5));

          let type: string;
          let adsType: string | null;
          let topper = false;

          if (typeNoise < 0.267) {
            if (subtypeNoise < 0.33) type = 's_01_01';
            else if (subtypeNoise < 0.66) type = 's_01_02';
            else type = 's_01_03';
            adsType = Math.round(typeNoise * 100) % 2 === 0 ? 'ads_s_01_01' : 'ads_s_01_02';
          } else if (typeNoise < 0.534) {
            if (subtypeNoise < 0.33) type = 's_02_01';
            else if (subtypeNoise < 0.66) type = 's_02_02';
            else type = 's_02_03';
            adsType = Math.round(typeNoise * 100) % 2 === 0 ? 'ads_s_02_01' : 'ads_s_02_02';
          } else {
            if (subtypeNoise < 0.33) type = 's_03_01';
            else if (subtypeNoise < 0.66) type = 's_03_02';
            else type = 's_03_03';
            adsType = Math.round(typeNoise * 100) % 2 === 0 ? 'ads_s_03_01' : 'ads_s_03_02';
            const topperNoise = fixNoise(noise.noise((x + xOff) * 6, (z + zOff) * 6));
            topper = topperNoise > 0.998;
            if (ctx.spotLights) {
              if (Math.random() < 0.1 && subtypeNoise > 0.8 && !topper) {
                this.updateables.push(new Spotlight(x + xOff, 160 * scale, z + zOff, root, assets));
              }
            }
          }

          // remove ads in the midband
          if (typeNoise > 0.33 && typeNoise < 0.66) adsType = null;

          const matNoise = fixNoise(noise.noise((x + xOff) * -3, (z + zOff) * -3));
          const mat = assets.getMaterial(pickBuildingMatId(matNoise));

          if (topper && adsType !== null) {
            this.updateables.push(new Topper(x + xOff, 190 * scale, z + zOff, root, assets));
          }

          if (Math.random() < 0.05) {
            this.updateables.push(new Smoke(x + xOff, 190 * scale, z + zOff, root, assets, ctx.getLookAtTarget));
          }

          const mesh = new THREE.Mesh(assets.getModel(type), mat);
          mesh.position.set(x + xOff, 0, z + zOff);
          mesh.scale.set(1, scale, 1);
          mesh.rotateY((rotate * Math.PI) / 180);
          this.meshesCollid.push(mesh);

          if (adsType !== null) {
            const ad = new Advert(x + xOff, 0, z + zOff, assets.getModel(adsType), false, root, assets);
            ad.mesh.scale.set(1, scale, 1);
            ad.mesh.rotateY((-rotate * Math.PI) / 180);
            this.updateables.push(ad);
          }
        }
      }
    } else {
      // ── single big building or tower ──────────────────────
      const isTower = typeNoise > 0.975;
      const xOff = BLOCK_SIZE / 2;
      const zOff = BLOCK_SIZE / 2;
      const sub = fixNoise(noise.noise(x * 4, z * 4));

      let type: string;
      if (isTower) {
        if (sub < 0.33) type = 's_05_01';
        else if (sub < 0.66) type = 's_05_02';
        else type = 's_05_03';
      } else {
        if (sub < 0.33) type = 's_04_01';
        else if (sub < 0.66) type = 's_04_02';
        else type = 's_04_03';
      }

      const matNoise = fixNoise(noise.noise((x + xOff) * -3, (z + zOff) * -3));
      const mat = assets.getMaterial(pickBigBuildingMatId(matNoise, sub > 0.9));

      const rotateNoise = fixNoise(noise.noise((x + xOff) * 4, (z + zOff) * 4));
      const rotate = getBuildingRotation(rotateNoise);

      let adsType: string | null = null;
      if (Math.round(rotateNoise * 100) % 2 === 0) {
        const adsNoise = fixNoise(noise.noise((x + xOff) * 6, (z + zOff) * 6));
        const adsTypes = isTower
          ? ['ads_s_05_01', 'ads_s_05_02', 'ads_s_05_03', 'ads_s_05_04']
          : ['ads_s_04_01', 'ads_s_04_02', 'ads_s_04_03', 'ads_s_04_04'];
        adsType = adsTypes[Math.floor(adsNoise * adsTypes.length)];
      }

      const scale = 1 + rotateNoise * 0.5;
      const mesh = new THREE.Mesh(assets.getModel(type), mat);
      mesh.position.set(x + xOff, 0, z + zOff);
      mesh.scale.set(1, scale, 1);
      mesh.rotateY((rotate * Math.PI) / 180);
      this.meshesCollid.push(mesh);

      if (adsType !== null) {
        const ad = new Advert(x + xOff, 0, z + zOff, assets.getModel(adsType), isTower, root, assets);
        ad.mesh.scale.set(1, scale, 1);
        ad.mesh.rotateY((-rotate * Math.PI) / 180);
        this.updateables.push(ad);
      }
    }

    // ── ground plane (skipped in clearing — the flat top fills that area) ─
    if (!inClearArea) {
      const ground = new THREE.Mesh(
        assets.getModel('ground'),
        assets.getMaterial('ground'),
      );
      ground.rotateX(-Math.PI / 2);
      ground.position.set(x + BLOCK_SIZE / 2, 0, z + BLOCK_SIZE / 2);
      this.meshes.push(ground);
    }

    // ── storefronts + tramways (on every 2nd block corner) ──
    if (!inClearArea && x % (CELL_STEP * 2) === 0 && z % (CELL_STEP * 2) === 0) {
      const storeMats = ['storefronts', 'building_02', 'building_03', 'building_07'];
      const matId = storeMats[Math.floor(subtypeNoise * storeMats.length)] ?? 'storefronts';
      const storeMesh = new THREE.Mesh(
        assets.getModel('storefronts'),
        assets.getMaterial(matId),
      );
      storeMesh.position.set(
        x + BLOCK_SIZE + ROAD_WIDTH / 2,
        0,
        z + BLOCK_SIZE + ROAD_WIDTH / 2,
      );
      this.meshesCollid.push(storeMesh);
    }

    // Attach everything to the root group (not the scene directly — the root
    // is translated so synthcity-local coordinates land at Luminal world 0,0).
    for (const m of this.meshes) root.add(m);
    for (const m of this.meshesCollid) root.add(m);
  }

  remove(): void {
    const { root } = this.ctx;
    for (const m of this.meshes) root.remove(m);
    for (const d of this.updateables) d.remove();
    for (const m of this.meshesCollid) root.remove(m);
  }

  update(): void {
    for (const d of this.updateables) d.update();
  }
}

// ── Decorative children ───────────────────────────────────
interface DecorItem {
  remove(): void;
  update(): void;
}

class Advert implements DecorItem {
  mesh: THREE.Mesh;
  private adsMats: string[];
  private interval: number;
  private counter: number;
  private switches: boolean;

  constructor(
    x: number, y: number, z: number,
    geo: THREE.BufferGeometry,
    isTower: boolean,
    private readonly root: THREE.Object3D,
    private readonly assets: SynthCityAssets,
  ) {
    this.adsMats = isTower
      ? ['ads_large_01', 'ads_large_02', 'ads_large_03', 'ads_large_04', 'ads_large_05']
      : ['ads_01', 'ads_02', 'ads_03', 'ads_04', 'ads_05'];
    const mat = this.assets.getMaterial(this.adsMats[Math.floor(Math.random() * this.adsMats.length)]);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, y, z);
    this.root.add(this.mesh);
    this.interval = 200 + Math.random() * 800;
    this.counter = Math.random() * this.interval;
    this.switches = Math.random() < 0.5;
  }

  remove(): void {
    this.root.remove(this.mesh);
  }

  update(): void {
    if (!this.switches) return;
    this.counter++;
    if (this.counter > this.interval) {
      this.counter = 0;
      this.mesh.material = this.assets.getMaterial(
        this.adsMats[Math.floor(Math.random() * this.adsMats.length)],
      );
    }
  }
}

class Topper implements DecorItem {
  private mesh: THREE.Mesh;
  private rdir: number;

  constructor(
    x: number, y: number, z: number,
    private readonly root: THREE.Object3D,
    assets: SynthCityAssets,
  ) {
    const topperGeos = [
      'topper_01', 'topper_02', 'topper_03', 'topper_04',
      'topper_05', 'topper_06', 'topper_07', 'topper_08',
      'topper_09', 'topper_10', 'topper_11', 'topper_12',
    ];
    const mats = ['ads_large_01', 'ads_large_02', 'ads_large_03', 'ads_large_04', 'ads_large_05'];
    const mat = assets.getMaterial(mats[Math.floor(Math.random() * mats.length)]);
    const geo = assets.getModel(topperGeos[Math.floor(Math.random() * topperGeos.length)]);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, y, z);
    const s = 0.8 + Math.random();
    this.mesh.scale.set(s, s, s);
    this.root.add(this.mesh);
    this.rdir = Math.random() <= 0.5 ? Math.random() * 0.01 : -Math.random() * 0.01;
  }

  remove(): void {
    this.root.remove(this.mesh);
  }

  update(): void {
    this.mesh.rotation.y += this.rdir;
  }
}

class Smoke implements DecorItem {
  private mesh: THREE.Mesh;
  private rstep: number;

  constructor(
    x: number, y: number, z: number,
    private readonly root: THREE.Object3D,
    assets: SynthCityAssets,
    private readonly getLookAt: () => THREE.Vector3,
  ) {
    const mats = ['smoke_01', 'smoke_02', 'smoke_03'];
    const mat = assets.getMaterial(mats[Math.floor(Math.random() * mats.length)]);
    this.mesh = new THREE.Mesh(assets.getModel('smoke'), mat);
    this.mesh.position.set(x, y, z);
    const s = 1 + Math.random() * 8;
    const sy = s * (1 + Math.random() * 0.5);
    this.mesh.scale.set(s, sy, s);
    this.root.add(this.mesh);
    this.rstep = Math.random() * 7;
  }

  remove(): void {
    this.root.remove(this.mesh);
  }

  update(): void {
    this.rstep += 0.0025;
    this.mesh.lookAt(this.getLookAt());
    this.mesh.rotation.x += Math.cos(this.rstep) * 0.25;
  }
}

class Spotlight implements DecorItem {
  private mesh: THREE.Mesh;
  private rstep: number;

  constructor(
    x: number, y: number, z: number,
    private readonly root: THREE.Object3D,
    assets: SynthCityAssets,
  ) {
    const mats = ['spotlight_01', 'spotlight_02', 'spotlight_03', 'spotlight_04'];
    const mat = assets.getMaterial(mats[Math.floor(Math.random() * mats.length)]);
    this.mesh = new THREE.Mesh(assets.getModel('spotlight'), mat);
    this.mesh.position.set(x, y, z);
    const s = 10 + Math.random() * 10;
    this.mesh.scale.set(s, s, s);
    this.root.add(this.mesh);
    this.rstep = Math.random() * 7;
  }

  remove(): void {
    this.root.remove(this.mesh);
  }

  update(): void {
    this.rstep += 0.01;
    // Note: no lookAt needed for spotlight cone — rotate on X for subtle motion.
    this.mesh.rotation.x += Math.cos(this.rstep) * 0.4;
  }
}

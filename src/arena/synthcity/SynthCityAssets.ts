// Lazy singleton loader for every visual asset synthcity needs.
// Mirrors the non-spinner subset of synthcity/src/classes/AssetManager.js —
// spinner (player car), sky_*, env_* are all skipped because Luminal supplies
// its own player, sky, and environment.

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export interface SynthCityAssets {
  getModel(id: string): THREE.BufferGeometry;
  getMaterial(id: string): THREE.Material;
  getTexture(id: string): THREE.Texture;
}

const ASSET_BASE = '/';       // served from public/
const TEXTURE_DIR = 'textures/synthcity/';
const MODEL_DIR = 'models/synthcity/';

const BUILDING_WINDOWS_EMISSIVE = 1.5; // env.windowLights branch from AssetManager.js:27
const ADS_EMISSIVE_INTENSITY = 0.1;
const GROUND_EMISSIVE_INTENSITY = 0.2; // night branch from AssetManager.js:261

// Building material IDs that need the full (map + em + spec + bump) set.
const BUILDING_IDS = [
  'building_01', 'building_02', 'building_03', 'building_04', 'building_05',
  'building_06', 'building_07', 'building_08', 'building_09', 'building_10',
] as const;

const SMALL_BUILDING_MODELS = [
  's_01_01', 's_01_02', 's_01_03',
  's_02_01', 's_02_02', 's_02_03',
  's_03_01', 's_03_02', 's_03_03',
  's_04_01', 's_04_02', 's_04_03',
  's_05_01', 's_05_02', 's_05_03',
] as const;

const MEGA_MODELS = ['mega_01', 'mega_02', 'mega_03', 'mega_04', 'mega_05', 'mega_06'] as const;

const AD_MODELS = [
  'ads_s_01_01', 'ads_s_01_02',
  'ads_s_02_01', 'ads_s_02_02',
  'ads_s_03_01', 'ads_s_03_02',
  'ads_s_04_01', 'ads_s_04_02', 'ads_s_04_03', 'ads_s_04_04',
  'ads_s_05_01', 'ads_s_05_02', 'ads_s_05_03', 'ads_s_05_04',
] as const;

const TOPPER_MODELS = [
  'topper_01', 'topper_02', 'topper_03', 'topper_04',
  'topper_05', 'topper_06', 'topper_07', 'topper_08',
  'topper_09', 'topper_10', 'topper_11', 'topper_12',
] as const;

const CAR_MODELS = ['car_01', 'car_02', 'car_03', 'car_04', 'car_05', 'car_06', 'car_07', 'car_08'] as const;

class SynthCityAssetsImpl implements SynthCityAssets {
  private textures = new Map<string, THREE.Texture>();
  private models = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();

  getTexture(id: string): THREE.Texture {
    const t = this.textures.get(id);
    if (!t) throw new Error(`SynthCityAssets: missing texture "${id}"`);
    return t;
  }
  getModel(id: string): THREE.BufferGeometry {
    const m = this.models.get(id);
    if (!m) throw new Error(`SynthCityAssets: missing model "${id}"`);
    return m;
  }
  getMaterial(id: string): THREE.Material {
    const m = this.materials.get(id);
    if (!m) throw new Error(`SynthCityAssets: missing material "${id}"`);
    return m;
  }

  async load(): Promise<void> {
    const manager = new THREE.LoadingManager();
    const texLoader = new THREE.TextureLoader(manager);
    const objLoader = new OBJLoader(manager);

    // ── Textures ──────────────────────────────────────────
    const loadTex = (id: string, file: string, opts?: { repeat?: boolean }): void => {
      const tex = texLoader.load(ASSET_BASE + TEXTURE_DIR + file);
      if (opts?.repeat) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
      }
      this.textures.set(id, tex);
    };

    loadTex('ground', 'ground.jpg');
    loadTex('ground_em', 'ground_em.jpg');
    loadTex('cars', 'cars.jpg');
    loadTex('cars_em', 'cars_em.jpg');
    loadTex('storefronts', 'storefronts_01.jpg', { repeat: true });
    loadTex('storefronts_em', 'storefronts_01_em.jpg', { repeat: true });
    loadTex('mega_building_01', 'mega_building_01.jpg', { repeat: true });
    loadTex('mega_building_01_em', 'mega_building_01_em.jpg', { repeat: true });

    for (const id of BUILDING_IDS) {
      loadTex(id, `${id}.jpg`, { repeat: true });
      loadTex(`${id}_em`, `${id}_em.jpg`, { repeat: true });
      loadTex(`${id}_rough`, `${id}_spec.jpg`, { repeat: true });
    }
    for (let i = 1; i <= 5; i++) {
      const id = i.toString().padStart(2, '0');
      loadTex(`ads_${id}`, `ads_${id}.jpg`);
      loadTex(`ads_large_${id}`, `ads_large_${id}.jpg`);
    }
    for (let i = 1; i <= 3; i++) {
      const id = i.toString().padStart(2, '0');
      loadTex(`smoke_${id}`, `smoke_${id}.jpg`);
    }
    for (let i = 1; i <= 4; i++) {
      const id = i.toString().padStart(2, '0');
      loadTex(`spotlight_${id}`, `spotlight_${id}.jpg`);
    }

    // ── OBJ models ────────────────────────────────────────
    // The original synthcity AssetManager just did `obj.children[0].geometry`
    // without any instance check. OBJLoader returns a Group whose children are
    // Meshes (one per object in the file); we already confirmed each file has
    // exactly one object via `grep -c "^o "`. Match the original behaviour.
    const loadObj = (id: string, file: string): Promise<void> =>
      new Promise((resolve, reject) => {
        objLoader.load(
          ASSET_BASE + MODEL_DIR + file,
          (group) => {
            const child = group.children[0] as THREE.Mesh | undefined;
            const geom = child?.geometry as THREE.BufferGeometry | undefined;
            if (!geom) {
              reject(new Error(`SynthCityAssets: OBJ "${id}" has no geometry on children[0]`));
              return;
            }
            this.models.set(id, geom);
            resolve();
          },
          undefined,
          (err) => reject(err),
        );
      });

    const objPromises: Promise<void>[] = [];
    for (const id of SMALL_BUILDING_MODELS) objPromises.push(loadObj(id, `${id}.obj`));
    for (const id of MEGA_MODELS) objPromises.push(loadObj(id, `${id}.obj`));
    for (const id of AD_MODELS) objPromises.push(loadObj(id, `${id}.obj`));
    for (const id of TOPPER_MODELS) objPromises.push(loadObj(id, `${id}.obj`));
    for (const id of CAR_MODELS) objPromises.push(loadObj(id, `${id}.obj`));
    objPromises.push(loadObj('storefronts', 'storefronts.obj'));
    objPromises.push(loadObj('spotlight', 'spotlight.obj'));

    await Promise.all(objPromises);

    // Procedural geometries.
    this.models.set('ground', new THREE.PlaneGeometry(152, 152));
    this.models.set('smoke', new THREE.PlaneGeometry(64, 64));

    // ── Materials ─────────────────────────────────────────
    // Plain helpers so the builder can ask for materials by id.
    this.materials.set('ground', new THREE.MeshPhongMaterial({
      map: this.getTexture('ground'),
      emissive: new THREE.Color(0x0090ff),
      emissiveMap: this.getTexture('ground_em'),
      emissiveIntensity: GROUND_EMISSIVE_INTENSITY,
      shininess: 0,
    }));

    this.materials.set('cars', new THREE.MeshPhongMaterial({
      map: this.getTexture('cars'),
      emissive: new THREE.Color(0xffffff),
      emissiveMap: this.getTexture('cars_em'),
      emissiveIntensity: 1.0,
      side: THREE.DoubleSide,
    }));

    this.materials.set('storefronts', new THREE.MeshPhongMaterial({
      map: this.getTexture('storefronts'),
      emissive: new THREE.Color(0xffffff),
      emissiveMap: this.getTexture('storefronts_em'),
      emissiveIntensity: BUILDING_WINDOWS_EMISSIVE,
      shininess: 0,
    }));

    for (const id of BUILDING_IDS) {
      this.materials.set(id, new THREE.MeshPhongMaterial({
        map: this.getTexture(id),
        specular: new THREE.Color(0xffffff),
        specularMap: this.getTexture(`${id}_rough`),
        emissive: new THREE.Color().setHSL(Math.random(), 1.0, 0.475),
        emissiveMap: this.getTexture(`${id}_em`),
        emissiveIntensity: BUILDING_WINDOWS_EMISSIVE,
        bumpMap: this.getTexture(id),
        bumpScale: 5,
      }));
    }

    this.materials.set('mega_building_01', new THREE.MeshPhongMaterial({
      map: this.getTexture('mega_building_01'),
      specular: new THREE.Color(0x777777),
      shininess: 1,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: this.getTexture('mega_building_01_em'),
      emissiveIntensity: BUILDING_WINDOWS_EMISSIVE,
      bumpMap: this.getTexture('mega_building_01'),
      bumpScale: 10,
    }));

    for (let i = 1; i <= 5; i++) {
      const id = i.toString().padStart(2, '0');
      this.materials.set(`ads_${id}`, new THREE.MeshPhongMaterial({
        emissive: new THREE.Color(0xffffff),
        emissiveMap: this.getTexture(`ads_${id}`),
        emissiveIntensity: ADS_EMISSIVE_INTENSITY,
        blending: THREE.AdditiveBlending,
        fog: false,
        side: THREE.DoubleSide,
      }));
      this.materials.set(`ads_large_${id}`, new THREE.MeshPhongMaterial({
        emissive: new THREE.Color(0xffffff),
        emissiveMap: this.getTexture(`ads_large_${id}`),
        emissiveIntensity: ADS_EMISSIVE_INTENSITY,
        blending: THREE.AdditiveBlending,
        fog: false,
        side: THREE.DoubleSide,
      }));
    }

    for (let i = 1; i <= 3; i++) {
      const id = i.toString().padStart(2, '0');
      this.materials.set(`smoke_${id}`, new THREE.MeshPhongMaterial({
        alphaMap: this.getTexture(`smoke_${id}`),
        color: new THREE.Color(0xffffff),
        shininess: 0,
        specular: new THREE.Color(0x000000),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: false,
      }));
    }

    for (let i = 1; i <= 4; i++) {
      const id = i.toString().padStart(2, '0');
      this.materials.set(`spotlight_${id}`, new THREE.MeshPhongMaterial({
        alphaMap: this.getTexture(`spotlight_${id}`),
        color: new THREE.Color(0xffffff),
        shininess: 0,
        specular: new THREE.Color(0x000000),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: false,
      }));
    }
  }
}

let cached: Promise<SynthCityAssets> | null = null;

/**
 * Lazy singleton — first caller triggers every texture + OBJ fetch in parallel.
 * Subsequent callers get the resolved cache. Assets live for the lifetime of
 * the page; they survive map switches so reselecting synth_city is free.
 */
export function getSynthCityAssets(): Promise<SynthCityAssets> {
  if (!cached) {
    const impl = new SynthCityAssetsImpl();
    cached = impl.load().then(() => impl);
  }
  return cached;
}

/** Test-only escape hatch to drop the cached singleton. */
export function __resetSynthCityAssetsCache(): void {
  cached = null;
}

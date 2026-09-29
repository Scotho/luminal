#!/usr/bin/env node
// One-shot importer: copies the non-spinner subset of the standalone SynthCity
// project's models + textures into public/models/synthcity and
// public/textures/synthcity. Skips spinner (player car), sky_*, and env_*
// assets — Luminal supplies its own player, sky, and environment.
//
// Usage:
//   node scripts/import-synthcity-assets.mjs [--source <path>] [--dry-run]
//
// Default source: C:\Projects\synthcity (the standalone scene repo).

import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── Arg parsing ─────────────────────────────────────────
const args = process.argv.slice(2);
let sourceRoot = 'C:/Projects/synthcity';
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source' && i + 1 < args.length) {
    sourceRoot = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

if (!existsSync(sourceRoot)) {
  console.error(`[import-synthcity] source not found: ${sourceRoot}`);
  process.exit(1);
}

const MODEL_SRC = join(sourceRoot, 'assets', 'models');
const TEXTURE_SRC = join(sourceRoot, 'assets', 'textures');
const MODEL_DST = join(REPO_ROOT, 'public', 'models', 'synthcity');
const TEXTURE_DST = join(REPO_ROOT, 'public', 'textures', 'synthcity');

// ── Allowlist of files to copy ──────────────────────────
// Mirrors SynthCityAssets.ts — anything the loader asks for by id.

const MODEL_FILES = [
  // mega buildings
  'mega_01.obj', 'mega_02.obj', 'mega_03.obj', 'mega_04.obj', 'mega_05.obj', 'mega_06.obj',
  // small/big buildings
  's_01_01.obj', 's_01_02.obj', 's_01_03.obj',
  's_02_01.obj', 's_02_02.obj', 's_02_03.obj',
  's_03_01.obj', 's_03_02.obj', 's_03_03.obj',
  's_04_01.obj', 's_04_02.obj', 's_04_03.obj',
  's_05_01.obj', 's_05_02.obj', 's_05_03.obj',
  // cars
  'car_01.obj', 'car_02.obj', 'car_03.obj', 'car_04.obj',
  'car_05.obj', 'car_06.obj', 'car_07.obj', 'car_08.obj',
  // toppers
  'topper_01.obj', 'topper_02.obj', 'topper_03.obj', 'topper_04.obj',
  'topper_05.obj', 'topper_06.obj', 'topper_07.obj', 'topper_08.obj',
  'topper_09.obj', 'topper_10.obj', 'topper_11.obj', 'topper_12.obj',
  // ads
  'ads_s_01_01.obj', 'ads_s_01_02.obj',
  'ads_s_02_01.obj', 'ads_s_02_02.obj',
  'ads_s_03_01.obj', 'ads_s_03_02.obj',
  'ads_s_04_01.obj', 'ads_s_04_02.obj', 'ads_s_04_03.obj', 'ads_s_04_04.obj',
  'ads_s_05_01.obj', 'ads_s_05_02.obj', 'ads_s_05_03.obj', 'ads_s_05_04.obj',
  // misc
  'storefronts.obj',
  'spotlight.obj',
];

const TEXTURE_FILES = [
  // ground / cars
  'ground.jpg', 'ground_em.jpg',
  'cars.jpg', 'cars_em.jpg',
  // storefronts
  'storefronts_01.jpg', 'storefronts_01_em.jpg',
  // mega
  'mega_building_01.jpg', 'mega_building_01_em.jpg',
  // buildings 01-10 (base + em + spec)
  ...Array.from({ length: 10 }, (_, i) => {
    const id = String(i + 1).padStart(2, '0');
    return [
      `building_${id}.jpg`,
      `building_${id}_em.jpg`,
      `building_${id}_spec.jpg`,
    ];
  }).flat(),
  // ads small + large
  ...Array.from({ length: 5 }, (_, i) => {
    const id = String(i + 1).padStart(2, '0');
    return [`ads_${id}.jpg`, `ads_large_${id}.jpg`];
  }).flat(),
  // smoke
  'smoke_01.jpg', 'smoke_02.jpg', 'smoke_03.jpg',
  // spotlight
  'spotlight_01.jpg', 'spotlight_02.jpg', 'spotlight_03.jpg', 'spotlight_04.jpg',
];

// ── Copy pass ───────────────────────────────────────────
function ensureDir(p) {
  if (dryRun) return;
  mkdirSync(p, { recursive: true });
}

function copyList(label, src, dst, files) {
  ensureDir(dst);
  let copied = 0;
  let missing = 0;
  for (const name of files) {
    const from = join(src, name);
    const to = join(dst, name);
    if (!existsSync(from)) {
      missing++;
      console.warn(`[import-synthcity] ${label}: missing ${name}`);
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] ${from} -> ${to}`);
    } else {
      copyFileSync(from, to);
    }
    copied++;
  }
  console.log(`[import-synthcity] ${label}: ${copied} copied, ${missing} missing`);
  return { copied, missing };
}

console.log(`[import-synthcity] source: ${sourceRoot}`);
console.log(`[import-synthcity] dest:   ${REPO_ROOT}/public/{models,textures}/synthcity`);
if (dryRun) console.log('[import-synthcity] DRY RUN — no files will be written');

const modelResult = copyList('models', MODEL_SRC, MODEL_DST, MODEL_FILES);
const texResult = copyList('textures', TEXTURE_SRC, TEXTURE_DST, TEXTURE_FILES);

if (modelResult.missing + texResult.missing > 0) {
  console.error('[import-synthcity] finished with missing files — check source path');
  process.exit(1);
}
console.log('[import-synthcity] done');

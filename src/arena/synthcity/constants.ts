// Constants ported from the standalone SynthCity project.
// These numbers are load-bearing: changing them drifts the procedural layout
// away from the curated seed-4217 world that puts a mega_03 ziggurat at
// (976, 2800) — the location the hand-built spawn platform sits on.

export const SEED = 4217;

export const BLOCK_SIZE = 128;
export const ROAD_WIDTH = 24;
export const CELL_STEP = BLOCK_SIZE + ROAD_WIDTH; // 152 world units per city block

export const NOISE_FACTOR = 0.0017;
export const NOISE_DETAIL_LOD = 8;
export const NOISE_DETAIL_FALLOFF = 0.5;

// Start-block clearing — the 3×3 grid of blocks around this corner is stripped
// of procedural buildings so the spawn platform has a clean pocket to sit in.
export const CLEAR_CENTER_X = 912;
export const CLEAR_CENTER_Z = 2736;

// Platform (hand-built base box that replaces the ziggurat at the start block)
export const BASE_WIDTH = 456;
export const BASE_HEIGHT = 130;

// Platform centre in synthcity-local world coordinates.
// Synthcity-local (976, 2800) = Luminal-world (0, 0) after the root-group translation.
export const PLATFORM_CENTER_X = 976;
export const PLATFORM_CENTER_Z = 2800;

// Generator densities — matches the final standalone tuning.
export const CITY_BLOCK_CELL_COUNT = 40;
export const CITY_LIGHTS_CELL_COUNT = 8;
export const CITY_LIGHTS_CELL_STEP_MUL = 4; // city-light cells are 4× the city-block size
export const CITY_LIGHTS_POOL_SIZE = 10;

export const TRAFFIC_CELL_COUNT = 10;
export const TRAFFIC_SPAWN_CHANCE_PER_DIR = 0.6;

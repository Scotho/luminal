import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { getGfx, onSettingsChange, VISUAL_TUNING, MAP_TUNING, setActiveBloomMap } from './graphics';
import type { SceneBundle, GfxSettings, BloomPassLike, MapType, RenderComposer } from './types/index';
import { registerBloomApplier } from './mapBloomOverride';

// Per-map bloom override state — lives here because only scene.ts owns
// the post-processing pipeline, but grid.ts drives the switching via
// mapBloomOverride.ts.
let _activeMapForBloom: MapType = 'midtown_bowl';

// Camera system re-exported from src/camera/ module
export type { CameraRigState as CameraState } from './camera/types';
// ts-prune-ignore-next
export { createCameraState } from './camera/index';

export function createScene(): SceneBundle {
  const gfx: GfxSettings = getGfx();

  // Renderer
  const renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer({ antialias: gfx.antialias, powerPreference: 'default' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, gfx.pixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = (VISUAL_TUNING[gfx.preset] ?? VISUAL_TUNING.high).exposure;
  document.body.appendChild(renderer.domElement);

  // Prevent iOS Safari crash loop on GPU memory pressure — handle context loss gracefully
  renderer.domElement.addEventListener('webglcontextlost', (e: Event) => {
    e.preventDefault(); // allows context to be restored
    console.warn('[scene] WebGL context lost — pausing render');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    console.warn('[scene] WebGL context restored — resuming');
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, gfx.pixelRatio));
  });

  // Scene
  const scene: THREE.Scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020305);
  scene.userData._renderer = renderer; // expose for env map generation

  // Camera
  const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.3,
    800
  );
  scene.userData._camera = camera;

  // Lighting — tagged with names so per-map builders can find and dim them.
  // synth_city uses its own synthcity-tuned lighting and needs these turned off
  // to avoid a teal wash over the MeshPhongMaterials.
  const ambient: THREE.AmbientLight = new THREE.AmbientLight(0x08232B, 0.58);
  ambient.name = 'luminal_base_ambient';
  scene.add(ambient);

  const dirLight: THREE.DirectionalLight = new THREE.DirectionalLight(0x193C48, 0.46);
  dirLight.name = 'luminal_base_dirLight';
  dirLight.position.set(20, 80, 30);
  scene.add(dirLight);

  const fillLight: THREE.HemisphereLight = new THREE.HemisphereLight(0x03161A, 0x071114, 0.36);
  fillLight.name = 'luminal_base_fillLight';
  scene.add(fillLight);

  // ── Post-processing: pmndrs/postprocessing (single merged shader pass) ──
  // mipmapBlur produces selective glow: tight halos on small emissives
  // (characters, trails) while still allowing atmospheric environment bloom.
  const composer: EffectComposer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomEffect: BloomEffect = new BloomEffect({
    intensity: gfx.bloom.strength,
    radius: gfx.bloom.radius,
    luminanceThreshold: gfx.bloom.threshold,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
  });
  const effectPass: EffectPass = new EffectPass(camera, bloomEffect);
  // Never disable the EffectPass — it owns renderToScreen in pmndrs.
  // Disabling it prevents the framebuffer from reaching the canvas (freeze).
  // Instead, "off" means intensity=0 (pass runs but produces zero bloom).
  if (!gfx.bloom.enabled) bloomEffect.intensity = 0;
  composer.addPass(effectPass);

  // Stashed strength for restoring bloom after enabled=true
  let _stashedStrength = gfx.bloom.strength;

  // Thin proxy exposing strength/radius/threshold/enabled API used
  // throughout the codebase (game.ts, adminPanel.ts, atmosphere.ts, etc.)
  const bloomPass: BloomPassLike = {
    get strength(): number { return bloomEffect.intensity; },
    set strength(v: number) { _stashedStrength = v; if (this.enabled) bloomEffect.intensity = v; },
    get radius(): number { return bloomEffect.mipmapBlurPass.radius; },
    set radius(v: number) { bloomEffect.mipmapBlurPass.radius = v; },
    get threshold(): number { return bloomEffect.luminanceMaterial.threshold; },
    set threshold(v: number) { bloomEffect.luminanceMaterial.threshold = v; },
    get enabled(): boolean { return bloomEffect.intensity > 0 || _stashedStrength > 0; },
    set enabled(v: boolean) { bloomEffect.intensity = v ? _stashedStrength : 0; },
  };

  const composerProxy: RenderComposer = {
    render(): void { composer.render(); },
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
    },
  };

  // ── Bloom applier — respects per-map override ──────────
  const applyBloomFromMap = (g: GfxSettings): void => {
    const override = MAP_TUNING[_activeMapForBloom]?.bloom;
    if (override) {
      bloomPass.strength = override.strength;
      bloomPass.radius = override.radius;
      bloomPass.threshold = override.threshold;
    } else {
      bloomPass.strength = g.bloom.strength;
      bloomPass.radius = g.bloom.radius;
      bloomPass.threshold = g.bloom.threshold;
    }
    bloomPass.enabled = g.bloom.enabled;
  };

  // Register the applier with the decoupling layer so grid.ts can trigger
  // it via applyMapBloomOverride(mapType, gfx) without importing scene.ts.
  registerBloomApplier((mapType: MapType, g: GfxSettings) => {
    _activeMapForBloom = mapType;
    setActiveBloomMap(mapType);
    applyBloomFromMap(g);
  });

  // React to graphics settings changes
  onSettingsChange((g: GfxSettings): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, g.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    composerProxy.setSize(window.innerWidth, window.innerHeight);
    applyBloomFromMap(g);
    const tuning = VISUAL_TUNING[g.preset] ?? VISUAL_TUNING.high;
    renderer.toneMappingExposure = tuning.exposure;
  });

  // Handle resize
  window.addEventListener('resize', (): void => {
    const g: GfxSettings = getGfx();
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, g.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    composerProxy.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, composer: composerProxy, bloomPass };
}

// Camera functions re-exported from src/camera/ module
// ts-prune-ignore-next
export { setCameraFOV, setCameraDist, setCameraLookAhead, setCameraLerp, getCameraParams, setShakeEnabled } from './camera/index';
// ts-prune-ignore-next
export { seedCameraState, updateCamera, resetCamera } from './camera/index';

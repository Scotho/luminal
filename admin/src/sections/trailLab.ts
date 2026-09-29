import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BloomPassLike } from '@main/viewerExports';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from '../trailDesigns/types';

/* ── Trail path generation ─────────────────────────────── */

function buildTrailPath(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  // Oval track: straight + curves, like a lightcycle arena run
  const straight = 18, radius = 6, segs = 60;
  // Bottom straight (left to right)
  for (let i = 0; i <= 30; i++) pts.push(new THREE.Vector3(-straight / 2 + (straight * i) / 30, 0, radius));
  // Right curve
  for (let i = 1; i <= segs / 2; i++) {
    const a = Math.PI / 2 - (Math.PI * i) / (segs / 2);
    pts.push(new THREE.Vector3(straight / 2 + Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  // Top straight (right to left)
  for (let i = 1; i <= 30; i++) pts.push(new THREE.Vector3(straight / 2 - (straight * i) / 30, 0, -radius));
  // Left curve
  for (let i = 1; i <= segs / 2; i++) {
    const a = -Math.PI / 2 - (Math.PI * i) / (segs / 2);
    pts.push(new THREE.Vector3(-straight / 2 + Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return pts;
}

/* ── Floor grid ────────────────────────────────────────── */

function buildFloor(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(60, 40);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x04070b, emissive: 0x0a1218, emissiveIntensity: 0.4,
    roughness: 0.15, metalness: 0.8, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.01;
  scene.add(mesh);
  const grid = new THREE.GridHelper(60, 60, 0x112233, 0x0a1520);
  grid.position.y = 0;
  scene.add(grid);
  return mesh;
}

/* ── Design registry ───────────────────────────────────── */

const designs: TrailDesign[] = [];
let designModulesLoaded = false;

async function ensureDesignsLoaded(): Promise<void> {
  if (designModulesLoaded) return;
  designModulesLoaded = true;
  // Dynamic imports — each design file registers via registerDesign()
  const modules = import.meta.glob('../trailDesigns/d*.ts', { eager: false });
  const promises = Object.values(modules).map(loader => (loader as () => Promise<{ default?: TrailDesign }>)());
  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.default) {
      designs.push(r.value.default);
    }
  }
}

/* ── HTML markup ───────────────────────────────────────── */

function buildMarkup(color: string): string {
  return `
<div class="trail-lab">
  <div class="trail-lab-toolbar">
    <label>Design: <select id="tl-design"></select></label>
    <label>Color: <input type="color" id="tl-color" value="${color}"></label>
    <span id="tl-desc" class="trail-lab-desc"></span>
    <span id="tl-category" class="trail-lab-cat"></span>
  </div>
  <div id="tl-canvas-wrap" class="trail-lab-canvas-wrap"></div>
  <div id="tl-params" class="trail-lab-params"></div>
</div>`;
}

/* ── Main render function ──────────────────────────────── */

export function renderTrailLab(container: HTMLElement): () => void {
  let disposed = false;
  let rafId = 0;
  let activeDesign: TrailDesignInstance | null = null;
  let activeIdx = 0;

  const trailColor = new THREE.Color(0x00ffd5);
  const wallHeight = 2.5;
  const wallWidth = 0.22;
  const path = buildTrailPath();

  container.innerHTML = buildMarkup('#00ffd5');

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
  const canvasWrap = q<HTMLElement>('#tl-canvas-wrap');
  const designSelect = q<HTMLSelectElement>('#tl-design');
  const colorInput = q<HTMLInputElement>('#tl-color');
  const descEl = q<HTMLElement>('#tl-desc');
  const catEl = q<HTMLElement>('#tl-category');
  const paramsEl = q<HTMLElement>('#tl-params');

  // ── Three.js setup ─────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.setClearColor(0x020305);
  canvasWrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020305);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 200);
  camera.position.set(0, 18, 22);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1, 0);

  // Lighting
  scene.add(new THREE.AmbientLight(0x08232b, 0.5));
  const dir = new THREE.DirectionalLight(0x193c48, 0.4);
  dir.position.set(20, 40, 20);
  scene.add(dir);
  scene.add(new THREE.HemisphereLight(0x03161a, 0x071114, 0.3));

  // Post-processing (pmndrs — matches main game pipeline)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomEffect = new BloomEffect({
    intensity: 0.6,
    radius: 0.4,
    luminanceThreshold: 0.25,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
  });
  const bloomEffectPass = new EffectPass(camera, bloomEffect);
  composer.addPass(bloomEffectPass);
  const bloom: BloomPassLike = {
    get strength() { return bloomEffect.intensity; },
    set strength(v) { bloomEffect.intensity = v; },
    get radius() { return bloomEffect.mipmapBlurPass.radius; },
    set radius(v) { bloomEffect.mipmapBlurPass.radius = v; },
    get threshold() { return bloomEffect.luminanceMaterial.threshold; },
    set threshold(v) { bloomEffect.luminanceMaterial.threshold = v; },
    get enabled() { return bloomEffectPass.enabled; },
    set enabled(v) { bloomEffectPass.enabled = v; },
  };

  buildFloor(scene);

  // ── Resize handling ────────────────────────────────
  function resize(): void {
    const w = canvasWrap.clientWidth || 800;
    const h = canvasWrap.clientHeight || 500;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvasWrap);
  resize();

  // ── Design lifecycle ───────────────────────────────
  function buildContext(): TrailLabContext {
    return { scene, camera, renderer, bloomPass: bloom, color: trailColor, path, wallHeight, wallWidth };
  }

  function activateDesign(idx: number): void {
    if (activeDesign) { activeDesign.dispose(); activeDesign = null; }
    paramsEl.innerHTML = '';
    if (idx < 0 || idx >= designs.length) return;
    activeIdx = idx;
    const d = designs[idx];
    descEl.textContent = d.description;
    catEl.textContent = `[${d.category}]`;
    activeDesign = d.create(buildContext());

    // Build param sliders
    if (activeDesign.params) {
      for (const [key, p] of Object.entries(activeDesign.params)) {
        const row = document.createElement('label');
        row.className = 'trail-lab-param-row';
        row.innerHTML = `${key}: <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}"> <span>${p.value.toFixed(2)}</span>`;
        const inp = row.querySelector('input')!;
        const val = row.querySelector('span')!;
        inp.addEventListener('input', () => { const v = parseFloat(inp.value); p.value = v; val.textContent = v.toFixed(2); p.onChange(v); });
        paramsEl.appendChild(row);
      }
    }
  }

  // ── Load designs and populate selector ─────────────
  ensureDesignsLoaded().then(() => {
    designSelect.innerHTML = designs.map((d, i) => `<option value="${i}">${d.name}</option>`).join('');
    if (designs.length > 0) activateDesign(0);
  });

  designSelect.addEventListener('change', () => activateDesign(parseInt(designSelect.value)));
  colorInput.addEventListener('input', () => {
    trailColor.set(colorInput.value);
    activateDesign(activeIdx); // rebuild with new color
  });

  // ── Render loop ────────────────────────────────────
  let lastT = performance.now();
  function tick(): void {
    if (disposed) return;
    rafId = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    controls.update();
    if (activeDesign) activeDesign.update(dt);
    composer.render();
  }
  rafId = requestAnimationFrame(tick);

  // ── Cleanup ────────────────────────────────────────
  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    if (activeDesign) activeDesign.dispose();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    container.innerHTML = '';
  };
}

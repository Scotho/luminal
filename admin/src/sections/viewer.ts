import {
  createViewerScene,
  loadBikeModel,
  cloneBikeModel,
  isBikeModelLoaded,
  getBikeModelHeight,
  loadCarModel,
  cloneCarModel,
  isCarModelLoaded,
  loadHoverboardModel,
  cloneHoverboardModel,
  isHoverboardModelLoaded,
  getHoverboardModelHeight,
  HoverboardAnimator,
  HoverAnimState,
  BikeAnimator,
  BikeAnimState,
  CarAnimator,
  CarAnimState,
  VISUAL_TUNING,
  getBloomLevel,
  getGfx,
  setPreset,
  getVehiclePhysics,
} from '@main/viewerExports';
import type { SceneBundle, PresetName, VehicleType } from '@main/viewerExports';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import {
  ANIM_STATE_LABELS,
  BIKE_STATE_LABELS,
  CAR_STATE_LABELS,
  VEHICLE_DESCRIPTIONS,
  buildStatsHTML,
  buildHoverInput,
  buildBikeInput,
  buildCarInput,
  buildViewerMarkup,
  buildPoseOverlayHTML,
} from './viewerAnimHelpers';

const TRAIL_HEIGHT = 2.7;

export function renderViewer(container: HTMLElement): () => void {
  let disposed = false;
  let rafId = 0;
  let bundle: SceneBundle | null = null;
  let controls: OrbitControls | null = null;
  let currentModel: THREE.Group | null = null;

  let currentColor = '#00ffd5';
  let currentPreset: PresetName = getGfx().preset as PresetName;
  let currentVehicle: VehicleType = 'bike';
  let hoverAnimator: HoverboardAnimator | null = null;
  let bikeAnimator: BikeAnimator | null = null;
  let carAnimator: CarAnimator | null = null;
  let selectedAnimState: HoverAnimState = HoverAnimState.Idle;
  let selectedBikeState: BikeAnimState = BikeAnimState.Idle;
  let selectedCarState: CarAnimState = CarAnimState.Idle;
  let animParam = 0, animLooping = true;
  let wireframeOn = false, turntableOn = false, statsOpen = true;
  let grindPreloadFrames = 0;
  let playbackSpeed = 1;
  let frozen = false;
  let showPoseOverlay = false;

  container.innerHTML = buildViewerMarkup(currentPreset, currentColor);

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
  const canvasWrap = q<HTMLElement>('#viewer-canvas-wrap');
  const statsEl = q<HTMLElement>('#viewer-stats');
  const presetSelect = q<HTMLSelectElement>('#viewer-preset');
  const colorInput = q<HTMLInputElement>('#viewer-color');
  const animBar = q<HTMLElement>('#viewer-anim-bar');
  const animStateSelect = q<HTMLSelectElement>('#viewer-anim-state');
  const animParamSlider = q<HTMLInputElement>('#viewer-anim-param');
  const animParamVal = q<HTMLElement>('#viewer-anim-param-val');
  const animLoopCheck = q<HTMLInputElement>('#viewer-anim-loop');
  const animSpeedSlider = q<HTMLInputElement>('#viewer-anim-speed');
  const animSpeedVal = q<HTMLElement>('#viewer-anim-speed-val');
  const freezeBtn = q<HTMLButtonElement>('#viewer-freeze');
  const animCurrentLabel = q<HTMLElement>('#viewer-anim-current-state');
  const vehicleTabs = container.querySelectorAll<HTMLButtonElement>('.viewer-vehicle-tab');
  const turntableBtn = q<HTMLButtonElement>('#viewer-turntable');
  const wireframeBtn = q<HTMLButtonElement>('#viewer-wireframe');
  const poseToggle = q<HTMLButtonElement>('#viewer-pose-toggle');
  const poseOverlay = q<HTMLElement>('#viewer-pose-overlay');
  const screenshotBtn = q<HTMLButtonElement>('#viewer-screenshot');
  const infoToggle = q<HTMLButtonElement>('#viewer-info-toggle');
  const infoBody = q<HTMLElement>('#viewer-info-body');
  const physStats = q<HTMLElement>('#viewer-phys-stats');
  const descEl = q<HTMLElement>('#viewer-desc');
  bundle = createViewerScene(canvasWrap);
  const { scene, camera, renderer, composer, bloomPass } = bundle;

  scene.add(new THREE.GridHelper(20, 40, 0x0a2a30, 0x061218));
  camera.position.set(4, 3, 4);
  camera.lookAt(0, 1, 0);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 12;
  controls.update();
  function updateVehicleInfo(): void {
    const phys = getVehiclePhysics(currentVehicle);
    physStats.innerHTML = buildStatsHTML(phys);
    descEl.textContent = VEHICLE_DESCRIPTIONS[currentVehicle];
  }

  function updateStats(): void {
    const tuning = VISUAL_TUNING[currentPreset] ?? VISUAL_TUNING.high;
    const b = getGfx().bloom;
    statsEl.innerHTML = [
      `neonEmissive: ${tuning.neonEmissive}`,
      `exposure: ${tuning.exposure}`,
      `bloom: ${getBloomLevel()} (${b.strength}, ${b.radius}, ${b.threshold})`,
    ].join('<br>');
  }

  function rebuildAnimBar(): void {
    let stateOptions = '';
    if (currentVehicle === 'hoverboard') {
      stateOptions = ANIM_STATE_LABELS.map(s =>
        `<option value="${s.value}">${s.label}</option>`).join('');
    } else if (currentVehicle === 'bike') {
      stateOptions = BIKE_STATE_LABELS.map(s =>
        `<option value="${s.value}">${s.label}</option>`).join('');
    } else {
      stateOptions = CAR_STATE_LABELS.map(s =>
        `<option value="${s.value}">${s.label}</option>`).join('');
    }
    animStateSelect.innerHTML = stateOptions;
    animStateSelect.value = '0';
    selectedAnimState = 0 as HoverAnimState;
    selectedBikeState = 0 as BikeAnimState;
    selectedCarState = 0 as CarAnimState;
    grindPreloadFrames = 0;
  }
  function disposeModel(): void {
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach(m => m.dispose());
          mesh.geometry?.dispose();
        }
      });
      currentModel = null;
    }
    hoverAnimator = null;
    bikeAnimator = null;
    carAnimator = null;
  }
  function applyWireframe(): void {
    currentModel?.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => { (m as THREE.MeshStandardMaterial).wireframe = wireframeOn; });
      }
    });
  }
  function placeModel(): void {
    disposeModel();
    const colorNum = new THREE.Color(currentColor).getHex();
    let clone: THREE.Group, scale: number;
    switch (currentVehicle) {
      case 'car':
        clone = cloneCarModel(colorNum);
        // Match in-game playerVFX.ts buildCar: CAR_SCALE / 1.05
        scale = 2.0 / 1.05;
        clone.rotation.y = Math.PI;
        break;
      case 'hoverboard':
        clone = cloneHoverboardModel(colorNum);
        // Match in-game playerVFX.ts buildHoverboard: HOVER_SCALE / 1.05, Y offset +0.15
        scale = TRAIL_HEIGHT / getHoverboardModelHeight() / 1.05;
        clone.position.y = 0.15;
        break;
      default:
        clone = cloneBikeModel(colorNum);
        // Match in-game playerVFX.ts buildBike: BIKE_SCALE / 1.05 * 1.1
        scale = TRAIL_HEIGHT / getBikeModelHeight() / 1.05 * 1.1;
        break;
    }
    clone.scale.setScalar(scale);

    // Match in-game player.ts line 241: inner.scale.setScalar(1.05)
    // Wrap clone in an inner group at 1.05x scale
    const innerWrapper = new THREE.Group();
    innerWrapper.scale.setScalar(1.05);
    innerWrapper.add(clone);

    currentModel = innerWrapper;
    scene.add(currentModel);

    // Null out all animators before creating the one for current vehicle
    hoverAnimator = null;
    bikeAnimator = null;
    carAnimator = null;

    if (currentVehicle === 'hoverboard') {
      hoverAnimator = new HoverboardAnimator(innerWrapper);
      hoverAnimator.attachProxies(clone);
    } else if (currentVehicle === 'bike') {
      bikeAnimator = new BikeAnimator(innerWrapper);
    } else {
      carAnimator = new CarAnimator(innerWrapper);
    }
    // Animation bar is always visible now (all vehicles have animators)
    animBar.style.display = '';

    if (wireframeOn) applyWireframe();
    updateVehicleInfo();
  }
  // ── Vehicle loaders ──
  const LOADERS: Record<VehicleType, () => Promise<void>> = {
    bike: loadBikeModel, car: loadCarModel, hoverboard: loadHoverboardModel };
  const IS_LOADED: Record<VehicleType, () => boolean> = {
    bike: isBikeModelLoaded, car: isCarModelLoaded, hoverboard: isHoverboardModelLoaded };

  function loadAndPlace(): void {
    LOADERS[currentVehicle]().then(() => {
      if (!disposed) { placeModel(); updateStats(); rebuildAnimBar(); }
    });
  }
  loadAndPlace();

  function applyPreset(): void {
    setPreset(currentPreset);
    const tuning = VISUAL_TUNING[currentPreset] ?? VISUAL_TUNING.high;
    renderer.toneMappingExposure = tuning.exposure;
    const b = getGfx().bloom;
    bloomPass.strength = b.strength;
    bloomPass.radius = b.radius;
    bloomPass.threshold = b.threshold;
    bloomPass.enabled = b.enabled;
    if (IS_LOADED[currentVehicle]()) placeModel();
    updateStats();
  }

  vehicleTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const vehicle = tab.dataset.vehicle as VehicleType | undefined;
      if (!vehicle || vehicle === currentVehicle) return;
      currentVehicle = vehicle;
      vehicleTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadAndPlace();
    });
  });

  presetSelect.addEventListener('change', () => {
    currentPreset = presetSelect.value as PresetName;
    applyPreset();
  });
  colorInput.addEventListener('input', () => {
    currentColor = colorInput.value;
    if (IS_LOADED[currentVehicle]()) placeModel();
  });
  animStateSelect.addEventListener('change', () => {
    const val = Number(animStateSelect.value);
    if (currentVehicle === 'hoverboard') {
      selectedAnimState = val as HoverAnimState;
      if (hoverAnimator) hoverAnimator.reset();
    } else if (currentVehicle === 'bike') {
      selectedBikeState = val as BikeAnimState;
      if (bikeAnimator) bikeAnimator.reset();
    } else {
      selectedCarState = val as CarAnimState;
      if (carAnimator) carAnimator.reset();
    }
    grindPreloadFrames = 0;
  });
  animParamSlider.addEventListener('input', () => {
    animParam = parseFloat(animParamSlider.value);
    animParamVal.textContent = animParam.toFixed(2);
  });
  animLoopCheck.addEventListener('change', () => { animLooping = animLoopCheck.checked; });
  animSpeedSlider.addEventListener('input', () => {
    playbackSpeed = parseFloat(animSpeedSlider.value);
    animSpeedVal.textContent = playbackSpeed.toFixed(1) + 'x';
  });
  freezeBtn.addEventListener('click', () => {
    frozen = !frozen;
    freezeBtn.classList.toggle('active', frozen);
    freezeBtn.innerHTML = frozen ? '&#x25B6; Resume' : '&#x23F8; Freeze';
  });

  turntableBtn.addEventListener('click', () => {
    turntableOn = !turntableOn;
    if (controls) { controls.autoRotate = turntableOn; controls.autoRotateSpeed = 2.0; }
    turntableBtn.classList.toggle('active', turntableOn);
  });
  wireframeBtn.addEventListener('click', () => {
    wireframeOn = !wireframeOn;
    applyWireframe();
    wireframeBtn.classList.toggle('active', wireframeOn);
  });
  poseToggle.addEventListener('click', () => {
    showPoseOverlay = !showPoseOverlay;
    poseOverlay.style.display = showPoseOverlay ? '' : 'none';
    poseToggle.classList.toggle('active', showPoseOverlay);
  });
  screenshotBtn.addEventListener('click', () => {
    if (!bundle) return;
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    let stateName = 'static';
    if (currentVehicle === 'hoverboard' && hoverAnimator) {
      stateName = ANIM_STATE_LABELS.find(s => s.value === hoverAnimator!.getState())?.label ?? 'unknown';
    } else if (currentVehicle === 'bike' && bikeAnimator) {
      stateName = BIKE_STATE_LABELS.find(s => s.value === bikeAnimator!.getState())?.label ?? 'unknown';
    } else if (currentVehicle === 'car' && carAnimator) {
      stateName = CAR_STATE_LABELS.find(s => s.value === carAnimator!.getState())?.label ?? 'unknown';
    }
    a.download = `luminal-${currentVehicle}-${stateName.replace(/\s+/g, '_')}-${Date.now()}.png`;
    a.click();
  });
  infoToggle.addEventListener('click', () => {
    statsOpen = !statsOpen;
    infoBody.style.display = statsOpen ? '' : 'none';
    infoToggle.innerHTML = `Vehicle Stats ${statsOpen ? '&#x25BC;' : '&#x25B6;'}`;
  });

  const resizeObserver = new ResizeObserver(() => {
    if (disposed || !bundle) return;
    const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  });
  resizeObserver.observe(canvasWrap);

  let lastTime = performance.now();
  function animate(): void {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - lastTime) / 1000);
    const dt = rawDt * playbackSpeed;
    lastTime = now;
    controls?.update();

    if (!frozen) {
      if (currentVehicle === 'hoverboard' && hoverAnimator) {
        if (selectedAnimState === HoverAnimState.GrindEntry && animLooping) {
          grindPreloadFrames++;
          if (grindPreloadFrames > 30) { hoverAnimator.reset(); grindPreloadFrames = 0; }
        }
        const input = buildHoverInput(dt, selectedAnimState, animParam);
        if (selectedAnimState === HoverAnimState.GrindExit) {
          grindPreloadFrames++;
          if (grindPreloadFrames < 15) input.grinding = true;
          else if (grindPreloadFrames > 30 && animLooping) { hoverAnimator.reset(); grindPreloadFrames = 0; }
        }
        hoverAnimator.update(input);
        const stateLabel = ANIM_STATE_LABELS.find(s => s.value === hoverAnimator!.getState());
        animCurrentLabel.textContent = stateLabel ? `[${stateLabel.label}]` : '';
      } else if (currentVehicle === 'bike' && bikeAnimator) {
        bikeAnimator.update(buildBikeInput(dt, selectedBikeState, animParam));
        const stateLabel = BIKE_STATE_LABELS.find(s => s.value === bikeAnimator!.getState());
        animCurrentLabel.textContent = stateLabel ? `[${stateLabel.label}]` : '';
      } else if (currentVehicle === 'car' && carAnimator) {
        carAnimator.update(buildCarInput(dt, selectedCarState, animParam));
        const stateLabel = CAR_STATE_LABELS.find(s => s.value === carAnimator!.getState());
        animCurrentLabel.textContent = stateLabel ? `[${stateLabel.label}]` : '';
      }
    }

    if (showPoseOverlay && currentModel) {
      poseOverlay.innerHTML = buildPoseOverlayHTML({
        currentVehicle, currentModel, hoverAnimator, bikeAnimator, carAnimator,
      });
    }

    composer.render();
  }
  animate();

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    controls?.dispose();
    disposeModel();
    renderer.dispose();
    renderer.domElement.remove();
    container.innerHTML = '';
  };
}

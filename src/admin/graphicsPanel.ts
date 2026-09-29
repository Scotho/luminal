// ── Admin Panel: Graphics Section ────────────────────────
// Rendering (preset/lighting/bloom/atmosphere), map environment (floor/reflections), trail.

import * as THREE from 'three';
import {
  addHeader,
  addSubHeader,
  addLabel,
  addSlider,
  trackSlider,
  addToggle,
  trackToggle,
  addColorPicker,
  trackColorPicker,
} from './helpers';
import { setPreset, getGfx, PRESET_NAMES, MAP_TUNING } from '../graphics';
import { getArenaReactive } from '../grid';
import { initAdminPanel } from '../adminPanel';
import type { GameLike, PlayerLike } from '../adminPanel';
import type { PresetName } from '../types/index';
import { MAPS } from '../types/index';
import { TRAIL_LEGACY_TUNING, applyTrailLegacyTuning } from '../trail';
import { BIKE_PHYSICS } from '../vehicleConfig';

export function addRenderingSection(
  panel: HTMLDivElement,
  gameRef: GameLike | null,
  allPlayers: PlayerLike[],
): void {
  // ── Graphics Preset ──────────────────────────────────────
  const presetRow = document.createElement('div');
  Object.assign(presetRow.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0 8px', borderBottom: '1px solid rgba(73,162,178,0.2)', marginBottom: '4px' });
  const presetLabel = document.createElement('span');
  presetLabel.textContent = 'GFX PRESET';
  presetLabel.style.width = '80px';
  presetLabel.style.flexShrink = '0';
  presetLabel.style.color = '#49A2B2';
  presetLabel.style.fontWeight = 'bold';
  presetLabel.style.letterSpacing = '1px';
  presetRow.appendChild(presetLabel);
  for (const name of PRESET_NAMES) {
    const btn = document.createElement('span');
    btn.textContent = name.toUpperCase();
    const isCurrent = getGfx().preset === name;
    Object.assign(btn.style, {
      padding: '3px 8px', cursor: 'pointer', fontSize: '10px', letterSpacing: '1px',
      border: '1px solid ' + (isCurrent ? 'rgba(73,162,178,0.6)' : 'rgba(73,162,178,0.2)'),
      color: isCurrent ? '#49A2B2' : '#777',
      background: isCurrent ? 'rgba(73,162,178,0.1)' : 'transparent',
    });
    btn.addEventListener('click', () => {
      setPreset(name as PresetName);
      // Re-open panel to refresh all slider values
      initAdminPanel();
    });
    presetRow.appendChild(btn);
  }
  panel.appendChild(presetRow);

  const reactive = getArenaReactive();
  const atmoState = reactive?.atmosphere ?? null;

  // ── Scene Lighting ──────────────────────────────────────
  addHeader('SCENE LIGHTING', 'scene');
  const renderer = gameRef?.scene?.userData._renderer as THREE.WebGLRenderer | undefined;
  const sceneLights = { ambient: null as THREE.AmbientLight | null, dir: null as THREE.DirectionalLight | null, hemi: null as THREE.HemisphereLight | null };
  gameRef?.scene?.traverse((child: THREE.Object3D) => {
    if ((child as THREE.AmbientLight).isAmbientLight && !sceneLights.ambient) sceneLights.ambient = child as THREE.AmbientLight;
    if ((child as THREE.DirectionalLight).isDirectionalLight && !sceneLights.dir) sceneLights.dir = child as THREE.DirectionalLight;
    if ((child as THREE.HemisphereLight).isHemisphereLight && !sceneLights.hemi) sceneLights.hemi = child as THREE.HemisphereLight;
  });

  if (renderer) {
    trackSlider('scene', 'exposure', addSlider('exposure', renderer.toneMappingExposure, 0.5, 3, 0.05, (v) => { if (atmoState) atmoState.adminFreeze = true; renderer.toneMappingExposure = v; }));
  }
  // Scene background color
  const bg = gameRef?.scene?.background;
  if (bg && (bg as THREE.Color).isColor) {
    const bgColor = bg as THREE.Color;
    trackColorPicker('scene', 'bgColor', bgColor.getHex(), addColorPicker('bgColor', bgColor.getHex(), (hex) => { bgColor.setHex(hex); }).picker);
  }
  if (sceneLights.ambient) {
    const a = sceneLights.ambient;
    trackSlider('scene', 'ambientIntensity', addSlider('ambient', a.intensity, 0, 2, 0.01, (v) => { a.intensity = v; }));
    trackColorPicker('scene', 'ambientColor', a.color.getHex(), addColorPicker('ambientClr', a.color.getHex(), (hex) => { a.color.setHex(hex); }).picker);
  }
  if (sceneLights.dir) {
    const d = sceneLights.dir;
    trackSlider('scene', 'dirLightIntensity', addSlider('dirLight', d.intensity, 0, 2, 0.01, (v) => { d.intensity = v; }));
    trackColorPicker('scene', 'dirLightColor', d.color.getHex(), addColorPicker('dirLightClr', d.color.getHex(), (hex) => { d.color.setHex(hex); }).picker);
  }
  if (sceneLights.hemi) {
    const h = sceneLights.hemi;
    trackSlider('scene', 'hemiIntensity', addSlider('hemiLight', h.intensity, 0, 2, 0.01, (v) => { h.intensity = v; }));
    trackColorPicker('scene', 'hemiSkyColor', h.color.getHex(), addColorPicker('hemiSky', h.color.getHex(), (hex) => { h.color.setHex(hex); }).picker);
    trackColorPicker('scene', 'hemiGroundColor', h.groundColor.getHex(), addColorPicker('hemiGround', h.groundColor.getHex(), (hex) => { h.groundColor.setHex(hex); }).picker);
  }

  // ── Bloom ───────────────────────────────────────────────
  addHeader('BLOOM', 'bloom');
  const bp = gameRef?.bloomPass;
  if (bp) {
    const freezeBloom = () => { if (gameRef) gameRef.adminBloomFreeze = true; };
    trackToggle('bloom', 'enabled', addToggle('enabled', bp.enabled, (checked) => { freezeBloom(); bp.enabled = checked; }));

    // Base value sliders — set the PRESET base, not the live output
    addLabel('── Base Values (before audio) ──');
    const baseStr = gameRef?.baseBloomStrength ?? bp.strength;
    trackSlider('bloom', 'strength', addSlider('strength', baseStr, 0, 3, 0.05, (v) => {
      freezeBloom();
      if (gameRef) gameRef.baseBloomStrength = v;
      bp.strength = v;
    }));
    trackSlider('bloom', 'radius', addSlider('radius', bp.radius, 0, 1, 0.01, (v) => { freezeBloom(); bp.radius = v; }));
    trackSlider('bloom', 'threshold', addSlider('threshold', bp.threshold, 0, 1, 0.01, (v) => { freezeBloom(); bp.threshold = v; }));

    // Live bloom readout — base vs final with reactive delta
    addLabel('── Live Output ──');
    const readout = document.createElement('div');
    readout.style.cssText = 'padding:4px 0;color:#8af;font-family:monospace;font-size:11px;line-height:1.5;white-space:pre';
    const target = document.querySelector('.admin-panel .admin-section:last-child');
    if (target) target.appendChild(readout);
    let _prevBase = baseStr;
    const updateReadout = () => {
      const base = gameRef?.baseBloomStrength ?? _prevBase;
      _prevBase = base;
      const liveStr = bp.strength;
      const delta = liveStr - base;
      const frozen = gameRef?.adminBloomFreeze ?? false;
      readout.textContent =
        `str  base ${base.toFixed(2)}` + (frozen ? ' [frozen]' : ` + ${delta.toFixed(2)} reactive = ${liveStr.toFixed(2)}`) +
        `\nrad  ${bp.radius.toFixed(2)}  thr ${bp.threshold.toFixed(2)}`;
    };
    const readoutTimer = setInterval(updateReadout, 200);
    updateReadout();
    const observer = new MutationObserver(() => {
      if (!readout.isConnected) { clearInterval(readoutTimer); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Per-category emissive multipliers with enable/disable toggles
    addLabel('── Category Multipliers ──');
    const catSliders: Record<string, HTMLInputElement> = {};
    const bloom = getGfx().bloom;
    const CAT_KEYS = ['vehicles', 'trails', 'environment', 'lights'] as const;
    for (const key of CAT_KEYS) {
      const mulKey = `${key}Mul` as const;
      const onKey = `${key}On` as const;
      const slider = addSlider(key, bloom[mulKey], 0, 3, 0.05, (v) => {
        if (bloom[onKey]) bloom[mulKey] = v;
      });
      catSliders[key] = slider;
      trackSlider('bloom', key + 'Mul', slider);
      trackToggle('bloom', key + 'On', addToggle(key + ' on', bloom[onKey], (checked) => {
        bloom[onKey] = checked;
        if (checked) bloom[mulKey] = parseFloat(catSliders[key].value);
      }));
    }
  } else {
    addLabel('(bloom pass not available)');
  }

  // ── Atmosphere ──────────────────────────────────────────
  addHeader('ATMOSPHERE', 'atmosphere');
  if (atmoState && atmoState.level !== 'off') {
    // Freeze reactive updates so slider values stick
    const freezeAtmo = () => { atmoState.adminFreeze = true; };
    // FogExp2 density
    const fog = gameRef?.scene?.fog as THREE.FogExp2 | null;
    if (fog) {
      trackSlider('atmosphere', 'fogDensity', addSlider('fogBase', fog.density, 0, 0.02, 0.0005, (v) => { freezeAtmo(); fog.density = v; }));
      trackSlider('atmosphere', 'fogReactiveRange', addSlider('fogReactive', atmoState.fogReactiveRange, 0, 0.005, 0.0001, (v) => { freezeAtmo(); atmoState.fogReactiveRange = v; }));
      trackColorPicker('atmosphere', 'fogColor', fog.color.getHex(), addColorPicker('fogColor', fog.color.getHex(), (hex) => { freezeAtmo(); fog.color.setHex(hex); }).picker);
    }
    // Floor mist uniforms (controls apply to all layers)
    if (atmoState.mistMeshes.length) {
      const mistMat = atmoState.mistMeshes[0].material as THREE.ShaderMaterial;
      trackSlider('atmosphere', 'mistOpacity', addSlider('mistOpacity', mistMat.uniforms.uOpacity.value, 0, 0.5, 0.01, (v) => { freezeAtmo(); atmoState.mistMeshes.forEach(m => { (m.material as THREE.ShaderMaterial).uniforms.uOpacity.value = v; }); }));
      trackSlider('atmosphere', 'mistSpeed', addSlider('mistSpeed', mistMat.uniforms.uSpeed.value, 0, 0.1, 0.005, (v) => { freezeAtmo(); atmoState.mistMeshes.forEach(m => { (m.material as THREE.ShaderMaterial).uniforms.uSpeed.value = v; }); }));
      trackSlider('atmosphere', 'mistNoiseScale', addSlider('mistNoise', mistMat.uniforms.uNoiseScale.value, 0.002, 0.05, 0.001, (v) => { freezeAtmo(); atmoState.mistMeshes.forEach(m => { (m.material as THREE.ShaderMaterial).uniforms.uNoiseScale.value = v; }); }));
      trackSlider('atmosphere', 'mistWindShift', addSlider('windShift', mistMat.uniforms.uWindShift.value, 0, 0.06, 0.002, (v) => { freezeAtmo(); atmoState.mistMeshes.forEach(m => { (m.material as THREE.ShaderMaterial).uniforms.uWindShift.value = v; }); }));
      trackSlider('atmosphere', 'mistY', addSlider('mistY', atmoState.mistMeshes[0].position.y, 0, 10, 0.1, (v) => { freezeAtmo(); atmoState.mistMeshes[0].position.y = v; }));
    }
  } else {
    addLabel('(atmosphere off or not loaded)');
  }
}

export function addMapEnvironmentSection(
  _panel: HTMLDivElement,
  gameRef: GameLike | null,
): void {
  const reactive = getArenaReactive();

  // ── Floor ───────────────────────────────────────────────
  // Sliders read from and write to MAP_TUNING[currentMap], so tweaks are
  // per-map and the copy-output snippets map 1:1 to the MAP_TUNING source.
  const currentMap = reactive?.mapType ?? 'midtown_bowl';
  const mapLabel = (MAPS.find(m => m.id === currentMap)?.label ?? currentMap).toUpperCase();
  addHeader('FLOOR (' + mapLabel + ')', 'floor');
  if (reactive?.reflector) {
    const rMat = reactive.reflector.material as THREE.ShaderMaterial;
    const mt = MAP_TUNING[currentMap];
    trackSlider('floor', 'reflectStrength', addSlider('reflectStrength', mt.floorReflectStrength, 0, 1, 0.01, (v) => {
      mt.floorReflectStrength = v;
      rMat.uniforms['uReflectStrength'].value = v;
    }));
    trackSlider('floor', 'emissiveIntensity', addSlider('emissive', mt.floorEmissiveIntensity, 0, 2, 0.01, (v) => {
      mt.floorEmissiveIntensity = v;
      rMat.uniforms['uFloorEmissiveIntensity'].value = v;
    }));
    trackSlider('floor', 'roughness', addSlider('roughness', mt.floorRoughness, 0, 1, 0.01, (v) => {
      mt.floorRoughness = v;
      rMat.uniforms['uRoughness'].value = v;
    }));
  } else {
    addLabel('(reflections off — floor controls need high/ultra preset)');
  }

  // ── Floor Material (per-map) ───────────────────────────
  if (reactive?.floorMat) {
    const fm = reactive.floorMat;
    addSubHeader('MATERIAL');
    trackSlider('floor', 'matRoughness', addSlider('mat roughness', fm.roughness, 0, 1, 0.01, (v) => {
      fm.roughness = v; fm.needsUpdate = true;
    }));
    trackSlider('floor', 'matMetalness', addSlider('mat metalness', fm.metalness, 0, 1, 0.01, (v) => {
      fm.metalness = v; fm.needsUpdate = true;
    }));
    trackSlider('floor', 'matOpacity', addSlider('mat opacity', fm.opacity, 0, 1, 0.01, (v) => {
      fm.opacity = v; fm.needsUpdate = true;
    }));
    trackSlider('floor', 'matEmissiveInt', addSlider('mat emissiveInt', fm.emissiveIntensity, 0, 3, 0.01, (v) => {
      fm.emissiveIntensity = v; fm.needsUpdate = true;
    }));
    trackSlider('floor', 'matEnvMapInt', addSlider('mat envMapInt', fm.envMapIntensity ?? 1, 0, 5, 0.05, (v) => {
      fm.envMapIntensity = v; fm.needsUpdate = true;
    }));
  }

  // ── Reflections ────────────────────────────────────────
  addHeader('REFLECTIONS (' + mapLabel + ')', 'reflections');
  if (reactive?.reflector) {
    const reflector = reactive.reflector;
    const reflectorMat = reflector.material as THREE.ShaderMaterial;
    const mt = MAP_TUNING[currentMap];

    // ── Mirror ──
    addSubHeader('MIRROR');
    trackSlider('reflections', 'intensity', addSlider('intensity', mt.reflectionsIntensity, 0, 1, 0.01, (v) => {
      mt.reflectionsIntensity = v;
      reflectorMat.uniforms['color'].value.setScalar(v);
    }));
    trackSlider('reflections', 'yOffset', addSlider('yOffset', mt.reflectionsYOffset, -0.5, 0.5, 0.005, (v) => {
      mt.reflectionsYOffset = v;
      reflector.position.y = v;
    }));

    // ── Clip ──
    // Note: clipBias is a Reflector constructor option, so live slider changes
    // drive the uniform directly and only take effect next arena rebuild for
    // the underlying render target. The uniform update works for the shader.
    addSubHeader('CLIP');
    trackSlider('reflections', 'clipBias', addSlider('clipBias', mt.reflectionsClipBias, 0, 0.1, 0.0005, (v) => {
      mt.reflectionsClipBias = v;
      reflectorMat.uniforms['clipBias'] = reflectorMat.uniforms['clipBias'] || { value: v };
      reflectorMat.uniforms['clipBias'].value = v;
    }));

  } else {
    addLabel('(reflections off — need high/ultra preset)');
  }
}

export function addTrailSection(
  _panel: HTMLDivElement,
  allPlayers: PlayerLike[],
): void {
  // ── Trail ───────────────────────────────────────────────
  addHeader('TRAIL', 'trail');
  const player = allPlayers[0] ?? null;
  const trail = player?.trail ?? null;
  if (!trail) {
    addLabel('(no active trail — start a game)');
  } else {
    trackSlider('trail', 'coreWidth', addSlider('coreWidth', TRAIL_LEGACY_TUNING.coreWidth, 0.1, 0.35, 0.005, (v) => {
      applyTrailLegacyTuning({ coreWidth: v });
    }));
    trackSlider('trail', 'haloWidth', addSlider('haloWidth', TRAIL_LEGACY_TUNING.haloWidth, 0.16, 0.45, 0.005, (v) => {
      applyTrailLegacyTuning({ haloWidth: v });
    }));
    trackSlider('trail', 'height', addSlider('height', TRAIL_LEGACY_TUNING.height, 1.8, 3.4, 0.05, (v) => {
      applyTrailLegacyTuning({ height: v });
    }));
    trackSlider('trail', 'coreIntensity', addSlider('coreInt', TRAIL_LEGACY_TUNING.coreIntensity, 0.4, 2.0, 0.05, (v) => {
      applyTrailLegacyTuning({ coreIntensity: v });
    }));
    trackSlider('trail', 'haloIntensity', addSlider('haloInt', TRAIL_LEGACY_TUNING.haloIntensity, 0.2, 1.4, 0.05, (v) => {
      applyTrailLegacyTuning({ haloIntensity: v });
    }));
    trackSlider('trail', 'headCore', addSlider('headCore', TRAIL_LEGACY_TUNING.headCore, 0.2, 2.2, 0.05, (v) => {
      applyTrailLegacyTuning({ headCore: v });
    }));
    trackSlider('trail', 'headHalo', addSlider('headHalo', TRAIL_LEGACY_TUNING.headHalo, 0.2, 2.0, 0.05, (v) => {
      applyTrailLegacyTuning({ headHalo: v });
    }));
    trackSlider('trail', 'headBlade', addSlider('headBlade', TRAIL_LEGACY_TUNING.headBlade, 0.1, 1.5, 0.05, (v) => {
      applyTrailLegacyTuning({ headBlade: v });
    }));
    trackSlider('trail', 'groundSpill', addSlider('groundSpill', TRAIL_LEGACY_TUNING.groundSpill, 0.1, 1.2, 0.05, (v) => {
      applyTrailLegacyTuning({ groundSpill: v });
    }));
    trackSlider('trail', 'coreBand', addSlider('coreBand', TRAIL_LEGACY_TUNING.coreBand, 0.05, 0.6, 0.01, (v) => {
      applyTrailLegacyTuning({ coreBand: v });
    }));
    trackSlider('trail', 'headLength', addSlider('headLength', TRAIL_LEGACY_TUNING.headLength, 0.5, 3.0, 0.05, (v) => {
      applyTrailLegacyTuning({ headLength: v });
    }));
    trackSlider('trail', 'flowRate', addSlider('flowRate', TRAIL_LEGACY_TUNING.flowRate, 0.0, 1.5, 0.02, (v) => {
      applyTrailLegacyTuning({ flowRate: v });
    }));
    trackSlider('trail', 'bikeTrailAttach', addSlider('bikeAttach', BIKE_PHYSICS.trailRear, 2.0, 3.0, 0.02, (v) => {
      BIKE_PHYSICS.trailRear = v;
    }));
  }
}

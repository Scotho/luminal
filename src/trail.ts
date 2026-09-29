import * as THREE from 'three';
import { getGfx, bloomMul, VISUAL_TUNING } from './graphics';
import { grid } from './spatialGrid';
import type { TrailPoint, VehicleType } from './types/index';
import { buildTrailWallGeometry } from './trailGeometry';
import { enableReflection } from './renderLayers';

const MAX_INSTANCES = 2000;
const TRAIL_WALL_RENDER_ORDER = 10;
const HEAD_RENDER_ORDER = 12;
const TAIL_TAPER_COUNT = 4;
const TAIL_TAPER_FRACTIONS = [0.78, 0.90, 0.96, 0.99];

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quat2 = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

type TrailLayer = 'core' | 'halo';

type TrailShaderUniforms = {
  uTime: { value: number };
  uSpeed: { value: number };
  uSlipstream: { value: number };
  uBaseColor: { value: THREE.Color };
  uCoreColor: { value: THREE.Color };
  uGlowColor: { value: THREE.Color };
  uAlpha: { value: number };
  uBandWidth: { value: number };
  uBandSharpness: { value: number };
  uFlowRate: { value: number };
  uRimStrength: { value: number };
  uHotspot: { value: number };
  uIntensity: { value: number };
  uSegCount: { value: number };
};

export interface TrailLegacyTuning {
  height: number;
  coreWidth: number;
  haloWidth: number;
  coreIntensity: number;
  haloIntensity: number;
  headCore: number;
  headHalo: number;
  headBlade: number;
  groundSpill: number;
  coreBand: number;
  headLength: number;
  flowRate: number;
}

export const TRAIL_LEGACY_TUNING: TrailLegacyTuning = {
  height: 2.5,
  coreWidth: 0.14,
  haloWidth: 0.28,
  coreIntensity: 0.82,
  haloIntensity: 0.50,
  headCore: 0.65,
  headHalo: 0.42,
  headBlade: 0.38,
  groundSpill: 0.28,
  coreBand: 0.32,
  headLength: 1.55,
  flowRate: 0.42,
};

export interface TrailColorProfile {
  baseColor: THREE.Color;
  coreColor: THREE.Color;
  haloColor: THREE.Color;
  edgeColor: THREE.Color;
  hotspotColor: THREE.Color;
  luminance: number;
  darkBoost: number;
  wallEmissive: number;
  haloEmissive: number;
  edgeOpacity: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteXZ(x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z);
}

function configureTrailSurfaceMaterial(mat: THREE.MeshStandardMaterial): void {
  mat.depthWrite = false;
  mat.forceSinglePass = true;
}

function createLayerGeometry(width: number): THREE.BufferGeometry {
  return buildTrailWallGeometry(TRAIL_LEGACY_TUNING.height, width);
}

function createLiveHeadGeometry(width: number): THREE.BufferGeometry {
  return buildTrailWallGeometry(TRAIL_LEGACY_TUNING.height, width);
}

export function deriveTrailColorProfile(color: number | string | THREE.Color): TrailColorProfile {
  const source = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
  const luminance = source.r * 0.299 + source.g * 0.587 + source.b * 0.114;
  const darkBoost = Math.max(0, 1 - luminance * 1.32);
  const hsl = { h: 0, s: 0, l: 0 };
  source.getHSL(hsl);

  const baseColor = new THREE.Color().setHSL(
    hsl.h,
    clamp(Math.max(hsl.s * 1.08, 0.72), 0.72, 1),
    clamp(0.22 + luminance * 0.06 + darkBoost * 0.05, 0.22, 0.32),
  );
  const haloColor = new THREE.Color().setHSL(
    hsl.h,
    clamp(Math.max(hsl.s * 0.94, 0.58), 0.58, 0.98),
    clamp(0.38 + darkBoost * 0.07, 0.38, 0.52),
  );
  const coreColor = new THREE.Color().setHSL(
    hsl.h,
    clamp(Math.max(hsl.s * 0.88, 0.55), 0.55, 0.95),
    clamp(0.46 + darkBoost * 0.07, 0.46, 0.58),
  );
  const edgeColor = haloColor.clone().lerp(coreColor, 0.35);
  const hotspotColor = coreColor.clone().lerp(new THREE.Color(0xffffff), 0.12);

  const tuning = VISUAL_TUNING[getGfx().preset] ?? VISUAL_TUNING.high;
  const wallEmissive = tuning.wallEmissive * TRAIL_LEGACY_TUNING.coreIntensity;
  return {
    baseColor,
    coreColor,
    haloColor,
    edgeColor,
    hotspotColor,
    luminance,
    darkBoost,
    wallEmissive,
    haloEmissive: wallEmissive * TRAIL_LEGACY_TUNING.haloIntensity,
    edgeOpacity: 0.14 + darkBoost * 0.05,
  };
}

function buildLayerMaterial(profile: TrailColorProfile, layer: TrailLayer, live = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: layer === 'core' ? profile.baseColor : profile.haloColor,
    emissive: layer === 'core' ? profile.coreColor : profile.edgeColor,
    emissiveIntensity: layer === 'core' ? profile.wallEmissive : profile.haloEmissive,
    roughness: layer === 'core' ? 0.08 : 0.14,
    metalness: 0.02,
    transparent: true,
    opacity: 1,
    blending: layer === 'core' ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  if (live) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
  }
  configureTrailSurfaceMaterial(mat);
  return mat;
}

function applyLegacyShader(
  mat: THREE.MeshStandardMaterial,
  profile: TrailColorProfile,
  uniformsList: TrailShaderUniforms[],
  layer: TrailLayer,
): void {
  const halfH = (TRAIL_LEGACY_TUNING.height / 2).toFixed(4);
  const isCore = layer === 'core';

  mat.customProgramCacheKey = () => `trail-legacy-${layer}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSpeed = { value: 1 };
    shader.uniforms.uSlipstream = { value: 0 };
    shader.uniforms.uBaseColor = { value: profile.baseColor.clone() };
    shader.uniforms.uCoreColor = { value: profile.coreColor.clone() };
    shader.uniforms.uGlowColor = { value: profile.haloColor.clone() };
    shader.uniforms.uAlpha = { value: isCore ? 0.52 : 0.36 };
    shader.uniforms.uBandWidth = { value: isCore ? TRAIL_LEGACY_TUNING.coreBand : 0.36 };
    shader.uniforms.uBandSharpness = { value: isCore ? 6.4 : 2.8 };
    shader.uniforms.uFlowRate = { value: TRAIL_LEGACY_TUNING.flowRate * (isCore ? 1 : 0.72) };
    shader.uniforms.uRimStrength = { value: isCore ? 0.18 : 0.72 };
    shader.uniforms.uHotspot = { value: isCore ? 0.72 : 0.34 };
    shader.uniforms.uIntensity = { value: isCore ? TRAIL_LEGACY_TUNING.coreIntensity : TRAIL_LEGACY_TUNING.haloIntensity };
    shader.uniforms.uSegCount = { value: 1 };
    uniformsList.push(shader.uniforms as unknown as TrailShaderUniforms);

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
varying float vLocalY;
varying float vLocalX;
varying vec3 vLegacyNormal;
varying vec3 vTrailTint;
varying float vProgress;
varying vec3 vViewDir;
attribute float aInstanceIdx;
uniform float uSegCount;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vLocalY = position.y / ${halfH} * 0.5 + 0.5;
vLocalX = position.x + 0.5;
vLegacyNormal = normalize(normalMatrix * objectNormal);
vTrailTint = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
vTrailTint *= instanceColor.rgb;
#endif
#ifdef USE_INSTANCING
vProgress = 1.0 - aInstanceIdx / max(uSegCount - 1.0, 1.0);
#else
vProgress = 0.0;
#endif
vec4 mvPos = modelViewMatrix * vec4(transformed, 1.0);
vViewDir = -normalize(mvPos.xyz);`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
varying float vLocalY;
varying float vLocalX;
varying vec3 vLegacyNormal;
varying vec3 vTrailTint;
varying float vProgress;
varying vec3 vViewDir;
uniform float uTime;
uniform float uSpeed;
uniform float uSlipstream;
uniform vec3 uBaseColor;
uniform vec3 uCoreColor;
uniform vec3 uGlowColor;
uniform float uAlpha;
uniform float uBandWidth;
uniform float uBandSharpness;
uniform float uFlowRate;
uniform float uRimStrength;
uniform float uHotspot;
uniform float uIntensity;
uniform float uSegCount;`,
    );

    const bodyCode = isCore
      ? [
        'float bodyFill = smoothstep(0.02, 0.08, vLocalY) * (1.0 - smoothstep(0.93, 0.99, vLocalY));',
        'float band = exp(-pow(abs(vLocalY - 0.48) / max(uBandWidth * 2.0, 0.01), 2.0));',
        'float fillBlend = 0.65 + 0.35 * band;',
        'float flow = 0.96 + 0.04 * sin(vLocalY * 3.14 + uTime * uFlowRate);',
        'vec3 col = mix(uBaseColor, uCoreColor, fillBlend) * bodyFill * flow * uIntensity;',
        'float ageFade = mix(1.0, 0.45, pow(vProgress, 2.0));',
        'float alpha = bodyFill * uAlpha * (0.55 + 0.45 * band) * ageFade;',
      ].join('\n')
      : [
        'float bodyFill = smoothstep(0.01, 0.10, vLocalY) * (1.0 - smoothstep(0.86, 1.0, vLocalY));',
        'float energy = 0.95 + 0.05 * sin(vLocalY * 2.0 + uTime * uFlowRate * 0.6);',
        'vec3 col = uGlowColor * bodyFill * 0.5 * energy * uIntensity;',
        'float fresnel = pow(1.0 - abs(dot(vViewDir, vLegacyNormal)), 2.5);',
        'col += uGlowColor * fresnel * 0.12 * bodyFill;',
        'float ageFade = mix(1.0, 0.6, pow(vProgress, 2.5));',
        'float alpha = bodyFill * uAlpha * 0.50 * ageFade;',
      ].join('\n');

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      [
        bodyCode,
        'col *= max(vTrailTint, vec3(0.8));',
        'gl_FragColor = vec4(col, alpha);',
      ].join('\n'),
    );
  };
}

export function applyTrailLegacyTuning(patch: Partial<TrailLegacyTuning>): void {
  Object.assign(TRAIL_LEGACY_TUNING, patch);
  for (const trail of Trail.registry) trail.refreshLegacyVisuals();
}

export class Trail {
  static readonly registry = new Set<Trail>();

  scene: THREE.Scene;
  vehicleType: VehicleType;
  color: THREE.Color;
  _colorProfile: TrailColorProfile;
  points: TrailPoint[];
  wallHeight: number;
  wallWidth: number;
  _segCount: number;
  _baseEmissive: number;
  wallMat: THREE.MeshStandardMaterial;
  haloWallMat: THREE.MeshStandardMaterial;
  wallMesh: THREE.InstancedMesh;
  haloWallMesh: THREE.InstancedMesh;
  _origY: Float32Array;
  _liveSeg: THREE.Mesh | null;
  _haloLiveSeg: THREE.Mesh | null;
  _smoothSpeedFactor: number | undefined;
  _glowingIdxs: number[] | null | undefined;
  _darkBoost: number;
  _wallUniforms: TrailShaderUniforms[];
  _haloUniforms: TrailShaderUniforms[];
  _liveWallMat: THREE.MeshStandardMaterial;
  _haloLiveWallMat: THREE.MeshStandardMaterial;

  private _fadingSegs = new Map<number, number>();
  private _destroyedSegs = new Set<number>();
  private _origYScale = new Float32Array(MAX_INSTANCES);
  private _instanceColor: THREE.InstancedBufferAttribute;
  private _instanceIdx: THREE.InstancedBufferAttribute;
  private _headGroup: THREE.Group | null = null;
  private _headCore: THREE.Sprite | null = null;
  private _headHalo: THREE.Sprite | null = null;
  private _headBlade: THREE.Mesh | null = null;
  private _groundSpill: THREE.Mesh | null = null;
  private _lastHeadX = 0;
  private _lastHeadZ = 0;
  private _lastHeadRot = 0;
  private _headSpeed = 1;

  constructor(scene: THREE.Scene, color: number | string, vehicleType: VehicleType = 'bike') {
    this.scene = scene;
    this.vehicleType = vehicleType;
    this.color = new THREE.Color(color);
    this.points = [];
    this.wallHeight = TRAIL_LEGACY_TUNING.height;
    this.wallWidth = TRAIL_LEGACY_TUNING.coreWidth;
    this._segCount = 0;
    this._origY = new Float32Array(MAX_INSTANCES);
    this._wallUniforms = [];
    this._haloUniforms = [];
    this._instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
    this._colorProfile = deriveTrailColorProfile(this.color);
    this._darkBoost = this._colorProfile.darkBoost;
    this._baseEmissive = this._colorProfile.wallEmissive;

    for (let i = 0; i < this._instanceColor.array.length; i++) this._instanceColor.array[i] = 1;

    const idxArray = new Float32Array(MAX_INSTANCES);
    for (let i = 0; i < MAX_INSTANCES; i++) idxArray[i] = i;
    this._instanceIdx = new THREE.InstancedBufferAttribute(idxArray, 1);

    this.wallMat = buildLayerMaterial(this._colorProfile, 'core');
    this._liveWallMat = buildLayerMaterial(this._colorProfile, 'core', true);
    this.haloWallMat = buildLayerMaterial(this._colorProfile, 'halo');
    this._haloLiveWallMat = buildLayerMaterial(this._colorProfile, 'halo', true);
    applyLegacyShader(this.wallMat, this._colorProfile, this._wallUniforms, 'core');
    applyLegacyShader(this._liveWallMat, this._colorProfile, this._wallUniforms, 'core');
    applyLegacyShader(this.haloWallMat, this._colorProfile, this._haloUniforms, 'halo');
    applyLegacyShader(this._haloLiveWallMat, this._colorProfile, this._haloUniforms, 'halo');

    this.wallMesh = this._initWallMesh(scene, createLayerGeometry(TRAIL_LEGACY_TUNING.coreWidth), this.wallMat);
    this.haloWallMesh = this._initWallMesh(scene, createLayerGeometry(TRAIL_LEGACY_TUNING.haloWidth), this.haloWallMat, 9);
    // Halo layer hidden — caused dark-rectangle artifacts in floor reflections.
    // Core wall + head sprites + bloom provide sufficient glow.
    this.haloWallMat.visible = false;
    this._haloLiveWallMat.visible = false;
    this._attachInstanceIdx(this.wallMesh.geometry);
    this._attachInstanceIdx(this.haloWallMesh.geometry);
    this._liveSeg = null;
    this._haloLiveSeg = null;
    Trail.registry.add(this);
  }

  private _attachInstanceIdx(geo: THREE.BufferGeometry): void {
    geo.setAttribute('aInstanceIdx', this._instanceIdx);
  }

  private _initWallMesh(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
    renderOrder = TRAIL_WALL_RENDER_ORDER,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.instanceColor = this._instanceColor;
    scene.add(mesh);
    enableReflection(mesh);
    return mesh;
  }

  private _ensureHeadVisuals(): void {
    if (this._headGroup) return;

    const coreMat = new THREE.SpriteMaterial({
      color: this._colorProfile.hotspotColor,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
    });
    const haloMat = new THREE.SpriteMaterial({
      color: this._colorProfile.haloColor,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      depthTest: false,
    });
    const bladeMat = new THREE.MeshBasicMaterial({
      color: this._colorProfile.hotspotColor,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this._headGroup = new THREE.Group();
    this._headGroup.renderOrder = HEAD_RENDER_ORDER;

    this._headCore = new THREE.Sprite(coreMat);
    this._headCore.position.set(0, this.wallHeight * 0.54, 0);
    this._headCore.renderOrder = HEAD_RENDER_ORDER;

    this._headHalo = new THREE.Sprite(haloMat);
    this._headHalo.position.set(0, this.wallHeight * 0.52, 0);
    this._headHalo.renderOrder = HEAD_RENDER_ORDER;

    this._headBlade = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1), bladeMat);
    this._headBlade.position.set(0, this.wallHeight * 0.5, 0);
    this._headBlade.renderOrder = HEAD_RENDER_ORDER;

    // groundSpill removed — additive plane bled through vehicle models
    this._groundSpill = null;

    this._headGroup.add(this._headHalo, this._headCore, this._headBlade);
    this.scene.add(this._headGroup);
    enableReflection(this._headGroup);
    this._syncHeadVisuals();
  }

  private _syncHeadVisuals(): void {
    if (!this._headCore || !this._headHalo || !this._headBlade || !this._groundSpill) return;

    const headScale = TRAIL_LEGACY_TUNING.headLength * (0.88 + this._headSpeed * 0.18);
    this._headCore.position.set(0, this.wallHeight * 0.54, 0);
    this._headHalo.position.set(0, this.wallHeight * 0.52, 0);
    this._headBlade.position.set(0, this.wallHeight * 0.5, 0);
    this._headCore.material.color.copy(this._colorProfile.hotspotColor);
    this._headHalo.material.color.copy(this._colorProfile.haloColor);
    (this._headBlade.material as THREE.MeshBasicMaterial).color.copy(this._colorProfile.hotspotColor);
    (this._groundSpill.material as THREE.MeshBasicMaterial).color.copy(this._colorProfile.haloColor);

    this._headCore.scale.setScalar(headScale * 0.7);
    this._headHalo.scale.setScalar(headScale * 1.38);
    this._headBlade.scale.set(1, this.wallHeight * (0.94 + this._headSpeed * 0.12), 1);
    this._groundSpill.scale.set(TRAIL_LEGACY_TUNING.haloWidth * 7.5, TRAIL_LEGACY_TUNING.haloWidth * 4.5, 1);

    this._headCore.material.opacity = clamp(0.72 * TRAIL_LEGACY_TUNING.headCore, 0.15, 1);
    this._headHalo.material.opacity = clamp(0.36 * TRAIL_LEGACY_TUNING.headHalo, 0.08, 0.95);
    (this._headBlade.material as THREE.MeshBasicMaterial).opacity = clamp(0.42 * TRAIL_LEGACY_TUNING.headBlade, 0.08, 0.95);
    (this._groundSpill.material as THREE.MeshBasicMaterial).opacity = clamp(0.26 * TRAIL_LEGACY_TUNING.groundSpill, 0.04, 0.75);
  }

  private _setLayerMatrix(mesh: THREE.InstancedMesh, idx: number, yScale = 1): void {
    const y = (this.wallHeight * yScale) / 2;
    _pos.y = y;
    _mat4.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(idx, _mat4);
    mesh.instanceMatrix.addUpdateRange(idx * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private _updateLiveSegment(mesh: THREE.Mesh | null, length: number, mx: number, mz: number, rot: number): void {
    if (!mesh) return;
    mesh.scale.x = length + 0.01;
    mesh.position.set(mx, this.wallHeight / 2, mz);
    mesh.rotation.y = rot;
  }

  setSlipstream(value: number): void {
    for (const u of this._wallUniforms) u.uSlipstream.value = value;
    for (const u of this._haloUniforms) u.uSlipstream.value = value;
  }

  addPoint(x: number, z: number): void {
    if (!isFiniteXZ(x, z)) return;
    const last = this.points[this.points.length - 1];
    if (last && Math.abs(last.x - x) < 0.3 && Math.abs(last.z - z) < 0.3) return;

    this.points.push({ x, z });

    if (this.points.length >= 2) {
      if (this._liveSeg) this._liveSeg.scale.x = 0;
      if (this._haloLiveSeg) this._haloLiveSeg.scale.x = 0;
      const a = this.points[this.points.length - 2];
      const b = this.points[this.points.length - 1];
      this._buildSegment(a, b);
      grid.insertSegment(a.x, a.z, b.x, b.z, this, this.points.length - 2);
    }
  }

  updateHead(x: number, z: number): void {
    if (!isFiniteXZ(x, z)) return;

    const tSec = performance.now() * 0.001;
    for (const u of this._wallUniforms) u.uTime.value = tSec;
    for (const u of this._haloUniforms) u.uTime.value = tSec;

    const last = this.points[this.points.length - 1];
    if (!last) return;

    const dx = x - last.x;
    const dz = z - last.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.01) return;

    const rot = Math.atan2(dx, dz) + Math.PI / 2;
    const mx = (last.x + x) / 2;
    const mz = (last.z + z) / 2;

    if (!this._liveSeg) {
      this._liveSeg = new THREE.Mesh(createLiveHeadGeometry(TRAIL_LEGACY_TUNING.coreWidth), this._liveWallMat);
      this._liveSeg.frustumCulled = false;
      this._liveSeg.renderOrder = TRAIL_WALL_RENDER_ORDER;
      this.scene.add(this._liveSeg);
      enableReflection(this._liveSeg);
    }
    if (!this._haloLiveSeg) {
      this._haloLiveSeg = new THREE.Mesh(createLiveHeadGeometry(TRAIL_LEGACY_TUNING.haloWidth), this._haloLiveWallMat);
      this._haloLiveSeg.frustumCulled = false;
      this._haloLiveSeg.renderOrder = TRAIL_WALL_RENDER_ORDER - 1;
      this.scene.add(this._haloLiveSeg);
      enableReflection(this._haloLiveSeg);
    }

    this._updateLiveSegment(this._liveSeg, length, mx, mz, rot);
    this._updateLiveSegment(this._haloLiveSeg, length, mx, mz, rot);

    this._ensureHeadVisuals();
    this._lastHeadX = x;
    this._lastHeadZ = z;
    this._lastHeadRot = rot;
    if (this._headGroup) {
      this._headGroup.position.set(x, 0, z);
      this._headGroup.rotation.y = rot;
      this._syncHeadVisuals();
    }
  }

  updateSpeed(speedFactor: number): void {
    if (this._smoothSpeedFactor === undefined) this._smoothSpeedFactor = speedFactor;
    this._smoothSpeedFactor += (speedFactor - this._smoothSpeedFactor) * 0.15;
    const sf = this._smoothSpeedFactor;

    const dashBlend = clamp((sf - 1.65) / 0.55, 0, 1);
    const speedLift = Math.max(0, sf - 0.95);
    const coreScale = 0.96 + dashBlend * 0.16 + speedLift * 0.06;
    const haloScale = 0.9 + dashBlend * 0.12 + speedLift * 0.04;

    this._headSpeed = 1 + dashBlend * 0.35 + speedLift * 0.12;
    this.wallMat.emissiveIntensity = this._baseEmissive * coreScale * bloomMul.trails;
    this._liveWallMat.emissiveIntensity = this._baseEmissive * coreScale * bloomMul.trails;
    this.haloWallMat.emissiveIntensity = this._colorProfile.haloEmissive * haloScale * bloomMul.trails;
    this._haloLiveWallMat.emissiveIntensity = this._colorProfile.haloEmissive * haloScale * bloomMul.trails;

    const flowSpeed = 1 + dashBlend * 0.8 + speedLift * 0.28;
    for (const u of this._wallUniforms) {
      u.uSpeed.value = flowSpeed;
      u.uIntensity.value = TRAIL_LEGACY_TUNING.coreIntensity * coreScale;
    }
    for (const u of this._haloUniforms) {
      u.uSpeed.value = flowSpeed * 0.92;
      u.uIntensity.value = TRAIL_LEGACY_TUNING.haloIntensity * haloScale;
    }
    this._syncHeadVisuals();
  }

  private _buildSegment(a: TrailPoint, b: TrailPoint): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.01 || this._segCount >= MAX_INSTANCES) return;

    const rot = Math.atan2(dx, dz) + Math.PI / 2;
    const idx = this._segCount;

    _pos.set((a.x + b.x) / 2, this.wallHeight / 2, (a.z + b.z) / 2);
    _euler.set(0, rot, 0);
    _quat.setFromEuler(_euler);
    _scale.set(length + 0.01, 1, 1);
    this._setLayerMatrix(this.wallMesh, idx);
    this._setLayerMatrix(this.haloWallMesh, idx);
    this._origY[idx] = this.wallHeight / 2;
    this._origYScale[idx] = 1;
    this._segCount++;
    this.wallMesh.count = this._segCount;
    this.haloWallMesh.count = this._segCount;
    for (const u of this._wallUniforms) u.uSegCount.value = this._segCount;
    for (const u of this._haloUniforms) u.uSegCount.value = this._segCount;

    if (this._segCount <= TAIL_TAPER_COUNT) this._applyTailTaper();
  }

  private _applyTailTaper(): void {
    const n = Math.min(TAIL_TAPER_COUNT, this._segCount);
    for (let i = 0; i < n; i++) {
      const frac = TAIL_TAPER_FRACTIONS[i];
      this.wallMesh.getMatrixAt(i, _mat4);
      _mat4.decompose(_pos, _quat2, _scale);
      _pos.y = (this.wallHeight * frac) / 2;
      _scale.y = frac;
      _mat4.compose(_pos, _quat2, _scale);
      this.wallMesh.setMatrixAt(i, _mat4);
      this.haloWallMesh.setMatrixAt(i, _mat4);
      this._origY[i] = _pos.y;
      this._origYScale[i] = frac;
      this.wallMesh.instanceMatrix.addUpdateRange(i * 16, 16);
      this.haloWallMesh.instanceMatrix.addUpdateRange(i * 16, 16);
    }
    this.wallMesh.instanceMatrix.needsUpdate = true;
    this.haloWallMesh.instanceMatrix.needsUpdate = true;
  }

  setInstanceY(instanceIdx: number, y: number): void {
    if (instanceIdx >= this._segCount) return;
    for (const mesh of [this.wallMesh, this.haloWallMesh]) {
      mesh.getMatrixAt(instanceIdx, _mat4);
      _mat4.decompose(_pos, _quat, _scale);
      _pos.y = y;
      _mat4.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(instanceIdx, _mat4);
      mesh.instanceMatrix.addUpdateRange(instanceIdx * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  getInstanceOrigY(instanceIdx: number): number {
    return this._origY[instanceIdx] || this.wallHeight / 2;
  }

  resetGlowing(): void {
    if (!this._glowingIdxs) return;
    for (const idx of this._glowingIdxs) this.setInstanceY(idx, this.getInstanceOrigY(idx));
    this._glowingIdxs = null;
  }

  warmShaders(): void {
    _pos.set(0, -500, 0);
    _quat.identity();
    _scale.set(0.01, 0.01, 0.01);
    _mat4.compose(_pos, _quat, _scale);
    this.wallMesh.setMatrixAt(0, _mat4);
    this.haloWallMesh.setMatrixAt(0, _mat4);
    this.wallMesh.count = 1;
    this.haloWallMesh.count = 1;
    this.wallMesh.instanceMatrix.needsUpdate = true;
    this.haloWallMesh.instanceMatrix.needsUpdate = true;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.wallMesh.count = this._segCount;
      this.haloWallMesh.count = this._segCount;
    }));
  }

  copyLocalHazeProfile(haloTarget: THREE.Color, coreTarget: THREE.Color): void {
    haloTarget.copy(this._colorProfile.haloColor);
    coreTarget.copy(this._colorProfile.coreColor);
  }

  getVisualGeometry(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [this.haloWallMesh, this.wallMesh];
    if (this._haloLiveSeg) out.push(this._haloLiveSeg);
    if (this._liveSeg) out.push(this._liveSeg);
    if (this._headGroup) out.push(this._headGroup);
    return out;
  }

  checkCollision(px: number, pz: number, skipLastN = 0): boolean {
    return grid.checkCollision(px, pz, 0.8, this, skipLastN);
  }

  fadeSegment(segIndex: number): void {
    if (segIndex < 0 || segIndex >= this._segCount) return;
    if (this._fadingSegs.has(segIndex) || this._destroyedSegs.has(segIndex)) return;
    this._fadingSegs.set(segIndex, 0);
  }

  tickFadingSegments(dt: number): number[] {
    const FADE_DURATION = 0.3;
    const completed: number[] = [];

    for (const [idx, progress] of this._fadingSegs) {
      const next = progress + dt / FADE_DURATION;
      if (next >= 1) {
        completed.push(idx);
        this._fadingSegs.delete(idx);
      } else {
        this._fadingSegs.set(idx, next);
      }
      this._setSegmentFade(idx, 1 - Math.min(next, 1));
    }

    return completed;
  }

  private _setSegmentFade(segIndex: number, alpha: number): void {
    if (segIndex >= this._segCount) return;
    for (const mesh of [this.wallMesh, this.haloWallMesh]) {
      mesh.getMatrixAt(segIndex, _mat4);
      _mat4.decompose(_pos, _quat, _scale);
      const origYScale = this._origYScale[segIndex] || 1;
      _scale.y = origYScale * Math.max(0.001, alpha);
      _pos.y = (this.wallHeight * _scale.y) / 2;
      _mat4.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(segIndex, _mat4);
      mesh.instanceMatrix.addUpdateRange(segIndex * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  markSegmentDestroyed(segIndex: number): void {
    this._destroyedSegs.add(segIndex);
  }

  isSegmentDestroyed(segIndex: number): boolean {
    return this._destroyedSegs.has(segIndex);
  }

  refreshLegacyVisuals(): void {
    this.wallHeight = TRAIL_LEGACY_TUNING.height;
    this.wallWidth = TRAIL_LEGACY_TUNING.coreWidth;
    this._colorProfile = deriveTrailColorProfile(this.color);
    this._darkBoost = this._colorProfile.darkBoost;
    this._baseEmissive = this._colorProfile.wallEmissive;
    this._wallUniforms.length = 0;
    this._haloUniforms.length = 0;
    applyLegacyShader(this.wallMat, this._colorProfile, this._wallUniforms, 'core');
    applyLegacyShader(this._liveWallMat, this._colorProfile, this._wallUniforms, 'core');
    applyLegacyShader(this.haloWallMat, this._colorProfile, this._haloUniforms, 'halo');
    applyLegacyShader(this._haloLiveWallMat, this._colorProfile, this._haloUniforms, 'halo');
    this.wallMat.needsUpdate = true;
    this._liveWallMat.needsUpdate = true;
    this.haloWallMat.needsUpdate = true;
    this._haloLiveWallMat.needsUpdate = true;
    for (const u of this._wallUniforms) u.uSegCount.value = this._segCount;
    for (const u of this._haloUniforms) u.uSegCount.value = this._segCount;

    const coreGeo = createLayerGeometry(TRAIL_LEGACY_TUNING.coreWidth);
    const haloGeo = createLayerGeometry(TRAIL_LEGACY_TUNING.haloWidth);
    const oldCoreGeo = this.wallMesh.geometry;
    const oldHaloGeo = this.haloWallMesh.geometry;
    this.wallMesh.geometry = coreGeo;
    this.haloWallMesh.geometry = haloGeo;
    this._attachInstanceIdx(coreGeo);
    this._attachInstanceIdx(haloGeo);
    oldCoreGeo.dispose();
    oldHaloGeo.dispose();

    if (this._liveSeg) {
      const old = this._liveSeg.geometry;
      this._liveSeg.geometry = createLiveHeadGeometry(TRAIL_LEGACY_TUNING.coreWidth);
      old.dispose();
      this._liveSeg.position.y = this.wallHeight / 2;
    }
    if (this._haloLiveSeg) {
      const old = this._haloLiveSeg.geometry;
      this._haloLiveSeg.geometry = createLiveHeadGeometry(TRAIL_LEGACY_TUNING.haloWidth);
      old.dispose();
      this._haloLiveSeg.position.y = this.wallHeight / 2;
    }

    this.wallMat.color.copy(this._colorProfile.baseColor);
    this.wallMat.emissive.copy(this._colorProfile.coreColor);
    this._liveWallMat.color.copy(this._colorProfile.baseColor);
    this._liveWallMat.emissive.copy(this._colorProfile.coreColor);
    this.haloWallMat.color.copy(this._colorProfile.haloColor);
    this.haloWallMat.emissive.copy(this._colorProfile.edgeColor);
    this._haloLiveWallMat.color.copy(this._colorProfile.haloColor);
    this._haloLiveWallMat.emissive.copy(this._colorProfile.edgeColor);

    for (let i = 0; i < this._segCount; i++) {
      this.wallMesh.getMatrixAt(i, _mat4);
      _mat4.decompose(_pos, _quat, _scale);
      _pos.y = (this.wallHeight * (_scale.y || 1)) / 2;
      _mat4.compose(_pos, _quat, _scale);
      this.wallMesh.setMatrixAt(i, _mat4);
      this.haloWallMesh.setMatrixAt(i, _mat4);
      this._origY[i] = _pos.y;
      this.wallMesh.instanceMatrix.addUpdateRange(i * 16, 16);
      this.haloWallMesh.instanceMatrix.addUpdateRange(i * 16, 16);
    }
    this.wallMesh.instanceMatrix.needsUpdate = true;
    this.haloWallMesh.instanceMatrix.needsUpdate = true;

    if (this._headGroup) {
      this._headGroup.position.set(this._lastHeadX, 0, this._lastHeadZ);
      this._headGroup.rotation.y = this._lastHeadRot;
      this._syncHeadVisuals();
    }

    this.updateSpeed(this._smoothSpeedFactor ?? 1);
  }

  destroy(): void {
    Trail.registry.delete(this);
    this.scene.remove(this.wallMesh);
    this.scene.remove(this.haloWallMesh);
    this.wallMesh.geometry.dispose();
    this.haloWallMesh.geometry.dispose();
    this.wallMesh.dispose();
    this.haloWallMesh.dispose();

    if (this._liveSeg) {
      this.scene.remove(this._liveSeg);
      this._liveSeg.geometry.dispose();
    }
    if (this._haloLiveSeg) {
      this.scene.remove(this._haloLiveSeg);
      this._haloLiveSeg.geometry.dispose();
    }
    if (this._headGroup) {
      this.scene.remove(this._headGroup);
      this._headCore?.material.dispose();
      this._headHalo?.material.dispose();
      this._headBlade?.geometry.dispose();
      (this._headBlade?.material as THREE.Material | undefined)?.dispose();
      this._groundSpill?.geometry.dispose();
      (this._groundSpill?.material as THREE.Material | undefined)?.dispose();
    }

    this.wallMat.dispose();
    this._liveWallMat.dispose();
    this.haloWallMat.dispose();
    this._haloLiveWallMat.dispose();
    this._segCount = 0;
    this.points = [];
  }
}

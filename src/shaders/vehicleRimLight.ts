// ── vehicleRimLight.ts ──────────────────────────────────
// Fresnel-based rim-light shader patch for vehicle MeshStandardMaterial
// instances. Brightens silhouette edges where the surface normal grazes
// the view direction, so vehicles read against the dark arena floor.
// Applied at construction time via onBeforeCompile; zero per-frame CPU cost.

import * as THREE from 'three';

export interface RimParams {
  strength: number;     // 0 = no-op; ~1.3 = pronounced edge
  power: number;        // Fresnel sharpness; higher = thinner rim
  tint: THREE.Color;    // player emissive color
}

/** Apply rim-light patch to every opaque MeshStandardMaterial under `root`. */
export function applyRimLight(root: THREE.Object3D, params: RimParams): void {
  if (params.strength === 0) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as THREE.Mesh).isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !(m as THREE.MeshStandardMaterial).isMaterial) continue;
      const mat = m as THREE.MeshStandardMaterial;
      // Skip exhaust glows and other already-bright transparent layers
      if (mat.transparent && mat.opacity < 1) continue;
      patchMaterial(mat, params);
    }
  });
}

/** Inject the Fresnel rim term into a single MeshStandardMaterial. */
export function patchMaterial(mat: THREE.MeshStandardMaterial, params: RimParams): void {
  if (params.strength === 0) return;
  try {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimStrength = { value: params.strength };
      shader.uniforms.uRimPower = { value: params.power };
      shader.uniforms.uRimTint = { value: params.tint.clone() };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vRimNormal;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vRimNormal = normalize(transformedNormal);`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vRimNormal;
uniform float uRimStrength;
uniform float uRimPower;
uniform vec3 uRimTint;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        `float rim = pow(1.0 - max(dot(normalize(vRimNormal), normalize(vViewPosition)), 0.0), uRimPower);
gl_FragColor.rgb += uRimTint * rim * uRimStrength;
#include <tonemapping_fragment>`,
      );
    };
    // Namespace key so three.js's shader cache doesn't reuse an unpatched
    // program for a patched material. Strength/power live in uniforms, so
    // the cache key stays constant — no shader recompile per param change.
    mat.customProgramCacheKey = () => 'rimLight';
    mat.needsUpdate = true;
  } catch (err) {
    // Three.js can reject shader edits if the chunk pattern isn't present
    // (e.g., engine version drift). Fall back to un-rimmed material silently.
    console.warn('[rimLight] patch failed, falling back', err);
  }
}

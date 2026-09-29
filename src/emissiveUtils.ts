import * as THREE from 'three';

const _hsl = { h: 0, s: 0, l: 0 };

/** Compute an emissive color from a player hex color.
 *  Slightly saturates and brightens to make neon glow pop. */
export function computeEmissiveColor(color: number): THREE.Color {
  const c = new THREE.Color(color);
  c.getHSL(_hsl);
  // Boost saturation and lightness for glow
  c.setHSL(_hsl.h, Math.min(_hsl.s * 1.2, 1), Math.min(_hsl.l * 1.3, 0.85));
  return c;
}

/** Compute luminance-based dark boost — darker player colors get stronger emissive
 *  to stay visible against the dark arena. */
export function computeDarkBoost(color: number): { lum: number; darkBoost: number } {
  const c = new THREE.Color(color);
  const lum = c.getHSL(_hsl).l;
  // darkBoost ramps from 0 (bright colors) to ~1 (very dark colors)
  const darkBoost = Math.max(0, 1 - lum * 2);
  return { lum, darkBoost };
}

/** Shared in-game visibility tuning for vehicles with darker body materials.
 *  Keeps bright colors close to baseline while giving dark hues a stronger boost. */
export function computeVehicleVisibilityBoost(color: number): { lum: number; darkBoost: number; visibilityBoost: number } {
  const { lum, darkBoost } = computeDarkBoost(color);
  const visibilityBoost = 1 + darkBoost * 0.45 + darkBoost * darkBoost * 0.35;
  return { lum, darkBoost, visibilityBoost };
}

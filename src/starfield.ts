import * as THREE from 'three';

// ── Star Texture ────────────────────────────────────────
// 64x64 composite: tight Gaussian core + wide Lorentzian halo.
// Real PSFs follow inverse-power-law tails — the Lorentzian term
// gives stars an extended ethereal glow that Gaussian alone misses.

export function createStarTexture(resolution = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d')!;

  const half = resolution / 2;
  const imageData = ctx.createImageData(resolution, resolution);
  const data = imageData.data;

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const dx = (x - half + 0.5) / half;
      const dy = (y - half + 0.5) / half;
      const r2 = dx * dx + dy * dy;

      const core = Math.exp(-r2 * 5.0);               // tight Gaussian
      const halo = 1.0 / (1.0 + r2 * 10.0);           // Lorentzian wings
      const alpha = Math.min(1, core * 0.65 + halo * 0.35);

      const idx = (y * resolution + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ── Star Size (power-law distribution) ──────────────────
// Cubic falloff: ~70% tiny (0.15-0.5), ~25% medium (0.5-1.5), ~5% hero (1.5-3.5)

export function starSize(): number {
  const raw = Math.pow(Math.random(), 2.5);
  return 0.3 + raw * 3.7;
}

// ── Blackbody Color Temperature ─────────────────────────
// Tanner Helland algorithm (R² > 0.987 fit to CIE color matching).
// Maps Kelvin (1000-40000) to linear RGB [0,1].

export function blackbodyToRGB(tempK: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, tempK)) / 100;
  let r: number, g: number, b: number;

  if (t <= 66) {
    r = 1.0;
    g = 0.39008157876902 * Math.log(t) - 0.63184144378863;
  } else {
    const t60 = t - 60;
    r = 1.29293618606275 * Math.pow(t60, -0.1332047592);
    g = 1.12989086089529 * Math.pow(t60, -0.0755148492);
  }

  if (t >= 66) b = 1.0;
  else if (t <= 19) b = 0.0;
  else b = 0.54320678911020 * Math.log(t - 10) - 1.19625408914;

  return [
    Math.max(0, Math.min(1, r)),
    Math.max(0, Math.min(1, g)),
    Math.max(0, Math.min(1, b)),
  ];
}

// ── Star Temperature ────────────────────────────────────
// Weighted random temperature. Larger stars skew hotter (bluer).
// 5% cyberpunk accents return sentinel -1 (caller applies hand-tuned color).

export function starTemperature(size: number): number {
  const accent = Math.random();
  if (accent < 0.025) return -1;  // teal accent sentinel
  if (accent < 0.05) return -2;   // purple accent sentinel

  // Size-biased bucket selection: bigger stars more likely to be hot
  const sizeBias = (size - 0.15) / 3.35; // 0→1
  const roll = Math.random() * (1 + sizeBias * 0.6);

  if (roll < 0.35) return 3000 + Math.random() * 1500;       // cool: orange-amber
  if (roll < 0.65) return 4500 + Math.random() * 1500;       // warm: yellow-white
  if (roll < 0.85) return 6000 + Math.random() * 2000;       // neutral: white
  return 8000 + Math.random() * 7000;                        // hot: blue-white
}

// ── Star Color (unified) ────────────────────────────────
// Returns RGB for a star given its temperature and brightness.

export function starColor(brightness: number, size = 1.0): [number, number, number] {
  const temp = starTemperature(size);

  if (temp === -1) {
    // Teal accent
    const b = brightness;
    return [0.6 * b + 0.2, 0.85 * b + 0.1, 0.95 * b + 0.05];
  }
  if (temp === -2) {
    // Purple accent
    const b = brightness;
    return [0.8 * b + 0.15, 0.55 * b + 0.1, 0.9 * b + 0.05];
  }

  return blackbodyToRGB(temp);
}

// ── Shader Source ────────────────────────────────────────

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aBrightness;
  attribute float aPhase;
  attribute float aFreq;

  uniform float uTime;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vBrightness;
  varying float vPhase;

  void main() {
    vColor = color;
    vPhase = aPhase;

    // Multi-frequency scintillation — 3 incommensurate sine waves
    float t1 = sin(uTime * aFreq * 1.0 + aPhase);
    float t2 = sin(uTime * aFreq * 2.37 + aPhase * 1.73);
    float t3 = sin(uTime * aFreq * 0.43 + aPhase * 2.17);
    float twinkle = 0.88 + 0.18 * (t1 * 0.5 + t2 * 0.3 + t3 * 0.2);

    vBrightness = aBrightness * twinkle;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // sizeAttenuation: perspective-based scaling
    gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
    gl_PointSize = max(gl_PointSize, 1.0);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uStarTexture;
  uniform float uTime;

  varying vec3 vColor;
  varying float vBrightness;
  varying float vPhase;

  void main() {
    vec4 texel = texture2D(uStarTexture, gl_PointCoord);

    // Chromatic scintillation on bright stars
    vec3 tinted = vColor;
    if (vBrightness > 0.6) {
      float rShift = sin(uTime * 1.1 + vPhase) * 0.05;
      float bShift = sin(uTime * 1.4 + vPhase * 1.3) * 0.05;
      tinted = vColor + vec3(rShift, 0.0, bShift);
    }

    // Boost intensity — additive blending with a little over-1.0 headroom
    // gives bright cores without clipping the halo
    float intensity = vBrightness * 1.6;
    gl_FragColor = vec4(tinted * intensity, texel.a);
  }
`;

// ── ShaderMaterial Factory ──────────────────────────────

export function createStarMaterial(
  texture: THREE.CanvasTexture,
  pixelRatio: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uStarTexture: { value: texture },
    },
    vertexShader,
    fragmentShader,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

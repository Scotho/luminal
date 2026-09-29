import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d20TwoTone: TrailDesign = {
  name: 'Two-Tone Split',
  description: 'Bottom half dark saturated, top half bright emissive — hard color split like cockpit instruments',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;
    const HALF_H = (wallHeight / 2).toFixed(4);

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${HALF_H}) * 0.5 + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uSplitPoint;
      uniform float uSplitSharpness;
      uniform float uTopBrightness;
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float body = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));
        // Hard split
        float splitMask = smoothstep(uSplitPoint - uSplitSharpness, uSplitPoint + uSplitSharpness, vLocalY);
        vec3 darkHalf = uColor * 0.2;
        vec3 brightHalf = uColor * uTopBrightness;
        vec3 col = mix(darkHalf, brightHalf, splitMask);
        // Fresnel on both halves
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.5);
        col += uColor * fresnel * 0.15;
        gl_FragColor = vec4(col * body, body * 0.7);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:          { value: color.clone() },
        uSplitPoint:     { value: 0.5 },
        uSplitSharpness: { value: 0.05 },
        uTopBrightness:  { value: 1.5 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    const segWidth = wallWidth * 1.3;
    const _mid = new THREE.Vector3();
    const _dir = new THREE.Vector3();

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      _dir.subVectors(b, a);
      const segLen = _dir.length();
      if (segLen < 0.0001) continue;
      _mid.addVectors(a, b).multiplyScalar(0.5);
      _mid.y = wallHeight / 2;
      const geo = new THREE.BoxGeometry(segWidth, wallHeight, segLen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_mid);
      mesh.rotation.y = Math.atan2(_dir.x, _dir.z);
      mesh.renderOrder = 10;
      scene.add(mesh);
      meshes.push(mesh);
    }

    return {
      update(_dt: number): void { /* static — no per-frame updates */ },
      dispose(): void {
        for (const m of meshes) { scene.remove(m); m.geometry.dispose(); }
        mat.dispose();
        meshes.length = 0;
      },
      params: {
        splitPoint: {
          value: 0.5, min: 0.2, max: 0.8, step: 0.02,
          onChange(v: number) { mat.uniforms['uSplitPoint'].value = v; },
        },
        splitSharpness: {
          value: 0.05, min: 0.01, max: 0.3, step: 0.01,
          onChange(v: number) { mat.uniforms['uSplitSharpness'].value = v; },
        },
        topBrightness: {
          value: 1.5, min: 0.5, max: 4.0, step: 0.1,
          onChange(v: number) { mat.uniforms['uTopBrightness'].value = v; },
        },
      },
    };
  },
};

export default d20TwoTone;

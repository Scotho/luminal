import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d21NoiseTurbulence: TrailDesign = {
  name: 'Noise Turbulence',
  description: 'Procedural noise distorts brightness — organic energy turbulence flowing through the wall',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const HALF_H = (wallHeight / 2).toFixed(4);

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${HALF_H}) * 0.5 + 0.5;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uNoiseScale;
      uniform float uNoiseStrength;
      varying float vLocalY;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      // Simple 3D hash noise
      float hash(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }

      float noise3d(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                       mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                       mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
      }

      void main() {
        float body = smoothstep(0.0, 0.05, vLocalY) * (1.0 - smoothstep(0.93, 1.0, vLocalY));

        vec3 noisePos = vWorldPos * uNoiseScale + vec3(uTime * 0.3, uTime * 0.15, 0.0);
        float n = noise3d(noisePos) * 2.0 - 1.0;
        float turbulence = 1.0 + n * uNoiseStrength;

        float heightGrad = 0.4 + 0.6 * smoothstep(0.1, 0.85, vLocalY);
        float topEdge = smoothstep(0.7, 0.93, vLocalY) * 0.4;

        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.0);

        vec3 col = uColor * heightGrad * turbulence + uColor * (topEdge + fresnel * 0.15);
        gl_FragColor = vec4(col, body * 0.6);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:         { value: color.clone() },
        uTime:          { value: 0 },
        uNoiseScale:    { value: 1.5 },
        uNoiseStrength: { value: 0.4 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];

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
      geometries.push(geo);
    }

    let elapsed = 0;

    return {
      update(dt: number): void {
        elapsed += dt;
        mat.uniforms['uTime'].value = elapsed;
      },

      dispose(): void {
        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        mat.dispose();
        meshes.length = 0;
        geometries.length = 0;
      },

      params: {
        noiseScale: {
          value: 1.5,
          min: 0.3,
          max: 5.0,
          step: 0.1,
          onChange(v: number) { mat.uniforms['uNoiseScale'].value = v; },
        },
        noiseStrength: {
          value: 0.4,
          min: 0.0,
          max: 1.0,
          step: 0.05,
          onChange(v: number) { mat.uniforms['uNoiseStrength'].value = v; },
        },
      },
    };
  },
};

export default d21NoiseTurbulence;

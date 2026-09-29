import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d16HoloScan: TrailDesign = {
  name: 'Holographic Scan',
  description: 'Animated horizontal scan lines sweep upward through the trail — holographic display feel',
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
      uniform float uTime;
      uniform float uScanCount;
      uniform float uScanWidth;
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        float body = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));

        // Scan lines sweeping upward
        float scanPhase = fract(vLocalY * uScanCount - uTime * 0.8);
        float scanLine = smoothstep(0.0, uScanWidth, scanPhase) * (1.0 - smoothstep(uScanWidth, uScanWidth * 2.0, scanPhase));

        // Base brightness + scan line boost
        float brightness = 0.35 + scanLine * 0.65;

        // Height gradient
        float heightGrad = 0.5 + 0.5 * vLocalY;

        // Fresnel
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.0);

        vec3 col = uColor * brightness * heightGrad;
        col += uColor * fresnel * 0.15;

        gl_FragColor = vec4(col, body * 0.65);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:     { value: color.clone() },
        uTime:      { value: 0 },
        uScanCount: { value: 8.0 },
        uScanWidth: { value: 0.12 },
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
        scanCount: {
          value: 8.0,
          min: 2,
          max: 20,
          step: 1,
          onChange(v: number) { mat.uniforms['uScanCount'].value = v; },
        },
        scanWidth: {
          value: 0.12,
          min: 0.02,
          max: 0.4,
          step: 0.01,
          onChange(v: number) { mat.uniforms['uScanWidth'].value = v; },
        },
      },
    };
  },
};

export default d16HoloScan;

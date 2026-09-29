import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d14PulseEnergy: TrailDesign = {
  name: 'Pulsing Energy',
  description: 'Animated energy waves flow along trail length — living light wall',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying float vLocalX;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${(wallHeight / 2).toFixed(4)}) + 0.5;
        vLocalX = position.x + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uPulseSpeed;
      uniform float uPulseIntensity;
      varying float vLocalY;
      varying float vLocalX;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        float body = smoothstep(0.0, 0.05, vLocalY) * (1.0 - smoothstep(0.93, 1.0, vLocalY));
        float wave1 = sin(vLocalX * 6.28 * 3.0 - uTime * uPulseSpeed) * 0.5 + 0.5;
        float wave2 = sin(vLocalX * 6.28 * 7.0 + uTime * uPulseSpeed * 1.3) * 0.5 + 0.5;
        float wave3 = sin(vLocalY * 6.28 * 2.0 + uTime * uPulseSpeed * 0.7) * 0.5 + 0.5;
        float energy = 0.6 + uPulseIntensity * (wave1 * 0.3 + wave2 * 0.15 + wave3 * 0.1);
        float heightGrad = 0.5 + 0.5 * smoothstep(0.1, 0.85, vLocalY);
        float topEdge = smoothstep(0.7, 0.92, vLocalY) * 0.5;
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.5);
        vec3 col = uColor * (heightGrad + topEdge) * energy;
        col += uColor * fresnel * 0.2;
        gl_FragColor = vec4(col, body * 0.6);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:          { value: color.clone() },
        uTime:           { value: 0 },
        uPulseSpeed:     { value: 2.0 },
        uPulseIntensity: { value: 0.5 },
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
        pulseSpeed: {
          value: 2.0,
          min: 0.5,
          max: 6.0,
          step: 0.1,
          onChange(v: number) { mat.uniforms['uPulseSpeed'].value = v; },
        },
        pulseIntensity: {
          value: 0.5,
          min: 0.0,
          max: 1.5,
          step: 0.05,
          onChange(v: number) { mat.uniforms['uPulseIntensity'].value = v; },
        },
      },
    };
  },
};

export default d14PulseEnergy;

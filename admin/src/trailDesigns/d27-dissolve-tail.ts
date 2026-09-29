import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d27DissolveTail: TrailDesign = {
  name: 'Dissolve Tail',
  description: 'Trail dissolves from back to front with noise — energy dissipation at the tail end',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const HALF_H = (wallHeight / 2).toFixed(4);

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying vec3 vWorldPos;
      void main() {
        vLocalY = (position.y / ${HALF_H}) * 0.5 + 0.5;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uAge;
      uniform float uDissolveStart;
      varying float vLocalY;
      varying vec3 vWorldPos;

      float hash2d(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        float body = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));

        float dissolveAmount = smoothstep(uDissolveStart, 0.0, uAge);
        float noise = hash2d(vWorldPos.xz * 8.0);
        if (noise < dissolveAmount) discard;

        float heightGrad = 0.5 + 0.5 * vLocalY;
        vec3 col = uColor * heightGrad * (0.6 + 0.4 * uAge);

        gl_FragColor = vec4(col, body * 0.65);
      }
    `;

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.ShaderMaterial[] = [];

    const segWidth = wallWidth * 1.2;
    const total = path.length - 1;
    const _mid = new THREE.Vector3();
    const _dir = new THREE.Vector3();

    // dissolveStart tunable — shared reference value, written into each mat
    let dissolveStart = 0.4;

    for (let i = 0; i < total; i++) {
      const a = path[i];
      const b = path[i + 1];

      _dir.subVectors(b, a);
      const segLen = _dir.length();
      if (segLen < 0.0001) continue;

      // i=0 is oldest (tail), i=total-1 is newest (head)
      const age = total > 1 ? i / (total - 1) : 1.0;

      _mid.addVectors(a, b).multiplyScalar(0.5);
      _mid.y = wallHeight / 2;

      const mat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor:         { value: color.clone() },
          uAge:           { value: age },
          uDissolveStart: { value: dissolveStart },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const geo = new THREE.BoxGeometry(segWidth, wallHeight, segLen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_mid);
      mesh.rotation.y = Math.atan2(_dir.x, _dir.z);
      mesh.renderOrder = 10;
      scene.add(mesh);
      meshes.push(mesh);
      geometries.push(geo);
      materials.push(mat);
    }

    return {
      update(_dt: number): void {
        // static dissolve — no per-frame update needed
      },

      dispose(): void {
        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        for (const mat of materials) mat.dispose();
        meshes.length = 0;
        geometries.length = 0;
        materials.length = 0;
      },

      params: {
        dissolveStart: {
          value: 0.4,
          min: 0.0,
          max: 1.0,
          step: 0.05,
          onChange(v: number) {
            dissolveStart = v;
            for (const mat of materials) mat.uniforms['uDissolveStart'].value = v;
          },
        },
      },
    };
  },
};

export default d27DissolveTail;

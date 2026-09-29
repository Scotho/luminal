import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const design: TrailDesign = {
  name: 'Fresnel Glass',
  description: 'Glass-like trail with strong fresnel — transparent when facing camera, bright at edges',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const halfH = (wallHeight / 2).toFixed(4);

    const vertexShader = /* glsl */`
      varying vec3 vNormal; varying vec3 vViewDir; varying float vLocalY;
      void main() {
        vLocalY = (position.y / ${halfH}) * 0.5 + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor; uniform float uFresnelPower; uniform float uFresnelBias; uniform float uBaseAlpha;
      varying vec3 vNormal; varying vec3 vViewDir; varying float vLocalY;
      void main() {
        float bodyFill = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.94, 1.0, vLocalY));
        float fresnel = uFresnelBias + (1.0 - uFresnelBias) * pow(1.0 - abs(dot(vViewDir, vNormal)), uFresnelPower);
        vec3 col = uColor * (0.2 + 0.8 * fresnel) * 1.3;
        col += uColor * smoothstep(0.7, 0.95, vLocalY) * 0.5;
        gl_FragColor = vec4(col, bodyFill * mix(uBaseAlpha, 0.9, fresnel));
      }
    `;

    const uniforms = {
      uColor:        { value: color.clone() },
      uFresnelPower: { value: 3.0 },
      uFresnelBias:  { value: 0.1 },
      uBaseAlpha:    { value: 0.15 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];

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

      const angle = Math.atan2(_dir.x, _dir.z);

      const geo = new THREE.BoxGeometry(wallWidth * 1.2, wallHeight, segLen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_mid);
      mesh.rotation.y = angle;
      scene.add(mesh);
      meshes.push(mesh);
      geometries.push(geo);
    }

    return {
      update(_dt: number): void { /* view-dependent only, no animation */ },

      dispose(): void {
        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        mat.dispose();
        meshes.length = 0;
        geometries.length = 0;
      },

      params: {
        fresnelPower: {
          value: 3.0,
          min: 1.0,
          max: 8.0,
          step: 0.1,
          onChange(v: number) { uniforms.uFresnelPower.value = v; },
        },
        fresnelBias: {
          value: 0.1,
          min: 0.0,
          max: 0.5,
          step: 0.02,
          onChange(v: number) { uniforms.uFresnelBias.value = v; },
        },
        baseAlpha: {
          value: 0.15,
          min: 0.0,
          max: 0.5,
          step: 0.02,
          onChange(v: number) { uniforms.uBaseAlpha.value = v; },
        },
      },
    };
  },
};

export default design;

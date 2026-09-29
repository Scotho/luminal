import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d03ShaderWall: TrailDesign = {
  name: 'Custom Shader Wall',
  description: 'Pure ShaderMaterial with edge glow, height gradient, and fresnel — no standard lighting',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${(wallHeight / 2).toFixed(4)}) + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uEdgePower;
      uniform float uFresnelPower;
      uniform float uAlpha;
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        float heightGrad = 0.4 + 0.6 * smoothstep(0.1, 0.9, vLocalY);
        float topEdge = smoothstep(0.6, 0.92, vLocalY);
        float bodyFill = smoothstep(0.0, 0.05, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), uFresnelPower);
        float flow = 0.97 + 0.03 * sin(vLocalY * 6.28 + uTime * 1.5);

        vec3 col = uColor * heightGrad * (1.0 + topEdge * uEdgePower) * flow;
        col += uColor * fresnel * 0.3;

        float alpha = bodyFill * uAlpha * (0.6 + 0.4 * heightGrad);
        gl_FragColor = vec4(col, alpha);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:        { value: color.clone() },
        uTime:         { value: 0 },
        uEdgePower:    { value: 0.8 },
        uFresnelPower: { value: 2.5 },
        uAlpha:        { value: 0.6 },
      },
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

      const geo = new THREE.BoxGeometry(wallWidth, wallHeight, segLen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_mid);
      mesh.rotation.y = angle;
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
        edgePower: {
          value: 0.8,
          min: 0,
          max: 3,
          step: 0.1,
          onChange(v: number) { mat.uniforms['uEdgePower'].value = v; },
        },
        fresnelPower: {
          value: 2.5,
          min: 1,
          max: 5,
          step: 0.1,
          onChange(v: number) { mat.uniforms['uFresnelPower'].value = v; },
        },
        alpha: {
          value: 0.6,
          min: 0.1,
          max: 1.0,
          step: 0.05,
          onChange(v: number) { mat.uniforms['uAlpha'].value = v; },
        },
      },
    };
  },
};

export default d03ShaderWall;

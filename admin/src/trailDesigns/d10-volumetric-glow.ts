import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const design: TrailDesign = {
  name: 'Volumetric Glow',
  description: 'ShaderMaterial simulating volumetric light — brighter at center, falloff to edges on all axes',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const halfH = (wallHeight / 2).toFixed(4);
    const halfW = (wallWidth * 1.3 / 2).toFixed(4);

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDepth;

      void main() {
        vLocalY = (position.y / ${halfH}) * 0.5 + 0.5;
        vDepth = abs(position.z) / ${halfW};
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uFalloff;
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDepth;

      void main() {
        // Vertical falloff: brightest at center height, fading top/bottom
        float yCenterDist = abs(vLocalY - 0.5) * 2.0;
        float yFalloff = 1.0 - pow(yCenterDist, uFalloff);

        // Body fill
        float bodyFill = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));

        // Top edge accent
        float topEdge = smoothstep(0.75, 0.93, vLocalY) * 0.6;

        // Energy pulse
        float energy = 0.96 + 0.04 * sin(vLocalY * 5.0 + uTime * 1.5);

        vec3 col = uColor * (yFalloff + topEdge) * uIntensity * energy;

        // Fresnel enhancement
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.0);
        col += uColor * fresnel * 0.2;

        float alpha = bodyFill * yFalloff * 0.7;
        gl_FragColor = vec4(col, alpha);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:     { value: color.clone() },
        uTime:      { value: 0 },
        uIntensity: { value: 1.2 },
        uFalloff:   { value: 1.5 },
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

      const geo = new THREE.BoxGeometry(wallWidth * 1.3, wallHeight, segLen);
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
        intensity: {
          value: 1.2,
          min: 0.3,
          max: 4.0,
          step: 0.1,
          onChange(v: number) { mat.uniforms['uIntensity'].value = v; },
        },
        falloff: {
          value: 1.5,
          min: 0.5,
          max: 4.0,
          step: 0.1,
          onChange(v: number) { mat.uniforms['uFalloff'].value = v; },
        },
      },
    };
  },
};

export default design;

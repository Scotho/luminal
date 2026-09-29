import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d24StripePattern: TrailDesign = {
  name: 'Racing Stripes',
  description: 'Horizontal stripes with alternating bright/dark bands — circuit board trace aesthetic',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const HALF_H = wallHeight / 2;

    const vertexShader = /* glsl */`
      varying float vLocalY; varying vec3 vNormal; varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${HALF_H.toFixed(4)}) + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor; uniform float uTime;
      uniform float uStripeCount; uniform float uStripeDuty; uniform float uScrollSpeed;
      varying float vLocalY; varying vec3 vNormal; varying vec3 vViewDir;
      void main() {
        float body = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));
        float stripePhase = fract(vLocalY * uStripeCount + uTime * uScrollSpeed);
        float brightness = mix(0.15, 1.0, step(stripePhase, uStripeDuty));
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.5);
        vec3 col = uColor * brightness * (0.6 + 0.4 * vLocalY);
        col += uColor * fresnel * 0.2;
        gl_FragColor = vec4(col, body * 0.65);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor:       { value: color.clone() },
        uTime:        { value: 0 },
        uStripeCount: { value: 6 },
        uStripeDuty:  { value: 0.5 },
        uScrollSpeed: { value: 0.3 },
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
      _mid.y = HALF_H;

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
    const u = mat.uniforms;

    return {
      update(dt: number): void { elapsed += dt; u['uTime'].value = elapsed; },
      dispose(): void {
        for (const m of meshes) scene.remove(m);
        for (const g of geometries) g.dispose();
        mat.dispose(); meshes.length = 0; geometries.length = 0;
      },
      params: {
        stripeCount: { value: 6,   min: 2,   max: 20,  step: 1,    onChange(v: number) { u['uStripeCount'].value = v; } },
        stripeDuty:  { value: 0.5, min: 0.1, max: 0.9, step: 0.05, onChange(v: number) { u['uStripeDuty'].value  = v; } },
        scrollSpeed: { value: 0.3, min: 0,   max: 2,   step: 0.1,  onChange(v: number) { u['uScrollSpeed'].value = v; } },
      },
    };
  },
};

export default d24StripePattern;

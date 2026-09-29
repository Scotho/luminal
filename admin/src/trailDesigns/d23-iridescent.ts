import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const design: TrailDesign = {
  name: 'Iridescent Shift',
  description: 'View-angle dependent color shift — the trail shimmers between hues like oil on water',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const halfH = (wallHeight / 2).toFixed(4);

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${halfH}) * 0.5 + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uHueShift;
      uniform float uFresnelPower;
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
        vec4 p = mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
        vec4 q = mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
        float d=q.x-min(q.w,q.y); float e=1.0e-10;
        return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)),d/(q.x+e),q.x);
      }

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0,2.0/3.0,1.0/3.0,3.0);
        vec3 p = abs(fract(c.xxx+K.xyz)*6.0-K.www);
        return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);
      }

      void main() {
        float body = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), uFresnelPower);

        vec3 hsv = rgb2hsv(uColor);
        hsv.x += fresnel * uHueShift / 360.0;
        vec3 shiftedColor = hsv2rgb(hsv);

        vec3 col = mix(uColor, shiftedColor, fresnel) * (0.5 + 0.5 * smoothstep(0.1, 0.8, vLocalY));
        col += shiftedColor * fresnel * 0.4;

        float topEdge = smoothstep(0.75, 0.93, vLocalY) * 0.3;
        col += uColor * topEdge;

        gl_FragColor = vec4(col, body * 0.65);
      }
    `;

    const uniforms = {
      uColor:        { value: color.clone() },
      uHueShift:     { value: 45.0 },
      uFresnelPower: { value: 2.5 },
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

      const geo = new THREE.BoxGeometry(wallWidth * 1.3, wallHeight, segLen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_mid);
      mesh.rotation.y = Math.atan2(_dir.x, _dir.z);
      mesh.renderOrder = 10;
      scene.add(mesh);
      meshes.push(mesh);
      geometries.push(geo);
    }

    return {
      update(_dt: number): void { /* view-dependent only — no per-frame animation needed */ },

      dispose(): void {
        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        mat.dispose();
        meshes.length = 0;
        geometries.length = 0;
      },

      params: {
        hueShift: {
          value: 45,
          min: 0,
          max: 180,
          step: 5,
          onChange(v: number) { uniforms.uHueShift.value = v; },
        },
        fresnelPower: {
          value: 2.5,
          min: 1,
          max: 6,
          step: 0.1,
          onChange(v: number) { uniforms.uFresnelPower.value = v; },
        },
      },
    };
  },
};

export default design;

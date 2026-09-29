import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d29Blacklight: TrailDesign = {
  name: 'Blacklight UV',
  description: 'Dark body that fluoresces under blacklight — only edges and highlights glow intensely',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;
    const HALF_H = `${(wallHeight / 2).toFixed(4)}`;

    const vertexShader = /* glsl */`
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${HALF_H}) * 0.5 + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }`;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor;
      uniform float uFluorescence;
      uniform float uDarkness;
      varying float vLocalY;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float body = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));
        vec3 darkBase = uColor * uDarkness;
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.0);
        float topGlow = smoothstep(0.75, 0.95, vLocalY);
        float bottomGlow = (1.0 - smoothstep(0.0, 0.15, vLocalY)) * 0.3;
        float fluorescent = max(fresnel, max(topGlow, bottomGlow));
        vec3 col = mix(darkBase, uColor * uFluorescence, fluorescent);
        gl_FragColor = vec4(col, body * 0.75);
      }`;

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.ShaderMaterial[] = [];
    const segWidth = wallWidth * 1.3;
    const _mid = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    let fluorescence = 1.5;
    let darkness = 0.05;

    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      _dir.subVectors(b, a);
      const segLen = _dir.length();
      if (segLen < 0.0001) continue;
      _mid.addVectors(a, b).multiplyScalar(0.5);
      _mid.y = wallHeight / 2;
      const mat = new THREE.ShaderMaterial({
        vertexShader, fragmentShader,
        uniforms: {
          uColor:        { value: color.clone() },
          uFluorescence: { value: fluorescence },
          uDarkness:     { value: darkness },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
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
      update(_dt: number): void { /* static geometry */ },
      dispose(): void {
        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        for (const mat of materials) mat.dispose();
        meshes.length = 0;
        geometries.length = 0;
        materials.length = 0;
      },
      params: {
        fluorescence: {
          value: 1.5, min: 0.5, max: 4.0, step: 0.1,
          onChange(v: number) {
            fluorescence = v;
            for (const mat of materials) mat.uniforms['uFluorescence'].value = v;
          },
        },
        darkness: {
          value: 0.05, min: 0.0, max: 0.3, step: 0.01,
          onChange(v: number) {
            darkness = v;
            for (const mat of materials) mat.uniforms['uDarkness'].value = v;
          },
        },
      },
    };
  },
};

export default d29Blacklight;

import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const design: TrailDesign = {
  name: 'Edge Detect Glow',
  description: 'Inverted fresnel: opaque when edge-on, transparent when facing — shows only the silhouette edges',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const halfH = (wallHeight / 2).toFixed(4);

    const vertexShader = /* glsl */`
      varying float vLocalY; varying vec3 vNormal; varying vec3 vViewDir;
      void main() {
        vLocalY = (position.y / ${halfH}) * 0.5 + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform vec3 uColor; uniform float uEdgeWidth; uniform float uMinAlpha;
      varying float vLocalY; varying vec3 vNormal; varying vec3 vViewDir;
      void main() {
        float body = smoothstep(0.0, 0.03, vLocalY) * (1.0 - smoothstep(0.96, 1.0, vLocalY));

        // Edge detection: visible at edges, transparent when facing
        float facing = abs(dot(vViewDir, vNormal));
        float edge = pow(1.0 - facing, uEdgeWidth);

        // Top edge always visible
        float topAccent = smoothstep(0.8, 0.95, vLocalY);

        vec3 col = uColor * (edge + topAccent * 0.5) * 1.2;
        float alpha = body * max(edge, topAccent + uMinAlpha);

        gl_FragColor = vec4(col, alpha);
      }
    `;

    const uniforms = {
      uColor:     { value: color.clone() },
      uEdgeWidth: { value: 2.0 },
      uMinAlpha:  { value: 0.05 },
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

      const geo = new THREE.BoxGeometry(wallWidth * 1.5, wallHeight, segLen);
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
        edgeWidth: {
          value: 2.0,
          min: 0.5,
          max: 5.0,
          step: 0.1,
          onChange(v: number) { uniforms.uEdgeWidth.value = v; },
        },
        minAlpha: {
          value: 0.05,
          min: 0.0,
          max: 0.3,
          step: 0.01,
          onChange(v: number) { uniforms.uMinAlpha.value = v; },
        },
      },
    };
  },
};

export default design;

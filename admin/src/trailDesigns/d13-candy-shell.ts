import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

function buildSegments(
  path: THREE.Vector3[],
  width: number,
  height: number,
  material: THREE.Material,
  renderOrder: number,
  scene: THREE.Scene,
  out: THREE.Mesh[],
): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    if (length < 0.001) continue;
    const geo = new THREE.BoxGeometry(width, height, length);
    const mesh = new THREE.Mesh(geo, material);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.lookAt(b);
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Candy Shell',
  description: 'Hard glossy outer shell over soft inner glow — like resin over light',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;
    const halfH = `${(wallHeight / 2).toFixed(4)}`;

    const innerVert = /* glsl */`
      varying float vLocalY;
      void main() {
        vLocalY = (position.y / ${halfH}) * 0.5 + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const innerFrag = /* glsl */`
      uniform vec3  uColor;
      uniform float uGlowIntensity;
      varying float vLocalY;
      void main() {
        float body = smoothstep(0.02, 0.15, vLocalY) * (1.0 - smoothstep(0.85, 1.0, vLocalY));
        vec3 col = uColor * uGlowIntensity * body;
        gl_FragColor = vec4(col, body * 0.5);
      }
    `;
    const innerUniforms = {
      uColor:         { value: color.clone() },
      uGlowIntensity: { value: 1.5 },
    };
    const innerMat = new THREE.ShaderMaterial({
      uniforms: innerUniforms,
      vertexShader: innerVert,
      fragmentShader: innerFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const outerVert = /* glsl */`
      varying float vLocalY;
      varying vec3  vNormal;
      varying vec3  vViewDir;
      void main() {
        vLocalY = (position.y / ${halfH}) * 0.5 + 0.5;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = -normalize(mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `;
    const outerFrag = /* glsl */`
      uniform vec3  uColor;
      uniform float uShellAlpha;
      uniform float uFresnelStr;
      varying float vLocalY;
      varying vec3  vNormal;
      varying vec3  vViewDir;
      void main() {
        float body    = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.94, 1.0, vLocalY));
        float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 3.0);
        vec3  col     = uColor * (0.15 + fresnel * uFresnelStr);
        float topEdge = smoothstep(0.75, 0.93, vLocalY);
        col += uColor * topEdge * 0.4;
        gl_FragColor  = vec4(col, body * (uShellAlpha + fresnel * 0.3));
      }
    `;
    const outerUniforms = {
      uColor:      { value: color.clone() },
      uShellAlpha: { value: 0.3 },
      uFresnelStr: { value: 0.8 },
    };
    const outerMat = new THREE.ShaderMaterial({
      uniforms: outerUniforms,
      vertexShader: outerVert,
      fragmentShader: outerFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    buildSegments(path, wallWidth * 0.8, wallHeight, innerMat, 9,  scene, meshes);
    buildSegments(path, wallWidth * 1.3, wallHeight, outerMat, 10, scene, meshes);

    const params: TrailDesignInstance['params'] = {
      glowIntensity: {
        value: 1.5, min: 0.3, max: 4.0, step: 0.1,
        onChange(v: number) { innerUniforms.uGlowIntensity.value = v; },
      },
      shellAlpha: {
        value: 0.3, min: 0.05, max: 0.8, step: 0.05,
        onChange(v: number) { outerUniforms.uShellAlpha.value = v; },
      },
      fresnelStr: {
        value: 0.8, min: 0.1, max: 2.0, step: 0.05,
        onChange(v: number) { outerUniforms.uFresnelStr.value = v; },
      },
    };

    return {
      update(_dt: number): void { /* view-dependent fresnel — no time animation needed */ },
      dispose(): void {
        for (const mesh of meshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        innerMat.dispose();
        outerMat.dispose();
        meshes.length = 0;
      },
      params,
    };
  },
};

export default design;

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

const BODY_VERT = /* glsl */`
varying float vLocalY;
void main() {
  // position.y ranges from -height/2 to +height/2; remap to 0..1
  vLocalY = clamp(position.y + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BODY_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
varying float vLocalY;
void main() {
  float bodyFill = smoothstep(0.0, 0.04, vLocalY) * (1.0 - smoothstep(0.92, 1.0, vLocalY));
  float heightGrad = 0.45 + 0.55 * smoothstep(0.05, 0.8, vLocalY);
  vec3 col = uColor * heightGrad;
  gl_FragColor = vec4(col, bodyFill * uAlpha);
}
`;
const EDGE_VERT = /* glsl */`
varying float vLocalY;
void main() {
  vLocalY = clamp(position.y + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const EDGE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uBright;
uniform float uTime;
varying float vLocalY;
void main() {
  float edgeMask = smoothstep(0.60, 0.90, vLocalY) * (1.0 - smoothstep(0.95, 1.0, vLocalY));
  float pulse = 0.95 + 0.05 * sin(uTime * 2.0);
  vec3 col = uColor * uBright * pulse;
  gl_FragColor = vec4(col, edgeMask * 0.6);
}
`;

const design: TrailDesign = {
  name: 'Dual Shader Split',
  description: 'Two ShaderMaterial layers: opaque saturated body + additive bright edge crown',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    let time = 0;

    const bodyUniforms = {
      uColor: { value: color.clone() },
      uAlpha: { value: 0.7 },
    };

    const edgeUniforms = {
      uColor: { value: color.clone() },
      uBright: { value: 1.5 },
      uTime: { value: 0 },
    };

    const bodyMat = new THREE.ShaderMaterial({
      uniforms: bodyUniforms,
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    const edgeMat = new THREE.ShaderMaterial({
      uniforms: edgeUniforms,
      vertexShader: EDGE_VERT,
      fragmentShader: EDGE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];

    buildSegments(path, wallWidth * 1.3, wallHeight, bodyMat, 9, scene, meshes);
    buildSegments(path, wallWidth * 0.8, wallHeight, edgeMat, 10, scene, meshes);

    const params: TrailDesignInstance['params'] = {
      bodyAlpha: {
        value: 0.7,
        min: 0.2,
        max: 1.0,
        step: 0.05,
        onChange(v) {
          bodyUniforms.uAlpha.value = v;
        },
      },
      edgeBright: {
        value: 1.5,
        min: 0.5,
        max: 4.0,
        step: 0.1,
        onChange(v) {
          edgeUniforms.uBright.value = v;
        },
      },
    };

    return {
      update(dt: number) {
        time += dt;
        edgeUniforms.uTime.value = time;
      },
      dispose() {
        for (const mesh of meshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        bodyMat.dispose();
        edgeMat.dispose();
        meshes.length = 0;
      },
      params,
    };
  },
};

export default design;

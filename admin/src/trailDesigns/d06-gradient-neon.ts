import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

const VERT = /* glsl */`
varying float vLocalY;
uniform float uHalfHeight;
void main() {
  vLocalY = (position.y / uHalfHeight) * 0.5 + 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
varying float vLocalY;

void main() {
  float bodyFill = smoothstep(0.0, 0.03, vLocalY) * (1.0 - smoothstep(0.96, 1.0, vLocalY));

  // Three-zone gradient: dark -> saturated -> bright
  vec3 darkZone = uColor * 0.15;
  vec3 midZone = uColor * uIntensity;
  vec3 brightZone = mix(uColor * 1.5, vec3(1.0), 0.3); // white-hot

  // Blend zones based on height
  vec3 col = mix(darkZone, midZone, smoothstep(0.0, 0.4, vLocalY));
  col = mix(col, brightZone, smoothstep(0.7, 0.95, vLocalY));

  // Subtle energy pulse
  float pulse = 0.97 + 0.03 * sin(vLocalY * 4.0 + uTime * 1.2);
  col *= pulse;

  gl_FragColor = vec4(col * bodyFill, bodyFill * 0.75);
}
`;

function buildSegments(
  path: THREE.Vector3[],
  width: number,
  height: number,
  material: THREE.Material,
  scene: THREE.Scene,
  out: THREE.Mesh[],
): void {
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    dir.subVectors(b, a);
    const length = dir.length();
    if (length < 0.001) continue;

    const geo = new THREE.BoxGeometry(width, height, length);
    const mesh = new THREE.Mesh(geo, material);

    mid.addVectors(a, b).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.lookAt(b);
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = 9;

    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Gradient Map Neon',
  description: 'ShaderMaterial with procedural gradient texture — dark base to bright saturated to white-hot edge',
  category: 'shader',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    let time = 0;
    const halfHeight = wallHeight / 2;

    const uniforms = {
      uColor:      { value: color.clone() },
      uTime:       { value: 0 },
      uIntensity:  { value: 1.0 },
      uHalfHeight: { value: halfHeight },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    buildSegments(path, wallWidth * 1.3, wallHeight, mat, scene, meshes);

    const params: TrailDesignInstance['params'] = {
      intensity: {
        value: 1.0,
        min: 0.3,
        max: 3.0,
        step: 0.1,
        onChange(v: number) { uniforms.uIntensity.value = v; },
      },
      alpha: {
        value: 0.75,
        min: 0.1,
        max: 1.0,
        step: 0.05,
        onChange(_v: number) { /* baked into fragment as bodyFill * 0.75 */ },
      },
    };

    return {
      update(dt: number): void {
        time += dt;
        uniforms.uTime.value = time;
      },

      dispose(): void {
        for (const mesh of meshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
        mat.dispose();
        meshes.length = 0;
      },

      params,
    };
  },
};

export default design;

import * as THREE from 'three';

const MAX_PARTICLES = 50;
const PARTICLE_LIFETIME = 0.2;

interface Particle {
  alive: boolean;
  age: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

export class SparkEmitter {
  private _particles: Particle[] = [];
  private _geometry: THREE.BufferGeometry;
  private _points: THREE.Points;
  private _positions: Float32Array;
  private _opacities: Float32Array;
  private _color: THREE.Color;

  constructor(scene: THREE.Scene, color: number) {
    this._color = new THREE.Color(color);
    this._positions = new Float32Array(MAX_PARTICLES * 3);
    this._opacities = new Float32Array(MAX_PARTICLES);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._particles.push({ alive: false, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    }

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    this._geometry.setAttribute('opacity', new THREE.BufferAttribute(this._opacities, 1));

    const material = new THREE.PointsMaterial({
      color: this._color,
      size: 0.15,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this._points = new THREE.Points(this._geometry, material);
    this._points.frustumCulled = false;
    this._points.visible = false;
    scene.add(this._points);
  }

  /** Emit N sparks at position, shooting perpendicular to direction. */
  emit(x: number, y: number, z: number, dirX: number, dirZ: number, count: number): void {
    this._points.visible = true;
    const perpX = -dirZ;
    const perpZ = dirX;

    for (let i = 0; i < count; i++) {
      const p = this._particles.find(p => !p.alive);
      if (!p) break;
      p.alive = true;
      p.age = 0;
      p.x = x + (Math.random() - 0.5) * 0.2;
      p.y = y + Math.random() * 0.1;
      p.z = z + (Math.random() - 0.5) * 0.2;
      const spread = (Math.random() - 0.5) * 4;
      const up = 1 + Math.random() * 3;
      p.vx = perpX * spread + (Math.random() - 0.5) * 2;
      p.vy = up;
      p.vz = perpZ * spread + (Math.random() - 0.5) * 2;
    }
  }

  update(dt: number): void {
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this._particles[i];
      if (!p.alive) {
        this._opacities[i] = 0;
        continue;
      }
      p.age += dt;
      if (p.age >= PARTICLE_LIFETIME) {
        p.alive = false;
        this._opacities[i] = 0;
        continue;
      }
      anyAlive = true;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 15 * dt; // gravity
      const t = p.age / PARTICLE_LIFETIME;
      this._opacities[i] = 1 - t;
      this._positions[i * 3] = p.x;
      this._positions[i * 3 + 1] = p.y;
      this._positions[i * 3 + 2] = p.z;
    }
    (this._geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this._geometry.attributes.opacity as THREE.BufferAttribute).needsUpdate = true;
    if (!anyAlive) this._points.visible = false;
  }

  setColor(color: number): void {
    this._color.set(color);
    (this._points.material as THREE.PointsMaterial).color.copy(this._color);
  }

  dispose(): void {
    this._geometry.dispose();
    (this._points.material as THREE.Material).dispose();
    this._points.removeFromParent();
  }
}

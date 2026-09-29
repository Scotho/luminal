import * as THREE from 'three';
import type { GeneratorItem } from './Generator';
import type { SynthCityAssets } from './SynthCityAssets';
import { ROAD_WIDTH, TRAFFIC_SPAWN_CHANCE_PER_DIR } from './constants';

const CAR_GEO_IDS = ['car_01', 'car_02', 'car_03', 'car_04', 'car_05', 'car_06', 'car_07', 'car_08'];

/**
 * Flying car streamer — each cell spawns up to 3 directional cars (east / west /
 * north) with a per-direction spawn probability. Cars continuously advance and
 * reverse when they get too far from the reference target (usually the player).
 *
 * Ported from synthcity/src/classes/GeneratorItem_Traffic.js. The reference
 * target is supplied by the builder — the original used window.game.player.
 */
export class GeneratorTraffic implements GeneratorItem {
  private cars: Car[] = [];

  constructor(
    public readonly x: number,
    public readonly z: number,
    private readonly root: THREE.Object3D,
    private readonly assets: SynthCityAssets,
    private readonly getTrackTarget: () => THREE.Vector3,
  ) {
    for (let dir = 0; dir < 3; dir++) {
      if (Math.random() < TRAFFIC_SPAWN_CHANCE_PER_DIR) {
        this.cars.push(new Car(
          dir,
          this.x - ROAD_WIDTH / 2,
          this.z - ROAD_WIDTH / 2,
          this.root,
          this.assets,
          this.getTrackTarget,
        ));
      }
    }
  }

  remove(): void {
    for (const car of this.cars) car.remove();
    this.cars.length = 0;
  }

  update(): void {
    for (const car of this.cars) car.update();
  }
}

class Car {
  private mesh: THREE.Mesh | null;
  private x: number;
  private z: number;
  private alt: number;
  private altOffset: number;
  private speedFactor: number;
  private v = new THREE.Vector2();
  private pos = new THREE.Vector3();

  constructor(
    public readonly dir: number,
    spawnX: number,
    spawnZ: number,
    private readonly root: THREE.Object3D,
    private readonly assets: SynthCityAssets,
    private readonly getTrackTarget: () => THREE.Vector3,
  ) {
    this.x = spawnX;
    this.z = spawnZ;
    this.alt = 0;
    this.altOffset = 0;
    this.speedFactor = 1;

    const geoId = CAR_GEO_IDS[Math.floor(Math.random() * CAR_GEO_IDS.length)];
    const geo = this.assets.getModel(geoId);
    const mat = this.assets.getMaterial('cars');
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(spawnX, 0, spawnZ);
    this.root.add(this.mesh);

    const speed = 1.2;
    if (dir === 0) {
      // east
      this.v.set(speed, 0);
      this.alt = 20;
      this.mesh.rotateY(Math.PI / 2);
      this.x -= Math.floor(Math.random() * 20) * 4;
    } else if (dir === 1) {
      // west
      this.v.set(-speed, 0);
      this.alt = 60;
      this.mesh.rotateY(-Math.PI / 2);
      this.x -= Math.floor(Math.random() * 20) * 4;
    } else if (dir === 2) {
      // north
      this.v.set(0, -speed);
      this.alt = 40;
      this.mesh.rotateY(Math.PI);
      this.mesh.position.z -= Math.random() * 2;
      this.z -= Math.floor(Math.random() * 20) * 4;
    }

    if (Math.random() < 0.5) this.altOffset = 200;
    if (Math.random() < 0.2) {
      this.altOffset = 400;
      this.speedFactor = 2;
    }
  }

  remove(): void {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh = null;
    }
  }

  update(): void {
    if (!this.mesh) return;

    this.x += this.v.x * this.speedFactor;
    this.z += this.v.y * this.speedFactor;
    this.mesh.position.set(this.x, this.alt + this.altOffset, this.z);

    this.pos.set(this.x, this.alt + this.altOffset, this.z);
    const dist = this.pos.distanceTo(this.getTrackTarget());
    if (dist > 1000 + Math.random() * 500) {
      this.v.multiplyScalar(-1);
    }
  }
}

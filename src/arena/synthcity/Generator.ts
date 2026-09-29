import * as THREE from 'three';

// Grid-based streaming spawner, ported from synthcity/src/classes/Generator.js.
//
// Changes from the original JS version:
//   * Takes a `readCameraPosition` callback instead of a bound THREE.Camera so
//     we can feed it virtual synthcity-local coordinates from Luminal's real
//     camera (the root group is translated).
//   * `update()` snaps the grid to the new position with a full reinit when
//     the camera teleports more than cell_count/2 cells in one step. The
//     original JS version had an off-by-cell_count bug where large jumps
//     walked past the end of the grid rows and threw
//     "Cannot read properties of undefined (reading 'length')".
//   * Typed generic over the spawn-obj constructor.

export interface GeneratorItem {
  remove?(): void;
  update?(): void;
}

export interface GeneratorOptions<T extends GeneratorItem> {
  /** Reads the current synthcity-local camera position into `out`. */
  readCameraPosition: (out: THREE.Vector3) => void;
  /** World-space size of one cell. */
  cell_size: number;
  /** Number of cells per side (square grid). */
  cell_count: number;
  /** Factory for a spawned cell — called with world-space (x, z) of the cell. */
  spawn_obj: new (x: number, z: number) => T;
  /** Optional: only spawn cells whose centre is within a distance of the camera
   *  (default: entire grid). */
  debug?: boolean;
}

/** Max cells to spawn per addItems() call. Prevents single-frame spikes
 *  when the entire grid initializes at once (1200+ cells). Remaining cells
 *  are picked up by subsequent update() ticks. */
const CELLS_PER_FRAME = 80;

export class Generator<T extends GeneratorItem> {
  private readCameraPosition: (out: THREE.Vector3) => void;
  private cellSize: number;
  private cellCount: number;
  private SpawnObj: new (x: number, z: number) => T;

  private x = 0;
  private z = 0;
  private px = 0;
  private pz = 0;

  /** True while addItems() hasn't finished filling the grid yet. */
  private _filling = false;

  private grid: Array<Array<T | null>>;
  private scratch = new THREE.Vector3();

  constructor(opts: GeneratorOptions<T>) {
    this.readCameraPosition = opts.readCameraPosition;
    this.cellSize = opts.cell_size;
    this.cellCount = opts.cell_count;
    this.SpawnObj = opts.spawn_obj;

    // Initial grid — empty rows.
    this.grid = new Array<Array<T | null>>(this.cellCount);
    for (let i = 0; i < this.cellCount; i++) {
      this.grid[i] = new Array<T | null>(this.cellCount).fill(null);
    }

    // Seed the grid based on the current camera position.
    this.readCameraPosition(this.scratch);
    this.x = Math.floor(this.scratch.x / this.cellSize);
    this.z = Math.floor(this.scratch.z / this.cellSize);
    this.px = this.x;
    this.pz = this.z;
    this.addItems();
  }

  update(): void {
    this.px = this.x;
    this.pz = this.z;
    this.readCameraPosition(this.scratch);
    this.x = Math.floor(this.scratch.x / this.cellSize);
    this.z = Math.floor(this.scratch.z / this.cellSize);

    // Continue deferred fill from previous addItems() if not finished
    if (this._filling && this.px === this.x && this.pz === this.z) {
      this.addItems();
      this.updateItems();
      return;
    }

    if (this.px === this.x && this.pz === this.z) {
      this.updateItems();
      return;
    }

    const dx = this.px - this.x;
    const dz = this.pz - this.z;
    const limit = Math.floor(this.cellCount / 2);

    if (Math.abs(dx) >= limit || Math.abs(dz) >= limit) {
      // Large teleport: safer to dispose everything and rebuild from scratch.
      this.disposeAll();
      this.grid = new Array<Array<T | null>>(this.cellCount);
      for (let i = 0; i < this.cellCount; i++) {
        this.grid[i] = new Array<T | null>(this.cellCount).fill(null);
      }
      this.addItems();
      this.updateItems();
      return;
    }

    this.removeItems(dx, dz);
    this.shiftGrid(dx, dz);
    this.addItems();
    this.updateItems();
  }

  disposeAll(): void {
    for (let i = 0; i < this.grid.length; i++) {
      const row = this.grid[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (cell && typeof cell.remove === 'function') cell.remove();
        row[j] = null;
      }
    }
  }

  private removeItems(dx: number, dz: number): void {
    // The original JS code walks the grid on the side that's about to leave
    // the window. We preserve its loops verbatim so behaviour is identical,
    // but clamp j against the actual row length (the big-teleport path is
    // already caught in update()).
    const rows = this.grid.length;

    if (dx < 0) {
      for (let i = 0; i < rows; i++) {
        const row = this.grid[i];
        const end = Math.min(-dx, row.length);
        for (let j = 0; j < end; j++) {
          const cell = row[j];
          if (cell) {
            if (typeof cell.remove === 'function') cell.remove();
            row[j] = null;
          }
        }
      }
    }
    if (dx > 0) {
      for (let i = 0; i < rows; i++) {
        const row = this.grid[i];
        for (let j = row.length - dx; j < row.length; j++) {
          if (j < 0) continue;
          const cell = row[j];
          if (cell) {
            if (typeof cell.remove === 'function') cell.remove();
            row[j] = null;
          }
        }
      }
    }
    if (dz < 0) {
      for (let i = 0; i < -dz && i < rows; i++) {
        const row = this.grid[i];
        for (let j = 0; j < row.length; j++) {
          const cell = row[j];
          if (cell) {
            if (typeof cell.remove === 'function') cell.remove();
            row[j] = null;
          }
        }
      }
    }
    if (dz > 0) {
      for (let i = rows - dz; i < rows; i++) {
        if (i < 0) continue;
        const row = this.grid[i];
        for (let j = 0; j < row.length; j++) {
          const cell = row[j];
          if (cell) {
            if (typeof cell.remove === 'function') cell.remove();
            row[j] = null;
          }
        }
      }
    }
  }

  private shiftGrid(dx: number, dz: number): void {
    const rows = this.grid.length;
    // Copy current rows as flat references so we can read from the old layout
    // while writing the new one back into `this.grid`.
    const temp: Array<Array<T | null>> = new Array(rows);
    for (let i = 0; i < rows; i++) temp[i] = this.grid[i].slice(0);

    for (let i = 0; i < rows; i++) {
      const row = this.grid[i];
      for (let j = 0; j < row.length; j++) {
        const ii = i - dz;
        const jj = j - dx;
        if (ii < 0 || ii >= rows || jj < 0 || jj >= row.length) {
          row[j] = null;
        } else {
          row[j] = temp[ii][jj];
        }
      }
    }
  }

  private addItems(): void {
    const rad = Math.ceil(this.cellCount / 2);
    const camCellX = Math.floor(this.scratch.x / this.cellSize);
    const camCellZ = Math.floor(this.scratch.z / this.cellSize);
    const baseX = camCellX * this.cellSize - Math.floor((this.cellCount * this.cellSize) / 2);
    const baseZ = camCellZ * this.cellSize - Math.floor((this.cellCount * this.cellSize) / 2);

    let spawned = 0;
    this._filling = false;
    for (let i = 0; i < this.grid.length; i++) {
      const row = this.grid[i];
      for (let j = 0; j < row.length; j++) {
        const di = i - rad;
        const dj = j - rad;
        if (Math.sqrt(di * di + dj * dj) > rad) continue;
        if (row[j] !== null) continue;

        const xx = baseX + j * this.cellSize;
        const zz = baseZ + i * this.cellSize;
        row[j] = new this.SpawnObj(xx, zz);
        spawned++;
        if (spawned >= CELLS_PER_FRAME) {
          this._filling = true;
          return;
        }
      }
    }
  }

  private updateItems(): void {
    for (let i = 0; i < this.grid.length; i++) {
      const row = this.grid[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (cell && typeof cell.update === 'function') cell.update();
      }
    }
  }
}

export const ARENA_SIZE: number = 384;
export const HALF: number = ARENA_SIZE / 2;

let _gridCircular = false;
let _gridRadius = HALF;

export function setGridArenaShape(circular: boolean, radius: number): void {
  _gridCircular = circular;
  _gridRadius = radius;
}

export function isOutOfBounds(x: number, z: number): boolean {
  if (_gridCircular) return x * x + z * z >= _gridRadius * _gridRadius;
  return Math.abs(x) >= HALF || Math.abs(z) >= HALF;
}

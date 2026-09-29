// ── Shared Utilities ────────────────────────────────────

/**
 * Point-to-segment distance in 2D (XZ plane).
 * Used by trail collision, player proximity, and AI raycasting.
 */
export function pointToSegmentDist(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/**
 * Angle interpolation that handles wraparound correctly.
 * Used by replay playback and netcode interpolation.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Convert a numeric hex color (0xRRGGBB) to CSS rgb() string.
 */
export function hexToCSS(hex: number): string {
  return `rgb(${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff})`;
}

/**
 * Convert a numeric hex color to CSS rgba() string.
 */
export function hexToRGBA(hex: number, a: number): string {
  return `rgba(${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}, ${a})`;
}

/**
 * Format seconds into "M:SS" string.
 */
export function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatRelativeTime(tsMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - tsMs);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return day === 1 ? '1 day ago' : `${day} days ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return mo === 1 ? '1 month ago' : `${mo} months ago`;
  const yr = Math.floor(mo / 12);
  return yr === 1 ? '1 year ago' : `${yr} years ago`;
}

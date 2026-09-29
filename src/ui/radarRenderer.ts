import { Player } from '../player';
import { Trail } from '../trail';
import { ARENA_SIZE } from '../grid';
import { hexToRGBA } from '../utils';

interface RadarAI {
  player: Player;
  colorHex: number;
}

interface DrawRadarParams {
  player: Player | null;
  ais: RadarAI[];
  playerColor: number;
  targetCtx?: CanvasRenderingContext2D;
  targetSize?: number;
  radarCtx: CanvasRenderingContext2D | null;
}

export function drawRadar({ player, ais, playerColor, targetCtx, targetSize, radarCtx }: DrawRadarParams): void {
  const ctx: CanvasRenderingContext2D | null = targetCtx || radarCtx;
  if (!ctx) return;
  const s: number = targetSize || ctx.canvas.width;
  const half: number = ARENA_SIZE / 2;
  const scale: number = s / ARENA_SIZE;

  ctx.clearRect(0, 0, s, s);

  // Background border
  ctx.strokeStyle = 'rgba(100, 50, 200, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, s, s);

  // Draw trails
  const drawTrail = (trail: Trail, color: string): void => {
    const pts = trail.points;
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const x0: number = (pts[0].x + half) * scale;
    const z0: number = (pts[0].z + half) * scale;
    ctx.moveTo(x0, z0);
    // Skip some points for performance
    const step: number = Math.max(1, Math.floor(pts.length / 200));
    for (let i = step; i < pts.length; i += step) {
      ctx.lineTo((pts[i].x + half) * scale, (pts[i].z + half) * scale);
    }
    // Always draw to last point
    const last = pts[pts.length - 1];
    ctx.lineTo((last.x + half) * scale, (last.z + half) * scale);
    ctx.stroke();
  };

  if (player) drawTrail(player.trail, hexToRGBA(playerColor, 0.7));
  for (const ai of ais) {
    drawTrail(ai.player.trail, hexToRGBA(ai.colorHex, 0.7));
  }

  // Draw player dots (show last trail point for dead players on result screen)
  const drawDot = (p: Player | null, trail: Trail | undefined, color: string): void => {
    if (!p) return;
    let px: number, pz: number;
    if (p.alive) {
      const pos = p.getPosition();
      px = (pos.x + half) * scale;
      pz = (pos.z + half) * scale;
    } else if (targetCtx && trail && trail.points.length > 0) {
      // Result screen — show last trail position
      const last = trail.points[trail.points.length - 1];
      px = (last.x + half) * scale;
      pz = (last.z + half) * scale;
    } else {
      return;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, pz, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color.replace('0.9', '0.3');
    ctx.beginPath();
    ctx.arc(px, pz, 5, 0, Math.PI * 2);
    ctx.fill();
    // X marker for dead players on result screen
    if (!p.alive && targetCtx) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - 4, pz - 4); ctx.lineTo(px + 4, pz + 4);
      ctx.moveTo(px + 4, pz - 4); ctx.lineTo(px - 4, pz + 4);
      ctx.stroke();
    }
  };

  drawDot(player, player?.trail, hexToRGBA(playerColor, 0.9));
  for (const ai of ais) {
    drawDot(ai.player, ai.player?.trail, hexToRGBA(ai.colorHex, 0.9));
  }
}

interface DrawSettingsPreviewParams {
  demoPlayer1: Player | null;
  demoPlayer2: Player | null;
  radarCtx: CanvasRenderingContext2D | null;
}

export function drawSettingsPreview({ demoPlayer1, demoPlayer2, radarCtx }: DrawSettingsPreviewParams): void {
  const ctx: CanvasRenderingContext2D | null = radarCtx;
  if (!ctx) return;
  const s: number = ctx.canvas.width;
  const half: number = ARENA_SIZE / 2;
  const scale: number = s / ARENA_SIZE;

  ctx.clearRect(0, 0, s, s);

  // Border
  ctx.strokeStyle = 'rgba(100, 50, 200, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, s, s);

  const p1 = demoPlayer1;
  const p2 = demoPlayer2;
  if (!p1 || !p2) return;

  // Draw live demo trails
  const drawTrail = (trail: Trail, color: string): void => {
    const pts = trail.points;
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step: number = Math.max(1, Math.floor(pts.length / 200));
    ctx.moveTo((pts[0].x + half) * scale, (pts[0].z + half) * scale);
    for (let i = step; i < pts.length; i += step) {
      ctx.lineTo((pts[i].x + half) * scale, (pts[i].z + half) * scale);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo((last.x + half) * scale, (last.z + half) * scale);
    ctx.stroke();
  };

  drawTrail(p1.trail, 'rgba(0, 255, 255, 0.5)');
  drawTrail(p2.trail, 'rgba(255, 68, 0, 0.5)');

  // Draw dots for alive players
  const drawDot = (player: Player, color: string): void => {
    if (!player.alive) return;
    const pos = player.getPosition();
    const px: number = (pos.x + half) * scale;
    const pz: number = (pos.z + half) * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, pz, 3, 0, Math.PI * 2);
    ctx.fill();
  };

  drawDot(p1, 'rgba(0, 255, 255, 0.9)');
  drawDot(p2, 'rgba(255, 68, 0, 0.9)');
}

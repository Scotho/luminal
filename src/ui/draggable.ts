// ── Momentum Drag Utility ────────────────────────────────
// Shared by chat panel, announcement panel, match-chat window, etc.
import { warnDev } from '../swallow';

export interface DraggableOptions {
  saveKey?: string;
  skipSelector?: string;
  topMin?: number;
  hitTest?: (e: MouseEvent) => boolean;
}

export interface DraggableResult {
  isDragging: () => boolean;
}

export function makeDraggable(el: HTMLElement, handle: HTMLElement, { saveKey, skipSelector, topMin = 36, hitTest }: DraggableOptions = {}): DraggableResult {
  let dragging: boolean = false, oX: number = 0, oY: number = 0;
  let curX: number = 0, curY: number = 0, velX: number = 0, velY: number = 0;
  let pMX: number = 0, pMY: number = 0, pT: number = 0, anim: number | null = null;

  // Edge affinity — when snapped to an edge, resize keeps it there
  let snapLeft: boolean = false, snapRight: boolean = false;
  let snapTop: boolean = false, snapBottom: boolean = false;

  const SNAP = 12;
  const EDGE_SNAP = 20; // threshold for resize edge affinity

  function bnd(): { maxX: number; maxY: number } {
    return { maxX: Math.max(0, window.innerWidth - el.offsetWidth), maxY: Math.max(topMin, window.innerHeight - el.offsetHeight) };
  }
  function clamp(): void {
    const b = bnd();
    if (curX < 0) { curX = 0; velX *= -0.15; }
    if (curX > b.maxX) { curX = b.maxX; velX *= -0.15; }
    if (curY < topMin) { curY = topMin; velY *= -0.15; }
    if (curY > b.maxY) { curY = b.maxY; velY *= -0.15; }
  }
  function apply(): void { el.style.left = Math.round(curX) + 'px'; el.style.top = Math.round(curY) + 'px'; el.style.bottom = 'auto'; el.style.right = 'auto'; el.style.transform = 'none'; }
  function updateSnap(): void {
    const b = bnd();
    snapLeft = curX < EDGE_SNAP;
    snapRight = curX > b.maxX - EDGE_SNAP;
    snapTop = curY - topMin < EDGE_SNAP;
    snapBottom = curY > b.maxY - EDGE_SNAP;
  }
  function save(): void {
    if (saveKey) localStorage.setItem(saveKey, JSON.stringify({ x: Math.round(curX), y: Math.round(curY), w: el.offsetWidth, h: el.offsetHeight, sL: snapLeft, sR: snapRight, sT: snapTop, sB: snapBottom }));
  }

  function tick(): void {
    velX *= 0.85; velY *= 0.85;
    curX += velX; curY += velY;
    clamp(); apply();
    if (Math.abs(velX) > 0.15 || Math.abs(velY) > 0.15) { anim = requestAnimationFrame(tick); }
    else {
      anim = null;
      const b = bnd();
      if (curX < SNAP) curX = 0; else if (curX > b.maxX - SNAP) curX = b.maxX;
      if (curY - topMin < SNAP) curY = topMin; else if (curY > b.maxY - SNAP) curY = b.maxY;
      updateSnap(); apply(); save();
    }
  }

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (skipSelector && (e.target as HTMLElement).closest(skipSelector)) return;
    if (hitTest && !hitTest(e)) return;
    e.preventDefault();
    dragging = true;
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    const r: DOMRect = el.getBoundingClientRect();
    curX = r.left; curY = r.top; apply();
    oX = e.clientX - curX; oY = e.clientY - curY;
    pMX = e.clientX; pMY = e.clientY; pT = performance.now();
    velX = 0; velY = 0;
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    const now: number = performance.now(), dt: number = Math.max(1, now - pT);
    curX = e.clientX - oX; curY = e.clientY - oY;
    const cap: number = 10;
    velX = 0.5 * velX + 0.5 * Math.max(-cap, Math.min(cap, (e.clientX - pMX) / dt * 16));
    velY = 0.5 * velY + 0.5 * Math.max(-cap, Math.min(cap, (e.clientY - pMY) / dt * 16));
    pMX = e.clientX; pMY = e.clientY; pT = now;
    clamp(); apply();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(velX) > 0.15 || Math.abs(velY) > 0.15) { anim = requestAnimationFrame(tick); }
    else { updateSnap(); save(); }
  });

  window.addEventListener('resize', () => {
    if (dragging) return;
    const r: DOMRect = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // hidden — don't clobber saved position
    curX = r.left; curY = r.top;
    const b = bnd();
    // Reposition from snapped edges
    if (snapLeft) curX = 0;
    if (snapRight) curX = b.maxX;
    if (snapTop) curY = topMin;
    if (snapBottom) curY = b.maxY;
    clamp(); apply(); save();
  });

  // Restore edge affinity from saved position
  if (saveKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey) || 'null');
      if (saved) {
        snapLeft = !!saved.sL; snapRight = !!saved.sR;
        snapTop = !!saved.sT; snapBottom = !!saved.sB;
      }
    } catch (e) { warnDev('draggable', e); }
  }

  return { isDragging: () => dragging };
}

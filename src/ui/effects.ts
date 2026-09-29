// ── Visual Effects Module ────────────────────────────────
// Extracted from main.js: Ambient EQ borders, FPS counter, electric pulse click effect.

import { show, hide, toggleVisible } from './dom';
import { getLocalBool, setLocalBool } from './storage';
import { DisposableBag } from '../disposables';

const _effectsBag = new DisposableBag();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

interface EffectsDeps {
  game: GameInstance;
  getAudioStarted: () => boolean;
  composer: { render(): void };
  renderer: { render(scene: unknown, camera: unknown): void };
}

interface PulsePoint {
  x: number;
  y: number;
}

type PulseBranch = Array<PulsePoint>;

interface Pulse {
  x: number;
  y: number;
  t: number;
  branches: PulseBranch[];
}

interface TrailPoint {
  x: number;
  y: number;
  birth: number;
}

let _game: GameInstance = null;
let _getAudioStarted: (() => boolean) | null = null;

// ── Ambient EQ Border Lines ──────────────────────────────
const AEQ_BAR_COUNT: number = 80;
const aeqMusic: HTMLElement | null = document.getElementById('aeq-music');

let _annPanel: HTMLElement | null = null;
let _annLink: HTMLElement | null = null;

// ── Performance Overlay (FPS / Ping) ─────────────────────
const _perfOverlay: HTMLElement | null = document.getElementById('perf-overlay');
let _fpsFrames: number = 0;
let _fpsLast: number = performance.now();
let _lastFps: number = 0;
export function getLastFps(): number { return _lastFps; }
let _lastPing: string = '\u2014';
let _showFps: boolean = getLocalBool('luminal-perf-fps', false);
let _showMem: boolean = getLocalBool('luminal-perf-mem', false);
let _showPing: boolean = getLocalBool('luminal-perf-ping', false);
let _showVram: boolean = getLocalBool('luminal-perf-vram', false);

// ── Electric Pulse Click Effect ──────────────────────────
let pulseCanvas: HTMLCanvasElement;
let pulseCtx: CanvasRenderingContext2D;
const pulses: Pulse[] = [];
const trailPoints: (TrailPoint | null)[] = []; // { x, y, birth } — 2D trail like bikes
let mouseHeld: boolean = false;
let lastTrailX: number = 0, lastTrailY: number = 0;
let rippleTimer: number = 0;

/* ─────────────────────────────────────────────────────────
   initEffects — call once after game + renderer are ready
   ───────────────────────────────────────────────────────── */
export function initEffects({ game, getAudioStarted, composer: _composer, renderer: _renderer }: EffectsDeps): void {
  pulseCanvas = document.getElementById('pulse-canvas') as HTMLCanvasElement;
  pulseCtx = pulseCanvas.getContext('2d')!;
  _game = game;
  _getAudioStarted = getAudioStarted;

  // ── Build EQ bars (music overlay only) ──
  for (let i = 0; i < AEQ_BAR_COUNT; i++) {
    if (aeqMusic) {
      const b3: HTMLDivElement = document.createElement('div');
      b3.className = 'aeq-bar';
      b3.style.height = '1px';
      aeqMusic.appendChild(b3);
    }
  }

  // Announcement panel link (grabbed from DOM)
  _annPanel = document.getElementById('announcement-panel');
  _annLink = _annPanel ? _annPanel.querySelector('.ann-link') : null;

  // ── Pulse canvas setup ──
  resizePulseCanvas();
  _effectsBag.addEventListener(window, 'resize', resizePulseCanvas);

  _effectsBag.addEventListener(document, 'mousedown', ((e: MouseEvent) => {
    if (!isPulseActive()) return;
    const softClick: boolean = isSliderOrArrow(e.target as HTMLElement);
    if (!softClick && isMenuInteractive(e.target as HTMLElement)) return;
    if (!softClick) {
      mouseHeld = true;
      lastTrailX = e.clientX;
      lastTrailY = e.clientY;
      rippleTimer = 0;
      trailPoints.push(null); // stroke break
    }
    spawnPulse(e.clientX, e.clientY, softClick);
  }) as EventListener);

  _effectsBag.addEventListener(document, 'mousemove', ((e: MouseEvent) => {
    if (!mouseHeld || !isPulseActive()) return;
    const dx: number = e.clientX - lastTrailX;
    const dy: number = e.clientY - lastTrailY;
    if (dx * dx + dy * dy > 64) { // every 8px
      trailPoints.push({ x: e.clientX, y: e.clientY, birth: performance.now() });
      lastTrailX = e.clientX;
      lastTrailY = e.clientY;
    }
  }) as EventListener);

  _effectsBag.addEventListener(document, 'mouseup', (() => { mouseHeld = false; }) as EventListener);
}

/* ─────────────────────────────────────────────────────────
   updateAmbientEQ — called every frame from the game loop
   ───────────────────────────────────────────────────────── */
export function updateAmbientEQ(): void {
  const game: GameInstance = _game;
  const audioStarted: boolean = _getAudioStarted!();

  const musicOpen: boolean = aeqMusic != null && !document.getElementById('music-overlay')!.classList.contains('hidden');
  if (aeqMusic) toggleVisible(aeqMusic, musicOpen);
  if (!audioStarted) return;
  if (!musicOpen) return;

  const bands: { bass: number; lowMid: number; mid: number; upperMid: number; presence: number; energy: number } | null = game._lastBands;
  if (!bands) return;

  // Pulse the rommii link color with the music
  if (_annLink && _annPanel!.classList.contains('announcement--visible')) {
    const glow: number = 0.2 + bands.energy * 0.4;
    (_annLink as HTMLElement).style.color = `rgba(var(--c-hot),${0.55 + bands.energy * 0.45})`;
    (_annLink as HTMLElement).style.textShadow = `0 0 ${8 + bands.energy * 10}px rgba(var(--c-hot),${glow})`;
  }

  const vals: number[] = [bands.bass, bands.lowMid, bands.mid, bands.upperMid, bands.presence, bands.energy];
  const musicBars: HTMLCollection | null = aeqMusic ? aeqMusic.children : null;

  if (musicOpen && musicBars) {
    for (let i = 0; i < AEQ_BAR_COUNT; i++) {
      const pos: number = Math.abs(i - AEQ_BAR_COUNT / 2) / (AEQ_BAR_COUNT / 2);
      const bandIdx: number = Math.min(5, Math.floor(pos * 6));
      const v: number = vals[bandIdx];
      const h: number = 1 + v * 20 + Math.sin(i * 0.3 + Date.now() * 0.003) * v * 4;
      (musicBars[AEQ_BAR_COUNT - 1 - i] as HTMLElement).style.height = h + 'px';
    }
  }
}

/* ─────────────────────────────────────────────────────────
   updateFPS — called every frame, manages its own 500ms window
   ───────────────────────────────────────────────────────── */
export function updateFPS(): void {
  const now: number = performance.now();
  _fpsFrames++;
  if (now - _fpsLast >= 500) {
    _lastFps = Math.round(_fpsFrames / ((now - _fpsLast) / 1000));
    _fpsFrames = 0;
    _fpsLast = now;
    _lastPing = document.getElementById('tb-ping')?.textContent || '\u2014';

    // Update perf overlay
    _updatePerfOverlay();

    // Update settings tooltip
    const memVal: string = document.getElementById('tb-mem')?.textContent || '\u2014';
    const vramVal: string = document.getElementById('tb-vram')?.textContent || '\u2014';
    const settingsBtn: HTMLElement | null = document.getElementById('tb-settings-btn');
    if (settingsBtn) {
      settingsBtn.setAttribute('data-tip',
        `${_lastFps} FPS\n${memVal} MB RAM\n${vramVal} MB VRAM\n${_lastPing} ms PING`);
    }
  }
}

export function setPerfFps(on: boolean): void {
  _showFps = on;
  setLocalBool('luminal-perf-fps', on);
  _updatePerfOverlay();
}

export function setPerfMem(on: boolean): void {
  _showMem = on;
  setLocalBool('luminal-perf-mem', on);
  _updatePerfOverlay();
}

export function setPerfPing(on: boolean): void {
  _showPing = on;
  setLocalBool('luminal-perf-ping', on);
  _updatePerfOverlay();
}

export function setPerfVram(on: boolean): void {
  _showVram = on;
  setLocalBool('luminal-perf-vram', on);
  _updatePerfOverlay();
}

function _updatePerfOverlay(): void {
  if (!_perfOverlay) return;
  const parts: string[] = [];
  if (_showFps) {
    parts.push(`<span class="perf-fps">${_lastFps} <span class="perf-label">FPS</span></span>`);
  }
  if (_showMem) {
    const memEl = document.getElementById('tb-mem');
    const memWrap = document.getElementById('tb-mem-wrap');
    if (memEl) {
      const val = memEl.textContent || '0';
      const display = val === '0' ? '\u2014' : val;
      const tip = (memWrap?.getAttribute('data-tip') || '').replace(/"/g, '&quot;');
      parts.push(`<span class="perf-mem" data-tip="${tip}" data-tip-pos="below">${display} <span class="perf-label">MB</span></span>`);
    }
  }
  if (_showVram) {
    const vramEl = document.getElementById('tb-vram');
    const vramWrap = document.getElementById('tb-vram-wrap');
    if (vramEl) {
      const tip = (vramWrap?.getAttribute('data-tip') || '').replace(/"/g, '&quot;');
      parts.push(`<span class="perf-vram" data-tip="${tip}" data-tip-pos="below">${vramEl.textContent} <span class="perf-label">VM</span></span>`);
    }
  }
  if (_showPing) {
    const pingWrap = document.getElementById('tb-ping-wrap');
    const pingTip = (pingWrap?.getAttribute('data-tip') || '').replace(/"/g, '&quot;');
    parts.push(`<span class="perf-ping" data-tip="${pingTip}" data-tip-pos="below">${_lastPing} <span class="perf-label">MS</span></span>`);
  }
  if (parts.length === 0) {
    hide(_perfOverlay);
    return;
  }
  show(_perfOverlay);
  _perfOverlay.innerHTML = parts.join('<span class="perf-sep">\u00b7</span>');
}

/* ─────────────────────────────────────────────────────────
   Pulse canvas helpers (internal)
   ───────────────────────────────────────────────────────── */
function resizePulseCanvas(): void {
  pulseCanvas.width = window.innerWidth;
  pulseCanvas.height = window.innerHeight;
}

function isMenuInteractive(target: HTMLElement): boolean {
  return !!target.closest('.menu-btn, .color-opt, .bestof-arrow, .quickstart-toggle, .setting-arrow, .keybind-key, .keybinds-row, .keybinds-tab, .control-toggle, .replay-btn, #music-controls, .draggable-header, .chat-resize-handle, #global-chat, #match-chat-window, .playlist-item, .overlay-screen .content');
}

// Sliders and arrows get pulse ring only (no branches)
function isSliderOrArrow(target: HTMLElement): boolean {
  return !!target.closest('input[type="range"], .bestof-arrow, .setting-arrow, #opp-left, #opp-right');
}

function isPulseActive(): boolean {
  return _game.state === 'menu' || _game.state === 'gameover';
}

function spawnPulse(x: number, y: number, noBranches: boolean = false): void {
  pulses.push({
    x, y, t: 0,
    branches: noBranches ? [] : generateBranches(x, y),
  });
}

function generateBranches(cx: number, cy: number): PulseBranch[] {
  const branches: PulseBranch[] = [];
  const count: number = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const angle: number = Math.random() * Math.PI * 2;
    const len: number = 25 + Math.random() * 40;
    const segments: PulsePoint[] = [];
    let x: number = cx, y: number = cy;
    const steps: number = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < steps; s++) {
      const frac: number = (s + 1) / steps;
      const jitter: number = (1 - frac) * 10;
      x += Math.cos(angle) * (len / steps) + (Math.random() - 0.5) * jitter;
      y += Math.sin(angle) * (len / steps) + (Math.random() - 0.5) * jitter;
      segments.push({ x, y });
    }
    branches.push(segments);
  }
  return branches;
}

/* ─────────────────────────────────────────────────────────
   drawPulseCanvas — called every frame from the game loop
   ───────────────────────────────────────────────────────── */
export function drawPulseCanvas(): void {
  const game: GameInstance = _game;
  pulseCtx.clearRect(0, 0, pulseCanvas.width, pulseCanvas.height);

  // Intensity depends on state: very dim during countdown, normal on menu
  const intensity: number = (game.state === 'countdown' || game.state === 'transition') ? 0.15 : (game.state === 'menu' ? 1.0 : 0);
  if (intensity === 0) { pulses.length = 0; trailPoints.length = 0; return; }

  const now: number = performance.now();

  // Ripple on hold
  if (mouseHeld && isPulseActive()) {
    rippleTimer += 0.016;
    if (rippleTimer > 0.35) {
      rippleTimer = 0;
      spawnPulse(lastTrailX + (Math.random() - 0.5) * 14, lastTrailY + (Math.random() - 0.5) * 14);
    }
  }

  // Draw 2D trail (glow line that fades after 1s)
  const TRAIL_LIFE: number = 1000; // ms
  for (let i = trailPoints.length - 1; i >= 0; i--) {
    if (trailPoints[i] !== null && now - trailPoints[i]!.birth > TRAIL_LIFE) { trailPoints.splice(i, 1); }
  }
  if (trailPoints.length > 1) {
    const totalPts: number = trailPoints.length;
    for (let i = 1; i < totalPts; i++) {
      const p0: TrailPoint | null = trailPoints[i - 1];
      const p1: TrailPoint | null = trailPoints[i];
      if (p0 === null || p1 === null) continue;
      const age: number = (now - p1.birth) / TRAIL_LIFE;
      const a: number = Math.max(0, 1 - age) * 0.8 * intensity;
      // Gradient position along trail (0=start/yellow, 1=end/amber-orange)
      const grad: number = i / totalPts;
      const r: number = Math.round(255 - grad * 30);
      const g: number = Math.round(220 - grad * 80);
      const b: number = Math.round(60 - grad * 30);
      // Outer glow (wider, dimmer)
      pulseCtx.beginPath();
      pulseCtx.moveTo(p0.x, p0.y);
      pulseCtx.lineTo(p1.x, p1.y);
      pulseCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a * 0.3})`;
      pulseCtx.lineWidth = 10;
      pulseCtx.stroke();
      // Mid glow
      pulseCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a * 0.5})`;
      pulseCtx.lineWidth = 4;
      pulseCtx.stroke();
      // Core (bright)
      pulseCtx.strokeStyle = `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 80)}, ${a})`;
      pulseCtx.lineWidth = 1.5;
      pulseCtx.stroke();
    }
  }


  // Draw pulses
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p: Pulse = pulses[i];
    p.t += 0.035;
    if (p.t >= 1) { pulses.splice(i, 1); continue; }

    const alpha: number = (1 - p.t) * intensity;
    const ringR: number = p.t * 60;

    // Ring
    pulseCtx.beginPath();
    pulseCtx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
    pulseCtx.strokeStyle = `rgba(80, 200, 185, ${alpha * 0.2})`;
    pulseCtx.lineWidth = 1.5 * (1 - p.t);
    pulseCtx.stroke();

    // Center glow
    const grad: CanvasGradient = pulseCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 18 * (1 - p.t * 0.5));
    grad.addColorStop(0, `rgba(50, 130, 120, ${alpha * 0.15})`);
    grad.addColorStop(1, `rgba(80, 200, 185, 0)`);
    pulseCtx.beginPath();
    pulseCtx.arc(p.x, p.y, 30, 0, Math.PI * 2);
    pulseCtx.fillStyle = grad;
    pulseCtx.fill();

    // Lightning branches
    const branchAlpha: number = p.t < 0.15 ? p.t / 0.15 : Math.max(0, 1 - (p.t - 0.15) / 0.5);
    if (branchAlpha > 0) {
      for (const segs of p.branches) {
        pulseCtx.beginPath();
        pulseCtx.moveTo(p.x, p.y);
        for (const s of segs) pulseCtx.lineTo(s.x, s.y);
        pulseCtx.strokeStyle = `rgba(80, 200, 185, ${branchAlpha * 0.25 * intensity})`;
        pulseCtx.lineWidth = 1;
        pulseCtx.stroke();
        // Glow pass
        pulseCtx.strokeStyle = `rgba(50, 130, 120, ${branchAlpha * 0.1 * intensity})`;
        pulseCtx.lineWidth = 2.5;
        pulseCtx.stroke();
      }
    }
  }
}

/** Tear down listeners registered by initEffects. */
// ts-prune-ignore-next
export function disposeEffects(): void {
  _effectsBag.reset();
}

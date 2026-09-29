// ── Admin Debug Panel ────────────────────────────────────
// Backtick (`) to toggle. Full lighting/emissive tuning with export & reset.
// Draggable, resizable floating panel with persistent layout.
// Access: admin-claimed users or localhost (DEV builds).

import * as THREE from 'three';
import type { BloomPassLike } from './types/index';
import {
  setHelperState,
  collectAllValues,
  collectDirtyValues,
  resetAll,
  flashBtn,
  copyToClipboard,
  importFromClipboard,
  addGroupDivider,
  closeSectionBody,
  buildSearchInput,
  expandAllSections,
  collapseAllSections,
  type AdminSliderEntry,
  type AdminColorEntry,
  type AdminToggleEntry,
} from './admin/helpers';
import { adminOverrides } from './player';
import type { Trail } from './trail';

// ── Domain modules ──────────────────────────────────────
import { addFreecamSection } from './admin/freecam';
import { addGodModeButton, addPerfStatsSection } from './admin/perfStats';
import { addPhysicsSection, addGameplaySection } from './admin/physicsPanel';
import { addCameraSection } from './admin/cameraPanel';
import { addRenderingSection, addMapEnvironmentSection, addTrailSection } from './admin/graphicsPanel';
import { addVehicleSection } from './admin/vehiclePanel';
import { addArenaSection, restoreHiddenArenaMeshes } from './admin/arenaPanel';
import { addMasterControlsSection, clearMasterBaselines } from './admin/masterControls';

// ── Access control ─────────────────────────────────────────
// Admin access is determined by Firebase custom claims (server-issued).
// The `admin` claim is cached on auth state change and checked synchronously.
// In dev builds only, localhost also grants access for local testing.
let _isAdminCached = false;
let _navigateToDebug: (() => void) | null = null;
let _rendererRef: THREE.WebGLRenderer | null = null;

export function setAdminDeps(deps: { navigateToDebug: () => void; renderer?: THREE.WebGLRenderer }): void {
  _navigateToDebug = deps.navigateToDebug;
  if (deps.renderer) _rendererRef = deps.renderer;
}

export function hasAdminAccess(): boolean {
  if (import.meta.env.DEV) {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocal) return true;
  }
  return _isAdminCached;
}

// ── Types ───────────────────────────────────────────────

export interface PlayerLike {
  trail: Trail;
  mesh: THREE.Group;
  engineGlow: THREE.Mesh;
  bikeLight: THREE.PointLight | null;
  underGlow: THREE.PointLight | null;
  proximityAura: THREE.PointLight | null;
  _beam: THREE.SpotLight | null;
  isAI: boolean;
  suppressTrail: boolean;
}

export interface AIEntry {
  player: PlayerLike;
  aiState: { personality: Record<string, number> | null } | null;
}

export interface GameLike {
  player: PlayerLike | null;
  ais: AIEntry[];
  demoPlayer1: PlayerLike | null;
  demoPlayer2: PlayerLike | null;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bloomPass: BloomPassLike | null;
  baseBloomStrength: number;
  adminBloomFreeze: boolean;
  adminGodMode: boolean;
  adminFreecam: boolean;
  adminFreecamInput: Record<string, boolean | number | undefined>;
  _freeCamPos: THREE.Vector3;
  _freeCamYaw: number;
  _freeCamPitch: number;
  timeScale: number;
}

// ── Module state ────────────────────────────────────────

let _shell: HTMLDivElement | null = null;
let panel: HTMLDivElement | null = null;
let _gameRef: GameLike | null = null;
let _sliders: AdminSliderEntry[] = [];
let _colorPickers: AdminColorEntry[] = [];
let _toggles: AdminToggleEntry[] = [];
let _freecamCleanup: (() => void) | null = null;
let _freecamTickFn: (() => void) | null = null;

// ── Layout persistence ──────────────────────────────────

interface PanelLayout { x: number; y: number; w: number; h: number }
const LAYOUT_KEY = 'admin-panel-layout';
const MIN_W = 280;
const MIN_H = 300;
const MAX_W = 700;

function loadLayout(): PanelLayout {
  try {
    const s = localStorage.getItem(LAYOUT_KEY);
    if (s) {
      const l = JSON.parse(s) as PanelLayout;
      if (l.w >= MIN_W && l.h >= MIN_H) return l;
    }
  } catch { /* use defaults */ }
  return { x: window.innerWidth - 380, y: 10, w: 360, h: Math.round(window.innerHeight * 0.85) };
}

function saveLayout(l: PanelLayout): void {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
}

function applyLayout(el: HTMLElement, l: PanelLayout): void {
  el.style.left = l.x + 'px';
  el.style.top = l.y + 'px';
  el.style.width = l.w + 'px';
  el.style.height = l.h + 'px';
}

function clampToViewport(l: PanelLayout): void {
  const vw = window.innerWidth, vh = window.innerHeight;
  l.x = Math.max(-l.w + 60, Math.min(vw - 60, l.x));
  l.y = Math.max(0, Math.min(vh - 40, l.y));
}

// ── Drag from title bar ─────────────────────────────────

function wireDrag(handle: HTMLElement, layout: PanelLayout): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.style.cursor = 'grabbing';
    const sx = e.clientX, sy = e.clientY;
    const ox = layout.x, oy = layout.y;
    const onMove = (ev: MouseEvent) => {
      layout.x = ox + ev.clientX - sx;
      layout.y = oy + ev.clientY - sy;
      if (_shell) applyLayout(_shell, layout);
    };
    const onUp = () => {
      handle.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      clampToViewport(layout);
      if (_shell) applyLayout(_shell, layout);
      saveLayout(layout);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Resize edges ────────────────────────────────────────

function addResizeEdges(shell: HTMLElement, layout: PanelLayout): void {
  const specs: Array<{ dir: string; css: Record<string, string> }> = [
    { dir: 'e', css: { right: '-3px', top: '12px', bottom: '12px', width: '6px', cursor: 'ew-resize' } },
    { dir: 'w', css: { left: '-3px', top: '12px', bottom: '12px', width: '6px', cursor: 'ew-resize' } },
    { dir: 's', css: { bottom: '-3px', left: '12px', right: '12px', height: '6px', cursor: 'ns-resize' } },
    { dir: 'se', css: { right: '-3px', bottom: '-3px', width: '14px', height: '14px', cursor: 'nwse-resize' } },
    { dir: 'sw', css: { left: '-3px', bottom: '-3px', width: '14px', height: '14px', cursor: 'nesw-resize' } },
  ];
  for (const { dir, css } of specs) {
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', zIndex: '3', ...css });
    el.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      const snap = { ...layout };
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (dir.includes('e')) layout.w = Math.max(MIN_W, Math.min(MAX_W, snap.w + dx));
        if (dir.includes('s')) layout.h = Math.max(MIN_H, snap.h + dy);
        if (dir.includes('w')) {
          const nw = Math.max(MIN_W, Math.min(MAX_W, snap.w - dx));
          layout.x = snap.x + snap.w - nw;
          layout.w = nw;
        }
        applyLayout(shell, layout);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveLayout(layout);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    shell.appendChild(el);
  }
}

// ── Public API ──────────────────────────────────────────

export function initAdminPanel(game?: GameLike): void {
  // Tear down previous instance
  if (_shell) _shell.remove();
  if (_freecamCleanup) { _freecamCleanup(); _freecamCleanup = null; }
  _freecamTickFn = null;
  if (game) _gameRef = game;
  _sliders = [];
  _colorPickers = [];
  _toggles = [];

  const overlay = document.getElementById('overlay');
  if (overlay) overlay.style.display = 'none';

  // ── Outer shell (draggable + resizable) ──────────────
  const layout = loadLayout();
  clampToViewport(layout);

  _shell = document.createElement('div');
  _shell.id = 'admin-panel-shell';
  Object.assign(_shell.style, {
    position: 'fixed',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(0,0,0,0.92)',
    border: '1px solid rgba(73,162,178,0.3)',
    borderRadius: '6px',
    zIndex: '99999',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    opacity: '0', transform: 'scale(0.95)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  });
  applyLayout(_shell, layout);

  // ── Title bar (drag handle) ──────────────────────────
  const titleBar = document.createElement('div');
  Object.assign(titleBar.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '5px 10px', background: 'rgba(73,162,178,0.1)',
    borderBottom: '1px solid rgba(73,162,178,0.25)',
    cursor: 'grab', userSelect: 'none', flexShrink: '0',
    fontFamily: 'monospace',
  });

  const titleLabel = document.createElement('span');
  titleLabel.textContent = 'ADMIN';
  Object.assign(titleLabel.style, {
    color: '#49A2B2', fontWeight: 'bold', fontSize: '10px', letterSpacing: '3px',
  });

  const titleActions = document.createElement('div');
  Object.assign(titleActions.style, { display: 'flex', gap: '8px', alignItems: 'center' });

  if (_navigateToDebug) {
    const dbgBtn = document.createElement('span');
    dbgBtn.textContent = 'DBG';
    Object.assign(dbgBtn.style, {
      color: '#e8a735', cursor: 'pointer', fontSize: '9px',
      letterSpacing: '1px', fontWeight: 'bold',
      border: '1px solid rgba(232,167,53,0.3)', padding: '2px 6px',
    });
    dbgBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    dbgBtn.addEventListener('click', () => { destroyAdminPanel(); _navigateToDebug?.(); });
    titleActions.appendChild(dbgBtn);
  }

  const closeBtn = document.createElement('span');
  closeBtn.textContent = '\u00d7';
  Object.assign(closeBtn.style, {
    color: '#ff6666', cursor: 'pointer', fontSize: '16px', lineHeight: '1', padding: '0 2px',
  });
  closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  closeBtn.addEventListener('click', () => destroyAdminPanel());
  titleActions.appendChild(closeBtn);

  titleBar.appendChild(titleLabel);
  titleBar.appendChild(titleActions);
  _shell.appendChild(titleBar);

  // ── Content area (scrollable panel for all sliders) ──
  panel = document.createElement('div');
  panel.id = 'admin-panel';
  Object.assign(panel.style, {
    flex: '1', overflowY: 'auto', overflowX: 'hidden',
    color: '#ccc', fontFamily: 'monospace', fontSize: '11px',
    padding: '8px 14px 14px', boxSizing: 'border-box',
    minHeight: '0',
  });
  _shell.appendChild(panel);

  // Resize grip visual indicator (bottom-right corner)
  const grip = document.createElement('div');
  Object.assign(grip.style, {
    position: 'absolute', right: '3px', bottom: '3px',
    width: '8px', height: '8px', pointerEvents: 'none',
    borderRight: '2px solid rgba(73,162,178,0.35)',
    borderBottom: '2px solid rgba(73,162,178,0.35)',
  });
  _shell.appendChild(grip);

  // Wire interactions
  wireDrag(titleBar, layout);
  addResizeEdges(_shell, layout);

  document.body.appendChild(_shell);
  requestAnimationFrame(() => {
    if (_shell) { _shell.style.opacity = '1'; _shell.style.transform = 'scale(1)'; }
  });

  // ── Helpers state ────────────────────────────────────
  setHelperState({
    panel, sliders: _sliders, colorPickers: _colorPickers,
    toggles: _toggles, currentSectionBody: null, sectionWrappers: [],
  });

  // ── Quick actions bar ────────────────────────────────
  const quickBar = document.createElement('div');
  Object.assign(quickBar.style, {
    borderBottom: '1px solid rgba(73,162,178,0.2)',
    paddingBottom: '6px', marginBottom: '4px',
  });
  panel.appendChild(quickBar);

  const freecamRefs = addFreecamSection(quickBar, _gameRef, _rendererRef, destroyAdminPanel);
  _freecamCleanup = freecamRefs.cleanup;
  _freecamTickFn = freecamRefs.tickFn;
  addGodModeButton(quickBar, _gameRef);

  const actionRow = document.createElement('div');
  Object.assign(actionRow.style, { display: 'flex', gap: '4px', marginBottom: '6px' });
  for (const [label, fn] of [['EXPAND ALL', expandAllSections], ['COLLAPSE ALL', collapseAllSections]] as const) {
    const btn = document.createElement('span');
    btn.textContent = label;
    Object.assign(btn.style, {
      flex: '1', padding: '3px 0', textAlign: 'center', cursor: 'pointer',
      fontSize: '9px', letterSpacing: '1px', color: '#49A2B2',
      border: '1px solid rgba(73,162,178,0.25)', borderRadius: '2px',
    });
    btn.addEventListener('click', fn);
    actionRow.appendChild(btn);
  }
  quickBar.appendChild(actionRow);
  quickBar.appendChild(buildSearchInput());

  // ── Domain sections ──────────────────────────────────
  const freecamTickFnRef = { get current() { return _freecamTickFn; } };

  const allPlayers: PlayerLike[] = [];
  if (_gameRef?.player) allPlayers.push(_gameRef.player);
  if (_gameRef?.ais) _gameRef.ais.forEach((a) => allPlayers.push(a.player));
  if (_gameRef?.demoPlayer1) allPlayers.push(_gameRef.demoPlayer1);
  if (_gameRef?.demoPlayer2) allPlayers.push(_gameRef.demoPlayer2);

  addGroupDivider('QUICK MIX');
  addMasterControlsSection(panel, _gameRef);

  addGroupDivider('PERFORMANCE');
  addPerfStatsSection(panel, _rendererRef, freecamTickFnRef);

  addGroupDivider('RENDERING');
  addRenderingSection(panel, _gameRef, allPlayers);

  addGroupDivider('MAP ENVIRONMENT');
  addMapEnvironmentSection(panel, _gameRef);

  addGroupDivider('TRAIL & VEHICLE');
  addTrailSection(panel, allPlayers);
  addVehicleSection(allPlayers);

  addGroupDivider('ARENA');
  addArenaSection(panel, _gameRef);

  addGroupDivider('CAMERA');
  addCameraSection(panel, _gameRef);

  addGroupDivider('PHYSICS');
  addPhysicsSection(_gameRef);

  addGroupDivider('AI & GAMEPLAY');
  addGameplaySection(_gameRef);

  closeSectionBody();

  // ── Footer actions ───────────────────────────────────
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    borderTop: '1px solid rgba(73,162,178,0.2)',
    paddingTop: '6px', marginTop: '8px',
  });
  panel.appendChild(footer);

  const footerBtns: Array<{ text: string; color: string; onClick: () => void }> = [
    { text: '[EXPORT ALL JSON]', color: '#49A2B2', onClick: () => {
      copyToClipboard(JSON.stringify(collectAllValues(), null, 2), '[EXPORT ALL JSON]');
    }},
    { text: '[EXPORT DIRTY JSON]', color: '#49A2B2', onClick: () => {
      const vals = collectDirtyValues();
      if (!Object.keys(vals).length) { flashBtn('[EXPORT DIRTY JSON]', '(no changes)'); return; }
      copyToClipboard(JSON.stringify(vals, null, 2), '[EXPORT DIRTY JSON]');
    }},
    { text: '[IMPORT JSON]', color: '#49A2B2', onClick: () => { importFromClipboard(); } },
    { text: '[RESET TO DEFAULTS]', color: '#e8a735', onClick: () => { resetAll(); } },
    { text: '[CLOSE ADMIN]', color: '#ff6666', onClick: () => { destroyAdminPanel(); } },
  ];
  for (const { text, color, onClick } of footerBtns) {
    const btn = document.createElement('div');
    btn.textContent = text;
    btn.dataset.label = text;
    Object.assign(btn.style, {
      marginTop: '4px', padding: '6px', textAlign: 'center', cursor: 'pointer',
      color, border: `1px solid ${color}33`, fontSize: '10px',
    });
    btn.addEventListener('click', onClick);
    footer.appendChild(btn);
  }
}

export function destroyAdminPanel(): void {
  if (_freecamCleanup) { _freecamCleanup(); _freecamCleanup = null; }
  _freecamTickFn = null;

  clearMasterBaselines();
  restoreHiddenArenaMeshes();

  if (_shell) {
    _shell.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
    _shell.style.opacity = '0';
    _shell.style.transform = 'scale(0.95)';
    const s = _shell;
    setTimeout(() => { s.remove(); }, 150);
    _shell = null;
    panel = null;
  }
  _sliders = [];
  _colorPickers = [];
  _toggles = [];
  setHelperState({
    panel: null, sliders: _sliders, colorPickers: _colorPickers,
    toggles: _toggles, currentSectionBody: null, sectionWrappers: [],
  });
  for (const k of Object.keys(adminOverrides)) adminOverrides[k] = null;
  if (_gameRef) _gameRef.adminBloomFreeze = false;
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.style.display = '';
}

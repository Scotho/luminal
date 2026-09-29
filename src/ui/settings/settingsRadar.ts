// ── Settings: Radar ─────────────────────────────────────
// Radar size slider, radar toggle, radar mobile hide, drag & resize.

import { show, hide } from '../dom';
import { notifySettingChanged } from '../../settingsSync';
import { createToggle, createSlider } from '../controls';
import { warnDev } from '../../swallow';
import type { ToggleHandle } from '../controls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

// ── Radar Size ──────────────────────────────────────────
export function applyRadarSize(size: number): void {
  document.documentElement.style.setProperty('--radar-size', size + 'px');
  const radarCanvas: HTMLCanvasElement = document.getElementById('radar-canvas') as HTMLCanvasElement;
  radarCanvas.width = size;
  radarCanvas.height = size;
}

// ── Radar Toggle ────────────────────────────────────────
export function updateRadarToggle(game: GameInstance, radarEnabled: boolean): void {
  game.radarEnabled = radarEnabled;
  // Hide/show radar in settings preview
  const radarEl: HTMLElement | null = document.getElementById('radar');
  if (game.settingsOpen) {
    if (radarEnabled) {
      show(radarEl!);
      show('match-timer');
    } else {
      hide(radarEl!);
      hide('match-timer');
    }
  }
}

export interface RadarInitDeps {
  game: GameInstance;
  onRadarToggle: (v: boolean) => void;
  onRadarMobileHide: (v: boolean) => void;
  getRadarEnabled: () => boolean;
}

export interface RadarHandles {
  radarToggleCtrl: ToggleHandle;
  radarMobileHideCtrl: ToggleHandle;
}

// ── Init ─────────────────────────────────────────────────
export function initRadar(deps: RadarInitDeps): RadarHandles {
  const { game, onRadarToggle, onRadarMobileHide } = deps;

  // ── Radar Size Slider ─────────────────────────────────
  const radarSizeSlider: HTMLInputElement = document.getElementById('radar-size') as HTMLInputElement;

  const savedRadarSize: string | null = localStorage.getItem('luminal-radar-size');
  if (savedRadarSize !== null) applyRadarSize(Number(savedRadarSize));
  else applyRadarSize(140);

  createSlider({
    el: radarSizeSlider,
    storageKey: 'luminal-radar-size',
    onInput(val) { applyRadarSize(val); },
    onChange() { notifySettingChanged(); },
  });

  // ── Radar Toggle ───────────────────────────────────────
  const radarToggleCtrl = createToggle({
    el: document.getElementById('radar-toggle')!,
    storageKey: 'luminal-radar-enabled',
    defaultVal: 'on',
    onChange(val) {
      onRadarToggle(val === 'on');
      notifySettingChanged();
      updateRadarToggle(game, deps.getRadarEnabled());
    },
  });
  updateRadarToggle(game, deps.getRadarEnabled());

  // ── Radar Mobile Hide Toggle ─────────────────────────
  const radarMobileHideCtrl = createToggle({
    el: document.getElementById('radar-mobile-hide-toggle')!,
    storageKey: 'luminal-radar-mobile-hide',
    defaultVal: 'on',
    onChange(val) {
      onRadarMobileHide(val === 'on');
      game.radarMobileHide = val === 'on';
      notifySettingChanged();
    },
  });

  // ── Radar drag + resize ────────────────────────────────
  {
    const _radarWrap: HTMLElement = document.getElementById('radar-wrap')!;
    const _radarEl: HTMLElement = document.getElementById('radar')!;
    const _radarResizeH: HTMLElement = document.getElementById('radar-resize')!;
    const _radarDragH: HTMLElement = document.getElementById('radar-timer-bar')!;
    let _radarResizing: boolean = false;
    let _radarDragging: boolean = false;
    let _radarOX: number = 0, _radarOY: number = 0;

    // Drag via timer bar
    _radarDragH.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('#radar-resize')) return;
      e.preventDefault();
      _radarDragging = true;
      const r: DOMRect = _radarWrap.getBoundingClientRect();
      _radarOX = e.clientX - r.left;
      _radarOY = e.clientY - r.top;
      _radarWrap.style.transition = 'none';
    });

    // Resize via corner handle
    _radarResizeH.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      _radarResizing = true;
      _radarEl.style.transition = 'none';
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (_radarDragging) {
        let nx: number = e.clientX - _radarOX;
        let ny: number = e.clientY - _radarOY;
        // Clamp to viewport
        const w: number = _radarWrap.offsetWidth, h: number = _radarWrap.offsetHeight;
        nx = Math.max(0, Math.min(window.innerWidth - w, nx));
        ny = Math.max(40, Math.min(window.innerHeight - h, ny));
        _radarWrap.style.left = nx + 'px';
        _radarWrap.style.top = ny + 'px';
        _radarWrap.style.right = 'auto';
      }
      if (_radarResizing) {
        const r: DOMRect = _radarEl.getBoundingClientRect();
        const newSize: number = Math.round(Math.max(100, Math.min(440, Math.max(r.right - e.clientX, e.clientY - r.top))));
        applyRadarSize(newSize);
        radarSizeSlider.value = String(newSize);
      }
    });

    window.addEventListener('mouseup', () => {
      if (_radarDragging) {
        _radarDragging = false;
        _radarWrap.style.transition = '';
        localStorage.setItem('luminal-radar-pos', JSON.stringify({ left: _radarWrap.style.left, top: _radarWrap.style.top }));
      }
      if (_radarResizing) {
        _radarResizing = false;
        _radarEl.style.transition = '';
        localStorage.setItem('luminal-radar-size', radarSizeSlider.value);
        notifySettingChanged();
      }
    });

    // Restore saved position
    const _savedRadarPos: string | null = localStorage.getItem('luminal-radar-pos');
    if (_savedRadarPos) {
      try {
        const p: { left: string; top: string } = JSON.parse(_savedRadarPos);
        _radarWrap.style.left = p.left;
        _radarWrap.style.top = p.top;
        _radarWrap.style.right = 'auto';
      } catch (e) { warnDev('settings', e); }
    }
  }

  return { radarToggleCtrl, radarMobileHideCtrl };
}

// ── Reset to Defaults ────────────────────────────────────
export function resetRadarDefaults(): void {
  localStorage.removeItem('luminal-radar-size');
  localStorage.removeItem('luminal-radar-pos');

  // Reset radar position
  const radarWrap: HTMLElement = document.getElementById('radar-wrap')!;
  radarWrap.style.left = '';
  radarWrap.style.top = '';
  radarWrap.style.right = '';
}

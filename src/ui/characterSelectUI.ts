// ── Character Select Screen ─────────────────────────────
// Showroom-style vehicle selection with stat bars, flavor text,
// special ability, color picker, and 3D preview.
// Auto-saves vehicle and color to localStorage.

import type { VehicleType } from '../types/index';
import { PLAYER_COLORS, PLAYER_COLOR_CSS_MAP, DEFAULT_PLAYER_COLOR_KEY } from '../playerColors';
import { db } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getPreviewCanvasDeferred, suspendPreviewsByPrefix } from './lobbyPreview';
import { notifySettingChanged } from '../settingsSync';
import { vibrate } from '../vibrate';
import { EVT_CHARACTER_CHANGED } from '../events';
import { logLocal } from '../localDiagnostics';
import { startShowroomEngine, stopShowroomEngineHard } from './characterSelectAudio';
import { getAvailableColors } from '../progression/progressionGuard';
import { getProgressionState } from '../progression/progressionManager';
import { initHubUI, type HubTab } from './hubUI';
import { initUnlocksAndShop, renderUnlocksPanel, renderShopPanel, refreshShopBalance } from './unlocksUI';
import { initMatchSettings } from './matchSettingsUI';

// ── Vehicle Display Data (hand-authored, not computed from physics) ──

interface VehicleDisplayStats {
  name: string;
  flavor: string;
  stats: { label: string; value: number }[];
  special: { name: string; desc: string };
}

const LOADOUT_STATS: Record<VehicleType, VehicleDisplayStats> = {
  bike: {
    name: 'SPECTRE',
    flavor: 'Ultralight precision machine. Speed without compromise.',
    stats: [
      { label: 'SPEED', value: 6 },
      { label: 'BOOST', value: 7 },
      { label: 'ACCEL', value: 10 },
      { label: 'HANDLING', value: 8 },
      { label: 'METER', value: 6 },
    ],
    special: { name: 'SLIPSTREAM', desc: 'Draft off enemy trails to siphon speed and charge boost.' },
  },
  car: {
    name: 'SLINGSHOT',
    flavor: 'Drift-tech muscle. Slide hard. Boost harder.',
    stats: [
      { label: 'SPEED', value: 7 },
      { label: 'BOOST', value: 10 },
      { label: 'ACCEL', value: 5 },
      { label: 'HANDLING', value: 3 },
      { label: 'METER', value: 7 },
    ],
    special: { name: 'SIDEWINDER', desc: 'Hold brake to drift. Drifting builds boost meter.' },
  },
  hoverboard: {
    name: 'VECTOR',
    flavor: 'Carve the grid like deep snow. Flow is everything.',
    stats: [
      { label: 'SPEED', value: 3 },
      { label: 'BOOST', value: 5 },
      { label: 'ACCEL', value: 8 },
      { label: 'HANDLING', value: 10 },
      { label: 'METER', value: 1 },
    ],
    special: { name: 'VECTOR LOCK', desc: 'Grind enemy paths to generate boost... if you can hold the line.' },
  },
};

const LOADOUT_KEYS: VehicleType[] = ['bike', 'car', 'hoverboard'];

/** Vehicles shown as "COMING SOON" — viewable but not selectable. */
const COMING_SOON_VEHICLES: readonly VehicleType[] = [];

/**
 * Vehicles that cannot be selected.
 * Vehicles are core gameplay and are NOT gated by progression: stored
 * `unlockedItems` lists are never reconciled with current defaults, so gating
 * on them locked signed-in accounts out of vehicles that anonymous players
 * could freely pick.
 */
function getDisabledVehicles(): Set<VehicleType> {
  return new Set<VehicleType>(COMING_SOON_VEHICLES);
}

// ── State ────────────────────────────────────────────────

let _selectedVehicle: VehicleType = 'bike';
let _selectedColor: string = DEFAULT_PLAYER_COLOR_KEY;
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;
let _initialized = false;

let _loadoutUid: string | null = null;
let _loadoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
const LOADOUT_DEBOUNCE_MS = 3000;

/** Save current loadout to Firestore (debounced). */
function _scheduleLoadoutSave(): void {
  if (!_loadoutUid) return;
  if (_loadoutSaveTimer) clearTimeout(_loadoutSaveTimer);
  const uid = _loadoutUid;
  _loadoutSaveTimer = setTimeout(async () => {
    _loadoutSaveTimer = null;
    try {
      await updateDoc(doc(db, 'users', uid), {
        loadout: {
          vehicle: localStorage.getItem('luminal-vehicle') || 'bike',
          color: localStorage.getItem('luminal-color') || DEFAULT_PLAYER_COLOR_KEY,
        },
      });
    } catch { /* silently fail */ }
  }, LOADOUT_DEBOUNCE_MS);
}

/** Load loadout from Firestore and write to localStorage. */
export async function restoreLoadoutFromFirestore(uid: string): Promise<void> {
  _loadoutUid = uid;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists() && snap.data().loadout) {
      const loadout = snap.data().loadout;
      if (loadout.vehicle) localStorage.setItem('luminal-vehicle', loadout.vehicle);
      if (loadout.color) localStorage.setItem('luminal-color', loadout.color);
    } else {
      // First login — seed Firestore from current localStorage
      await updateDoc(doc(db, 'users', uid), {
        loadout: {
          vehicle: localStorage.getItem('luminal-vehicle') || 'bike',
          color: localStorage.getItem('luminal-color') || DEFAULT_PLAYER_COLOR_KEY,
        },
      });
    }
  } catch { /* continue with localStorage defaults */ }
}

/** Stop loadout sync (on logout). */
export function stopLoadoutSync(): void {
  if (_loadoutSaveTimer) { clearTimeout(_loadoutSaveTimer); _loadoutSaveTimer = null; }
  _loadoutUid = null;
}

/** Reset loadout localStorage to defaults (on logout). */
export function resetLoadoutDefaults(): void {
  localStorage.setItem('luminal-vehicle', 'bike');
  localStorage.setItem('luminal-color', DEFAULT_PLAYER_COLOR_KEY);
}

// ── DOM refs (cached on init) ────────────────────────────

let _nameEl: HTMLElement;
let _flavorEl: HTMLElement;
let _statsEl: HTMLElement;
let _specialNameEl: HTMLElement;
let _specialDescEl: HTMLElement;
let _colorContainer: HTMLElement;
let _savedEl: HTMLElement;
let _showroomEl: HTMLElement;
let _carouselEl: HTMLElement;

// ── Public API ───────────────────────────────────────────

export function getSelectedVehicle(): VehicleType {
  const saved = localStorage.getItem('luminal-vehicle');
  if (saved === 'bike' || saved === 'car' || saved === 'hoverboard') {
    // If previously-saved vehicle is now disabled, fall back to bike
    return getDisabledVehicles().has(saved as VehicleType) ? 'bike' : saved;
  }
  return 'bike';
}

export function getSelectedColorKey(): string {
  return localStorage.getItem('luminal-color') || DEFAULT_PLAYER_COLOR_KEY;
}

export interface CharacterSelectDeps {
  playTick: () => void;
  onBack: () => void;
}

export function initCharacterSelect(deps: CharacterSelectDeps): void {
  if (_initialized) return;
  _initialized = true;

  // Cache DOM refs
  _nameEl = document.getElementById('cs-vehicle-name')!;
  _flavorEl = document.getElementById('cs-flavor')!;
  _statsEl = document.getElementById('cs-stats')!;
  _specialNameEl = document.getElementById('cs-special-name')!;
  _specialDescEl = document.getElementById('cs-special-desc')!;
  _colorContainer = document.getElementById('cs-color-options')!;
  _savedEl = document.getElementById('cs-saved')!;
  _showroomEl = document.querySelector('.cs-showroom') as HTMLElement;
  _carouselEl = document.getElementById('cs-carousel')!;

  // Load saved state
  _selectedVehicle = getSelectedVehicle();
  _selectedColor = getSelectedColorKey();

  // Build color swatches
  _renderColorSwatches(deps);

  // Wire card clicks
  for (const vKey of LOADOUT_KEYS) {
    const card = document.getElementById(`cs-card-${vKey}`);
    if (!card) continue;
    if (getDisabledVehicles().has(vKey)) {
      card.classList.add('cs-card--disabled');
    }
    card.addEventListener('click', () => {
      if (getDisabledVehicles().has(vKey)) {
        // Show details but don't select
        _applyVehicle(vKey);
        return;
      }
      if (_selectedVehicle === vKey) {
        // Re-clicking current vehicle replays the showroom engine preview
        startShowroomEngine(vKey);
        return;
      }
      deps.playTick();
      _selectVehicle(vKey);
    });
  }

  // Apply initial selection (no save flash on init)
  _applyVehicle(_selectedVehicle);
  _applyColor(_selectedColor, false);

  // Mobile scroll-snap auto-select
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    _initTouchSnap(deps);
  }

  // Desktop: convert vertical wheel → horizontal carousel scroll
  _carouselEl.addEventListener('wheel', (e: WheelEvent) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      _carouselEl.scrollBy({ left: e.deltaY, behavior: 'smooth' });
    }
  }, { passive: false });

  // Hidden console command (legacy — progression system now controls unlocks)
  window.luminalUnlock = (vehicle: string) => {
    logLocal(`%c[LUMINAL] Vehicle unlock is now controlled by progression system (requested: ${vehicle})`, 'color: #00d4ff');
  };

  // Hub coordinator
  initHubUI({
    onBack: () => deps.onBack(),
    onTabChange: (tab: HubTab) => {
      if (tab === 'unlocks') renderUnlocksPanel();
      if (tab === 'shop') { refreshShopBalance(); renderShopPanel(); }
    },
  });
  initUnlocksAndShop();
  initMatchSettings({ playTick: deps.playTick });
}

// ── Screen enter/exit hooks (called by navigation system) ──

export function onCharacterSelectExit(): void {
  stopShowroomEngineHard();
  // Park preview scenes (stop rendering but keep for fast re-entry)
  suspendPreviewsByPrefix('cs-');
  for (const vKey of LOADOUT_KEYS) {
    const wrap = document.getElementById(`cs-canvas-wrap-${vKey}`);
    if (wrap) wrap.innerHTML = '';
  }
}

export function onCharacterSelectEnter(): void {
  // Refresh previews with current color in case it changed from match-options
  const currentColor = getSelectedColorKey();
  if (currentColor !== _selectedColor) {
    _selectedColor = currentColor;
    _applyColor(_selectedColor, false);
  }
  const currentVehicle = getSelectedVehicle();
  if (currentVehicle !== _selectedVehicle) {
    _selectedVehicle = currentVehicle;
    _applyVehicle(_selectedVehicle);
  }
  _refreshPreviews();
  // Restore carousel scroll position to the selected card (especially after reload)
  _scrollToSelected(false);
  // Set initial dot indicator to match the selected vehicle
  const initIdx = LOADOUT_KEYS.indexOf(_selectedVehicle);
  if (initIdx >= 0) _updateDots(initIdx);
}

function _scrollToSelected(animate = true): void {
  if (!_carouselEl) return;
  const card = document.getElementById(`cs-card-${_selectedVehicle}`);
  if (!card) return;
  requestAnimationFrame(() => {
    if (!_carouselEl) return;
    const cardLeft = (card as HTMLElement).offsetLeft;
    const cardW = (card as HTMLElement).offsetWidth;
    const carouselW = _carouselEl.offsetWidth;
    const target = cardLeft - (carouselW - cardW) / 2;
    if (animate) {
      _carouselEl.scrollTo({ left: target, behavior: 'smooth' });
    } else {
      _carouselEl.scrollLeft = target;
    }
  });
}

// ── Vehicle Selection ────────────────────────────────────

function _selectVehicle(type: VehicleType): void {
  _selectedVehicle = type;
  localStorage.setItem('luminal-vehicle', type);
  _scheduleLoadoutSave();
  _applyVehicle(type);
  notifySettingChanged();
  _flashSaved();
  startShowroomEngine(type);
  _scrollToSelected(true);
  window.dispatchEvent(new CustomEvent(EVT_CHARACTER_CHANGED, { detail: { vehicle: type } }));
}

function _applyVehicle(type: VehicleType): void {
  const disabledSet = getDisabledVehicles();
  const isDisabled = disabledSet.has(type);

  // Update card selected states — disabled cards show --viewing instead of --selected
  for (const vKey of LOADOUT_KEYS) {
    const card = document.getElementById(`cs-card-${vKey}`);
    if (!card) continue;
    if (disabledSet.has(vKey)) {
      card.classList.toggle('cs-card--viewing', vKey === type);
      card.classList.remove('cs-card--selected');
    } else {
      card.classList.toggle('cs-card--selected', vKey === _selectedVehicle);
      card.classList.remove('cs-card--viewing');
    }
  }

  // Update detail panel
  const data = LOADOUT_STATS[type];
  _nameEl.textContent = data.name;
  _flavorEl.textContent = data.flavor;
  _renderStats(data.stats);
  _specialNameEl.textContent = data.special.name;
  _specialDescEl.textContent = data.special.desc;

  // Toggle "COMING SOON..." badge on name
  const badge = document.getElementById('cs-coming-soon');
  if (badge) badge.style.display = isDisabled ? '' : 'none';
}

// ── Color Selection ──────────────────────────────────────

function _selectColor(key: string, deps: CharacterSelectDeps): void {
  if (key === _selectedColor) return;
  _selectedColor = key;
  localStorage.setItem('luminal-color', key);
  _scheduleLoadoutSave();
  _applyColor(key, true);
  notifySettingChanged();
  deps.playTick();
  _flashSaved();
  window.dispatchEvent(new CustomEvent(EVT_CHARACTER_CHANGED, { detail: { color: key } }));
}

function _applyColor(key: string, refreshPreviews: boolean): void {
  // Update swatch selection
  _colorContainer.querySelectorAll('.cs-color').forEach((el) => {
    (el as HTMLElement).classList.toggle('cs-color--selected', (el as HTMLElement).dataset.color === key);
  });

  // Update showroom glow CSS variable
  const css = PLAYER_COLOR_CSS_MAP[key] || PLAYER_COLOR_CSS_MAP[DEFAULT_PLAYER_COLOR_KEY];
  if (_showroomEl) _showroomEl.style.setProperty('--cs-glow', css + '22');

  // Also update card glow
  for (const vKey of LOADOUT_KEYS) {
    const card = document.getElementById(`cs-card-${vKey}`);
    if (card) card.style.setProperty('--cs-glow', css + '18');
  }

  // Update floor glow
  const floor = document.querySelector('.cs-floor') as HTMLElement | null;
  if (floor) floor.style.setProperty('--cs-glow', css + '12');

  // Sync match-options color swatches (so both pickers stay in sync)
  document.querySelectorAll('#match-options .color-opt').forEach((el) => {
    (el as HTMLElement).classList.toggle('color-opt--selected', (el as HTMLElement).dataset.color === key);
  });

  if (refreshPreviews) _refreshPreviews();
}

// ── Stats Rendering ──────────────────────────────────────

function _renderStats(stats: { label: string; value: number }[]): void {
  _statsEl.innerHTML = '';
  const fills: HTMLElement[] = [];
  for (const stat of stats) {
    const row = document.createElement('div');
    row.className = 'cs-stat-row';

    const label = document.createElement('span');
    label.className = 'cs-stat-label';
    label.textContent = stat.label;

    const track = document.createElement('div');
    track.className = 'cs-stat-track';

    const fill = document.createElement('div');
    fill.className = 'cs-stat-fill';
    fill.style.width = '0%';
    track.appendChild(fill);
    fills.push(fill);

    const val = document.createElement('span');
    val.className = 'cs-stat-val';
    val.textContent = String(stat.value);

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(val);
    _statsEl.appendChild(row);
  }

  // Stagger the fill animations 50ms apart so bars sweep in left-to-right.
  // The CSS transition (width 0.35s var(--ease-default)) drives the animation.
  for (let i = 0; i < fills.length; i++) {
    const target = `${stats[i].value * 10}%`;
    setTimeout(() => { fills[i].style.width = target; }, i * 50);
  }
}

// ── Color Swatches ───────────────────────────────────────

function _renderColorSwatches(deps: CharacterSelectDeps): void {
  _colorContainer.innerHTML = '';
  const progState = getProgressionState();
  const availableColors = getAvailableColors(progState);
  for (const { key, css } of PLAYER_COLORS) {
    const dot = document.createElement('div');
    dot.className = 'cs-color';
    dot.dataset.color = key;
    dot.id = `cs-color-${key}`;
    dot.tabIndex = 0;
    dot.style.background = css;
    dot.style.boxShadow = `0 0 8px ${css}`;
    if (key === _selectedColor) dot.classList.add('cs-color--selected');

    if (!availableColors.includes(key)) {
      dot.classList.add('color-swatch--locked');
      dot.style.opacity = '0.3';
      dot.style.pointerEvents = 'none';
    } else {
      dot.addEventListener('click', () => _selectColor(key, deps));
      dot.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _selectColor(key, deps);
        }
      });
    }

    _colorContainer.appendChild(dot);
  }
}

// ── 3D Previews ──────────────────────────────────────────

function _initPreviews(): void {
  _refreshPreviews();
}

function _refreshPreviews(): void {
  // Build selected vehicle immediately, stagger others to avoid frame freeze
  _loadPreview(_selectedVehicle);
  let frame = 0;
  for (const vKey of LOADOUT_KEYS) {
    if (vKey === _selectedVehicle) continue;
    frame++;
    const key = vKey;
    const delay = frame;
    _afterFrames(delay, () => _loadPreview(key));
  }
}

function _loadPreview(vKey: VehicleType): void {
  const wrap = document.getElementById(`cs-canvas-wrap-${vKey}`);
  if (!wrap) return;
  getPreviewCanvasDeferred(`cs-${vKey}`, _selectedColor, vKey, (canvas) => {
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  });
}

function _afterFrames(n: number, fn: () => void): void {
  if (n <= 0) { fn(); return; }
  requestAnimationFrame(() => _afterFrames(n - 1, fn));
}

// ── Save Toast ───────────────────────────────────────────

function _flashSaved(): void {
  if (!_savedEl) return;
  _savedEl.classList.add('cs-saved--visible');
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    _savedEl.classList.remove('cs-saved--visible');
    _saveTimeout = null;
  }, 1200);
}

// ── Carousel Dot Indicators ──────────────────────────────

function _updateDots(activeIdx: number): void {
  const dots = document.querySelectorAll('.cs-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('cs-dot--active', i === activeIdx);
  });
}

// ── Touch Snap (mobile carousel) ─────────────────────────

function _initTouchSnap(deps: CharacterSelectDeps): void {
  let snapRaf: number | null = null;
  let lastSnapIdx = -1;

  function updateSnap(): void {
    const gridRect = _carouselEl.getBoundingClientRect();
    const center = gridRect.left + gridRect.width / 2;
    let closestIdx = 0;
    let closestDist = Infinity;

    LOADOUT_KEYS.forEach((v, i) => {
      const card = document.getElementById(`cs-card-${v}`);
      if (card) {
        const r = card.getBoundingClientRect();
        const cardCenter = r.left + r.width / 2;
        const dist = Math.abs(cardCenter - center);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
    });

    if (closestIdx !== lastSnapIdx) {
      lastSnapIdx = closestIdx;
      _updateDots(closestIdx);
      vibrate(10);
      const vType = LOADOUT_KEYS[closestIdx];
      if (getDisabledVehicles().has(vType)) {
        // Show details but keep previous selection
        _applyVehicle(vType);
      } else if (vType !== _selectedVehicle) {
        deps.playTick();
        _selectVehicle(vType);
      }
    }
  }

  _carouselEl.addEventListener('scroll', () => {
    if (snapRaf) cancelAnimationFrame(snapRaf);
    snapRaf = requestAnimationFrame(updateSnap);
  }, { passive: true });
}

// ── For testing ──────────────────────────────────────────

export function _resetForTesting(): void {
  _selectedVehicle = 'bike';
  _selectedColor = DEFAULT_PLAYER_COLOR_KEY;
  _initialized = false;
  if (_saveTimeout) { clearTimeout(_saveTimeout); _saveTimeout = null; }
  // Note: event listeners from previous initCharacterSelect() runs remain
  // attached to DOM nodes. Tests that re-init and click must use fresh
  // vi.fn() deps — stale listeners will still fire but will target the
  // previous test's (now-unused) mock instances.
}

// ts-prune-ignore-next
export { LOADOUT_STATS as _LOADOUT_STATS_FOR_TESTING };

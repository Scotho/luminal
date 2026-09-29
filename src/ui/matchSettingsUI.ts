/**
 * MATCH tab — arena, difficulty, best-of, enemies selectors.
 * Disabled during active matches (between rounds).
 */

import { renderMapCarousel } from './mapCarousel';
import { renderDifficultySelector } from './difficultySelectUI';
import { notifySettingChanged } from '../settingsSync';

let _initialized = false;
let _isMatchActive = false;

export function initMatchSettings(deps: { playTick?: () => void }): void {
  if (_initialized) return;
  _initialized = true;

  // Arena carousel (moved from loadout showroom into MATCH tab)
  const mapContainer = document.getElementById('cs-map-options');
  if (mapContainer) {
    renderMapCarousel({ mode: 'solo', container: mapContainer, orientation: 'landscape', playTick: deps.playTick });
  }

  // Difficulty selector (moved from loadout header into MATCH tab)
  const diffContainer = document.getElementById('cs-difficulty-options');
  if (diffContainer) {
    renderDifficultySelector({ container: diffContainer });
  }

  // Best-of selector
  _renderSelector('hub-bestof-options', 'bestof', [
    { label: '1', value: '1' },
    { label: '3', value: '3' },
    { label: '5', value: '5' },
  ], localStorage.getItem('luminal-bestof') || '1');

  // Enemies selector
  _renderSelector('hub-enemies-options', 'opponents', [
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
  ], localStorage.getItem('luminal-opponents') || '1');
}

interface SelectorOption {
  label: string;
  value: string;
}

function _renderSelector(containerId: string, storageKey: string, options: SelectorOption[], currentValue: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'cs-selector-row';

  let selectedIdx = options.findIndex(o => o.value === currentValue);
  if (selectedIdx < 0) selectedIdx = 0;

  const valueEl = document.createElement('span');
  valueEl.className = 'cs-selector-value';
  valueEl.textContent = options[selectedIdx].label;

  const update = (dir: -1 | 1) => {
    if (_isMatchActive) return;
    selectedIdx = (selectedIdx + dir + options.length) % options.length;
    valueEl.textContent = options[selectedIdx].label;
    localStorage.setItem(`luminal-${storageKey}`, options[selectedIdx].value);
    notifySettingChanged();
  };

  const leftBtn = document.createElement('button');
  leftBtn.className = 'cs-selector-arrow cs-selector-arrow--left';
  leftBtn.type = 'button';
  leftBtn.setAttribute('aria-label', `Previous ${storageKey}`);
  leftBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  leftBtn.addEventListener('click', () => update(-1));

  const rightBtn = document.createElement('button');
  rightBtn.className = 'cs-selector-arrow cs-selector-arrow--right';
  rightBtn.type = 'button';
  rightBtn.setAttribute('aria-label', `Next ${storageKey}`);
  rightBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  rightBtn.addEventListener('click', () => update(1));

  row.appendChild(leftBtn);
  row.appendChild(valueEl);
  row.appendChild(rightBtn);
  container.appendChild(row);
}

/** Called by match lifecycle to enable/disable MATCH controls. */
export function setMatchActive(active: boolean): void {
  _isMatchActive = active;
  const overlay = document.getElementById('hub-match-disabled');
  if (overlay) overlay.classList.toggle('hidden', !active);
}

export function isMatchActive(): boolean { return _isMatchActive; }

export function _resetForTesting(): void {
  _initialized = false;
  _isMatchActive = false;
}

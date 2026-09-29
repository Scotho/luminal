import type { AIDifficulty } from '../types/index';
import { vibrate } from '../vibrate';

const STORAGE_KEY = 'luminal-difficulty';
const DIFFICULTIES: { id: AIDifficulty; label: string }[] = [
  { id: 'easy', label: 'EASY' },
  { id: 'medium', label: 'MEDIUM' },
  { id: 'hard', label: 'HARD' },
];

export function getSelectedDifficulty(): AIDifficulty {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'easy' || saved === 'medium' || saved === 'hard') return saved;
  return 'medium';
}

export function setSelectedDifficulty(d: AIDifficulty): void {
  localStorage.setItem(STORAGE_KEY, d);
}

interface DifficultySelectorOptions {
  container: HTMLElement;
  playTick?: () => void;
  compact?: boolean;
}

function _getIndex(): number {
  const current = getSelectedDifficulty();
  return DIFFICULTIES.findIndex(d => d.id === current);
}

function _cycle(dir: -1 | 1, opts: DifficultySelectorOptions): void {
  const idx = _getIndex();
  const next = Math.max(0, Math.min(DIFFICULTIES.length - 1, idx + dir));
  if (next === idx) return;
  vibrate(10);
  opts.playTick?.();
  setSelectedDifficulty(DIFFICULTIES[next].id);
  renderDifficultySelector(opts);
}

export function renderDifficultySelector(opts: DifficultySelectorOptions): void {
  const { container } = opts;
  container.innerHTML = '';

  if (!opts.compact) {
    const label = document.createElement('div');
    label.className = 'cs-selector-label';
    label.textContent = 'AI DIFFICULTY';
    container.appendChild(label);
  }

  const row = document.createElement('div');
  row.className = 'cs-selector-row' + (opts.compact ? ' cs-selector-row--compact' : '');

  if (opts.compact) {
    const compactPrefix = document.createElement('span');
    compactPrefix.className = 'cs-selector-row-prefix';
    compactPrefix.textContent = 'AI';
    row.appendChild(compactPrefix);
  }

  const idx = _getIndex();
  const current = DIFFICULTIES[idx];

  // Left arrow
  const leftBtn = document.createElement('button');
  leftBtn.className = 'cs-selector-arrow';
  leftBtn.textContent = '\u25C0'; // ◀
  leftBtn.disabled = idx === 0;
  leftBtn.setAttribute('aria-label', 'Previous difficulty');
  leftBtn.addEventListener('click', () => _cycle(-1, opts));

  // Value display
  const value = document.createElement('span');
  value.className = 'cs-selector-value';
  value.textContent = current.label;

  // Right arrow
  const rightBtn = document.createElement('button');
  rightBtn.className = 'cs-selector-arrow';
  rightBtn.textContent = '\u25B6'; // ▶
  rightBtn.disabled = idx === DIFFICULTIES.length - 1;
  rightBtn.setAttribute('aria-label', 'Next difficulty');
  rightBtn.addEventListener('click', () => _cycle(1, opts));

  row.appendChild(leftBtn);
  row.appendChild(value);
  row.appendChild(rightBtn);
  container.appendChild(row);
}

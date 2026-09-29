// ── Touch Controls Tutorial ─────────────────────────────
// Progressive disclosure mini-tutorial for mobile controls.
// Shows one mechanic at a time with animated hand prompt +
// pulsing highlight on the relevant button/zone.
//
// Based on industry best practices:
// - Asphalt 9: pulsing highlights during first race
// - Mario Kart Tour: one-finger progressive onboarding
// - Apple HIG: teach one mechanic at a time, allow skip
//
// Shown on first play per localStorage flag. Replayable.

import type { VehicleType } from './types/index';

// ── Types ───────────────────────────────────────────────

interface TutorialStep {
  /** Element ID to highlight (button or zone). */
  targetId: string;
  /** Short instruction text. */
  text: string;
  /** Icon to show next to text. */
  icon: string;
  /** Duration in ms before auto-advancing (0 = wait for press). */
  autoAdvanceMs: number;
}

type TouchMode = 'gestures' | 'buttons';

// ── Step Definitions ────────────────────────────────────

function _getButtonSteps(vehicle: VehicleType): TutorialStep[] {
  const steps: TutorialStep[] = [
    { targetId: 'tb-left',  text: 'TAP to steer left',    icon: '\u{1F448}', autoAdvanceMs: 2500 },
    { targetId: 'tb-right', text: 'TAP to steer right',   icon: '\u{1F449}', autoAdvanceMs: 2500 },
    { targetId: 'tb-gas',   text: 'HOLD to accelerate',   icon: '\u{1F446}', autoAdvanceMs: 2500 },
    { targetId: 'tb-boost', text: 'TAP to boost',         icon: '\u26A1',    autoAdvanceMs: 2500 },
    { targetId: 'tb-brake', text: 'HOLD to brake',        icon: '\u{1F447}', autoAdvanceMs: 2500 },
  ];
  if (vehicle === 'car') {
    steps.push({ targetId: 'tb-context', text: 'HOLD while turning to drift', icon: '\u{1F30A}', autoAdvanceMs: 3000 });
  } else if (vehicle === 'hoverboard') {
    steps.push({ targetId: 'tb-context', text: 'TAP to hover',               icon: '\u{1FA82}', autoAdvanceMs: 2500 });
  }
  return steps;
}

function _getGestureSteps(vehicle: VehicleType): TutorialStep[] {
  const steps: TutorialStep[] = [
    { targetId: 'touch-overlay', text: 'TAP left or right half to steer', icon: '\u{1F448}\u{1F449}', autoAdvanceMs: 2500 },
    { targetId: 'touch-overlay', text: 'SLIDE UP to accelerate',          icon: '\u{1F446}',          autoAdvanceMs: 2500 },
    { targetId: 'touch-overlay', text: 'SLIDE DOWN to brake',             icon: '\u{1F447}',          autoAdvanceMs: 2500 },
    { targetId: 'touch-overlay', text: 'TAP both sides to boost',         icon: '\u26A1',             autoAdvanceMs: 3000 },
  ];
  if (vehicle === 'car') {
    steps.push({ targetId: 'touch-overlay', text: 'SLIDE DOWN + steer to drift', icon: '\u{1F30A}', autoAdvanceMs: 3000 });
  }
  return steps;
}

// ── State ───────────────────────────────────────────────

const STORAGE_KEY = 'luminal-touch-tutorial-done';

let _overlay: HTMLElement | null = null;
let _textEl: HTMLElement | null = null;
let _iconEl: HTMLElement | null = null;
let _skipBtn: HTMLButtonElement | null = null;
let _highlightEl: HTMLElement | null = null;
let _stepDotContainer: HTMLElement | null = null;

let _steps: TutorialStep[] = [];
let _currentStep = 0;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _active = false;

// ── DOM ─────────────────────────────────────────────────

function _ensureOverlay(): void {
  if (_overlay) return;

  _overlay = document.createElement('div');
  _overlay.id = 'touch-tutorial';
  _overlay.classList.add('hidden');
  _overlay.setAttribute('role', 'dialog');
  _overlay.setAttribute('aria-label', 'Touch controls tutorial');

  // Highlight ring (positioned over target button)
  _highlightEl = document.createElement('div');
  _highlightEl.className = 'tt-highlight';
  _overlay.appendChild(_highlightEl);

  // Instruction card
  const card = document.createElement('div');
  card.className = 'tt-card';

  _iconEl = document.createElement('span');
  _iconEl.className = 'tt-icon';
  card.appendChild(_iconEl);

  _textEl = document.createElement('span');
  _textEl.className = 'tt-text';
  card.appendChild(_textEl);

  _overlay.appendChild(card);

  // Step dots
  _stepDotContainer = document.createElement('div');
  _stepDotContainer.className = 'tt-dots';
  _overlay.appendChild(_stepDotContainer);

  // Skip button
  _skipBtn = document.createElement('button') as HTMLButtonElement;
  _skipBtn.className = 'tt-skip';
  _skipBtn.textContent = 'SKIP';
  _skipBtn.type = 'button';
  _skipBtn.addEventListener('click', () => dismiss());
  _skipBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); });
  _overlay.appendChild(_skipBtn);

  // Tap overlay to advance
  _overlay.addEventListener('touchstart', (e) => {
    e.preventDefault();
    _advance();
  }, { passive: false });

  document.body.appendChild(_overlay);
}

function _renderStep(): void {
  if (!_overlay || !_textEl || !_iconEl || !_highlightEl || !_stepDotContainer) return;
  if (_currentStep >= _steps.length) { dismiss(); return; }

  const step = _steps[_currentStep];
  _textEl.textContent = step.text;
  _iconEl.textContent = step.icon;

  // Position highlight over target element
  const target = document.getElementById(step.targetId);
  if (target && !target.classList.contains('hidden')) {
    const rect = target.getBoundingClientRect();
    const pad = 8;
    _highlightEl.style.left = `${rect.left - pad}px`;
    _highlightEl.style.top = `${rect.top - pad}px`;
    _highlightEl.style.width = `${rect.width + pad * 2}px`;
    _highlightEl.style.height = `${rect.height + pad * 2}px`;
    _highlightEl.style.borderRadius = getComputedStyle(target).borderRadius;
    _highlightEl.classList.remove('hidden');
  } else {
    _highlightEl.classList.add('hidden');
  }

  // Update step dots
  _stepDotContainer.innerHTML = '';
  for (let i = 0; i < _steps.length; i++) {
    const dot = document.createElement('span');
    dot.className = `tt-dot${i === _currentStep ? ' tt-dot--active' : ''}`;
    _stepDotContainer.appendChild(dot);
  }

  // Auto-advance timer
  if (_timer) clearTimeout(_timer);
  if (step.autoAdvanceMs > 0) {
    _timer = setTimeout(() => _advance(), step.autoAdvanceMs);
  }
}

function _advance(): void {
  _currentStep++;
  if (_currentStep >= _steps.length) {
    dismiss();
  } else {
    _renderStep();
  }
}

// ── Public API ──────────────────────────────────────────

/** Show tutorial if not already completed. Call during countdown. */
// ts-prune-ignore-next
export function showTutorialIfNeeded(mode: TouchMode, vehicle: VehicleType): void {
  if (localStorage.getItem(STORAGE_KEY) === '1') return;
  startTutorial(mode, vehicle);
}

/** Force-start tutorial (e.g. from settings "How to Play"). */
export function startTutorial(mode: TouchMode, vehicle: VehicleType): void {
  _ensureOverlay();
  _steps = mode === 'buttons' ? _getButtonSteps(vehicle) : _getGestureSteps(vehicle);
  _currentStep = 0;
  _active = true;
  if (_overlay) _overlay.classList.remove('hidden');
  _renderStep();
}

/** Dismiss tutorial and mark as done. */
export function dismiss(): void {
  _active = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (_overlay) _overlay.classList.add('hidden');
  localStorage.setItem(STORAGE_KEY, '1');
}

/** Whether the tutorial is currently showing. */
// ts-prune-ignore-next
export function isTutorialActive(): boolean {
  return _active;
}

/** Reset completion flag (for testing or settings reset). */
// ts-prune-ignore-next
export function resetTutorialFlag(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Reset module state for testing. */
// ts-prune-ignore-next
export function _resetTutorialForTest(): void {
  _active = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _overlay?.remove();
  _overlay = null;
  _textEl = null;
  _iconEl = null;
  _skipBtn = null;
  _highlightEl = null;
  _stepDotContainer = null;
  _steps = [];
  _currentStep = 0;
  localStorage.removeItem(STORAGE_KEY);
}

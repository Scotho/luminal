// ── Reusable Settings Control Bindings ───────────────────
// Factories for toggle, slider, and cycler controls that handle
// event wiring, active-class sync, and localStorage persistence.

import { getLocalString, setLocalString } from './storage';

// ── Toggle ──────────────────────────────────────────────

export interface ToggleHandle {
  getValue(): string;
  setValue(v: string): void;
}

/**
 * Bind a segmented toggle (.control-toggle__option elements).
 * Handles: click → read data-val → update active class → persist → call onChange.
 */
export function createToggle(config: {
  el: HTMLElement;
  storageKey: string;
  defaultVal?: string;
  onChange: (val: string) => void;
}): ToggleHandle {
  const { el, storageKey, onChange } = config;
  const defaultVal = config.defaultVal ?? 'off';

  function syncActiveClass(val: string): void {
    el.querySelectorAll('.control-toggle__option').forEach((opt: Element) => {
      (opt as HTMLElement).classList.toggle(
        'control-toggle__option--active',
        (opt as HTMLElement).dataset.val === val,
      );
    });
  }

  let current = getLocalString(storageKey, defaultVal);
  syncActiveClass(current);

  function setTo(val: string): void {
    current = val;
    setLocalString(storageKey, current);
    syncActiveClass(current);
    onChange(current);
  }

  el.addEventListener('click', (e: Event) => {
    const opt = (e.target as HTMLElement).closest('.control-toggle__option') as HTMLElement | null;
    if (!opt) return;
    e.stopPropagation();
    setTo(opt.dataset.val!);
  });

  return {
    getValue: () => current,
    setValue(v: string) {
      current = v;
      setLocalString(storageKey, v);
      syncActiveClass(v);
    },
  };
}

// ── Slider ──────────────────────────────────────────────

/**
 * Bind a range slider with live preview on 'input' and persistence on 'change'.
 * Restores the saved value from localStorage on creation.
 */
export function createSlider(config: {
  el: HTMLInputElement;
  storageKey?: string;
  onInput: (val: number) => void;
  onChange?: (val: number) => void;
}): void {
  const { el, storageKey, onInput, onChange } = config;
  if (storageKey) {
    const saved = getLocalString(storageKey);
    if (saved) el.value = saved;
  }

  el.addEventListener('input', () => onInput(Number(el.value)));
  el.addEventListener('change', () => {
    if (storageKey) setLocalString(storageKey, el.value);
    onChange?.(Number(el.value));
  });
}

// ── Cycler ──────────────────────────────────────────────

export interface CyclerHandle {
  getIndex(): number;
  setIndex(i: number): void;
}

/**
 * Bind left/right arrow cycling through a list of options.
 * Wraps around at both ends.
 */
// ts-prune-ignore-next
export function createCycler(config: {
  leftBtn: HTMLElement;
  rightBtn: HTMLElement;
  label: HTMLElement;
  options: { value: string; label: string }[];
  initialIndex?: number;
  onChange: (val: string, idx: number) => void;
}): CyclerHandle {
  const { leftBtn, rightBtn, label, options, onChange } = config;
  let idx = config.initialIndex ?? 0;

  function update(): void {
    label.textContent = options[idx].label;
    onChange(options[idx].value, idx);
  }

  leftBtn.addEventListener('click', () => {
    idx = cycleIndex(idx, -1, options.length);
    update();
  });

  rightBtn.addEventListener('click', () => {
    idx = cycleIndex(idx, 1, options.length);
    update();
  });

  update();

  return {
    getIndex: () => idx,
    setIndex(i: number) { idx = i; update(); },
  };
}

// ── Utilities ───────────────────────────────────────────

/** Wrap-around index cycling: (2, 1, 3) → 0, (0, -1, 3) → 2. */
export function cycleIndex(current: number, dir: -1 | 1, length: number): number {
  return (current + dir + length) % length;
}

// ── Controls Factory Tests ───────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createToggle, createSlider, createCycler, cycleIndex } from '../controls';

beforeEach(() => {
  localStorage.clear();
});

// ── Toggle ──────────────────────────────────────────────

function makeToggleDOM(values: string[]): HTMLElement {
  const el = document.createElement('span');
  el.className = 'control-toggle';
  for (const val of values) {
    const opt = document.createElement('span');
    opt.className = 'control-toggle__option';
    opt.dataset.val = val;
    opt.textContent = val.toUpperCase();
    el.appendChild(opt);
  }
  document.body.appendChild(el);
  return el;
}

describe('createToggle', () => {
  it('initializes with defaultVal and syncs active class', () => {
    const el = makeToggleDOM(['off', 'on']);
    createToggle({ el, storageKey: 'test-toggle', defaultVal: 'on', onChange: vi.fn() });

    const opts = el.querySelectorAll('.control-toggle__option');
    expect((opts[0] as HTMLElement).classList.contains('control-toggle__option--active')).toBe(false);
    expect((opts[1] as HTMLElement).classList.contains('control-toggle__option--active')).toBe(true);
    el.remove();
  });

  it('reads initial value from localStorage', () => {
    localStorage.setItem('test-toggle', 'off');
    const el = makeToggleDOM(['off', 'on']);
    const handle = createToggle({ el, storageKey: 'test-toggle', defaultVal: 'on', onChange: vi.fn() });

    expect(handle.getValue()).toBe('off');
    el.remove();
  });

  it('updates on click and calls onChange', () => {
    const el = makeToggleDOM(['off', 'on']);
    const onChange = vi.fn();
    const handle = createToggle({ el, storageKey: 'test-toggle', defaultVal: 'off', onChange });

    // Click the 'on' option
    const onOpt = el.querySelectorAll('.control-toggle__option')[1] as HTMLElement;
    onOpt.click();

    expect(handle.getValue()).toBe('on');
    expect(onChange).toHaveBeenCalledWith('on');
    expect(localStorage.getItem('test-toggle')).toBe('on');
    expect(onOpt.classList.contains('control-toggle__option--active')).toBe(true);
    el.remove();
  });

  it('setValue updates programmatically', () => {
    const el = makeToggleDOM(['off', 'on']);
    const handle = createToggle({ el, storageKey: 'test-toggle', defaultVal: 'off', onChange: vi.fn() });

    handle.setValue('on');
    expect(handle.getValue()).toBe('on');
    expect(localStorage.getItem('test-toggle')).toBe('on');
    const opts = el.querySelectorAll('.control-toggle__option');
    expect((opts[1] as HTMLElement).classList.contains('control-toggle__option--active')).toBe(true);
    el.remove();
  });

  it('ignores clicks outside options', () => {
    const el = makeToggleDOM(['off', 'on']);
    const onChange = vi.fn();
    createToggle({ el, storageKey: 'test-toggle', defaultVal: 'off', onChange });

    el.click(); // click on container, not an option
    expect(onChange).not.toHaveBeenCalled();
    el.remove();
  });
});

// ── Slider ──────────────────────────────────────────────

describe('createSlider', () => {
  it('restores saved value from localStorage', () => {
    localStorage.setItem('test-slider', '75');
    const el = document.createElement('input');
    el.type = 'range';
    el.min = '0';
    el.max = '100';
    el.value = '50';

    createSlider({ el, storageKey: 'test-slider', onInput: vi.fn() });
    expect(el.value).toBe('75');
  });

  it('calls onInput on input event', () => {
    const el = document.createElement('input');
    el.type = 'range';
    el.value = '50';
    const onInput = vi.fn();

    createSlider({ el, storageKey: 'test-slider', onInput });
    el.value = '80';
    el.dispatchEvent(new Event('input'));
    expect(onInput).toHaveBeenCalledWith(80);
  });

  it('saves to localStorage and calls onChange on change event', () => {
    const el = document.createElement('input');
    el.type = 'range';
    el.value = '50';
    const onChange = vi.fn();

    createSlider({ el, storageKey: 'test-slider', onInput: vi.fn(), onChange });
    el.value = '60';
    el.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('test-slider')).toBe('60');
    expect(onChange).toHaveBeenCalledWith(60);
  });
});

// ── Cycler ──────────────────────────────────────────────

function makeCyclerDOM(): { left: HTMLElement; right: HTMLElement; label: HTMLElement } {
  const left = document.createElement('span');
  const right = document.createElement('span');
  const label = document.createElement('span');
  document.body.append(left, right, label);
  return { left, right, label };
}

describe('createCycler', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Charlie' },
  ];

  it('displays initial option', () => {
    const { left, right, label } = makeCyclerDOM();
    const onChange = vi.fn();
    createCycler({ leftBtn: left, rightBtn: right, label, options, onChange });

    expect(label.textContent).toBe('Alpha');
    expect(onChange).toHaveBeenCalledWith('a', 0);
    left.remove(); right.remove(); label.remove();
  });

  it('cycles right', () => {
    const { left, right, label } = makeCyclerDOM();
    const onChange = vi.fn();
    createCycler({ leftBtn: left, rightBtn: right, label, options, onChange });

    right.click();
    expect(label.textContent).toBe('Beta');
    expect(onChange).toHaveBeenLastCalledWith('b', 1);
    left.remove(); right.remove(); label.remove();
  });

  it('wraps around right', () => {
    const { left, right, label } = makeCyclerDOM();
    const onChange = vi.fn();
    createCycler({ leftBtn: left, rightBtn: right, label, options, initialIndex: 2, onChange });

    right.click();
    expect(label.textContent).toBe('Alpha');
    left.remove(); right.remove(); label.remove();
  });

  it('wraps around left', () => {
    const { left, right, label } = makeCyclerDOM();
    const onChange = vi.fn();
    createCycler({ leftBtn: left, rightBtn: right, label, options, onChange });

    left.click();
    expect(label.textContent).toBe('Charlie');
    left.remove(); right.remove(); label.remove();
  });

  it('setIndex updates programmatically', () => {
    const { left, right, label } = makeCyclerDOM();
    const onChange = vi.fn();
    const handle = createCycler({ leftBtn: left, rightBtn: right, label, options, onChange });

    handle.setIndex(2);
    expect(label.textContent).toBe('Charlie');
    expect(handle.getIndex()).toBe(2);
    left.remove(); right.remove(); label.remove();
  });
});

// ── cycleIndex ──────────────────────────────────────────

describe('cycleIndex', () => {
  it('increments normally', () => {
    expect(cycleIndex(0, 1, 3)).toBe(1);
  });

  it('wraps around forward', () => {
    expect(cycleIndex(2, 1, 3)).toBe(0);
  });

  it('wraps around backward', () => {
    expect(cycleIndex(0, -1, 3)).toBe(2);
  });

  it('decrements normally', () => {
    expect(cycleIndex(2, -1, 3)).toBe(1);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { updateStreakDisplay, hideStreakDisplay } from '../streakUI';

describe('updateStreakDisplay', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="streak-display" class="hidden">
        STREAK <span class="streak-num" data-streak="0">0</span>
        <span class="streak-proximity"></span>
        <div class="streak-tier-flash"></div>
        <div class="streak-electric-sweep"></div>
      </div>
    `;
  });

  it('shows streak display when streak >= 1', () => {
    updateStreakDisplay(1, 0, 5);
    const el = document.getElementById('streak-display')!;
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('hides streak display when streak < 1', () => {
    updateStreakDisplay(0, 0, 5);
    const el = document.getElementById('streak-display')!;
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('updates streak number text and data attribute', () => {
    updateStreakDisplay(7, 0, 10);
    const num = document.querySelector('.streak-num')!;
    expect(num.textContent).toBe('7');
    expect(num.getAttribute('data-streak')).toBe('7');
  });

  it('applies tier-1 class for streak 3', () => {
    updateStreakDisplay(3, 0, 10);
    const el = document.getElementById('streak-display')!;
    expect(el.classList.contains('streak-tier-1')).toBe(true);
  });

  it('applies tier-2 class for streak 5', () => {
    updateStreakDisplay(5, 0, 10);
    const el = document.getElementById('streak-display')!;
    expect(el.classList.contains('streak-tier-2')).toBe(true);
  });

  it('applies tier-3 class for streak 10', () => {
    updateStreakDisplay(10, 0, 20);
    const el = document.getElementById('streak-display')!;
    expect(el.classList.contains('streak-tier-3')).toBe(true);
  });

  it('applies tier-4 class for streak 20', () => {
    updateStreakDisplay(20, 0, 30);
    const el = document.getElementById('streak-display')!;
    expect(el.classList.contains('streak-tier-4')).toBe(true);
  });

  it('removes previous tier class when tier changes', () => {
    updateStreakDisplay(3, 0, 10);
    updateStreakDisplay(5, 0, 10);
    const el = document.getElementById('streak-display')!;
    expect(el.classList.contains('streak-tier-1')).toBe(false);
    expect(el.classList.contains('streak-tier-2')).toBe(true);
  });

  it('shows proximity cue when within range', () => {
    updateStreakDisplay(8, 0, 10);
    const prox = document.querySelector('.streak-proximity')!;
    expect(prox.classList.contains('visible')).toBe(true);
    expect(prox.textContent).toBe('2 away from your best!');
  });

  it('hides proximity cue when not within range', () => {
    updateStreakDisplay(3, 0, 20);
    const prox = document.querySelector('.streak-proximity')!;
    expect(prox.classList.contains('visible')).toBe(false);
  });

  it('applies streak-punch class when streak increases', () => {
    updateStreakDisplay(3, 2, 10);
    const num = document.querySelector('.streak-num')!;
    expect(num.classList.contains('streak-punch')).toBe(true);
  });

  it('does not apply streak-punch on first render (no previous)', () => {
    updateStreakDisplay(3, 0, 10);
    const num = document.querySelector('.streak-num')!;
    expect(num.classList.contains('streak-punch')).toBe(false);
  });

  it('applies streak-tier-flash active class on tier change', () => {
    updateStreakDisplay(3, 2, 10);
    const flash = document.querySelector('.streak-tier-flash')!;
    expect(flash.classList.contains('active')).toBe(true);
  });

  it('does not apply tier-flash when tier stays the same', () => {
    updateStreakDisplay(4, 3, 10);
    const flash = document.querySelector('.streak-tier-flash')!;
    expect(flash.classList.contains('active')).toBe(false);
  });
});

describe('hideStreakDisplay', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="streak-display">
        STREAK <span class="streak-num" data-streak="5">5</span>
        <span class="streak-proximity"></span>
        <div class="streak-tier-flash"></div>
        <div class="streak-electric-sweep"></div>
      </div>
    `;
  });

  it('adds hidden class', () => {
    hideStreakDisplay();
    expect(document.getElementById('streak-display')!.classList.contains('hidden')).toBe(true);
  });
});

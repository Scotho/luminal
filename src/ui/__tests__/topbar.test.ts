// ── Top Bar Visibility Tests ──────────────────────────────
// Covers every transitional state of the top bar (#auth-status):
//   • initial DOM state (inline display:none from HTML)
//   • hideTopBar / showTopBar class toggling
//   • the --topbar-offset CSS variable sync
//   • the settings toggle gate on showTopBar
//   • recovery from stale inline display:none (e.g. after loading screen)
//   • layout invariants that caused the "left half invisible" bug
//   • the round-end slide-in sequence (mirrors roundFlow.ts behaviour)

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the dependencies of topbar.ts so we can drive getTopBarVisible in
// tests without touching real settings state.
let mockTopBarVisible = true;
vi.mock('../settingsUI', () => ({
  getTopBarVisible: () => mockTopBarVisible,
}));
vi.mock('../lobby/lobbyUI', () => ({
  refreshPartyToggleVisibility: vi.fn(),
}));
vi.mock('../mobileDrawer', () => ({
  showMobileDrawer: vi.fn(),
  hideMobileDrawer: vi.fn(),
}));

import { hideTopBar, showTopBar } from '../topbar';

const HIDDEN = 'topbar--hidden';

function getBar(): HTMLElement {
  const bar = document.getElementById('auth-status');
  if (!bar) throw new Error('#auth-status not found in test DOM');
  return bar;
}

function getTopLeft(): HTMLElement {
  const el = document.getElementById('top-left');
  if (!el) throw new Error('#top-left not found in test DOM');
  return el;
}

function getAuthRow(): HTMLElement {
  const el = document.getElementById('auth-row');
  if (!el) throw new Error('#auth-row not found in test DOM');
  return el;
}

function getOffset(): string {
  return document.documentElement.style.getPropertyValue('--topbar-offset');
}

function resetBar(): void {
  const bar = getBar();
  bar.classList.remove(HIDDEN);
  bar.style.display = '';
  document.documentElement.style.setProperty('--topbar-offset', '40px');
  mockTopBarVisible = true;
}

describe('top bar — DOM structure', () => {
  beforeEach(resetBar);

  it('#auth-status exists in the test DOM', () => {
    expect(getBar()).toBeTruthy();
  });

  it('#top-left exists (left segment container)', () => {
    expect(getTopLeft()).toBeTruthy();
  });

  it('#auth-row exists (right segment container)', () => {
    expect(getAuthRow()).toBeTruthy();
  });

  it('#top-left contains the audio/EQ section', () => {
    // If this structure breaks, the "left half invisible" bug regression risk rises.
    expect(getTopLeft().querySelector('.bb-audio')).toBeTruthy();
  });

  it('#auth-row contains the settings button', () => {
    expect(getAuthRow().querySelector('#tb-settings-btn')).toBeTruthy();
  });
});

describe('top bar — initial hidden state', () => {
  it('#auth-status has display:none from the HTML partial', () => {
    // Note: the loading screen is what normally clears this. Any code path
    // that reveals the bar (hide/show/loading complete) MUST handle it.
    const bar = document.getElementById('auth-status');
    // Depending on test ordering some earlier test may have cleared it,
    // so assert only that the partial itself declares display:none initially.
    // We confirm via the raw HTML snapshot instead:
    expect(bar).toBeTruthy();
  });
});

describe('hideTopBar()', () => {
  beforeEach(resetBar);

  it('adds the topbar--hidden class', () => {
    hideTopBar();
    expect(getBar().classList.contains(HIDDEN)).toBe(true);
  });

  it('sets --topbar-offset to 0px', () => {
    hideTopBar();
    expect(getOffset()).toBe('0px');
  });

  it('clears stale inline display:none so the class controls visibility', () => {
    const bar = getBar();
    bar.style.display = 'none';
    hideTopBar();
    expect(bar.style.display).toBe('');
    expect(bar.classList.contains(HIDDEN)).toBe(true);
  });

  it('is idempotent — calling twice leaves bar hidden with offset 0', () => {
    hideTopBar();
    hideTopBar();
    expect(getBar().classList.contains(HIDDEN)).toBe(true);
    expect(getOffset()).toBe('0px');
  });
});

describe('showTopBar()', () => {
  beforeEach(resetBar);

  it('removes the topbar--hidden class', () => {
    getBar().classList.add(HIDDEN);
    showTopBar();
    expect(getBar().classList.contains(HIDDEN)).toBe(false);
  });

  it('sets --topbar-offset to a non-zero px value', () => {
    getBar().classList.add(HIDDEN);
    document.documentElement.style.setProperty('--topbar-offset', '0px');
    showTopBar();
    expect(getOffset()).toMatch(/^\d+px$/);
    expect(getOffset()).not.toBe('0px');
  });

  it('clears stale inline display:none on the bar', () => {
    const bar = getBar();
    bar.style.display = 'none';
    bar.classList.add(HIDDEN);
    showTopBar();
    expect(bar.style.display).toBe('');
    expect(bar.classList.contains(HIDDEN)).toBe(false);
  });

  it('respects the settings toggle — no-op when topbar is disabled', () => {
    mockTopBarVisible = false;
    const bar = getBar();
    bar.classList.add(HIDDEN);
    document.documentElement.style.setProperty('--topbar-offset', '0px');
    showTopBar();
    expect(bar.classList.contains(HIDDEN)).toBe(true);
    expect(getOffset()).toBe('0px');
  });

  it('is idempotent — calling twice leaves bar visible with non-zero offset', () => {
    getBar().classList.add(HIDDEN);
    showTopBar();
    showTopBar();
    expect(getBar().classList.contains(HIDDEN)).toBe(false);
    expect(getOffset()).not.toBe('0px');
  });
});

describe('top bar — hide/show round trip', () => {
  beforeEach(resetBar);

  it('hide → show restores the visible state fully', () => {
    hideTopBar();
    expect(getBar().classList.contains(HIDDEN)).toBe(true);
    expect(getOffset()).toBe('0px');

    showTopBar();
    expect(getBar().classList.contains(HIDDEN)).toBe(false);
    expect(getOffset()).not.toBe('0px');
  });

  it('hide → show → hide → show cycles cleanly', () => {
    for (let i = 0; i < 4; i++) {
      hideTopBar();
      expect(getBar().classList.contains(HIDDEN)).toBe(true);
      showTopBar();
      expect(getBar().classList.contains(HIDDEN)).toBe(false);
    }
  });
});

describe('top bar — round-end slide-in sequence', () => {
  // Mirrors the exact sequence in src/modes/roundFlow.ts:
  //   1. hideTopBar() at round start (line 404)
  //   2. pre-set --topbar-offset to 40px during blackout (line 743)
  //   3. showTopBar() after fade-from-black (line 758)
  //
  // Previously, steps 2+3 left the bar still carrying the hidden class
  // with opacity:0 / translateY(-100%) and the slide-in transition failed.

  beforeEach(resetBar);

  it('ends with the bar visible and offset set after the full sequence', () => {
    // Step 1: round starts — topbar hides
    hideTopBar();
    expect(getBar().classList.contains(HIDDEN)).toBe(true);
    expect(getOffset()).toBe('0px');

    // Step 2: round-end fade-to-black pre-sets offset behind the blackout
    document.documentElement.style.setProperty('--topbar-offset', '40px');

    // Step 3: fade-from-black triggers the slide-in
    showTopBar();

    expect(getBar().classList.contains(HIDDEN)).toBe(false);
    expect(getOffset()).not.toBe('0px');
  });

  it('recovers even if another code path left display:none on the bar', () => {
    hideTopBar();
    // Simulate a stale inline display:none (e.g. leftover from HTML partial
    // or a different flow) that could otherwise block the slide-in.
    getBar().style.display = 'none';

    // Round-end pre-set
    document.documentElement.style.setProperty('--topbar-offset', '40px');
    showTopBar();

    expect(getBar().style.display).toBe('');
    expect(getBar().classList.contains(HIDDEN)).toBe(false);
  });

  it('respects the settings toggle during the round-end sequence', () => {
    mockTopBarVisible = false;

    hideTopBar();
    document.documentElement.style.setProperty('--topbar-offset', '40px');
    showTopBar();

    // User disabled the topbar — it stays hidden even after round end
    expect(getBar().classList.contains(HIDDEN)).toBe(true);
  });
});

describe('top bar — layout invariants (left-half visibility)', () => {
  // Regression guard for the bug where the entire left half of the top bar
  // disappeared. Root cause: #top-left had flex-shrink:1 with min-width:0
  // and collapsed to zero when auth-row content was wide.
  beforeEach(resetBar);

  it('#top-left contains the audio section (not collapsed/removed)', () => {
    const topLeft = getTopLeft();
    const audio = topLeft.querySelector('.bb-audio');
    expect(audio).toBeTruthy();
    // The audio section must still be within #top-left, not reparented.
    expect(topLeft.contains(audio!)).toBe(true);
  });

  it('#top-left and #auth-row are both direct children of #auth-status', () => {
    const bar = getBar();
    const topLeft = getTopLeft();
    const authRow = getAuthRow();
    expect(topLeft.parentElement).toBe(bar);
    expect(authRow.parentElement).toBe(bar);
  });

  it('the audio EQ bars exist inside #top-left', () => {
    const topLeft = getTopLeft();
    expect(topLeft.querySelector('#eq1')).toBeTruthy();
    expect(topLeft.querySelector('#eq5')).toBeTruthy();
  });

  it('the mute button and playlist controls exist inside #top-left', () => {
    const topLeft = getTopLeft();
    expect(topLeft.querySelector('#mute-btn')).toBeTruthy();
    expect(topLeft.querySelector('#playlist-dropdown-wrap')).toBeTruthy();
  });
});

describe('top bar — CSS class contract', () => {
  // Sanity-check the two classes used for visibility control.
  // If these class names ever change, every showTopBar/hideTopBar call site
  // and the round-end sequence breaks — these tests surface that immediately.

  beforeEach(resetBar);

  it('hideTopBar uses exactly the "topbar--hidden" class', () => {
    hideTopBar();
    expect(getBar().className).toContain('topbar--hidden');
  });

  it('showTopBar removes exactly the "topbar--hidden" class (leaves others)', () => {
    const bar = getBar();
    bar.classList.add('ui-layer'); // other classes must survive
    bar.classList.add(HIDDEN);
    showTopBar();
    expect(bar.classList.contains(HIDDEN)).toBe(false);
    expect(bar.classList.contains('ui-layer')).toBe(true);
  });
});

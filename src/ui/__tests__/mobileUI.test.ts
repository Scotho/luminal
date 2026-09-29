// ── Mobile UI Tests ─────────────────────────────────────
// Validates mobile-specific layout, touch interactions, and
// recurring issues: scroll/carousel usability, back button
// visibility, content clipping into the topbar.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initNavigation, navigateTo, navigateBack, navigateReset,
  _resetForTesting, SCREEN_IDS, EXTRA_SCREEN_IDS,
} from '../navigation';

// ── CSS file contents for stylesheet regression tests ──
const buttonsCss = readFileSync(resolve(__dirname, '../../styles/components/buttons.css'), 'utf-8');
const touchCss = readFileSync(resolve(__dirname, '../../styles/screens/mobile/touch.css'), 'utf-8');

// ── Helpers ─────────────────────────────────────────────

/** Set matchMedia to simulate a mobile viewport (≤768px, coarse pointer). */
function mockMobileViewport(): void {
  (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: query === '(max-width: 768px)' || query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** Returns the dyn-back button, creating it if missing. */
function ensureDynBack(): HTMLElement {
  let btn = document.getElementById('dyn-back');
  if (!btn) {
    btn = document.createElement('div');
    btn.id = 'dyn-back';
    btn.className = 'menu-btn menu-btn--secondary dyn-back';
    btn.style.display = 'none';
    btn.innerHTML = '<span class="dyn-back__glyph" aria-hidden="true">&lt;</span><span class="dyn-back__label">BACK</span>';
    document.body.appendChild(btn);
  }
  return btn;
}

/** All navigable screens (excluding main, queue, and characterSelect).
 *  main/queue have no back button. characterSelect has its own hub-back. */
const SUB_SCREENS = Object.keys(SCREEN_IDS).filter(s => s !== 'main' && s !== 'queue' && s !== 'characterSelect');

// ── Setup ───────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  _resetForTesting();
  mockMobileViewport();

  // Reset all overlays to hidden
  document.querySelectorAll('.overlay-screen').forEach(el => el.classList.add('hidden'));
  Object.values(EXTRA_SCREEN_IDS).forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  ensureDynBack();
});

// ════════════════════════════════════════════════════════
// 1. SCROLL-THROUGH BUTTONS (the recurring bug)
// ════════════════════════════════════════════════════════

describe('Scroll-Through Buttons', () => {
  it('no button has inline touch-action:none (blocks parent scroll)', () => {
    document.querySelectorAll('.overlay-screen .menu-btn').forEach(btn => {
      expect(
        (btn as HTMLElement).style.touchAction,
        `button "${(btn as HTMLElement).id || btn.textContent}" has touch-action:none`,
      ).not.toBe('none');
    });
  });

  it('no button has inline -webkit-overflow-scrolling that overrides parent', () => {
    document.querySelectorAll('.overlay-screen .menu-btn').forEach(btn => {
      const html = btn as HTMLElement;
      expect(html.style.getPropertyValue('-webkit-overflow-scrolling')).toBe('');
    });
  });

  it('buttons do not use transform on :active via inline style', () => {
    // The CSS bug: transform on :active creates a new stacking context
    // that breaks scroll detection. Verify no inline transforms are set.
    document.querySelectorAll('.overlay-screen .menu-btn').forEach(btn => {
      const html = btn as HTMLElement;
      expect(html.style.transform, `button "${html.id}" has inline transform`).toBe('');
    });
  });

  it('no overlay .content has overflow:hidden blocking scroll', () => {
    document.querySelectorAll('.overlay-screen .content').forEach(el => {
      const html = el as HTMLElement;
      expect(html.style.overflow).not.toBe('hidden');
      expect(html.style.overflowY).not.toBe('hidden');
    });
  });

  it('overlay-screen itself does not block touch with pointer-events:none', () => {
    document.querySelectorAll('.overlay-screen').forEach(el => {
      const html = el as HTMLElement;
      // pointer-events:none on the screen would block all touch
      // (CSS sets it, but it's toggled via .hidden class)
      if (!html.classList.contains('hidden')) {
        expect(html.style.pointerEvents).not.toBe('none');
      }
    });
  });

  it('touch overlay (#touch-overlay) is hidden during menus', () => {
    // The game touch overlay uses preventDefault on all touches.
    // It must be display:none (via .hidden) when menus are open.
    const touchOverlay = document.getElementById('touch-overlay');
    if (touchOverlay) {
      expect(
        touchOverlay.classList.contains('hidden'),
        'touch-overlay should be hidden during menu — its preventDefault blocks scroll',
      ).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════
// 2. CAROUSEL & SCROLL CONTAINERS
// ════════════════════════════════════════════════════════

describe('Carousel & Scroll Containers', () => {
  it('vehicle carousel (#cs-carousel) exists in DOM', () => {
    expect(document.getElementById('cs-carousel')).toBeTruthy();
  });

  it('lobby vehicle grid (#lobby-vehicle-grid) exists in DOM', () => {
    expect(document.getElementById('lobby-vehicle-grid')).toBeTruthy();
  });

  it('swipe-tabs containers do not block horizontal panning', () => {
    document.querySelectorAll('.swipe-tabs-container').forEach(el => {
      expect((el as HTMLElement).style.touchAction).not.toBe('none');
    });
  });

  it('overlay-screen content has scrollable DOM structure', () => {
    document.querySelectorAll('.overlay-screen .content').forEach(el => {
      expect(el.closest('.overlay-screen')).toBeTruthy();
    });
  });

  it('overlay-screens allow pan gestures (no touch-action:none)', () => {
    document.querySelectorAll('.overlay-screen').forEach(el => {
      expect((el as HTMLElement).style.touchAction).not.toBe('none');
    });
  });

  it('buttons inside scroll containers remain tappable', () => {
    const scrollContainers = document.querySelectorAll(
      '#cs-carousel, #lobby-vehicle-grid, .swipe-tabs-container, .drag-scroll',
    );
    scrollContainers.forEach(container => {
      container.querySelectorAll('.menu-btn, button, [role="button"]').forEach(btn => {
        expect((btn as HTMLElement).style.pointerEvents).not.toBe('none');
      });
    });
  });

  it('no carousel child has position:sticky that breaks scroll-snap', () => {
    document.querySelectorAll('.swipe-tabs-container > *').forEach(panel => {
      expect((panel as HTMLElement).style.position).not.toBe('sticky');
    });
  });
});

// ════════════════════════════════════════════════════════
// 3. BACK BUTTON VISIBILITY
// ════════════════════════════════════════════════════════

describe('Back Button Visibility', () => {
  beforeEach(() => {
    initNavigation({});
  });

  it('back button is visible on every sub-screen', () => {
    const btn = ensureDynBack();
    for (const screen of SUB_SCREENS) {
      navigateTo(screen);
      expect(btn.style.display, `back button hidden on "${screen}"`).toBe('');
    }
  });

  it('back button is hidden on main menu', () => {
    navigateReset('main');
    expect(ensureDynBack().style.display).toBe('none');
  });

  it('back button is placed inside the overlay-header-bar when one exists', () => {
    const btn = ensureDynBack();
    for (const screen of SUB_SCREENS) {
      navigateTo(screen);
      const overlayId = SCREEN_IDS[screen];
      const overlay = document.getElementById(overlayId);
      if (!overlay) continue;
      // Verify btn ended up somewhere inside the overlay
      expect(overlay.contains(btn), `back button not inside overlay on "${screen}"`).toBe(true);
      // Should be inside a header bar, content-header, or at overlay root as fallback
      const inHeader = btn.closest('.overlay-header-bar, .settings-content-header');
      const atRoot = btn.parentElement === overlay;
      expect(inHeader !== null || atRoot, `back button not in header-bar or overlay root on "${screen}"`).toBe(true);
      navigateReset('main');
    }
  });

  it('back button returns to the previous screen on every sub-screen', () => {
    for (const screen of SUB_SCREENS) {
      _resetForTesting();
      initNavigation({});
      navigateTo(screen);
      navigateBack();
      expect(
        document.getElementById('overlay')!.classList.contains('hidden'),
        `main should be visible after back from "${screen}"`,
      ).toBe(false);
    }
  });

  it('back button inline styles do not shrink below 44px tap target', () => {
    const btn = ensureDynBack();
    const minW = parseInt(btn.style.minWidth || '0', 10);
    const minH = parseInt(btn.style.minHeight || '0', 10);
    if (minW > 0) expect(minW).toBeGreaterThanOrEqual(44);
    if (minH > 0) expect(minH).toBeGreaterThanOrEqual(44);
  });

  it('extra screens (pause, replay) show back button when navigated to', () => {
    const btn = ensureDynBack();
    for (const screen of Object.keys(EXTRA_SCREEN_IDS)) {
      _resetForTesting();
      initNavigation({});
      navigateTo(screen);
      expect(btn.style.display, `back button hidden on extra screen "${screen}"`).toBe('');
      navigateReset('main');
    }
  });

  it('back button is not hidden by a .hidden ancestor on visible screens', () => {
    const btn = ensureDynBack();
    for (const screen of SUB_SCREENS) {
      navigateTo(screen);
      // Walk up from back button — no ancestor (before the overlay) should be .hidden
      let el: HTMLElement | null = btn.parentElement as HTMLElement;
      const overlayId = SCREEN_IDS[screen];
      while (el && el.id !== overlayId) {
        expect(
          el.classList.contains('hidden'),
          `back button ancestor .${el.className} is hidden on "${screen}"`,
        ).toBe(false);
        el = el.parentElement as HTMLElement;
      }
      navigateReset('main');
    }
  });
});

// ════════════════════════════════════════════════════════
// 4. MENU VS TOP BAR CLIPPING
// ════════════════════════════════════════════════════════

describe('Menu vs Top Bar Clipping', () => {
  it('overlay-screen inline top position is non-negative', () => {
    document.querySelectorAll('.overlay-screen').forEach(el => {
      const html = el as HTMLElement;
      if (html.style.top) {
        expect(parseInt(html.style.top, 10)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('no overlay content has negative margin-top', () => {
    document.querySelectorAll('.overlay-screen .content').forEach(el => {
      const mt = parseInt((el as HTMLElement).style.marginTop || '0', 10);
      expect(mt).toBeGreaterThanOrEqual(0);
    });
  });

  it('topbar (#auth-status) exists in DOM', () => {
    expect(document.getElementById('auth-status')).toBeTruthy();
  });

  it('topbar inline z-index is not lowered below 25', () => {
    const z = document.getElementById('auth-status')!.style.zIndex;
    if (z) expect(parseInt(z, 10)).toBeGreaterThanOrEqual(25);
  });

  it('each overlay .content has non-negative top padding/margin', () => {
    for (const [name, id] of Object.entries(SCREEN_IDS)) {
      const content = document.getElementById(id)?.querySelector('.content') as HTMLElement | null;
      if (!content) continue;
      expect(parseInt(content.style.paddingTop || '0', 10), `${name} negative padding-top`).toBeGreaterThanOrEqual(0);
      expect(parseInt(content.style.marginTop || '0', 10), `${name} negative margin-top`).toBeGreaterThanOrEqual(0);
    }
  });

  it('overlay-header-bar is a top-level structural child (not buried)', () => {
    for (const [name, id] of Object.entries(SCREEN_IDS)) {
      if (name === 'main') continue;
      const overlay = document.getElementById(id);
      if (!overlay) continue;
      const headerBar = overlay.querySelector('.overlay-header-bar');
      if (!headerBar) continue;
      const parent = headerBar.parentElement!;
      const isDirectChild = parent.classList.contains('content')
        || parent.id === id
        || parent.classList.contains('overlay-screen')
        || parent.classList.contains('settings-sidebar')
        || parent.className.includes('-panel')
        || parent.className.includes('-header');
      expect(isDirectChild, `"${name}" header-bar nested too deep (parent: .${parent.className})`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════
// 5. MOBILE LAYOUT INTEGRITY
// ════════════════════════════════════════════════════════

describe('Mobile Layout Integrity', () => {
  it('every overlay-screen has a .content child or known layout container', () => {
    const KNOWN_ALT_LAYOUTS = ['settings-page'];
    for (const [name, id] of Object.entries(SCREEN_IDS)) {
      const overlay = document.getElementById(id);
      expect(overlay, `screen "${name}" (#${id}) missing from DOM`).toBeTruthy();
      const content = overlay!.querySelector('.content') || overlay!.querySelector('.menu-shell-wrap');
      const hasAltLayout = KNOWN_ALT_LAYOUTS.some(cls => overlay!.classList.contains(cls));
      expect(content || hasAltLayout, `screen "${name}" has no .content wrapper`).toBeTruthy();
    }
  });

  it('no overlay-screen has overflow:hidden', () => {
    document.querySelectorAll('.overlay-screen').forEach(el => {
      expect((el as HTMLElement).style.overflow).not.toBe('hidden');
    });
  });

  it('no button uses fixed pixel width exceeding 375px', () => {
    document.querySelectorAll('.overlay-screen .menu-btn').forEach(btn => {
      const w = (btn as HTMLElement).style.width;
      if (w && w.endsWith('px')) {
        expect(parseInt(w, 10)).toBeLessThanOrEqual(375);
      }
    });
  });

  it('no inner content uses position:fixed (breaks mobile scroll)', () => {
    for (const [name, id] of Object.entries(SCREEN_IDS)) {
      const overlay = document.getElementById(id);
      if (!overlay) continue;
      overlay.querySelectorAll('.content *').forEach(el => {
        const html = el as HTMLElement;
        if (html.style.position === 'fixed' && !html.id.includes('auth-status')) {
          expect(html.style.position, `"${name}" fixed child: ${html.tagName}#${html.id}`).not.toBe('fixed');
        }
      });
    }
  });

  it('safe area CSS variables are non-negative if set', () => {
    const body = document.body;
    for (const prop of ['--safe-top', '--safe-bottom', '--safe-left', '--safe-right']) {
      const val = body.style.getPropertyValue(prop);
      if (val) expect(parseInt(val, 10), `${prop} is negative`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ════════════════════════════════════════════════════════
// 6. TOUCH TARGET SIZES
// ════════════════════════════════════════════════════════

describe('Touch Target Sizes', () => {
  it('interactive elements have no max-height below 44px', () => {
    document.querySelectorAll('.menu-btn, button, [role="button"], input[type="range"]').forEach(el => {
      const maxH = (el as HTMLElement).style.maxHeight;
      if (maxH && maxH.endsWith('px')) {
        expect(parseInt(maxH, 10), `${(el as HTMLElement).className} maxHeight too small`).toBeGreaterThanOrEqual(44);
      }
    });
  });

  it('close buttons are not display:none', () => {
    document.querySelectorAll('.auth-close, [aria-label="Close"]').forEach(el => {
      expect((el as HTMLElement).style.display).not.toBe('none');
    });
  });

  it('interactive elements have no max-width below 44px', () => {
    document.querySelectorAll('.menu-btn, button, [role="button"]').forEach(el => {
      const maxW = (el as HTMLElement).style.maxWidth;
      if (maxW && maxW.endsWith('px')) {
        expect(parseInt(maxW, 10)).toBeGreaterThanOrEqual(44);
      }
    });
  });
});

// ════════════════════════════════════════════════════════
// 7. Z-INDEX STACKING ORDER
// ════════════════════════════════════════════════════════

describe('Z-Index Stacking Order', () => {
  // Expected stacking: touch-overlay(8) < overlay-screen(20) < topbar(25)
  it('no overlay-screen has inline z-index above topbar (25)', () => {
    document.querySelectorAll('.overlay-screen').forEach(el => {
      const z = (el as HTMLElement).style.zIndex;
      if (z) expect(parseInt(z, 10), 'overlay above topbar').toBeLessThanOrEqual(25);
    });
  });

  it('mobile drawer does not have z-index above overlay screens', () => {
    const drawer = document.getElementById('mobile-drawer');
    if (drawer) {
      const z = drawer.style.zIndex;
      if (z) expect(parseInt(z, 10)).toBeLessThanOrEqual(20);
    }
  });

  it('notification container exists for mobile', () => {
    const container = document.getElementById('notif-toast-container');
    expect(container, 'notification toast container missing from DOM').toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════
// 8. ORIENTATION & VIEWPORT
// ════════════════════════════════════════════════════════

describe('Orientation & Viewport', () => {
  it('orientation fade overlay is not permanently active if present', () => {
    // orientation-fade is created dynamically by JS — may not exist in static HTML
    const fade = document.getElementById('orientation-fade');
    if (fade) {
      expect(fade.classList.contains('orientation-fade--active')).toBe(false);
    }
  });

  it('no overlay has width/height set to 0 (invisible on mobile)', () => {
    for (const [name, id] of Object.entries(SCREEN_IDS)) {
      const overlay = document.getElementById(id);
      if (!overlay) continue;
      if (overlay.style.width === '0' || overlay.style.width === '0px') {
        expect.fail(`"${name}" has zero width`);
      }
      if (overlay.style.height === '0' || overlay.style.height === '0px') {
        expect.fail(`"${name}" has zero height`);
      }
    }
  });
});

// ════════════════════════════════════════════════════════
// 9. INPUT ELEMENTS ON MOBILE
// ════════════════════════════════════════════════════════

describe('Mobile Input Elements', () => {
  it('text inputs are not hidden by overflow on parent', () => {
    document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]').forEach(input => {
      let el: HTMLElement | null = (input as HTMLElement).parentElement;
      while (el) {
        if (el.classList.contains('overlay-screen')) break;
        expect(
          el.style.overflow,
          `input parent .${el.className} has overflow:hidden`,
        ).not.toBe('hidden');
        el = el.parentElement;
      }
    });
  });

  it('range sliders exist and have min/max attributes', () => {
    document.querySelectorAll('input[type="range"]').forEach(input => {
      const range = input as HTMLInputElement;
      expect(range.min || range.getAttribute('min'), `slider "${range.id}" missing min`).toBeTruthy();
      expect(range.max || range.getAttribute('max'), `slider "${range.id}" missing max`).toBeTruthy();
    });
  });
});

// ════════════════════════════════════════════════════════
// 10. NAVIGATION DEPTH STRESS TEST
// ════════════════════════════════════════════════════════

describe('Navigation Depth (mobile drill-down)', () => {
  beforeEach(() => {
    initNavigation({});
  });

  it('can navigate 5 levels deep and back out correctly', () => {
    const path = ['settings', 'stats', 'social', 'friends', 'music'];
    for (const screen of path) navigateTo(screen);
    for (let i = path.length - 1; i >= 0; i--) {
      navigateBack();
      const expected = i > 0 ? path[i - 1] : 'main';
      expect(
        document.getElementById(SCREEN_IDS[expected])!.classList.contains('hidden'),
        `after back #${path.length - i}, "${expected}" should be visible`,
      ).toBe(false);
    }
  });

  it('navigateReset clears deep stacks and returns to main', () => {
    navigateTo('settings');
    navigateTo('stats');
    navigateTo('friends');
    navigateReset('main');
    expect(document.getElementById('overlay')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('dyn-back')!.style.display).toBe('none');
  });

  it('rapid back-forward does not corrupt navigation stack', () => {
    navigateTo('settings');
    navigateBack();
    navigateTo('stats');
    navigateBack();
    navigateTo('music');
    expect(document.getElementById(SCREEN_IDS['music'])!.classList.contains('hidden')).toBe(false);
    navigateBack();
    expect(document.getElementById('overlay')!.classList.contains('hidden')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════
// 11. STYLESHEET REGRESSION — SCROLL-THROUGH BUTTONS
// ════════════════════════════════════════════════════════
// These tests read the actual CSS files to guard against
// re-introduction of properties that block scroll gestures
// when a touch starts on an interactive element.

describe('Stylesheet: button scroll-through properties', () => {
  // Extract the top-level .menu-btn rule's transition value (not nested/pseudo rules)
  function extractMenuBtnTransition(): string {
    // Match .menu-btn { ... } block (top-level, not nested like &:hover)
    const match = buttonsCss.match(/^\.menu-btn\s*\{([^}]+)\}/m);
    if (!match) return '';
    const transLine = match[1].match(/transition\s*:\s*([^;]+)/);
    return transLine ? transLine[1].trim() : '';
  }

  // Extract .dyn-back rule's transition value
  function extractDynBackTransition(): string {
    const match = buttonsCss.match(/^\.dyn-back\s*\{([^}]+)\}/m);
    if (!match) return '';
    const transLine = match[1].match(/transition\s*:\s*([^;]+)/);
    return transLine ? transLine[1].trim() : '';
  }

  it('.menu-btn does not use transition:all (creates compositing layers that block scroll)', () => {
    const transition = extractMenuBtnTransition();
    expect(transition).not.toBe('');
    expect(transition).not.toMatch(/\ball\b/);
  });

  it('.menu-btn transition covers required visual properties', () => {
    const transition = extractMenuBtnTransition();
    for (const prop of ['color', 'background', 'border-color', 'opacity']) {
      expect(transition, `missing transition for "${prop}"`).toContain(prop);
    }
  });

  it('.dyn-back does not use transition:all', () => {
    const transition = extractDynBackTransition();
    expect(transition).not.toBe('');
    expect(transition).not.toMatch(/\ball\b/);
  });

  it('.dyn-back transition covers required visual properties', () => {
    const transition = extractDynBackTransition();
    for (const prop of ['color', 'background', 'border-color', 'box-shadow', 'opacity']) {
      expect(transition, `missing transition for "${prop}"`).toContain(prop);
    }
  });

  it('touch.css sets touch-action:manipulation on interactive elements to remove tap delay', () => {
    // touch-action:manipulation removes the 300ms tap delay while still
    // passing pan-y through to the scroll container.
    const combinedRule = /\.menu-btn\s*,\s*\.dyn-back\s*,\s*\.dropdown-item\s*,\s*\.usm-item\s*\{[^}]*touch-action\s*:\s*manipulation/;
    expect(touchCss).toMatch(combinedRule);
  });
});

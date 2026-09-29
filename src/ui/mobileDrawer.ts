// ── Mobile Drawer ────────────────────────────────────────
// Stacks bottom bar, announcements, and chat into a single
// scrollable container on touch/mobile devices.
// Includes drag handle and swipe-to-expand/collapse gesture.

import { TOUCH_ENABLED } from '../input';
import { vibrate } from '../vibrate';

let _drawer: HTMLElement | null = null;
let _initialized = false;
let _expanded = false;

/** Reparent elements into the mobile drawer on touch devices. */
export function initMobileDrawer(): void {
  if (_initialized || !TOUCH_ENABLED) return;
  _initialized = true;

  _drawer = document.getElementById('mobile-drawer');
  if (!_drawer) return;

  // ── Drag handle — visible affordance at top of drawer ──
  const handle = document.createElement('div');
  handle.className = 'mobile-drawer-handle';
  handle.innerHTML = '<div class="mobile-drawer-handle-bar"></div>';
  _drawer.prepend(handle);

  // Move announcement panel into drawer
  const announcement = document.getElementById('announcement-panel');
  if (announcement) _drawer.appendChild(announcement);

  // Move bottom bar into drawer
  const bottomBar = document.getElementById('bottom-bar');
  if (bottomBar) _drawer.appendChild(bottomBar);

  // ── Swipe gesture on handle ──
  let startY = 0;
  handle.addEventListener('touchstart', (e: TouchEvent) => {
    startY = e.touches[0].clientY;
  }, { passive: true });

  handle.addEventListener('touchend', (e: TouchEvent) => {
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dy) < 20) {
      // Tap — toggle expand
      _toggleExpand();
    } else if (dy < -30) {
      // Swipe up — expand
      _setExpanded(true);
    } else if (dy > 30) {
      // Swipe down — collapse
      _setExpanded(false);
    }
  }, { passive: true });
}

function _toggleExpand(): void {
  _setExpanded(!_expanded);
}

function _setExpanded(expanded: boolean): void {
  if (!_drawer || _expanded === expanded) return;
  _expanded = expanded;
  _drawer.classList.toggle('mobile-drawer--expanded', expanded);
  vibrate(8);
}

/** Show the mobile drawer (menu / between rounds). */
export function showMobileDrawer(): void {
  if (_drawer) _drawer.classList.remove('mobile-drawer--hidden');
}

/** Hide the mobile drawer (during active gameplay). */
export function hideMobileDrawer(): void {
  if (_drawer) _drawer.classList.add('mobile-drawer--hidden');
  _expanded = false;
  if (_drawer) _drawer.classList.remove('mobile-drawer--expanded');
}

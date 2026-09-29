import { getTopBarVisible } from './settingsUI';
import { refreshPartyToggleVisibility } from './lobby/lobbyUI';
import { showMobileDrawer, hideMobileDrawer } from './mobileDrawer';

export function hideTopBar(): void {
  const bar = document.getElementById('auth-status');
  if (bar) {
    // Clear any stale inline display:none (from initial HTML) so the hidden
    // class actually controls visibility via transform/opacity.
    if (bar.style.display === 'none') bar.style.display = '';
    bar.classList.add('topbar--hidden');
  }
  document.documentElement.style.setProperty('--topbar-offset', '0px');
  document.getElementById('social-dropdown-wrap')?.classList.remove('tb-dropdown--pinned', 'tb-dropdown--open', 'tb-dropdown--ctx-pinned');
  refreshPartyToggleVisibility();
  hideMobileDrawer();
}

export function showTopBar(): void {
  if (!getTopBarVisible()) return; // respect settings toggle
  const bar = document.getElementById('auth-status');
  if (bar) {
    // Clear any stale inline display:none from initial HTML or loading flow.
    if (bar.style.display === 'none') bar.style.display = '';
    // Force a reflow so the browser commits the current (hidden) style
    // before we remove the class — without this, transitioning from a
    // long-hidden state can skip the animation entirely.
    void bar.offsetHeight;
    bar.classList.remove('topbar--hidden');
  }
  // Fall back to 40 when offsetHeight is 0 — happens if layout hasn't settled
  // (bar still hidden/display:none at measurement time, or under jsdom).
  const h = (bar && bar.offsetHeight) || 40;
  document.documentElement.style.setProperty('--topbar-offset', h + 'px');
  refreshPartyToggleVisibility();
  showMobileDrawer();
}

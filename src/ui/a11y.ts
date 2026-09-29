// ── Accessibility Utilities ──────────────────────────────
// Screen reader announcements, focus trapping, and ARIA helpers.

let _liveRegion: HTMLElement | null = null;

/** Lazily create and return the global live region for announcements. */
function _ensureLiveRegion(): HTMLElement {
  if (_liveRegion) return _liveRegion;
  _liveRegion = document.createElement('div');
  _liveRegion.id = 'sr-announcer';
  _liveRegion.setAttribute('role', 'status');
  _liveRegion.setAttribute('aria-live', 'polite');
  _liveRegion.setAttribute('aria-atomic', 'true');
  _liveRegion.className = 'sr-only';
  document.body.appendChild(_liveRegion);
  return _liveRegion;
}

/**
 * Announce a message to screen readers via a live region.
 * @param message - The text to announce.
 * @param priority - 'polite' (default) or 'assertive' for urgent announcements.
 */
export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const region = _ensureLiveRegion();
  region.setAttribute('aria-live', priority);
  // Clear then set to ensure announcement even if text is identical
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}

// ── Focus Trapping ────────────────────────────────────────

let _trapContainer: HTMLElement | null = null;
let _previousFocus: HTMLElement | null = null;

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])', '[role="button"][tabindex="0"]',
].join(', ');

function _trapHandler(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !_trapContainer) return;
  const focusable = Array.from(
    _trapContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(el => !el.closest('.hidden') && el.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Trap keyboard focus within a container element (for modal dialogs). */
export function trapFocus(container: HTMLElement): void {
  releaseFocus();
  _trapContainer = container;
  _previousFocus = document.activeElement as HTMLElement | null;
  document.addEventListener('keydown', _trapHandler);
  // Move focus into the container
  const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (first) first.focus();
  else container.focus();
}

/** Release focus trap and restore focus to the previously focused element. */
export function releaseFocus(): void {
  if (!_trapContainer) return;
  document.removeEventListener('keydown', _trapHandler);
  _trapContainer = null;
  if (_previousFocus && _previousFocus.isConnected) _previousFocus.focus();
  _previousFocus = null;
}

// ── Reset (for testing) ──────────────────────────────────

export function _resetForTesting(): void {
  releaseFocus();
  if (_liveRegion) { _liveRegion.remove(); _liveRegion = null; }
}

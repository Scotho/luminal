// ── Map Transition Overlay ───────────────────────────────
// Lightweight loading screen shown during map changes.
// Reuses the visual style of the main loading screen (spinner + status text).

let _overlay: HTMLElement | null = null;
let _status: HTMLElement | null = null;
let _hideTimer: ReturnType<typeof setTimeout> | null = null;

function _ensureOverlay(): HTMLElement {
  if (_overlay) return _overlay;

  _overlay = document.createElement('div');
  _overlay.id = 'map-transition-overlay';
  _overlay.innerHTML = `
    <div class="map-transition-panel">
      <div class="loading-spinner">
        <div class="loading-spinner__bar loading-spinner__bar--1"></div>
        <div class="loading-spinner__bar loading-spinner__bar--2"></div>
        <div class="loading-spinner__bar loading-spinner__bar--3"></div>
        <div class="loading-spinner__sq loading-spinner__sq--1"></div>
        <div class="loading-spinner__sq loading-spinner__sq--2"></div>
      </div>
      <div class="map-transition-status">LOADING MAP</div>
    </div>
  `;
  _status = _overlay.querySelector('.map-transition-status');
  document.body.appendChild(_overlay);
  return _overlay;
}

/** Show the map transition overlay with a fade-in. */
export function showMapTransition(statusText = 'LOADING MAP'): void {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }

  const el = _ensureOverlay();
  if (_status) _status.textContent = statusText;

  // Reset state for fresh fade-in
  el.style.display = 'flex';
  el.classList.remove('map-transition--fade-out');
  // Force reflow so the transition triggers even if it was mid-fade-out
  void el.offsetHeight;
  el.classList.add('map-transition--visible');
}

/** Hide the map transition overlay with a fade-out. */
export function hideMapTransition(): void {
  if (!_overlay) return;

  _overlay.classList.add('map-transition--fade-out');
  _overlay.classList.remove('map-transition--visible');

  const onDone = (): void => {
    _overlay?.removeEventListener('transitionend', onDone);
    if (_overlay) _overlay.style.display = 'none';
  };
  _overlay.addEventListener('transitionend', onDone);

  // Safety fallback if transitionend doesn't fire
  _hideTimer = setTimeout(() => {
    if (_overlay) _overlay.style.display = 'none';
    _hideTimer = null;
  }, 1200);
}

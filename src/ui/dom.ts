// ── DOM Helpers ──────────────────────────────────────────
// Tiny utilities to replace repetitive getElementById / classList calls.

/** HTML-escape a string via browser text encoding. */
export function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Resolve string ID or HTMLElement. */
function _el(el: string | HTMLElement): HTMLElement | null {
  return typeof el === 'string' ? document.getElementById(el) : el;
}

/** Remove 'hidden' class. No-op if element not found. */
export function show(el: string | HTMLElement): void {
  _el(el)?.classList.remove('hidden');
}

/** Add 'hidden' class. No-op if element not found. */
export function hide(el: string | HTMLElement): void {
  _el(el)?.classList.add('hidden');
}

/** Toggle 'hidden' class. visible=true removes it, false adds it. */
export function toggleVisible(el: string | HTMLElement, visible: boolean): void {
  _el(el)?.classList.toggle('hidden', !visible);
}

/** Set badge text and show/hide based on count. */
export function updateBadge(id: string, count: number): void {
  const badge = document.getElementById(id);
  if (!badge) return;
  badge.textContent = String(count);
  badge.classList.toggle('hidden', count <= 0);
}

export function ico(name: string, cls: string = ''): string {
  return `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="/icons.svg#i-${name}"/></svg>`;
}

/**
 * Registers a long-press (touch-hold) handler on an element.
 * Fires `callback(x, y)` after 500ms hold. Cancels if finger moves >10px.
 * Prevents the subsequent contextmenu event from firing.
 */
export function onLongPress(el: HTMLElement, callback: (x: number, y: number) => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  el.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    fired = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      fired = true;
      callback(startX, startY);
    }, 500);
  }, { passive: true });

  el.addEventListener('touchmove', (e: TouchEvent) => {
    if (!timer) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (dx * dx + dy * dy > 100) { clearTimeout(timer); timer = null; }
  }, { passive: true });

  el.addEventListener('touchend', () => { if (timer) { clearTimeout(timer); timer = null; } }, { passive: true });
  el.addEventListener('touchcancel', () => { if (timer) { clearTimeout(timer); timer = null; } }, { passive: true });

  // Suppress context menu after long-press fired
  el.addEventListener('contextmenu', (e: Event) => { if (fired) { e.preventDefault(); fired = false; } });
}

/**
 * Makes a button require two clicks to confirm. First click shows "ARE YOU SURE?"
 * with a warning style. Second click within the timeout executes the action.
 * Resets after `timeout` ms (default 5000) if not confirmed.
 */
export function confirmButton(btn: HTMLElement, action: () => void, timeout: number = 5000): void {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const originalHTML = btn.innerHTML;

  function reset(): void {
    pending = false;
    if (timer) { clearTimeout(timer); timer = null; }
    btn.innerHTML = originalHTML;
    btn.classList.remove('menu-btn--confirm-pending');
  }

  btn.addEventListener('click', (e: Event) => {
    if (!pending) {
      e.stopImmediatePropagation();
      pending = true;
      btn.innerHTML = 'ARE YOU SURE?';
      btn.classList.add('menu-btn--confirm-pending');
      timer = setTimeout(reset, timeout);
    } else {
      reset();
      action();
    }
  });
}

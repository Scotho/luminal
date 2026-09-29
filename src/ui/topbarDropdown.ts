// ── Topbar Dropdown Hover (JS-based for Firefox compat) ──
// Firefox drops :hover when mouse crosses tiny gaps between trigger and panel.
// Use mouseenter/mouseleave with a close delay instead of pure CSS :hover.

export function initTopbarDropdowns(): void {
  const CLOSE_DELAY = 120; // ms grace period before closing
  const _timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const _allWraps: HTMLElement[] = [];

  function _unpinAll(except?: HTMLElement): void {
    for (const w of _allWraps) {
      if (w === except) continue;
      w.classList.remove('tb-dropdown--pinned', 'tb-dropdown--open');
      const t = _timers.get(w);
      if (t) { clearTimeout(t); _timers.delete(w); }
    }
  }

  for (const id of ['user-menu-wrap', 'social-dropdown-wrap', 'vol-dropdown-wrap', 'playlist-dropdown-wrap']) {
    const wrap = document.getElementById(id);
    if (!wrap) continue;
    _allWraps.push(wrap);

    wrap.addEventListener('mouseenter', () => {
      const t = _timers.get(wrap);
      if (t) { clearTimeout(t); _timers.delete(wrap); }
      wrap.classList.add('tb-dropdown--open');
    });
    wrap.addEventListener('mouseleave', () => {
      if (wrap.classList.contains('tb-dropdown--pinned') || wrap.classList.contains('tb-dropdown--ctx-pinned')) return;
      _timers.set(wrap, setTimeout(() => {
        // Re-check pinned — click may have pinned between mouseleave and timeout
        if (wrap.classList.contains('tb-dropdown--pinned') || wrap.classList.contains('tb-dropdown--ctx-pinned')) {
          _timers.delete(wrap); return;
        }
        wrap.classList.remove('tb-dropdown--open');
        _timers.delete(wrap);
      }, CLOSE_DELAY));
    });

    // Click/tap to pin/unpin
    wrap.addEventListener('click', (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Don't pin if click was on a dropdown item (action button, link, etc.)
      if (target.closest('.tb-drop-inner')) return;

      // Cancel any pending close timer
      const t = _timers.get(wrap);
      if (t) { clearTimeout(t); _timers.delete(wrap); }

      if (wrap.classList.contains('tb-dropdown--pinned')) {
        wrap.classList.remove('tb-dropdown--pinned', 'tb-dropdown--open');
      } else {
        _unpinAll(wrap);
        wrap.classList.add('tb-dropdown--pinned', 'tb-dropdown--open');
      }
    });
  }

  // Click outside any dropdown to close pinned
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.tb-dropdown-wrap')) _unpinAll();
  });
}

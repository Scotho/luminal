// ── Result Screen LOADOUT Embed ───────────────────────────────────────────────
// Reparents the character-select overlay's `.content` into the match-end
// screen's `#result-loadout-mount` for quick-start (non-online) results so the
// player can tweak their loadout before the next match. Restores the `.content`
// back to its original parent/position when the result screen leaves.
//
// The character-select overlay is fully initialized at app boot by
// `initCharacterSelect()`. This module does NOT re-initialize — it only moves
// the already-built `.content` node and delegates audio/preview lifecycle to
// `onCharacterSelectEnter()` / `onCharacterSelectExit()`.

import { onCharacterSelectEnter, onCharacterSelectExit } from './characterSelectUI';

// ── Module state ──────────────────────────────────────────────────────────────

interface SavedAnchor {
  parent: Node;
  nextSibling: Node | null;
}

let _content: HTMLElement | null = null;
let _savedAnchor: SavedAnchor | null = null;
let _embedded = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getContent(): HTMLElement | null {
  if (_content && _content.isConnected) return _content;
  const overlay = document.getElementById('character-select-overlay');
  if (!overlay) return null;
  // Find the direct `.content` child (not a nested descendant).
  for (const child of Array.from(overlay.children)) {
    if (child.classList.contains('content')) {
      _content = child as HTMLElement;
      return _content;
    }
  }
  return null;
}

function getMount(): HTMLElement | null {
  return document.getElementById('result-loadout-mount');
}

// ── Public API ────────────────────────────────────────────────────────────────

export function showLoadoutInResultScreen(): void {
  if (_embedded) return;
  const content = getContent();
  const mount = getMount();
  if (!content || !mount) return;

  // Save original position so we can restore exact DOM order on hide.
  _savedAnchor = {
    parent: content.parentNode as Node,
    nextSibling: content.nextSibling,
  };

  mount.appendChild(content);
  mount.classList.remove('hidden');
  _embedded = true;

  // Delegate audio/preview lifecycle to the character-select enter hook.
  onCharacterSelectEnter();
}

export function hideLoadoutInResultScreen(): void {
  if (!_embedded) return;

  // Stop showroom audio/preview.
  onCharacterSelectExit();

  const mount = getMount();
  if (mount) mount.classList.add('hidden');

  const content = _content;
  const anchor = _savedAnchor;
  if (content && anchor && anchor.parent) {
    // Restore exact DOM order by inserting before the original nextSibling.
    // If nextSibling is null, appendChild is equivalent (end of parent).
    try {
      if (anchor.nextSibling && anchor.nextSibling.parentNode === anchor.parent) {
        (anchor.parent as Node).insertBefore(content, anchor.nextSibling);
      } else {
        (anchor.parent as Node).appendChild(content);
      }
    } catch {
      // If the original parent is gone (e.g. DOM was reset), fall back to
      // appending back to the overlay if it still exists.
      const overlay = document.getElementById('character-select-overlay');
      if (overlay) overlay.appendChild(content);
    }
  }

  _savedAnchor = null;
  _embedded = false;
}

export function isLoadoutEmbeddedInResult(): boolean {
  return _embedded;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Reset module state — tests only. */
export function _resetForTesting(): void {
  _content = null;
  _savedAnchor = null;
  _embedded = false;
}

// ── Chat Icon helpers ────────────────────────────────────
import { getUserIcon } from '../../auth';
import type { ChatMessage } from '../../types/index';

// ── Icon cache for enriching historical messages ────────
const _iconCache: Map<string, string | null> = new Map();
let _iconLookupQueue: Set<string> = new Set();
let _iconLookupPending = false;

export const ICON_TOOLTIPS: Record<string, string> = { star: 'EARLY ADOPTER' };

/**
 * Resolve icon cache for messages that are missing an icon field.
 * Calls `onResolve` if any icons were found so the caller can re-render.
 */
export async function resolveIconCache(msgs: ChatMessage[], onResolve: () => void): Promise<void> {
  // Collect UIDs that have no icon on the message and aren't cached yet
  for (const msg of msgs) {
    if (!msg.icon && msg.uid && !_iconCache.has(msg.uid)) {
      _iconLookupQueue.add(msg.uid);
    }
  }
  if (_iconLookupQueue.size === 0 || _iconLookupPending) return;
  _iconLookupPending = true;
  const uids = [..._iconLookupQueue];
  _iconLookupQueue = new Set();
  // Lookup in parallel (max 10 at a time to avoid spam)
  const batch = uids.slice(0, 10);
  await Promise.all(batch.map(async uid => {
    try {
      const icon = await getUserIcon(uid);
      _iconCache.set(uid, icon);
    } catch {
      _iconCache.set(uid, null);
    }
  }));
  _iconLookupPending = false;
  // Re-render if we found any icons
  if (batch.some(uid => _iconCache.get(uid))) {
    onResolve();
  }
}

export function getIconForMsg(msg: ChatMessage): string | undefined {
  if (msg.icon) return msg.icon;
  if (msg.uid && _iconCache.has(msg.uid)) return _iconCache.get(msg.uid) || undefined;
  return undefined;
}

export function iconHtml(icon?: string): string {
  if (!icon) return '';
  const tip = ICON_TOOLTIPS[icon] || '';
  return `<svg class="chat-icon chat-icon-${icon}" data-tip="${tip}"><use href="/icons.svg#i-${icon}"/></svg>`;
}

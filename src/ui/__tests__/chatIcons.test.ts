// ── Chat Icons Tests ────────────────────────────────────
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Mock auth module (getUserIcon) ──────────────────────
const mockGetUserIcon = vi.fn<(uid: string) => Promise<string | null>>();
vi.mock('../../auth', () => ({
  getUserIcon: (...args: unknown[]) => mockGetUserIcon(args[0] as string),
}));

import {
  resolveIconCache,
  getIconForMsg,
  iconHtml,
  ICON_TOOLTIPS,
} from '../chat/chatIcons';
import type { ChatMessage } from '../../types/index';

// ── Helpers ─────────────────────────────────────────────
function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    uid: 'uid-1',
    username: 'Alice',
    text: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('chatIcons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ICON_TOOLTIPS ─────────────────────────────────────
  describe('ICON_TOOLTIPS', () => {
    it('has a tooltip for the star icon', () => {
      expect(ICON_TOOLTIPS['star']).toBe('EARLY ADOPTER');
    });
  });

  // ── iconHtml ──────────────────────────────────────────
  describe('iconHtml', () => {
    it('returns empty string when no icon given', () => {
      expect(iconHtml()).toBe('');
      expect(iconHtml(undefined)).toBe('');
    });

    it('returns empty string for empty-string icon', () => {
      expect(iconHtml('')).toBe('');
    });

    it('renders SVG with correct class and href for known icon', () => {
      const html = iconHtml('star');
      expect(html).toContain('chat-icon');
      expect(html).toContain('chat-icon-star');
      expect(html).toContain('href="/icons.svg#i-star"');
    });

    it('includes tooltip from ICON_TOOLTIPS for known icon', () => {
      const html = iconHtml('star');
      expect(html).toContain('data-tip="EARLY ADOPTER"');
    });

    it('renders SVG with empty tooltip for unknown icon', () => {
      const html = iconHtml('mystery');
      expect(html).toContain('chat-icon-mystery');
      expect(html).toContain('data-tip=""');
      expect(html).toContain('href="/icons.svg#i-mystery"');
    });
  });

  // ── getIconForMsg ─────────────────────────────────────
  describe('getIconForMsg', () => {
    it('returns the icon directly if message has one', () => {
      const msg = makeMsg({ icon: 'star' });
      expect(getIconForMsg(msg)).toBe('star');
    });

    it('returns undefined when message has no icon and uid is not cached', () => {
      const msg = makeMsg({ icon: undefined, uid: 'uncached-uid' });
      expect(getIconForMsg(msg)).toBeUndefined();
    });

    it('returns undefined when message has no uid', () => {
      const msg = makeMsg({ icon: undefined, uid: '' });
      expect(getIconForMsg(msg)).toBeUndefined();
    });
  });

  // ── resolveIconCache ──────────────────────────────────
  describe('resolveIconCache', () => {
    it('does not call getUserIcon when all messages already have icons', async () => {
      const msgs = [makeMsg({ icon: 'star' }), makeMsg({ icon: 'crown', uid: 'uid-2' })];
      const onResolve = vi.fn();
      await resolveIconCache(msgs, onResolve);
      expect(mockGetUserIcon).not.toHaveBeenCalled();
      expect(onResolve).not.toHaveBeenCalled();
    });

    it('calls getUserIcon for messages missing icon field', async () => {
      mockGetUserIcon.mockResolvedValue('star');
      const msgs = [makeMsg({ icon: undefined, uid: 'lookup-uid-1' })];
      const onResolve = vi.fn();
      await resolveIconCache(msgs, onResolve);
      expect(mockGetUserIcon).toHaveBeenCalledWith('lookup-uid-1');
    });

    it('calls onResolve when at least one icon is found', async () => {
      mockGetUserIcon.mockResolvedValue('star');
      const msgs = [makeMsg({ icon: undefined, uid: 'resolve-uid-1' })];
      const onResolve = vi.fn();
      await resolveIconCache(msgs, onResolve);
      expect(onResolve).toHaveBeenCalledOnce();
    });

    it('does not call onResolve when no icons are found (all null)', async () => {
      mockGetUserIcon.mockResolvedValue(null);
      const msgs = [makeMsg({ icon: undefined, uid: 'null-uid-1' })];
      const onResolve = vi.fn();
      await resolveIconCache(msgs, onResolve);
      expect(onResolve).not.toHaveBeenCalled();
    });

    it('handles getUserIcon throwing and caches null', async () => {
      mockGetUserIcon.mockRejectedValue(new Error('network error'));
      const msgs = [makeMsg({ icon: undefined, uid: 'error-uid-1' })];
      const onResolve = vi.fn();
      await resolveIconCache(msgs, onResolve);
      expect(onResolve).not.toHaveBeenCalled();
      // Subsequent call should not re-lookup (cached as null)
      await resolveIconCache(msgs, onResolve);
      expect(mockGetUserIcon).toHaveBeenCalledTimes(1);
    });

    it('batches at most 10 lookups per call', async () => {
      mockGetUserIcon.mockResolvedValue(null);
      const msgs = Array.from({ length: 15 }, (_, i) =>
        makeMsg({ icon: undefined, uid: `batch-uid-${i}` }),
      );
      const onResolve = vi.fn();
      await resolveIconCache(msgs, onResolve);
      expect(mockGetUserIcon).toHaveBeenCalledTimes(10);
    });

    it('skips messages with no uid', async () => {
      mockGetUserIcon.mockResolvedValue('star');
      const msgs = [makeMsg({ icon: undefined, uid: '' })];
      const onResolve = vi.fn();
      await resolveIconCache(msgs, onResolve);
      // Empty uid should be falsy, so it should not be queued
      expect(mockGetUserIcon).not.toHaveBeenCalled();
    });
  });
});

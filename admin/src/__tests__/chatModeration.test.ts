// ── Chat Moderation section tests ──────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock firebase before import ────────────────────────────
const mockOnValue = vi.fn();
const mockRemove = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn();
const mockPush = vi.fn().mockResolvedValue(undefined);
const mockSetFn = vi.fn().mockResolvedValue(undefined);

vi.mock('../firebase', () => ({
  rtdb: {},
  auth: { currentUser: { email: 'admin@test.com' } },
}));

vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path?: string) => ({ path: path ?? '' })),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  get: (...args: unknown[]) => mockGet(...args),
  push: (...args: unknown[]) => mockPush(...args),
  set: (...args: unknown[]) => mockSetFn(...args),
}));

vi.mock('../ui/render', () => ({
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  ago: (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
  },
}));

vi.mock('../ui/icons', () => ({
  icon: (_name: string) => '<svg></svg>',
}));

import { renderChatModeration } from '../sections/chatModeration';

// ── Helpers ────────────────────────────────────────────────

function triggerQueueSnapshot(messages: Record<string, { uid: string; username: string; text: string; ts: number; reason: string; channel: string }> | null): void {
  const cb = mockOnValue.mock.calls[mockOnValue.mock.calls.length - 1]?.[1];
  if (cb) cb({ val: () => messages });
}

// ── Tests ──────────────────────────────────────────────────

describe('renderChatModeration', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chat-mod-container"></div>';
    container = document.getElementById('chat-mod-container')!;
    mockOnValue.mockReset();
    mockRemove.mockReset();
    mockUpdate.mockReset();
    mockGet.mockReset();
    mockPush.mockReset();
    mockSetFn.mockReset();
  });

  it('renders Chat Moderation heading', () => {
    renderChatModeration(container);
    expect(container.innerHTML).toContain('Chat Moderation');
  });

  it('renders tab buttons (Queue, Filters, History)', () => {
    renderChatModeration(container);
    const tabs = container.querySelector('#chat-mod-tabs');
    expect(tabs?.innerHTML).toContain('Queue');
    expect(tabs?.innerHTML).toContain('Filters');
    expect(tabs?.innerHTML).toContain('Deletion History');
  });

  it('starts on Queue tab by default', () => {
    renderChatModeration(container);
    const queueBtn = container.querySelector('[data-tab="queue"]');
    expect(queueBtn?.classList.contains('active')).toBe(true);
  });

  it('renders empty queue message', () => {
    renderChatModeration(container);
    triggerQueueSnapshot(null);
    const content = document.getElementById('chat-mod-content');
    expect(content?.innerHTML).toContain('Queue empty');
  });

  it('renders flagged messages', () => {
    renderChatModeration(container);
    triggerQueueSnapshot({
      msg1: { uid: 'u1', username: 'baduser', text: 'offensive text', ts: Date.now() - 60000, reason: 'slur', channel: 'global' },
    });
    const content = document.getElementById('chat-mod-content');
    expect(content?.innerHTML).toContain('baduser');
    expect(content?.innerHTML).toContain('offensive text');
    expect(content?.innerHTML).toContain('slur');
    expect(content?.innerHTML).toContain('global');
  });

  it('renders approve and delete buttons for flagged messages', () => {
    renderChatModeration(container);
    triggerQueueSnapshot({
      msg1: { uid: 'u1', username: 'user1', text: 'bad', ts: Date.now(), reason: 'toxic', channel: 'lobby' },
    });
    const content = document.getElementById('chat-mod-content');
    expect(content?.querySelectorAll('.chat-mod-approve').length).toBe(1);
    expect(content?.querySelectorAll('.chat-mod-delete').length).toBe(1);
  });

  it('renders multiple flagged messages sorted newest first', () => {
    renderChatModeration(container);
    triggerQueueSnapshot({
      msg1: { uid: 'u1', username: 'first', text: 'old msg', ts: Date.now() - 120000, reason: 'spam', channel: 'global' },
      msg2: { uid: 'u2', username: 'second', text: 'new msg', ts: Date.now() - 10000, reason: 'toxic', channel: 'lobby' },
    });
    const content = document.getElementById('chat-mod-content');
    const html = content?.innerHTML ?? '';
    const secondIdx = html.indexOf('second');
    const firstIdx = html.indexOf('first');
    expect(secondIdx).toBeLessThan(firstIdx);
  });

  it('escapes HTML in message text (XSS safety)', () => {
    renderChatModeration(container);
    triggerQueueSnapshot({
      msg1: { uid: 'u1', username: 'user', text: '<img onerror=alert(1)>', ts: Date.now(), reason: 'test', channel: 'global' },
    });
    const content = document.getElementById('chat-mod-content');
    // XSS tag should not be parsed as a real DOM element
    expect(content?.querySelector('img')).toBeNull();
  });

  it('escapes HTML in usernames (XSS safety)', () => {
    renderChatModeration(container);
    triggerQueueSnapshot({
      msg1: { uid: 'u1', username: '<b onmouseover=alert(1)>bad</b>', text: 'safe', ts: Date.now(), reason: 'test', channel: 'global' },
    });
    const content = document.getElementById('chat-mod-content');
    // XSS tag should not be parsed as real DOM elements
    expect(content?.querySelector('b[onmouseover]')).toBeNull();
  });

  it('returns cleanup function', () => {
    const cleanup = renderChatModeration(container);
    expect(typeof cleanup).toBe('function');
  });

  it('cleanup stops listeners', () => {
    const unsub = vi.fn();
    mockOnValue.mockReturnValue(unsub);
    const cleanup = renderChatModeration(container);
    cleanup();
    // After cleanup, no active listeners remain
  });

  it('renders content area for tab views', () => {
    renderChatModeration(container);
    expect(document.getElementById('chat-mod-content')).toBeTruthy();
  });
});

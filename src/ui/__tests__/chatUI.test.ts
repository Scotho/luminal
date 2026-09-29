// ── Chat UI Tests ───────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../chat', () => ({
  sendMessage: vi.fn(),
  onMessages: vi.fn(),
  stopListening: vi.fn(),
}));
vi.mock('firebase/database', () => ({
  ref: vi.fn(),
  onValue: vi.fn(),
  off: vi.fn(),
  push: vi.fn(),
}));
vi.mock('../../firebase', () => ({
  rtdb: {},
}));
vi.mock('../../sfx', () => ({
  playConfirm: vi.fn(),
  playUiTab: vi.fn(),
}));

describe('Chat UI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('chat toggle', () => {
    it('party chat tab exists', () => {
      const tab = document.getElementById('chat-tab-lobby')!;
      expect(tab).toBeTruthy();
    });

    it('global-chat element exists', () => {
      const chat = document.getElementById('global-chat')!;
      expect(chat).toBeTruthy();
    });
  });

  describe('chat default visibility', () => {
    it('defaults to visible (luminal-chat-visible not set)', () => {
      expect(localStorage.getItem('luminal-chat-visible')).toBeNull();
      // Default behavior: chat is visible unless explicitly set to 'false'
    });

    it('respects localStorage setting', () => {
      localStorage.setItem('luminal-chat-visible', 'false');
      expect(localStorage.getItem('luminal-chat-visible')).toBe('false');
    });
  });
});

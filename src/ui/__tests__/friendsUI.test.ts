// ── Friends UI Tests ────────────────────────────────────
import { describe, it, expect } from 'vitest';

describe('Friends UI', () => {
  describe('friends overlay DOM', () => {
    it('#friends-overlay exists', () => {
      const el = document.getElementById('friends-overlay')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('overlay-screen')).toBe(true);
    });

    it('has FRIENDS title', () => {
      expect(document.getElementById('friends-overlay')!.querySelector('.overlay-header-title')!.textContent!.trim()).toBe('FRIENDS');
    });

    it('has add friend input', () => {
      const input = document.getElementById('friends-add-input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.placeholder).toContain('Enter username');
      expect(input.maxLength).toBe(20);
    });

    it('has add button', () => {
      const btn = document.getElementById('btn-friends-add')!;
      expect(btn).toBeTruthy();
      expect(btn.querySelector('svg')).toBeTruthy();
    });

    it('has add status message area', () => {
      expect(document.getElementById('friends-add-status')).toBeTruthy();
    });

    it('has requests section (hidden)', () => {
      const requests = document.getElementById('friends-requests')!;
      expect(requests).toBeTruthy();
      expect(requests.classList.contains('hidden')).toBe(true);
    });

    it('has friends list section', () => {
      expect(document.getElementById('friends-list-section')).toBeTruthy();
      expect(document.getElementById('friends-list')).toBeTruthy();
    });

    it('has empty state message', () => {
      const empty = document.getElementById('friends-empty')!;
      expect(empty).toBeTruthy();
      expect(empty.textContent).toContain('No friends yet');
    });
  });

  describe('unified notification system', () => {
    it('#notif-toast-container exists', () => {
      expect(document.getElementById('notif-toast-container')).toBeTruthy();
    });

    it('#notif-list exists in dropdown', () => {
      expect(document.getElementById('notif-list')).toBeTruthy();
    });

    it('#notif-badge exists on bell icon', () => {
      expect(document.getElementById('notif-badge')).toBeTruthy();
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { renderSubplate, updateSubplateUser, _resetForTesting } from '../menuSubplate';

describe('menuSubplate', () => {
  let container: HTMLElement;

  beforeEach(() => {
    _resetForTesting();
    container = document.createElement('div');
    container.id = 'menu-subplate';
    document.body.innerHTML = '';
    document.body.appendChild(container);
  });

  describe('renderSubplate', () => {
    it('renders ANON when no user info provided', () => {
      renderSubplate(container, null, null, null);
      const spans = container.querySelectorAll('[data-type]');
      expect(spans[0]?.getAttribute('data-type')).toBe('ANON');
    });

    it('renders username when provided', () => {
      renderSubplate(container, 'SCOTHO', 1240, { level: 23, percent: 67 });
      const spans = container.querySelectorAll('[data-type]');
      expect(spans[0]?.getAttribute('data-type')).toBe('SCOTHO');
    });

    it('renders ANON for anonymous usernames matching Luminal_Anon_ pattern', () => {
      renderSubplate(container, 'Luminal_Anon_A1B2C3', 0, { level: 1, percent: 0 });
      const spans = container.querySelectorAll('[data-type]');
      expect(spans[0]?.getAttribute('data-type')).toBe('ANON');
    });

    it('renders flow value formatted with commas', () => {
      renderSubplate(container, 'TEST', 12500, { level: 5, percent: 50 });
      const spans = container.querySelectorAll('[data-type]');
      const types = Array.from(spans).map(s => s.getAttribute('data-type'));
      expect(types).toContain('12,500');
    });

    it('renders level number', () => {
      renderSubplate(container, 'TEST', 100, { level: 7, percent: 33 });
      const spans = container.querySelectorAll('[data-type]');
      const types = Array.from(spans).map(s => s.getAttribute('data-type'));
      expect(types).toContain('7');
    });

    it('renders XP bar with correct width percentage', () => {
      renderSubplate(container, 'TEST', 100, { level: 3, percent: 45 });
      const fill = container.querySelector('.subplate-xp__fill') as HTMLElement;
      expect(fill).toBeTruthy();
      expect(fill.style.width).toBe('45%');
    });

    it('renders XP bar at 0% for new players', () => {
      renderSubplate(container, 'TEST', 0, { level: 1, percent: 0 });
      const fill = container.querySelector('.subplate-xp__fill') as HTMLElement;
      expect(fill.style.width).toBe('0%');
    });

    it('clamps XP bar to 100% maximum', () => {
      renderSubplate(container, 'TEST', 0, { level: 1, percent: 150 });
      const fill = container.querySelector('.subplate-xp__fill') as HTMLElement;
      expect(fill.style.width).toBe('100%');
    });

    it('creates cursor element', () => {
      renderSubplate(container, 'TEST', 0, { level: 1, percent: 0 });
      expect(container.querySelector('.subplate-cursor')).toBeTruthy();
    });

    it('creates expected number of typed spans', () => {
      renderSubplate(container, 'TEST', 100, { level: 3, percent: 50 });
      // 6 text segments + 1 XP bar = 7 spans with data-type
      const spans = container.querySelectorAll('[data-type]');
      expect(spans.length).toBe(7);
    });
  });

  describe('updateSubplateUser', () => {
    it('re-renders with new values', () => {
      renderSubplate(container, 'OLD', 100, { level: 1, percent: 10 });
      updateSubplateUser('NEW', 500, { level: 3, percent: 50 });
      const spans = container.querySelectorAll('[data-type]');
      expect(spans[0]?.getAttribute('data-type')).toBe('NEW');
    });

    it('does nothing if no container was set', () => {
      _resetForTesting();
      // Should not throw
      updateSubplateUser('TEST', 100, { level: 1, percent: 0 });
    });
  });

  describe('ANON display name', () => {
    it('shows ANON when username is null', () => {
      renderSubplate(container, null, null, null);
      const spans = container.querySelectorAll('[data-type]');
      expect(spans[0]?.getAttribute('data-type')).toBe('ANON');
    });

    it('shows ANON for empty string username', () => {
      renderSubplate(container, '', 0, { level: 1, percent: 0 });
      const spans = container.querySelectorAll('[data-type]');
      expect(spans[0]?.getAttribute('data-type')).toBe('ANON');
    });
  });
});

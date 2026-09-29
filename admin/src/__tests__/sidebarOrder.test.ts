import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadOrder, saveOrder, getGroupForSection, DEFAULT_ORDER, GROUPS } from '../ui/sidebarOrder';

// Mock localStorage
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => { storage.set(key, val); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => storage.clear()),
  get length() { return storage.size; },
  key: vi.fn(() => null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
});

describe('loadOrder', () => {
  it('returns default order when nothing stored', () => {
    const order = loadOrder();
    expect(order).toEqual(DEFAULT_ORDER);
  });

  it('returns stored order from localStorage', () => {
    const custom = ['tasks', 'live', 'bugs'];
    storage.set('luminal-admin-sidebar-order', JSON.stringify(custom));
    const order = loadOrder();
    expect(order[0]).toBe('tasks');
    expect(order[1]).toBe('live');
    expect(order[2]).toBe('bugs');
    expect(order.length).toBeGreaterThan(3);
  });

  it('merges new sections not in stored order', () => {
    const partial = ['live', 'tasks'];
    storage.set('luminal-admin-sidebar-order', JSON.stringify(partial));
    const order = loadOrder();
    expect(order[0]).toBe('live');
    expect(order[1]).toBe('tasks');
    for (const s of DEFAULT_ORDER) {
      expect(order).toContain(s);
    }
  });

  it('returns default on invalid JSON', () => {
    storage.set('luminal-admin-sidebar-order', 'not-json');
    const order = loadOrder();
    expect(order).toEqual(DEFAULT_ORDER);
  });

  it('returns default on empty array', () => {
    storage.set('luminal-admin-sidebar-order', '[]');
    const order = loadOrder();
    expect(order).toEqual(DEFAULT_ORDER);
  });
});

describe('saveOrder', () => {
  it('persists order to localStorage', () => {
    const order = ['tasks', 'live'];
    saveOrder(order);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'luminal-admin-sidebar-order',
      JSON.stringify(order),
    );
  });
});

describe('getGroupForSection', () => {
  it('returns empty string for ungrouped sections', () => {
    expect(getGroupForSection('live')).toBe('');
  });

  it('returns correct group for planning sections', () => {
    expect(getGroupForSection('tasks')).toBe('Planning');
    expect(getGroupForSection('sessions')).toBe('Planning');
    expect(getGroupForSection('notes')).toBe('Planning');
    expect(getGroupForSection('specs')).toBe('Planning');
  });

  it('returns correct group for dev sections', () => {
    expect(getGroupForSection('git')).toBe('Dev');
    expect(getGroupForSection('audits')).toBe('Dev');
    expect(getGroupForSection('function-logs')).toBe('Dev');
    expect(getGroupForSection('file-browser')).toBe('Dev');
  });

  it('returns correct group for testing sections', () => {
    expect(getGroupForSection('test-center')).toBe('Testing');
    expect(getGroupForSection('e2e-matrix')).toBe('Testing');
    expect(getGroupForSection('testing')).toBe('Testing');
  });

  it('returns correct group for data sections', () => {
    expect(getGroupForSection('users')).toBe('Data');
    expect(getGroupForSection('matches')).toBe('Data');
    expect(getGroupForSection('leaderboard')).toBe('Data');
    expect(getGroupForSection('database')).toBe('Data');
    expect(getGroupForSection('playtime')).toBe('Data');
  });

  it('returns correct group for operations sections', () => {
    expect(getGroupForSection('bugs')).toBe('Operations');
    expect(getGroupForSection('purge')).toBe('Operations');
    expect(getGroupForSection('notifications')).toBe('Operations');
    expect(getGroupForSection('ollama')).toBe('Operations');
    expect(getGroupForSection('incidents')).toBe('Operations');
  });

  it('returns correct group for utilities sections', () => {
    expect(getGroupForSection('links')).toBe('Utilities');
    expect(getGroupForSection('viewer')).toBe('Utilities');
    expect(getGroupForSection('help')).toBe('Utilities');
    expect(getGroupForSection('settings')).toBe('Utilities');
  });

  it('returns Other for unknown sections', () => {
    expect(getGroupForSection('unknown')).toBe('Other');
  });
});

describe('GROUPS', () => {
  it('covers all non-ungrouped sections in DEFAULT_ORDER', () => {
    const allGrouped = GROUPS.flatMap(g => g.sections);
    const ungrouped = new Set(['live']);
    for (const s of DEFAULT_ORDER) {
      if (ungrouped.has(s)) continue;
      expect(allGrouped).toContain(s);
    }
  });

  it('has exactly 7 groups', () => {
    expect(GROUPS).toHaveLength(7);
  });
});

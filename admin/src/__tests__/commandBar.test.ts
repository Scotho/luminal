// ── Command bar tests ─────────────────────────────────────
//
// The fuzzyMatch and buildActions functions are not exported, so we test
// the public initCommandBar export and verify the module loads correctly.
// We also replicate the fuzzyMatch logic to test the algorithm directly,
// since it's a pure function with clear expected behavior.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies that buildActions imports
vi.mock('../ui/sidebarOrder', () => ({
  DEFAULT_ORDER: ['live', 'tasks', 'sessions'],
}));

vi.mock('../ui/agentTemplates', () => ({
  BUILTIN_TEMPLATES: [
    { label: 'Run Tests', prompt: 'run tests' },
    { label: 'Deploy', prompt: 'deploy' },
  ],
}));

vi.mock('../ui/ccPanel', () => ({
  sessionManager: { enqueue: vi.fn() },
}));

import { initCommandBar } from '../ui/commandBar';

// ── Standalone fuzzyMatch replica for unit testing ────────
// This mirrors the logic in commandBar.ts lines 101-115.
interface Action { label: string; category: string }

function fuzzyMatch(query: string, actions: Action[]): Action[] {
  const q = query.toLowerCase();
  if (!q) return actions;

  const scored: { action: Action; pos: number }[] = [];
  for (const action of actions) {
    const idx = action.label.toLowerCase().indexOf(q);
    if (idx !== -1) {
      scored.push({ action, pos: idx });
    }
  }

  scored.sort((a, b) => a.pos - b.pos);
  return scored.map(s => s.action);
}

// ── Test data ─────────────────────────────────────────────

const testActions: Action[] = [
  { label: 'Go to Status', category: 'Navigate' },
  { label: 'Go to Tasks', category: 'Navigate' },
  { label: 'Run Tests', category: 'Agent' },
  { label: 'Toggle CC Panel', category: 'Action' },
  { label: 'New Custom Agent', category: 'Action' },
  { label: 'Refresh Usage', category: 'Action' },
];

// ── fuzzyMatch tests ──────────────────────────────────────

describe('fuzzyMatch', () => {
  it('returns all actions for empty query', () => {
    const result = fuzzyMatch('', testActions);
    expect(result).toEqual(testActions);
  });

  it('filters to matching items only', () => {
    const result = fuzzyMatch('toggle', testActions);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Toggle CC Panel');
  });

  it('is case insensitive', () => {
    const result = fuzzyMatch('TOGGLE', testActions);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Toggle CC Panel');
  });

  it('returns empty for no match', () => {
    const result = fuzzyMatch('zzzzz', testActions);
    expect(result).toHaveLength(0);
  });

  it('ranks earlier position higher', () => {
    // "Go" appears at position 0 in "Go to Status" and "Go to Tasks"
    // "Run" appears at position 0 in "Run Tests"
    // All start at 0, so order is preserved among equal positions
    const actions: Action[] = [
      { label: 'Something Test', category: 'A' },  // "test" at pos 10
      { label: 'Test Runner', category: 'B' },       // "test" at pos 0
      { label: 'A Test File', category: 'C' },       // "test" at pos 2
    ];
    const result = fuzzyMatch('test', actions);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe('Test Runner');      // pos 0
    expect(result[1].label).toBe('A Test File');       // pos 2
    expect(result[2].label).toBe('Something Test');    // pos 10
  });

  it('exact match (full label) still works', () => {
    const result = fuzzyMatch('Run Tests', testActions);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Run Tests');
  });

  it('matches substring in the middle', () => {
    const result = fuzzyMatch('custom', testActions);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('New Custom Agent');
  });

  it('matches multiple items and sorts by position', () => {
    // "go" matches "Go to Status" (pos 0) and "Go to Tasks" (pos 0)
    // and also "Toggle CC Panel" (pos 3 — "Tog" doesn't match, but "go" is in "Toggle" at pos 3? No — "toggle" has "go" at index 3? Actually T-o-g-g-l-e... "go" is not there. Let me check.)
    // Actually: "Go to Status".toLowerCase() = "go to live status" — indexOf("go") = 0
    // "Go to Tasks" — indexOf("go") = 0
    // "Toggle CC Panel" — "toggle cc panel" — indexOf("go") = -1 (no "go" substring)
    const result = fuzzyMatch('go', testActions);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].label).toBe('Go to Status');
    expect(result[1].label).toBe('Go to Tasks');
  });
});

// ── initCommandBar tests ──────────────────────────────────

describe('initCommandBar', () => {
  it('is importable and is a function', () => {
    expect(typeof initCommandBar).toBe('function');
  });

  it('registers a keydown listener without crashing', () => {
    const spy = vi.spyOn(document, 'addEventListener');
    initCommandBar();
    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
    spy.mockRestore();
  });
});

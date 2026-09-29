// ── noteModel tests ───────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NoteNode,
  NotesTab,
  genId,
  makeNode,
  defaultState,
  findNode,
  findNodeById,
  getDepth,
  flatList,
  isDescendant,
  updateModifiedTimes,
} from '../sections/notes/noteModel';

// ── Shared test tree ──────────────────────────────────────

function makeTree(): NoteNode[] {
  const grandchild: NoteNode = { id: 'gc1', text: 'grandchild', children: [], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const child1: NoteNode = { id: 'c1', text: 'child 1', children: [grandchild], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const child2: NoteNode = { id: 'c2', text: 'child 2', children: [], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const root1: NoteNode = { id: 'r1', text: 'root 1', children: [child1, child2], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const root2: NoteNode = { id: 'r2', text: 'root 2', children: [], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  return [root1, root2];
}

function makeTab(roots?: NoteNode[]): NotesTab {
  return { id: 'tab1', label: 'Test', root: roots ?? makeTree() };
}

// ── genId ─────────────────────────────────────────────────

describe('genId', () => {
  it('returns a string matching note_<timestamp>_<random>', () => {
    const id = genId();
    expect(id).toMatch(/^note_\d+_[a-z0-9]+$/);
  });

  it('returns unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => genId()));
    expect(ids.size).toBe(50);
  });
});

// ── makeNode ──────────────────────────────────────────────

describe('makeNode', () => {
  it('creates a node with correct defaults', () => {
    const node = makeNode('hello');
    expect(node.text).toBe('hello');
    expect(node.children).toEqual([]);
    expect(node.collapsed).toBe(false);
    expect(node.id).toMatch(/^note_\d+_[a-z0-9]+$/);
    expect(node.created).toBeTruthy();
    expect(node.modified).toBe(node.created);
  });

  it('defaults to empty text when no argument given', () => {
    const node = makeNode();
    expect(node.text).toBe('');
  });

  it('sets created/modified to ISO timestamps', () => {
    const node = makeNode('test');
    // Should be parseable as a date
    expect(new Date(node.created).toISOString()).toBe(node.created);
  });
});

// ── defaultState ──────────────────────────────────────────

describe('defaultState', () => {
  it('returns a state with one tab', () => {
    const state = defaultState();
    expect(state.tabs).toHaveLength(1);
  });

  it('tab has label "Notes" and empty root', () => {
    const state = defaultState();
    expect(state.tabs[0].label).toBe('Notes');
    expect(state.tabs[0].root).toEqual([]);
  });

  it('activeTabId matches the tab id', () => {
    const state = defaultState();
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });
});

// ── findNode ──────────────────────────────────────────────

describe('findNode', () => {
  it('finds a root-level node', () => {
    const roots = makeTree();
    const loc = findNode(roots, 'r1');
    expect(loc).not.toBeNull();
    expect(loc!.parent).toBe(roots);
    expect(loc!.index).toBe(0);
    expect(loc!.parentNode).toBeNull();
    expect(loc!.ancestors).toEqual([]);
  });

  it('finds a nested child', () => {
    const roots = makeTree();
    const loc = findNode(roots, 'c1');
    expect(loc).not.toBeNull();
    expect(loc!.parentNode!.id).toBe('r1');
    expect(loc!.index).toBe(0);
    expect(loc!.ancestors).toHaveLength(1);
    expect(loc!.ancestors[0].id).toBe('r1');
  });

  it('finds a grandchild with full ancestor path', () => {
    const roots = makeTree();
    const loc = findNode(roots, 'gc1');
    expect(loc).not.toBeNull();
    expect(loc!.parentNode!.id).toBe('c1');
    expect(loc!.ancestors.map(a => a.id)).toEqual(['r1', 'c1']);
  });

  it('returns null for a missing id', () => {
    const roots = makeTree();
    expect(findNode(roots, 'nope')).toBeNull();
  });
});

// ── findNodeById ──────────────────────────────────────────

describe('findNodeById', () => {
  it('returns the NoteNode directly (not a location)', () => {
    const roots = makeTree();
    const node = findNodeById(roots, 'c1');
    expect(node).not.toBeNull();
    expect(node!.id).toBe('c1');
    expect(node!.text).toBe('child 1');
  });

  it('finds a deeply nested node', () => {
    const roots = makeTree();
    const node = findNodeById(roots, 'gc1');
    expect(node).not.toBeNull();
    expect(node!.text).toBe('grandchild');
  });

  it('returns null for a missing id', () => {
    const roots = makeTree();
    expect(findNodeById(roots, 'missing')).toBeNull();
  });
});

// ── getDepth ──────────────────────────────────────────────

describe('getDepth', () => {
  it('returns 0 for a root node', () => {
    expect(getDepth(makeTab(), 'r1')).toBe(0);
  });

  it('returns 1 for a direct child', () => {
    expect(getDepth(makeTab(), 'c1')).toBe(1);
  });

  it('returns 2 for a grandchild', () => {
    expect(getDepth(makeTab(), 'gc1')).toBe(2);
  });

  it('returns -1 for a missing node', () => {
    expect(getDepth(makeTab(), 'nope')).toBe(-1);
  });
});

// ── flatList ──────────────────────────────────────────────

describe('flatList', () => {
  it('returns nodes in depth-first order', () => {
    const roots = makeTree();
    const ids = flatList(roots).map(n => n.id);
    expect(ids).toEqual(['r1', 'c1', 'gc1', 'c2', 'r2']);
  });

  it('skips children of collapsed nodes', () => {
    const roots = makeTree();
    roots[0].collapsed = true; // collapse r1
    const ids = flatList(roots).map(n => n.id);
    expect(ids).toEqual(['r1', 'r2']);
  });

  it('skips only the collapsed subtree, not siblings', () => {
    const roots = makeTree();
    // Collapse c1 (child of r1), r1 itself stays expanded
    roots[0].children[0].collapsed = true;
    const ids = flatList(roots).map(n => n.id);
    expect(ids).toEqual(['r1', 'c1', 'c2', 'r2']);
  });

  it('returns empty array for empty input', () => {
    expect(flatList([])).toEqual([]);
  });
});

// ── isDescendant ──────────────────────────────────────────

describe('isDescendant', () => {
  it('returns true for a direct child', () => {
    const roots = makeTree();
    expect(isDescendant(roots[0], 'c1')).toBe(true);
  });

  it('returns true for a grandchild', () => {
    const roots = makeTree();
    expect(isDescendant(roots[0], 'gc1')).toBe(true);
  });

  it('returns false for self', () => {
    const roots = makeTree();
    expect(isDescendant(roots[0], 'r1')).toBe(false);
  });

  it('returns false for an unrelated node', () => {
    const roots = makeTree();
    expect(isDescendant(roots[1], 'c1')).toBe(false);
  });

  it('returns false for a node with no children', () => {
    const roots = makeTree();
    expect(isDescendant(roots[1], 'anything')).toBe(false);
  });
});

// ── updateModifiedTimes ───────────────────────────────────

describe('updateModifiedTimes', () => {
  it('updates modified field on all nodes', () => {
    const roots = makeTree();
    const before = roots[0].modified;
    // Ensure time advances
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));

    updateModifiedTimes(roots);

    expect(roots[0].modified).toBe('2026-06-15T12:00:00.000Z');
    expect(roots[0].modified).not.toBe(before);
    // Check nested node too
    expect(roots[0].children[0].modified).toBe('2026-06-15T12:00:00.000Z');
    expect(roots[0].children[0].children[0].modified).toBe('2026-06-15T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('handles empty array without error', () => {
    expect(() => updateModifiedTimes([])).not.toThrow();
  });
});

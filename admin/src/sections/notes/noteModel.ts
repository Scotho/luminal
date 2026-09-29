// ── Data Model & Tree Operations ──────────────────────────────────────────

export interface NoteNode {
  id: string;
  text: string;
  children: NoteNode[];
  collapsed: boolean;
  created: string;
  modified: string;
}

export interface NotesTab {
  id: string;
  label: string;
  root: NoteNode[];
  type?: 'notes' | 'reminders';
}

export interface NotesState {
  tabs: NotesTab[];
  activeTabId: string;
}

export interface NodeLocation {
  parent: NoteNode[];
  index: number;
  parentNode: NoteNode | null;     // null = root level
  ancestors: NoteNode[];           // path from root to parentNode
}

// ── ID Generator ───────────────────────────────────────────────────────────

export function genId(): string {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Node Factory ───────────────────────────────────────────────────────────

export function makeNode(text = ''): NoteNode {
  const now = new Date().toISOString();
  return { id: genId(), text, children: [], collapsed: false, created: now, modified: now };
}

// ── Default State ──────────────────────────────────────────────────────────

export function defaultState(): NotesState {
  const tabId = genId();
  return {
    tabs: [{ id: tabId, label: 'Notes', root: [] }],
    activeTabId: tabId,
  };
}

// ── Tree Search ────────────────────────────────────────────────────────────

export function findNode(
  nodes: NoteNode[],
  id: string,
  parentNode: NoteNode | null = null,
  ancestors: NoteNode[] = [],
): NodeLocation | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parent: nodes, index: i, parentNode, ancestors };
    const found = findNode(nodes[i].children, id, nodes[i], [...ancestors, nodes[i]]);
    if (found) return found;
  }
  return null;
}

export function findNodeById(nodes: NoteNode[], id: string): NoteNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeById(n.children, id);
    if (found) return found;
  }
  return null;
}

// ── Tree Utilities ─────────────────────────────────────────────────────────

export function getDepth(tab: NotesTab, id: string): number {
  function walk(nodes: NoteNode[], depth: number): number {
    for (const n of nodes) {
      if (n.id === id) return depth;
      const d = walk(n.children, depth + 1);
      if (d >= 0) return d;
    }
    return -1;
  }
  return walk(tab.root, 0);
}

export function flatList(nodes: NoteNode[]): NoteNode[] {
  const result: NoteNode[] = [];
  for (const n of nodes) {
    result.push(n);
    if (!n.collapsed) result.push(...flatList(n.children));
  }
  return result;
}

export function isDescendant(node: NoteNode, targetId: string): boolean {
  for (const c of node.children) {
    if (c.id === targetId) return true;
    if (isDescendant(c, targetId)) return true;
  }
  return false;
}

export function updateModifiedTimes(nodes: NoteNode[]): void {
  const now = new Date().toISOString();
  for (const n of nodes) {
    n.modified = now;
    updateModifiedTimes(n.children);
  }
}

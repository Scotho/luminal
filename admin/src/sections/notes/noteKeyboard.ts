// ── Keyboard Event Handlers ───────────────────────────────────────────────

import { NoteNode, NotesTab, findNode, makeNode, flatList } from './noteModel';

export interface KeyboardContext {
  scheduleSave: () => void;
  renderTree: () => void;
  focusNode: (id: string) => void;
  setFocusedId: (id: string | null) => void;
}

export function handleKeydown(
  e: KeyboardEvent,
  node: NoteNode,
  tab: NotesTab,
  ctx: KeyboardContext,
): void {
  if (e.key === 'Tab' && !e.shiftKey) {
    // Indent: become child of previous sibling
    e.preventDefault();
    const loc = findNode(tab.root, node.id);
    if (!loc || loc.index === 0) return; // can't indent first child

    const prevSibling = loc.parent[loc.index - 1];
    loc.parent.splice(loc.index, 1);
    prevSibling.children.push(node);
    prevSibling.collapsed = false;
    ctx.scheduleSave();
    ctx.renderTree();
    ctx.focusNode(node.id);
    return;
  }

  if (e.key === 'Tab' && e.shiftKey) {
    // Outdent: move to parent's level
    e.preventDefault();
    const loc = findNode(tab.root, node.id);
    if (!loc || !loc.parentNode) return; // already at root

    const parentLoc = findNode(tab.root, loc.parentNode.id);
    if (!parentLoc) return;

    // Remove from current parent
    loc.parent.splice(loc.index, 1);
    // Insert after parent in grandparent list
    parentLoc.parent.splice(parentLoc.index + 1, 0, node);
    ctx.scheduleSave();
    ctx.renderTree();
    ctx.focusNode(node.id);
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const loc = findNode(tab.root, node.id);
    if (!loc) return;

    const newNode = makeNode();
    loc.parent.splice(loc.index + 1, 0, newNode);
    ctx.setFocusedId(newNode.id);
    ctx.scheduleSave();
    ctx.renderTree();
    ctx.focusNode(newNode.id);
    return;
  }

  if (e.key === 'Backspace') {
    const textEl = e.target as HTMLElement;
    const text = textEl.textContent ?? '';
    if (text.length === 0) {
      e.preventDefault();
      const loc = findNode(tab.root, node.id);
      if (!loc) return;

      // Move children to parent level at this position
      const children = node.children;
      loc.parent.splice(loc.index, 1, ...children);

      // Focus previous visible node
      const flat = flatList(tab.root);
      const idx = flat.findIndex(n => n.id === (children.length > 0 ? children[0].id : ''));
      const prevNode = idx > 0 ? flat[idx - 1] : (flat.length > 0 ? flat[0] : null);
      const focusId = prevNode?.id ?? null;
      ctx.setFocusedId(focusId);
      ctx.scheduleSave();
      ctx.renderTree();
      if (focusId) ctx.focusNode(focusId);
      return;
    }
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const flat = flatList(tab.root);
    const idx = flat.findIndex(n => n.id === node.id);
    if (idx > 0) {
      const id = flat[idx - 1].id;
      ctx.setFocusedId(id);
      ctx.focusNode(id);
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const flat = flatList(tab.root);
    const idx = flat.findIndex(n => n.id === node.id);
    if (idx < flat.length - 1) {
      const id = flat[idx + 1].id;
      ctx.setFocusedId(id);
      ctx.focusNode(id);
    }
    return;
  }
}

// ── Diff Renderer tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseDiff, renderDiff, diffWords } from '../diffRenderer';
import type { DiffHunk } from '../diffRenderer';

// Sample single-hunk diff
const SINGLE_HUNK_DIFF = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,6 +10,8 @@ function foo() {
   const a = 1;
   const b = 2;
+  const c = 3;
+  const d = 4;
   const e = 5;
   return a + b;
 }`;

// Sample multi-hunk diff
const MULTI_HUNK_DIFF = `--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,4 +1,5 @@ function a() {
 line1
+added1
 line2
 line3
 line4
@@ -20,4 +21,3 @@ function b() {
 lineA
-removed1
 lineB
 lineC`;

// ── parseDiff ──────────────────────────────────────────────

describe('parseDiff', () => {
  it('returns empty array for empty input', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('   \n  \n')).toEqual([]);
  });

  it('parses single-hunk diff into one hunk', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    expect(hunks).toHaveLength(1);
  });

  it('assigns correct oldStart and newStart', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    expect(hunks[0].oldStart).toBe(10);
    expect(hunks[0].newStart).toBe(10);
  });

  it('counts add/remove/context lines correctly', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    const lines = hunks[0].lines;
    const adds = lines.filter(l => l.type === 'add');
    const removes = lines.filter(l => l.type === 'remove');
    const ctx = lines.filter(l => l.type === 'context');
    expect(adds).toHaveLength(2);
    expect(removes).toHaveLength(0);
    expect(ctx).toHaveLength(5);
  });

  it('assigns correct line numbers to context and add lines', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    const lines = hunks[0].lines;
    // First context line: old=10, new=10
    expect(lines[0].type).toBe('context');
    expect(lines[0].oldNum).toBe(10);
    expect(lines[0].newNum).toBe(10);
    // First add line: no oldNum, newNum=12
    const firstAdd = lines.find(l => l.type === 'add');
    expect(firstAdd?.oldNum).toBeUndefined();
    expect(firstAdd?.newNum).toBe(12);
  });

  it('parses multi-hunk diff into two hunks', () => {
    const hunks = parseDiff(MULTI_HUNK_DIFF);
    expect(hunks).toHaveLength(2);
  });

  it('second hunk has correct oldStart/newStart', () => {
    const hunks = parseDiff(MULTI_HUNK_DIFF);
    expect(hunks[1].oldStart).toBe(20);
    expect(hunks[1].newStart).toBe(21);
  });

  it('second hunk has correct add/remove counts', () => {
    const hunks = parseDiff(MULTI_HUNK_DIFF);
    const lines = hunks[1].lines;
    const adds = lines.filter(l => l.type === 'add');
    const removes = lines.filter(l => l.type === 'remove');
    expect(adds).toHaveLength(0);
    expect(removes).toHaveLength(1);
  });
});

// ── renderDiff ─────────────────────────────────────────────

describe('renderDiff', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders "No changes" for empty hunks array', () => {
    renderDiff([], container);
    expect(container.querySelector('.cc-diff-empty')).not.toBeNull();
    expect(container.querySelector('.cc-diff-empty')?.textContent).toContain('No changes');
  });

  it('added lines have class cc-diff-line--add', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    renderDiff(hunks, container);
    const addLines = container.querySelectorAll('.cc-diff-line--add');
    expect(addLines.length).toBe(2);
  });

  it('removed lines have class cc-diff-line--remove', () => {
    const hunks = parseDiff(MULTI_HUNK_DIFF);
    renderDiff(hunks, container);
    const removeLines = container.querySelectorAll('.cc-diff-line--remove');
    expect(removeLines.length).toBe(1);
  });

  it('context lines have class cc-diff-line--context', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    renderDiff(hunks, container);
    const ctxLines = container.querySelectorAll('.cc-diff-line--context');
    // 4 context lines total but may be collapsed — at least some present
    expect(ctxLines.length).toBeGreaterThan(0);
  });

  it('renders gutter elements for line numbers', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    renderDiff(hunks, container);
    const gutters = container.querySelectorAll('.cc-diff-gutter');
    expect(gutters.length).toBeGreaterThan(0);
  });

  it('renders old and new gutter elements', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    renderDiff(hunks, container);
    expect(container.querySelectorAll('.cc-diff-gutter--old').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.cc-diff-gutter--new').length).toBeGreaterThan(0);
  });

  it('action buttons call onAction with hunkIndex and action', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    const onAction = vi.fn();
    renderDiff(hunks, container, { onAction });

    const acceptBtn = container.querySelector('.cc-diff-accept') as HTMLButtonElement;
    expect(acceptBtn).not.toBeNull();
    acceptBtn.click();
    expect(onAction).toHaveBeenCalledWith(0, 'accept');

    const rejectBtn = container.querySelector('.cc-diff-reject') as HTMLButtonElement;
    expect(rejectBtn).not.toBeNull();
    rejectBtn.click();
    expect(onAction).toHaveBeenCalledWith(0, 'reject');
  });

  it('action buttons have data-hunk attribute', () => {
    const hunks = parseDiff(MULTI_HUNK_DIFF);
    const onAction = vi.fn();
    renderDiff(hunks, container, { onAction });

    const acceptBtns = container.querySelectorAll('.cc-diff-accept');
    expect(acceptBtns[0].getAttribute('data-hunk')).toBe('0');
    expect(acceptBtns[1].getAttribute('data-hunk')).toBe('1');
  });

  it('collapses unchanged context sections of 8+ lines', () => {
    // Build a diff with 10 context lines between changes
    const bigContextDiff = `--- a/src/big.ts
+++ b/src/big.ts
@@ -1,14 +1,15 @@ function big() {
+  const added = true;
 line1
 line2
 line3
 line4
 line5
 line6
 line7
 line8
 line9
 line10
-  const removed = true;
 line11
 line12
 line13`;

    const hunks = parseDiff(bigContextDiff);
    renderDiff(hunks, container);
    const collapsed = container.querySelector('.cc-diff-collapsed');
    expect(collapsed).not.toBeNull();
    expect(collapsed?.textContent).toMatch(/unchanged/i);
  });

  it('does not collapse context sections fewer than 8 lines', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    renderDiff(hunks, container);
    // SINGLE_HUNK_DIFF only has 4 context lines — should not collapse
    const collapsed = container.querySelector('.cc-diff-collapsed');
    expect(collapsed).toBeNull();
  });

  it('split view adds cc-diff--split class to wrapper', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    renderDiff(hunks, container, { mode: 'split' });
    expect(container.querySelector('.cc-diff--split')).not.toBeNull();
  });

  it('unified view does not add cc-diff--split class', () => {
    const hunks = parseDiff(SINGLE_HUNK_DIFF);
    renderDiff(hunks, container, { mode: 'unified' });
    expect(container.querySelector('.cc-diff--split')).toBeNull();
  });

  it('escapes HTML in content', () => {
    const xssDiff = `--- a/src/x.ts
+++ b/src/x.ts
@@ -1,2 +1,3 @@ fn() {
 const x = 1;
+  const evil = "<script>alert(1)</script>";
 const y = 2;`;

    const hunks = parseDiff(xssDiff);
    renderDiff(hunks, container);
    // The raw <script> tag must not appear as an actual element
    expect(container.querySelector('script')).toBeNull();
    // But the escaped version should be in the text
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });

  it('word-level diff produces highlight spans for changed words', () => {
    const hunks: DiffHunk[] = [{
      oldStart: 1, oldCount: 2, newStart: 1, newCount: 2,
      lines: [
        { type: 'remove', content: 'const foo = 1;', oldNum: 1 },
        { type: 'add', content: 'const bar = 1;', newNum: 1 },
      ],
    }];
    renderDiff(hunks, container);
    expect(container.querySelector('.cc-diff-word--remove')).toBeTruthy();
    expect(container.querySelector('.cc-diff-word--add')).toBeTruthy();
  });

  it('comment button present and emits comment action', () => {
    const onAction = vi.fn();
    renderDiff([{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [{ type: 'add', content: 'x', newNum: 1 }] }], container, { onAction });
    const btn = container.querySelector('.cc-diff-comment') as HTMLElement;
    expect(btn).toBeTruthy();
    btn?.click();
    expect(onAction).toHaveBeenCalledWith(0, 'comment');
  });

  it('binary diff shows fallback message', () => {
    const hunks = parseDiff('Binary files a/img.png and b/img.png differ');
    renderDiff(hunks, container);
    expect(container.querySelector('.cc-diff-binary')).toBeTruthy();
  });
});

// ── diffWords ──────────────────────────────────────────────

describe('diffWords', () => {
  it('marks changed words as changed', () => {
    const { oldSegments, newSegments } = diffWords('const foo = 1;', 'const bar = 1;');
    const oldChanged = oldSegments.filter(s => s.changed).map(s => s.text);
    const newChanged = newSegments.filter(s => s.changed).map(s => s.text);
    expect(oldChanged).toContain('foo');
    expect(newChanged).toContain('bar');
  });

  it('marks unchanged words as not changed', () => {
    const { oldSegments, newSegments } = diffWords('const foo = 1;', 'const bar = 1;');
    const oldUnchanged = oldSegments.filter(s => !s.changed).map(s => s.text);
    const newUnchanged = newSegments.filter(s => !s.changed).map(s => s.text);
    expect(oldUnchanged).toContain('const');
    expect(newUnchanged).toContain('const');
  });

  it('returns empty segments for empty strings', () => {
    const { oldSegments, newSegments } = diffWords('', '');
    expect(oldSegments).toHaveLength(1); // split('') produces ['']
    expect(newSegments).toHaveLength(1);
  });
});

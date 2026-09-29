// ── noteRenderer tests ────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { NoteNode } from '../sections/notes/noteModel';
import { filterNotes, highlightText, renderMarkdown } from '../sections/notes/noteRenderer';

// ── Shared test tree ──────────────────────────────────────

function makeTree(): NoteNode[] {
  const grandchild: NoteNode = { id: 'gc1', text: 'grandchild note', children: [], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const child1: NoteNode = { id: 'c1', text: 'child 1', children: [grandchild], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const child2: NoteNode = { id: 'c2', text: 'child 2 deploy', children: [], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const root1: NoteNode = { id: 'r1', text: 'root 1', children: [child1, child2], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  const root2: NoteNode = { id: 'r2', text: 'root 2', children: [], collapsed: false, created: '2026-01-01', modified: '2026-01-01' };
  return [root1, root2];
}

// ── filterNotes ───────────────────────────────────────────

describe('filterNotes', () => {
  it('returns all node IDs when query is empty', () => {
    const roots = makeTree();
    const visible = filterNotes(roots, '');
    expect(visible.size).toBe(5);
    expect(visible.has('r1')).toBe(true);
    expect(visible.has('gc1')).toBe(true);
    expect(visible.has('r2')).toBe(true);
  });

  it('includes matching node and its ancestors', () => {
    const roots = makeTree();
    // "grandchild" only matches gc1, but r1 and c1 are ancestors
    const visible = filterNotes(roots, 'grandchild');
    expect(visible.has('gc1')).toBe(true);
    expect(visible.has('c1')).toBe(true);
    expect(visible.has('r1')).toBe(true);
    // Unrelated nodes should not be visible
    expect(visible.has('c2')).toBe(false);
    expect(visible.has('r2')).toBe(false);
  });

  it('is case-insensitive', () => {
    const roots = makeTree();
    const visible = filterNotes(roots, 'DEPLOY');
    expect(visible.has('c2')).toBe(true);
    expect(visible.has('r1')).toBe(true); // ancestor of c2
  });

  it('returns empty set when nothing matches', () => {
    const roots = makeTree();
    const visible = filterNotes(roots, 'zzzznotfound');
    expect(visible.size).toBe(0);
  });

  it('matches partial text', () => {
    const roots = makeTree();
    const visible = filterNotes(roots, 'child');
    // matches c1 ("child 1"), c2 ("child 2 deploy"), gc1 ("grandchild note")
    expect(visible.has('c1')).toBe(true);
    expect(visible.has('c2')).toBe(true);
    expect(visible.has('gc1')).toBe(true);
    // r1 is ancestor of all matches
    expect(visible.has('r1')).toBe(true);
  });
});

// ── highlightText ─────────────────────────────────────────

describe('highlightText', () => {
  it('returns escaped text when query is empty', () => {
    expect(highlightText('hello <world>', '')).toBe('hello &lt;world&gt;');
  });

  it('wraps matching text in <mark> tags', () => {
    const result = highlightText('hello world', 'world');
    expect(result).toContain('<mark');
    expect(result).toContain('world</mark>');
    expect(result).toContain('hello ');
  });

  it('is case-insensitive', () => {
    const result = highlightText('Hello World', 'hello');
    expect(result).toContain('<mark');
    expect(result).toContain('Hello</mark>');
  });

  it('escapes HTML in text before highlighting', () => {
    const result = highlightText('<script>alert("xss")</script>', 'script');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;');
    expect(result).toContain('<mark');
  });

  it('handles special regex characters in query', () => {
    const result = highlightText('price is $5.00', '$5.00');
    expect(result).toContain('<mark');
    expect(result).toContain('$5.00</mark>');
  });

  it('highlights multiple occurrences', () => {
    const result = highlightText('foo bar foo', 'foo');
    const markCount = (result.match(/<mark/g) ?? []).length;
    expect(markCount).toBe(2);
  });

  it('returns plain escaped text when no match', () => {
    const result = highlightText('hello world', 'xyz');
    expect(result).toBe('hello world');
    expect(result).not.toContain('<mark');
  });
});

// ── renderMarkdown ────────────────────────────────────────

describe('renderMarkdown', () => {
  it('converts **bold** to <strong>', () => {
    const result = renderMarkdown('hello **world**');
    expect(result).toContain('<strong>world</strong>');
  });

  it('converts backtick code to <code>', () => {
    const result = renderMarkdown('run `npm install` first');
    expect(result).toContain('<code');
    expect(result).toContain('npm install</code>');
  });

  it('converts [link](url) to <a>', () => {
    const result = renderMarkdown('see [docs](https://example.com)');
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('>docs</a>');
  });

  it('escapes HTML before applying markdown', () => {
    const result = renderMarkdown('<b>not bold</b>');
    expect(result).not.toContain('<b>');
    expect(result).toContain('&lt;b&gt;');
  });

  it('handles multiple markdown features in one string', () => {
    const result = renderMarkdown('**bold** and `code` and [link](http://x.com)');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('code</code>');
    expect(result).toContain('<a href="http://x.com"');
  });

  it('returns escaped plain text when no markdown present', () => {
    expect(renderMarkdown('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

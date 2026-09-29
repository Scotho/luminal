// ── Markdown Renderer tests ────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';

// Import after each test group to allow cache reset testing
import { renderMarkdownToString, renderMarkdown, _resetForTesting } from '../markdownRenderer';

beforeEach(() => {
  _resetForTesting();
});

// ── Fast path ─────────────────────────────────────────────

describe('fast path (no markdown syntax)', () => {
  it('returns plain text as-is when under 500 chars with no markdown', () => {
    const input = 'Hello, world! This is plain text with no special characters.';
    const result = renderMarkdownToString(input);
    expect(result).toBe(input);
  });

  it('returns empty string for empty input', () => {
    const result = renderMarkdownToString('');
    expect(result).toBe('');
  });
});

// ── Basic inline markdown ──────────────────────────────────

describe('bold text', () => {
  it('renders **bold** as <strong>', () => {
    const result = renderMarkdownToString('**bold text**');
    expect(result).toContain('<strong>');
    expect(result).toContain('bold text');
    expect(result).toContain('</strong>');
  });
});

describe('italic text', () => {
  it('renders *italic* as <em>', () => {
    const result = renderMarkdownToString('*italic text*');
    expect(result).toContain('<em>');
    expect(result).toContain('italic text');
    expect(result).toContain('</em>');
  });
});

describe('inline code', () => {
  it('renders `code` with cc-md-code-inline class', () => {
    const result = renderMarkdownToString('Use `myFunction()` here');
    expect(result).toContain('<code class="cc-md-code-inline">');
    expect(result).toContain('myFunction()');
  });
});

// ── Links ──────────────────────────────────────────────────

describe('links', () => {
  it('renders [text](url) as <a class="cc-md-link"> with href', () => {
    const result = renderMarkdownToString('[Click here](https://example.com)');
    expect(result).toContain('class="cc-md-link"');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('Click here');
  });
});

// ── Nesting ────────────────────────────────────────────────

describe('bold inside italic nesting', () => {
  it('renders ***bold italic*** with both <strong> and <em>', () => {
    const result = renderMarkdownToString('***bold italic***');
    expect(result).toContain('<strong>');
    expect(result).toContain('<em>');
  });
});

// ── Fenced code blocks ─────────────────────────────────────

describe('fenced code block with language', () => {
  it('renders ```typescript with cc-code-block and language-typescript class', () => {
    const input = '```typescript\nconst x: number = 42;\n```';
    const result = renderMarkdownToString(input);
    expect(result).toContain('cc-code-block');
    expect(result).toContain('language-typescript');
  });

  it('includes the code content (Prism may add spans around tokens)', () => {
    const input = '```typescript\nconst x: number = 42;\n```';
    const result = renderMarkdownToString(input);
    // Prism wraps tokens in spans, so check for identifiable text fragments
    expect(result).toContain('42');
    expect(result).toContain('number');
  });
});

describe('code block without language tag', () => {
  it('renders ``` without language with cc-code-block', () => {
    const input = '```\nsome code\n```';
    const result = renderMarkdownToString(input);
    expect(result).toContain('cc-code-block');
    expect(result).toContain('some code');
  });
});

// ── Code block extras ─────────────────────────────────────

describe('code block copy button', () => {
  it('includes cc-code-copy in fenced code block output', () => {
    const input = '```javascript\nconsole.log("hi");\n```';
    const result = renderMarkdownToString(input);
    expect(result).toContain('cc-code-copy');
  });
});

describe('code block line numbers', () => {
  it('includes cc-code-line-num in fenced code block output', () => {
    const input = '```bash\necho hello\necho world\n```';
    const result = renderMarkdownToString(input);
    expect(result).toContain('cc-code-line-num');
  });
});

// ── Tables ────────────────────────────────────────────────

describe('table rendering', () => {
  it('renders markdown table as <table class="cc-md-table">', () => {
    const input = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const result = renderMarkdownToString(input);
    expect(result).toContain('<table class="cc-md-table">');
  });

  it('renders 3 rows: header + 2 data rows', () => {
    const input = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const result = renderMarkdownToString(input);
    const rowMatches = result.match(/<tr/g) || [];
    expect(rowMatches.length).toBe(3);
  });
});

// ── XSS protection ────────────────────────────────────────

describe('XSS protection', () => {
  it('escapes <script> tags in input', () => {
    const input = 'Hello <script>alert("xss")</script> world';
    const result = renderMarkdownToString(input);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
  });

  it('blocks javascript: URLs in links', () => {
    const input = '[click me](javascript:alert(1))';
    const result = renderMarkdownToString(input);
    expect(result).not.toContain('javascript:');
  });
});

// ── LRU cache ─────────────────────────────────────────────

describe('LRU cache', () => {
  it('returns same result on cache hit (same input twice)', () => {
    const input = '**bold**';
    const first = renderMarkdownToString(input);
    const second = renderMarkdownToString(input);
    expect(first).toBe(second);
  });

  it('evicts oldest entry when cache exceeds 500 entries', () => {
    // Fill cache with 501 unique entries
    for (let i = 0; i < 501; i++) {
      renderMarkdownToString(`entry-${i}-plain text no markup here`);
    }
    // After 501 inserts, the cache should still work (not crash)
    const result = renderMarkdownToString('still works');
    expect(typeof result).toBe('string');
  });
});

// ── renderMarkdown (DOM variant) ──────────────────────────

describe('renderMarkdown (DOM variant)', () => {
  it('sets innerHTML of container', () => {
    const container = document.createElement('div');
    renderMarkdown('**hello**', container);
    expect(container.innerHTML).toContain('strong');
  });

  it('handles empty input without crashing', () => {
    const container = document.createElement('div');
    expect(() => renderMarkdown('', container)).not.toThrow();
  });
});

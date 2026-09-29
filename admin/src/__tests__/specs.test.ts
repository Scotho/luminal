import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml, inlineFormat } from '../sections/specs';

// ── inlineFormat ────────────────────────────────────────

describe('inlineFormat', () => {
  it('renders **bold** as <strong>', () => {
    expect(inlineFormat('**bold**')).toBe('<strong>bold</strong>');
  });

  it('renders `code` as <code>', () => {
    const result = inlineFormat('`code`');
    expect(result).toContain('<code');
    expect(result).toContain('code</code>');
  });

  it('renders [link](url) as <a>', () => {
    const result = inlineFormat('[click](https://example.com)');
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('>click</a>');
  });

  it('handles nested bold with code', () => {
    const result = inlineFormat('**bold `code`**');
    expect(result).toContain('<strong>');
    expect(result).toContain('</strong>');
    expect(result).toContain('<code');
  });

  it('escapes HTML entities', () => {
    const result = inlineFormat('<script>alert("xss")</script>');
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('returns escaped plain text when no formatting', () => {
    expect(inlineFormat('hello world')).toBe('hello world');
  });
});

// ── renderMarkdownToHtml ────────────────────────────────

describe('renderMarkdownToHtml', () => {
  it('renders # heading as <h1> with styling', () => {
    const result = renderMarkdownToHtml('# Heading');
    expect(result).toContain('<h1');
    expect(result).toContain('Heading');
    expect(result).toContain('</h1>');
    expect(result).toContain('font-size:20px');
  });

  it('renders ## heading as <h2>', () => {
    const result = renderMarkdownToHtml('## Sub');
    expect(result).toContain('<h2');
    expect(result).toContain('Sub');
    expect(result).toContain('</h2>');
    expect(result).toContain('font-size:16px');
  });

  it('renders code blocks with <pre><code> and escapes content', () => {
    const result = renderMarkdownToHtml('```\n<div>hello</div>\n```');
    expect(result).toContain('<pre');
    expect(result).toContain('<code');
    expect(result).toContain('&lt;div&gt;hello&lt;/div&gt;');
    expect(result).toContain('</code></pre>');
  });

  it('renders - list item as bullet with padding', () => {
    const result = renderMarkdownToHtml('- list item');
    expect(result).toContain('&#8226;');
    expect(result).toContain('list item');
    expect(result).toContain('padding:2px 0 2px');
  });

  it('renders 1. numbered list item', () => {
    const result = renderMarkdownToHtml('1. numbered');
    expect(result).toContain('1.');
    expect(result).toContain('numbered');
    expect(result).toContain('padding:2px 0 2px');
  });

  it('renders --- as <hr>', () => {
    const result = renderMarkdownToHtml('---');
    expect(result).toContain('<hr');
    expect(result).toContain('border-top:1px solid');
  });

  it('renders empty line as spacer div', () => {
    const result = renderMarkdownToHtml('');
    expect(result).toContain('<div style="height:8px;"></div>');
  });

  it('renders table rows with | as <table><tr><td>', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const result = renderMarkdownToHtml(md);
    expect(result).toContain('<table');
    expect(result).toContain('<tr>');
    expect(result).toContain('<td');
    expect(result).toContain('</table>');
  });

  it('renders plain text as <p>', () => {
    const result = renderMarkdownToHtml('Hello world');
    expect(result).toContain('<p');
    expect(result).toContain('Hello world');
    expect(result).toContain('</p>');
  });

  it('closes unclosed code blocks', () => {
    const result = renderMarkdownToHtml('```\ncode');
    expect(result).toContain('</code></pre>');
  });

  it('closes unclosed tables', () => {
    const result = renderMarkdownToHtml('| A | B |');
    expect(result).toContain('</table>');
  });
});

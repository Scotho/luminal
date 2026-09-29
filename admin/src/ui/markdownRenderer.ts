/**
 * markdownRenderer.ts
 * Full markdown rendering with Prism.js syntax highlighting and LRU cache.
 * Uses `marked` for parsing and `prismjs` for code highlighting.
 */

import { marked } from 'marked';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-markup';

// ── LRU Cache ─────────────────────────────────────────────

const CACHE_MAX = 500;
let cache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const val = cache.get(key);
  if (val === undefined) return undefined;
  // Promote on access: delete + re-insert to make it "most recent"
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function cacheSet(key: string, val: string): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= CACHE_MAX) {
    // Evict oldest (first inserted key)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, val);
}

// ── Fast path detection ───────────────────────────────────

const MD_SYNTAX_RE = /[#*`|[\]>\-_~]|\n\n|^\d+\. |\n\d+\. /;

function hasMdSyntax(content: string): boolean {
  return MD_SYNTAX_RE.test(content);
}

// ── XSS sanitisation ─────────────────────────────────────

function sanitize(html: string): string {
  // Strip script tags
  return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
}

function isSafeHref(href: string | null): boolean {
  if (!href) return false;
  const trimmed = href.trim().toLowerCase();
  return !trimmed.startsWith('javascript:') && !trimmed.startsWith('vbscript:');
}

// ── Code block renderer ───────────────────────────────────

function renderCodeBlock(code: string, lang: string | undefined): string {
  const language = lang ? lang.trim().toLowerCase() : '';
  const prismLang = language && Prism.languages[language] ? language : '';

  let highlighted: string;
  try {
    highlighted = prismLang
      ? Prism.highlight(code, Prism.languages[prismLang], prismLang)
      : escapeCodeContent(code);
  } catch {
    highlighted = escapeCodeContent(code);
  }

  const langLabel = language ? `<span class="cc-code-lang">${escapeAttr(language)}</span>` : '';
  const langClass = prismLang ? ` language-${escapeAttr(prismLang)}` : '';

  // Build line-number gutter
  const lines = code.split('\n');
  const lineNums = lines
    .map((_, i) => `<span class="cc-code-line-num">${i + 1}</span>`)
    .join('');

  return (
    `<div class="cc-code-block${langClass}">` +
      `<div class="cc-code-header">` +
        langLabel +
        `<button class="cc-code-copy" type="button">Copy</button>` +
      `</div>` +
      `<div class="cc-code-body">` +
        `<div class="cc-code-gutter">${lineNums}</div>` +
        `<pre class="cc-code-pre"><code>${highlighted}</code></pre>` +
      `</div>` +
    `</div>`
  );
}

function escapeCodeContent(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Configure marked ──────────────────────────────────────

marked.use({
  gfm: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      return renderCodeBlock(text, lang);
    },
    codespan({ text }: { text: string }): string {
      return `<code class="cc-md-code-inline">${text}</code>`;
    },
    link({ href, tokens }: { href: string | null; title?: string | null; tokens: object[] }): string {
      if (!isSafeHref(href)) {
        // Render as plain text — reconstruct raw text from token raws
        const rawText = tokens
          .map(t => String((t as Record<string, unknown>).raw ?? ''))
          .join('');
        return marked.parseInline(rawText) as string;
      }
      const safeHref = escapeAttr(href ?? '');
      const inner = this.parser.parseInline(tokens as Parameters<typeof this.parser.parseInline>[0]);
      return `<a class="cc-md-link" href="${safeHref}" target="_blank" rel="noopener">${inner}</a>`;
    },
    table(token: { header: unknown[]; rows: unknown[][] }): string {
      const headerCells = (token.header as Array<{ tokens: object[]; align?: string }>)
        .map(cell => `<th>${this.parser.parseInline(cell.tokens as Parameters<typeof this.parser.parseInline>[0])}</th>`)
        .join('');
      const bodyRows = (token.rows as Array<Array<{ tokens: object[]; align?: string }>>)
        .map(row => {
          const cells = row
            .map(cell => `<td>${this.parser.parseInline(cell.tokens as Parameters<typeof this.parser.parseInline>[0])}</td>`)
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<table class="cc-md-table"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    },
  },
});

// ── Public API ────────────────────────────────────────────

/** Render markdown to an HTML string with LRU caching. */
export function renderMarkdownToString(content: string): string {
  if (!content) return '';

  // Fast path: short plain text
  if (content.length < 500 && !hasMdSyntax(content)) {
    return content;
  }

  const cached = cacheGet(content);
  if (cached !== undefined) return cached;

  const raw = marked(content, { async: false }) as string;
  const result = sanitize(raw);

  cacheSet(content, result);
  return result;
}

/** Render markdown into a DOM container element. */
export function renderMarkdown(content: string, container: HTMLElement): void {
  container.innerHTML = renderMarkdownToString(content);
}

/** Reset cache and marked config for testing. */
export function _resetForTesting(): void {
  cache = new Map<string, string>();
}

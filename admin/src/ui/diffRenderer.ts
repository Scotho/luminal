/**
 * diffRenderer.ts
 *
 * Shared component for rendering unified diffs with word-level highlighting.
 * Used in the Agent Diffs page and inline tool result display.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldNum?: number;
  newNum?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface Segment {
  text: string;
  changed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Escape HTML special characters. */
function escapeHtml(str: string): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Word-level diff ───────────────────────────────────────────────────────

/**
 * Compute LCS table for two arrays of tokens.
 * Returns the length table (not the sequence itself).
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  // Build (m+1) x (n+1) table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/**
 * Backtrack the LCS table to produce matching indices for both arrays.
 * Returns a set of indices in `a` that are part of the LCS.
 */
function lcsMatchedIndicesA(dp: number[][], a: string[], b: string[]): Set<number> {
  const matched = new Set<number>();
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matched.add(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return matched;
}

function lcsMatchedIndicesB(dp: number[][], a: string[], b: string[]): Set<number> {
  const matched = new Set<number>();
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matched.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return matched;
}

/**
 * Compute word-level diff between two lines.
 * Splits by word boundaries (preserving whitespace tokens) and uses LCS
 * to identify which tokens are unchanged. Changed tokens get `changed: true`.
 */
export function diffWords(oldLine: string, newLine: string): { oldSegments: Segment[]; newSegments: Segment[] } {
  const oldTokens = oldLine.split(/(\s+)/);
  const newTokens = newLine.split(/(\s+)/);

  const dp = lcsTable(oldTokens, newTokens);
  const matchedOld = lcsMatchedIndicesA(dp, oldTokens, newTokens);
  const matchedNew = lcsMatchedIndicesB(dp, oldTokens, newTokens);

  const oldSegments: Segment[] = oldTokens.map((text, i) => ({ text, changed: !matchedOld.has(i) }));
  const newSegments: Segment[] = newTokens.map((text, i) => ({ text, changed: !matchedNew.has(i) }));

  return { oldSegments, newSegments };
}

/** Render an array of segments into an HTML string. */
function renderSegments(segments: Segment[], type: 'add' | 'remove'): string {
  const cls = type === 'add' ? 'cc-diff-word--add' : 'cc-diff-word--remove';
  return segments
    .map(s => s.changed ? `<span class="${cls}">${escapeHtml(s.text)}</span>` : escapeHtml(s.text))
    .join('');
}

// ── parseDiff ─────────────────────────────────────────────────────────────

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Pattern to detect binary diff lines. */
const BINARY_PATTERN = /^Binary files /m;

/**
 * Parse a unified diff string into an array of DiffHunk objects.
 * File header lines (---/+++) are skipped.
 */
export function parseDiff(diffText: string): DiffHunk[] {
  if (!diffText || !diffText.trim()) return [];

  // Binary diff detection — return a sentinel hunk with a special marker
  if (BINARY_PATTERN.test(diffText)) {
    return [{ oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, lines: [{ type: 'context', content: '\x00binary\x00' }] }];
  }

  const lines = diffText.split('\n');
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    // Skip file header lines
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) continue;

    const hunkMatch = HUNK_HEADER.exec(raw);
    if (hunkMatch) {
      if (current) hunks.push(current);
      oldLine = parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      newLine = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      current = { oldStart: oldLine, oldCount, newStart: newLine, newCount, lines: [] };
      continue;
    }

    if (!current) continue;

    if (raw.startsWith('+')) {
      current.lines.push({ type: 'add', content: raw.slice(1), newNum: newLine++ });
    } else if (raw.startsWith('-')) {
      current.lines.push({ type: 'remove', content: raw.slice(1), oldNum: oldLine++ });
    } else {
      // context line — may start with ' ' or be empty (end of diff)
      const content = raw.startsWith(' ') ? raw.slice(1) : raw;
      current.lines.push({ type: 'context', content, oldNum: oldLine++, newNum: newLine++ });
    }
  }

  if (current) hunks.push(current);
  return hunks;
}

// ── renderDiff ────────────────────────────────────────────────────────────

/** Threshold: collapse consecutive context lines at or above this count. */
const COLLAPSE_THRESHOLD = 8;

/** Max lines rendered per hunk before truncation. */
const TRUNCATION_LIMIT = 400;

interface RenderOptions {
  mode?: 'unified' | 'split';
  onAction?: (hunk: number, action: 'accept' | 'reject' | 'comment') => void;
  /** Internal: when true, render without truncation cap. */
  _noTruncate?: boolean;
}

/**
 * Render parsed diff hunks into a container element.
 * Clears the container before rendering.
 */
export function renderDiff(hunks: DiffHunk[], container: HTMLElement, options: RenderOptions = {}): void {
  container.innerHTML = '';

  if (hunks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cc-diff-empty';
    empty.textContent = 'No changes';
    container.appendChild(empty);
    return;
  }

  // Binary diff detection — sentinel hunk produced by parseDiff
  if (
    hunks.length === 1 &&
    hunks[0].lines.length === 1 &&
    hunks[0].lines[0].content === '\x00binary\x00'
  ) {
    const bin = document.createElement('div');
    bin.className = 'cc-diff-binary';
    bin.textContent = 'Binary file changed';
    container.appendChild(bin);
    return;
  }

  const { mode = 'unified', onAction, _noTruncate = false } = options;

  const wrapper = document.createElement('div');
  wrapper.className = 'cc-diff';
  if (mode === 'split') wrapper.classList.add('cc-diff--split');

  for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
    const hunk = hunks[hunkIdx];

    // ── Hunk header / action bar ───────────────────────────
    const header = document.createElement('div');
    header.className = 'cc-diff-hunk-header';

    const headerText = document.createElement('span');
    headerText.className = 'cc-diff-hunk-label';
    headerText.textContent = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    header.appendChild(headerText);

    if (onAction) {
      const actions = document.createElement('span');
      actions.className = 'cc-diff-actions';

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'cc-diff-accept';
      acceptBtn.setAttribute('data-hunk', String(hunkIdx));
      acceptBtn.textContent = 'Accept';
      acceptBtn.addEventListener('click', () => onAction(hunkIdx, 'accept'));
      actions.appendChild(acceptBtn);

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'cc-diff-reject';
      rejectBtn.setAttribute('data-hunk', String(hunkIdx));
      rejectBtn.textContent = 'Reject';
      rejectBtn.addEventListener('click', () => onAction(hunkIdx, 'reject'));
      actions.appendChild(rejectBtn);

      const commentBtn = document.createElement('button');
      commentBtn.className = 'cc-diff-comment';
      commentBtn.setAttribute('data-hunk', String(hunkIdx));
      commentBtn.textContent = 'Comment';
      commentBtn.addEventListener('click', () => onAction(hunkIdx, 'comment'));
      actions.appendChild(commentBtn);

      header.appendChild(actions);
    }

    wrapper.appendChild(header);

    // ── Lines ──────────────────────────────────────────────
    const table = document.createElement('table');
    table.className = 'cc-diff-table';

    const totalLines = hunk.lines.length;
    const lineLimit = !_noTruncate && totalLines > TRUNCATION_LIMIT ? TRUNCATION_LIMIT : totalLines;
    const linesToRender = hunk.lines.slice(0, lineLimit);

    // Pre-compute word-diff pairs: map index -> segments for remove/add pairs
    const wordDiffCache = buildWordDiffCache(linesToRender);

    // Group consecutive context lines to detect collapsible runs
    let i = 0;
    while (i < linesToRender.length) {
      const line = linesToRender[i];

      if (line.type === 'context') {
        // Collect the full run of context lines
        let j = i;
        while (j < linesToRender.length && linesToRender[j].type === 'context') j++;
        const run = linesToRender.slice(i, j);

        if (run.length >= COLLAPSE_THRESHOLD) {
          // Render collapsed row
          const collapseRow = table.insertRow();
          collapseRow.className = 'cc-diff-collapsed';
          const cell = collapseRow.insertCell();
          cell.colSpan = 3;
          cell.textContent = `... ${run.length} unchanged lines ...`;

          // Expand on click
          collapseRow.style.cursor = 'pointer';
          collapseRow.addEventListener('click', () => {
            // Remove collapse row and insert the actual lines
            const parent = collapseRow.parentElement;
            if (!parent) return;
            const before = collapseRow.nextSibling;
            parent.removeChild(collapseRow);
            for (const ctx of run) {
              parent.insertBefore(buildLineRow(ctx, mode, null, null), before ?? null);
            }
          });
        } else {
          // Render context lines normally
          for (const ctx of run) {
            table.appendChild(buildLineRow(ctx, mode, null, null));
          }
        }

        i = j;
      } else {
        const wordDiff = wordDiffCache.get(i) ?? null;
        table.appendChild(buildLineRow(line, mode, wordDiff?.oldSegments ?? null, wordDiff?.newSegments ?? null));
        i++;
      }
    }

    wrapper.appendChild(table);

    // ── Truncation notice ──────────────────────────────────
    if (!_noTruncate && totalLines > TRUNCATION_LIMIT) {
      const notice = document.createElement('div');
      notice.className = 'cc-diff-truncated';
      notice.innerHTML = `Showing ${TRUNCATION_LIMIT} of ${totalLines} lines `;
      const showAllBtn = document.createElement('button');
      showAllBtn.className = 'cc-diff-show-all';
      showAllBtn.textContent = 'Show all';
      showAllBtn.addEventListener('click', () => {
        // Re-render without truncation
        renderDiff(hunks, container, { ...options, _noTruncate: true });
      });
      notice.appendChild(showAllBtn);
      wrapper.appendChild(notice);
    }
  }

  container.appendChild(wrapper);
}

/**
 * Pre-compute word-level diffs for all adjacent remove+add pairs in a line array.
 * Returns a map: index (of the remove line) -> { oldSegments, newSegments }.
 * The add line's segments are stored at the add line's index as newSegments.
 */
function buildWordDiffCache(
  lines: DiffLine[]
): Map<number, { oldSegments: Segment[] | null; newSegments: Segment[] | null }> {
  const cache = new Map<number, { oldSegments: Segment[] | null; newSegments: Segment[] | null }>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === 'remove' && i + 1 < lines.length && lines[i + 1].type === 'add') {
      const { oldSegments, newSegments } = diffWords(lines[i].content, lines[i + 1].content);
      cache.set(i, { oldSegments, newSegments: null });
      cache.set(i + 1, { oldSegments: null, newSegments });
      i += 2;
    } else {
      i++;
    }
  }
  return cache;
}

// ── buildLineRow ──────────────────────────────────────────────────────────

function buildLineRow(
  line: DiffLine,
  mode: 'unified' | 'split',
  oldSegments: Segment[] | null,
  newSegments: Segment[] | null,
): HTMLTableRowElement {
  const row = document.createElement('tr');
  const typeClass = line.type === 'add'
    ? 'cc-diff-line--add'
    : line.type === 'remove'
      ? 'cc-diff-line--remove'
      : 'cc-diff-line--context';
  row.className = `cc-diff-line ${typeClass}`;

  if (mode === 'split') {
    // Old gutter
    const oldGutter = row.insertCell();
    oldGutter.className = 'cc-diff-gutter cc-diff-gutter--old';
    oldGutter.textContent = line.oldNum !== undefined ? String(line.oldNum) : '';

    // Old content (only shown for remove/context in split mode)
    const oldContent = row.insertCell();
    oldContent.className = 'cc-diff-content cc-diff-content--old';
    if (line.type !== 'add') {
      oldContent.innerHTML = oldSegments
        ? renderSegments(oldSegments, 'remove')
        : escapeHtml(line.content);
    }

    // New gutter
    const newGutter = row.insertCell();
    newGutter.className = 'cc-diff-gutter cc-diff-gutter--new';
    newGutter.textContent = line.newNum !== undefined ? String(line.newNum) : '';

    // New content (only shown for add/context in split mode)
    const newContent = row.insertCell();
    newContent.className = 'cc-diff-content cc-diff-content--new';
    if (line.type !== 'remove') {
      newContent.innerHTML = newSegments
        ? renderSegments(newSegments, 'add')
        : escapeHtml(line.content);
    }
  } else {
    // Unified: old gutter, new gutter, content
    const oldGutter = row.insertCell();
    oldGutter.className = 'cc-diff-gutter cc-diff-gutter--old';
    oldGutter.textContent = line.oldNum !== undefined ? String(line.oldNum) : '';

    const newGutter = row.insertCell();
    newGutter.className = 'cc-diff-gutter cc-diff-gutter--new';
    newGutter.textContent = line.newNum !== undefined ? String(line.newNum) : '';

    const content = row.insertCell();
    content.className = 'cc-diff-content';
    if (line.type === 'remove' && oldSegments) {
      content.innerHTML = renderSegments(oldSegments, 'remove');
    } else if (line.type === 'add' && newSegments) {
      content.innerHTML = renderSegments(newSegments, 'add');
    } else {
      content.innerHTML = escapeHtml(line.content);
    }
  }

  return row;
}

// admin/src/sections/git/diffRenderer.ts
// Shared diff renderer for the Git section: Working Tree, Log, and Branches tabs.
// Parses unified diff output and renders file-level diffs with hunk-level gutter actions.

import { escapeHtml } from '../../ui/render';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: '+' | '-' | ' ';
  content: string;
  oldNum?: number;
  newNum?: number;
}

export interface DiffHunk {
  header: string;
  startOld: number;
  startNew: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

// ── parseDiff ─────────────────────────────────────────────────────────────────

const DIFF_FILE_RE = /^diff --git /;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/;
const B_PATH_RE = /^diff --git a\/.+ b\/(.+)$/;

/**
 * Parse raw unified diff output (e.g. from `git diff`) into an array of DiffFile objects.
 * Handles multi-file diffs. Skips `+++`/`---` header lines.
 */
export function parseDiff(raw: string): DiffFile[] {
  if (!raw || !raw.trim()) return [];

  const lines = raw.split('\n');
  const files: DiffFile[] = [];

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const pushHunk = (): void => {
    if (currentHunk && currentFile) {
      currentFile.hunks.push(currentHunk);
    }
    currentHunk = null;
  };

  const pushFile = (): void => {
    pushHunk();
    if (currentFile) {
      files.push(currentFile);
    }
    currentFile = null;
  };

  for (const raw_line of lines) {
    // New file boundary
    if (DIFF_FILE_RE.test(raw_line)) {
      pushFile();
      const pathMatch = B_PATH_RE.exec(raw_line);
      const path = pathMatch ? pathMatch[1] : raw_line;
      currentFile = { path, hunks: [], additions: 0, deletions: 0 };
      continue;
    }

    if (!currentFile) continue;

    // Hunk header: @@ -old +new @@
    const hunkMatch = HUNK_HEADER_RE.exec(raw_line);
    if (hunkMatch) {
      pushHunk();
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      currentHunk = {
        header: raw_line,
        startOld: oldLine,
        startNew: newLine,
        lines: [],
      };
      continue;
    }

    // Skip file header lines (--- a/... and +++ b/...)
    if (raw_line.startsWith('--- ') || raw_line.startsWith('+++ ')) continue;
    // Skip index/mode lines that appear between diff --git and @@
    if (!currentHunk) continue;

    if (raw_line.startsWith('+')) {
      const dl: DiffLine = { type: '+', content: raw_line.slice(1), newNum: newLine++ };
      currentHunk.lines.push(dl);
      currentFile.additions++;
    } else if (raw_line.startsWith('-')) {
      const dl: DiffLine = { type: '-', content: raw_line.slice(1), oldNum: oldLine++ };
      currentHunk.lines.push(dl);
      currentFile.deletions++;
    } else {
      // Context line: starts with ' ' or is blank (no-newline sentinel)
      const content = raw_line.startsWith(' ') ? raw_line.slice(1) : raw_line;
      const dl: DiffLine = { type: ' ', content, oldNum: oldLine++, newNum: newLine++ };
      currentHunk.lines.push(dl);
    }
  }

  pushFile();
  return files;
}

// ── renderFileDiff ────────────────────────────────────────────────────────────

export interface RenderFileDiffOptions {
  showStageButtons?: boolean;
  showAIButton?: boolean;
}

/**
 * Render a single file's diff as an HTML string.
 * The caller is responsible for wiring mouseenter/mouseleave on `.diff-hunk`
 * to toggle `.hunk-actions` opacity, and wiring `.hunk-ai-btn` click handlers.
 */
export function renderFileDiff(file: DiffFile, options: RenderFileDiffOptions = {}): string {
  const { showStageButtons = false, showAIButton = false } = options;
  const showActions = showStageButtons || showAIButton;

  const addCount = file.additions;
  const delCount = file.deletions;

  const statsHtml = [
    addCount > 0 ? `<span style="color:var(--green)">+${addCount}</span>` : '',
    delCount > 0 ? `<span style="color:var(--red-bright,#d45234)">-${delCount}</span>` : '',
  ].filter(Boolean).join(' ');

  const fileHeader = `
    <div style="
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:6px 10px;
      border:1px solid var(--border);
      border-radius:4px 4px 0 0;
      background:var(--bg-surface);
      font-family:var(--font-mono);
      font-size:12px;
    ">
      <span style="color:var(--text)">${escapeHtml(file.path)}</span>
      <span style="font-size:11px">${statsHtml}</span>
    </div>
  `.trim();

  const hunksHtml = file.hunks.map((hunk, hunkIdx) => renderHunk(hunk, hunkIdx, file.path, showActions, showStageButtons, showAIButton)).join('');

  const hunksContainer = `
    <div style="
      border:1px solid var(--border);
      border-top:none;
      border-radius:0 0 4px 4px;
      overflow-x:auto;
    ">${hunksHtml}</div>
  `.trim();

  return `<div class="diff-file" style="margin-bottom:16px;">${fileHeader}${hunksContainer}</div>`;
}

function renderHunk(
  hunk: DiffHunk,
  hunkIdx: number,
  filePath: string,
  showActions: boolean,
  showStageButtons: boolean,
  showAIButton: boolean,
): string {
  const hunkHeaderRow = `
    <tr style="background:rgba(110,224,240,0.05);">
      <td colspan="3" style="
        padding:2px 8px;
        font-family:var(--font-mono);
        font-size:11px;
        color:var(--text-dim);
        white-space:pre;
      ">${escapeHtml(hunk.header)}</td>
    </tr>
  `.trim();

  const linesHtml = hunk.lines.map(line => renderDiffLine(line)).join('');

  const tableHtml = `
    <table style="
      width:100%;
      border-collapse:collapse;
      font-family:var(--font-mono);
      font-size:12px;
      line-height:1.5;
    ">
      ${hunkHeaderRow}
      ${linesHtml}
    </table>
  `.trim();

  let actionsHtml = '';
  if (showActions) {
    const fileAttr = escapeHtml(filePath);
    const hunkAttr = String(hunkIdx);
    const btnBase = `
      cursor:pointer;
      font-size:13px;
      padding:2px 6px;
      border-radius:3px;
      background:transparent;
      color:var(--text);
    `.trim();

    const stageBtn = showStageButtons
      ? `<button
          class="hunk-stage-btn"
          data-file="${fileAttr}"
          data-hunk="${hunkAttr}"
          title="Stage hunk"
          style="${btnBase} border:1px solid var(--green);"
        >±</button>`
      : '';

    const aiBtn = showAIButton
      ? `<button
          class="hunk-ai-btn"
          data-file="${fileAttr}"
          data-hunk="${hunkAttr}"
          title="Ask AI about hunk"
          style="${btnBase} border:1px solid var(--accent);"
        >◈</button>`
      : '';

    actionsHtml = `
      <div class="hunk-actions" style="
        position:absolute;
        right:4px;
        top:4px;
        display:flex;
        gap:4px;
        opacity:0;
        transition:opacity 0.15s;
      ">${stageBtn}${aiBtn}</div>
    `.trim();
  }

  return `
    <div
      class="diff-hunk"
      data-hunk="${String(hunkIdx)}"
      data-file="${escapeHtml(filePath)}"
      style="position:relative;"
    >
      ${tableHtml}
      ${actionsHtml}
    </div>
  `.trim();
}

function renderDiffLine(line: DiffLine): string {
  let bg = 'transparent';
  let prefixColor = 'var(--text-dim)';
  let prefixChar = '&nbsp;';

  if (line.type === '+') {
    bg = 'rgba(34,197,94,0.08)';
    prefixColor = 'var(--green)';
    prefixChar = '+';
  } else if (line.type === '-') {
    bg = 'rgba(239,68,68,0.08)';
    prefixColor = 'var(--red-bright,#d45234)';
    prefixChar = '-';
  }

  const oldNumCell = `
    <td style="
      width:36px;
      min-width:36px;
      padding:0 6px;
      text-align:right;
      color:var(--text-dim);
      font-size:10px;
      user-select:none;
      vertical-align:top;
      background:${bg};
    ">${line.oldNum !== undefined ? String(line.oldNum) : ''}</td>
  `.trim();

  const newNumCell = `
    <td style="
      width:36px;
      min-width:36px;
      padding:0 6px;
      text-align:right;
      color:var(--text-dim);
      font-size:10px;
      user-select:none;
      vertical-align:top;
      background:${bg};
    ">${line.newNum !== undefined ? String(line.newNum) : ''}</td>
  `.trim();

  const contentCell = `
    <td style="
      padding:0 8px;
      white-space:pre;
      background:${bg};
      width:100%;
    "><span style="color:${prefixColor};margin-right:6px;">${prefixChar}</span>${escapeHtml(line.content)}</td>
  `.trim();

  return `<tr style="background:${bg};">${oldNumCell}${newNumCell}${contentCell}</tr>`;
}

// ── getHunkPatch ──────────────────────────────────────────────────────────────

/**
 * Returns the raw patch text for a single hunk (header + lines),
 * suitable for passing to `git apply` or `git apply --cached`.
 */
export function getHunkPatch(file: DiffFile, hunkIdx: number): string {
  const hunk = file.hunks[hunkIdx];
  if (!hunk) return '';

  const lineTexts = hunk.lines.map(l => {
    if (l.type === '+') return `+${l.content}`;
    if (l.type === '-') return `-${l.content}`;
    return ` ${l.content}`;
  });

  return [hunk.header, ...lineTexts].join('\n');
}

// ── getHunkContext ────────────────────────────────────────────────────────────

/**
 * Returns a human-readable context string for a hunk, for use as AI prompt context.
 * Format: "File: <path>\n\n<patch>"
 */
export function getHunkContext(file: DiffFile, hunkIdx: number): string {
  const patch = getHunkPatch(file, hunkIdx);
  if (!patch) return '';
  return `File: ${file.path}\n\n${patch}`;
}

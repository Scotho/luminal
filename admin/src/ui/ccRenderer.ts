import type { CCCard, CCCardType, CCSession, Session } from '../types';
import { EFFORT_GLYPHS } from '../types';
import { escapeHtml } from './render';
import { sessionManager } from './ccSessionManager';
import { getActiveSessions, onSessionsChanged } from './sessionDataService';
import { getPool } from './agentPools';
import { renderMarkdownToString } from './markdownRenderer';
import { shouldGroup, type GroupableItem } from './collapsibleGroup';
import { createSpinner } from './spinnerComponent';
import { classifyError } from './errorClassifier';
import { detachedSessions } from './detachableWindow';
import { createContextGauge } from './contextGauge';
import { createAmbientStatusBar } from './ambientStatusBar';
import { renderToolTimeline } from './toolTimeline';
import { renderPoolDashboard } from './poolDashboard';

// ── Context gauge state ────────────────────────────────
let _ctxGauge: ReturnType<typeof createContextGauge> | null = null;

// ── Ambient status bar state ───────────────────────────
let _ambientBar: ReturnType<typeof createAmbientStatusBar> | null = null;
let _ctxGaugeSessionId: string | null = null;

// ── Pool dashboard state ───────────────────────────────
let _poolDashboard: ReturnType<typeof renderPoolDashboard> | null = null;

// ── Timeline mode toggle ───────────────────────────────
let _timelineMode = false;

// ── Incremental render state ──────────────────────────
// Tracks what was last rendered so we can patch instead of full-replace
let _renderedSessionId: string | null = null;
let _renderedCardCount = 0;
let _renderedLastCardBody = '';
let _renderedSessionStatus = '';

// ── Tab structure cache (prevents innerHTML thrash during streaming) ──
let _lastTabStructureKey = '';

// ── Tab order persistence ──────────────────────────────
const TAB_ORDER_KEY = 'luminal-agent-tab-order';

export function loadTabOrder(): string[] {
  try {
    const stored = localStorage.getItem(TAB_ORDER_KEY);
    return stored ? JSON.parse(stored) as string[] : [];
  } catch { return []; }
}

export function saveTabOrder(ids: string[]): void {
  localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(ids));
}

/** Sort sessions by persisted tab order, appending new ones at end. */
function sortByTabOrder<T extends { id: string }>(items: T[]): T[] {
  const order = loadTabOrder();
  const orderMap = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ai = orderMap.get(a.id) ?? Infinity;
    const bi = orderMap.get(b.id) ?? Infinity;
    return ai - bi;
  });
}

/** Wire drag-to-reorder and scroll-wheel on the tab container. Call once. */
export function wireTabDrag(): void {
  const tabsEl = document.getElementById('cc-agent-tabs');
  if (!tabsEl) return;

  // Scroll-wheel → smooth horizontal scroll
  tabsEl.addEventListener('wheel', (e) => {
    if (tabsEl.scrollWidth > tabsEl.clientWidth) {
      e.preventDefault();
      tabsEl.scrollBy({ left: e.deltaY * 2, behavior: 'smooth' });
    }
  }, { passive: false });

  let dragId: string | null = null;

  tabsEl.addEventListener('dragstart', (e) => {
    const tab = (e.target as HTMLElement).closest('.cc-agent-tab') as HTMLElement | null;
    if (!tab) return;
    dragId = tab.dataset.agentId ?? tab.dataset.externalId ?? null;
    tab.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId ?? '');
    }
  });

  tabsEl.addEventListener('dragend', (e) => {
    const tab = (e.target as HTMLElement).closest('.cc-agent-tab') as HTMLElement | null;
    tab?.classList.remove('dragging');
    tabsEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragId = null;
  });

  tabsEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const tab = (e.target as HTMLElement).closest('.cc-agent-tab') as HTMLElement | null;
    if (!tab) return;
    tabsEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    tab.classList.add('drag-over');
  });

  tabsEl.addEventListener('dragleave', (e) => {
    const tab = (e.target as HTMLElement).closest('.cc-agent-tab') as HTMLElement | null;
    tab?.classList.remove('drag-over');
  });

  tabsEl.addEventListener('drop', (e) => {
    e.preventDefault();
    tabsEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    const dropTab = (e.target as HTMLElement).closest('.cc-agent-tab') as HTMLElement | null;
    if (!dropTab || !dragId) return;
    const dropId = dropTab.dataset.agentId ?? dropTab.dataset.externalId ?? null;
    if (!dropId || dropId === dragId) return;

    // Reorder: get current tab IDs from DOM, swap, persist
    const tabs = Array.from(tabsEl.querySelectorAll('.cc-agent-tab')) as HTMLElement[];
    const ids = tabs.map(t => t.dataset.agentId ?? t.dataset.externalId ?? '');
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(dropId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    saveTabOrder(ids);
    renderFlyout();
  });
}

// ── External session selection state ──

let _selectedExternalId: string | null = null;
const _dismissedExternals: Set<string> = new Set();

/** Get currently active external sessions (from background poller). */
export function getExternalSessions(): Session[] {
  return getActiveSessions().filter(s => !_dismissedExternals.has(s.id));
}

/** Optimistically hide an external session tab until the next poll confirms removal. */
export function dismissExternalSession(id: string): void {
  _dismissedExternals.add(id);
  // Clear once poller catches up (session gone or status changed)
  setTimeout(() => _dismissedExternals.delete(id), 10_000);
}

/** Select an external session by ID (clears web-UI selection). */
export function selectExternalSession(id: string | null): void {
  _selectedExternalId = id;
  if (id) sessionManager.selectedId = null;
}

/** Get the currently selected external session, if any. */
export function getSelectedExternal(): Session | null {
  if (!_selectedExternalId) return null;
  return getActiveSessions().find(s => s.id === _selectedExternalId) ?? null;
}

/** Subscribe to data changes and re-render flyout. Call once at init. */
export function wireSessionDataToFlyout(): void {
  onSessionsChanged(() => renderFlyout());
}

/** Render external session detail into the output panel. */
export function renderExternalSessionDetail(session: Session): string {
  const statusColors: Record<string, string> = {
    'active': 'var(--accent)', 'needs-attention': 'var(--red)', 'blocked': 'var(--red)',
  };
  const color = statusColors[session.status] ?? 'var(--text-dim)';
  const phases = session.phases.map(p => {
    if (typeof p === 'string') return { label: p, done: false };
    return p as { label: string; done: boolean };
  });

  const sortedNotes = [...session.notes].sort((a, b) => b.ts.localeCompare(a.ts));

  return `
    <div style="padding:10px 12px;">
      <div style="margin-bottom:8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="width:8px; height:8px; border-radius:50%; background:${color}; display:inline-block; flex-shrink:0;"></span>
        <span style="font-size:13px; font-weight:700; color:var(--text);">${escapeHtml(session.summary)}</span>
        <span class="cc-agent-badge cc-agent-badge--ext" style="font-size:8px;">${escapeHtml(session.source === 'admin' ? 'ADMIN' : 'EXT')}</span>
        <span style="font-size:10px; padding:1px 6px; border-radius:3px; background:rgba(128,128,128,0.15); color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">${escapeHtml(session.type)}</span>
      </div>
      <div style="font-size:10px; color:var(--text-dim); margin-bottom:8px;">
        <code style="font-size:9px;">${escapeHtml(session.id)}</code>
        &middot; Created ${escapeHtml(new Date(session.created).toLocaleString())}
        ${session.branch ? ` &middot; Branch: <code>${escapeHtml(session.branch)}</code>` : ''}
      </div>
      ${session.plan ? `<div style="font-size:11px; color:var(--text-dim); padding:6px 8px; background:var(--bg); border-radius:4px; margin-bottom:8px; white-space:pre-wrap; word-break:break-word;">${escapeHtml(session.plan)}</div>` : ''}
      ${phases.length > 0 ? `
        <div style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim); margin-bottom:8px;">
          ${phases.map(p => `<div style="margin-bottom:2px;">${p.done ? '\u2611' : '\u2610'} ${escapeHtml(p.label)}</div>`).join('')}
        </div>
      ` : ''}
      ${sortedNotes.length > 0 ? `
        <div style="border-top:1px solid var(--border); padding-top:8px;">
          <div style="font-size:10px; font-weight:600; color:var(--text-dim); margin-bottom:4px; text-transform:uppercase; letter-spacing:1px;">Notes (${sortedNotes.length})</div>
          ${sortedNotes.map(n => {
            const isAgent = n.text.startsWith('[Agent:');
            const noteColor = isAgent ? 'var(--accent)' : 'var(--text-dim)';
            return `<div style="font-size:11px; margin-bottom:6px; padding-left:8px; border-left:2px solid ${isAgent ? 'var(--accent)' : 'var(--border)'};">
              <span style="color:${noteColor}; font-size:10px;">${escapeHtml(new Date(n.ts).toLocaleString())}</span><br/>
              <span style="color:${noteColor}; white-space:pre-wrap; word-break:break-word;">${escapeHtml(n.text)}</span>
            </div>`;
          }).join('')}
        </div>
      ` : '<div style="color:var(--text-dim); font-size:11px;">No notes yet.</div>'}
    </div>
  `;
}

// ── Card Renderer (legacy, kept for external session detail) ──

const CARD_ICONS: Record<CCCardType, string> = {
  text: '&#9656;',    // >
  tool: '&#9881;',    // gear
  error: '&#9888;',   // warning
  system: '&#8505;',  // info
  result: '&#10003;', // checkmark
  'file-context': '&#128196;', // page icon
};

const CARD_COLORS: Record<CCCardType, string> = {
  text: 'var(--accent)',
  tool: 'var(--purple, #aa64ff)',
  error: 'var(--red)',
  system: 'var(--yellow)',
  result: 'var(--green)',
  'file-context': 'var(--accent-dim, #4a9eff)',
};

export function renderCard(card: CCCard): string {
  const icon = CARD_ICONS[card.type];
  const color = CARD_COLORS[card.type];
  const hasBody = card.body.trim().length > card.preview.trim().length;

  const actionBtn = card.title.includes('Suggested Tasks')
    ? '<button class="cc-create-tasks-btn" style="margin:6px 10px 8px; padding:4px 12px; background:transparent; border:1px solid var(--accent-dim); border-radius:2px; color:var(--accent); cursor:pointer; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Create All Tasks</button>'
    : '';

  return `
    <div class="cc-card cc-card-${card.type}" data-card-id="${escapeHtml(card.id)}">
      <div class="cc-card-header"${hasBody ? ' style="cursor:pointer;"' : ''}>
        <span class="cc-card-icon" style="color:${color};">${icon}</span>
        <span class="cc-card-title">${escapeHtml(card.title)}</span>
        ${hasBody ? '<span class="cc-card-chevron">&#9662;</span>' : ''}
      </div>
      <div class="cc-card-preview">${escapeHtml(card.preview)}</div>
      ${hasBody ? `<div class="cc-card-body">${escapeHtml(card.body)}</div>` : ''}
      ${actionBtn}
    </div>
  `;
}

// ── Conversation Thread Renderer ────────────────────────
//
// Renders CCSession cards as a Claude Code-like conversation thread:
// - User messages: distinct bubble with user icon
// - Assistant text: left-aligned with backend icon
// - Tool calls: compact inline blocks (expandable)
// - Agent dispatches: nested blocks with border nesting
// - System/error: subtle inline notifications

// ── Safe markdown renderer ──────────────────────────────
// Wraps renderMarkdownToString with a pre-pass that escapes raw HTML tags in
// the source content, preventing inline HTML injection while preserving all
// markdown syntax. Fenced code blocks are left untouched (their content is
// handled by the renderer itself).

/** Escape `<` and `>` in non-code-block portions of a markdown string. */
function preEscapeHtmlTags(content: string): string {
  // Split on fenced code blocks to avoid escaping code content
  const parts = content.split(/(```[\s\S]*?```|`[^`]*`)/);
  return parts.map((part, i) => {
    // Odd indices are code spans/blocks — leave them alone
    if (i % 2 === 1) return part;
    // Escape < and > outside of code
    return part.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }).join('');
}

function renderMarkdownSafe(content: string): string {
  return renderMarkdownToString(preEscapeHtmlTags(content));
}

// ── Tool type classifier ────────────────────────────────

function toolTypeClass(title: string): string {
  const t = title.toLowerCase();
  if (['read', 'glob', 'grep'].some(k => t.includes(k))) return 'tool-type-read';
  if (['edit', 'write'].some(k => t.includes(k))) return 'tool-type-edit';
  if (t.includes('bash')) return 'tool-type-bash';
  if (t.includes('agent')) return 'tool-type-agent';
  if (['web', 'fetch', 'search'].some(k => t.includes(k))) return 'tool-type-search';
  return 'tool-type-default';
}

function renderUserTurn(card: CCCard): string {
  return `<div class="conv-turn conv-turn--user" data-card-id="${escapeHtml(card.id)}">
    <div class="conv-user-icon">&#9654;</div>
    <div class="conv-user-body">${renderMarkdownSafe(card.body)}</div>
  </div>`;
}

function renderAssistantText(card: CCCard, isStreaming: boolean): string {
  const depth = card.depth ?? 0;
  const indent = depth > 0 ? ` conv-depth-${Math.min(depth, 3)}` : '';
  const streamClass = isStreaming ? ' conv-streaming' : '';
  const html = renderMarkdownSafe(card.body);

  return `<div class="conv-turn conv-turn--assistant${indent}${streamClass}" data-card-id="${escapeHtml(card.id)}">
    <div class="conv-assistant-body">${html}</div>
  </div>`;
}

function renderToolCall(card: CCCard): string {
  const depth = card.depth ?? 0;
  const indent = depth > 0 ? ` conv-depth-${Math.min(depth, 3)}` : '';
  const statusClass = card.toolStatus === 'running'
    ? ' tool-running'
    : card.toolStatus === 'error'
      ? ' tool-error'
      : ' tool-done';
  const statusIcon = card.toolStatus === 'running'
    ? '<span class="conv-tool-spinner"></span>'
    : card.toolStatus === 'error'
      ? '<span style="color:var(--red);">&#10007;</span>'
      : '<span style="color:var(--green);">&#10003;</span>';
  // Split title into tool name + detail (e.g. "Read C:\foo\bar.ts" → badge "Read", detail "C:\foo\bar.ts")
  const rawTitle = card.title;
  const spaceIdx = rawTitle.indexOf(' ');
  const badgeName = spaceIdx > 0 ? rawTitle.slice(0, spaceIdx) : rawTitle;
  const detail = spaceIdx > 0 ? rawTitle.slice(spaceIdx + 1) : '';
  const typeClass = toolTypeClass(badgeName);
  const hasBody = card.body.trim().length > 0;
  // Duration badge
  const durHtml = card.toolDuration != null && card.toolStatus === 'done'
    ? `<span class="conv-tool-dur">${(card.toolDuration / 1000).toFixed(1)}s</span>`
    : '';

  return `<div class="conv-tool${indent}${statusClass}" data-card-id="${escapeHtml(card.id)}">
    <div class="conv-tool-header"${hasBody ? ' style="cursor:pointer;"' : ''}>
      ${statusIcon}
      <span class="conv-tool-badge ${typeClass}">${escapeHtml(badgeName)}</span>
      ${detail ? `<span class="conv-tool-name">${escapeHtml(detail)}</span>` : ''}
      ${durHtml}
      ${hasBody ? '<span class="conv-tool-chevron">&#9662;</span>' : ''}
    </div>
    ${hasBody ? `<div class="conv-tool-body">${escapeHtml(card.body)}</div>` : ''}
  </div>`;
}

function renderAgentBlock(card: CCCard): string {
  const depth = card.depth ?? 0;
  const indent = depth > 0 ? ` conv-depth-${Math.min(depth, 3)}` : '';
  const statusIcon = card.toolStatus === 'running'
    ? '<span class="conv-tool-spinner"></span>'
    : card.toolStatus === 'error'
      ? '<span style="color:var(--red);">&#10007;</span>'
      : '<span style="color:var(--green);">&#10003;</span>';
  const label = card.agentLabel ? escapeHtml(card.agentLabel) : 'Agent';
  const preview = card.preview ? escapeHtml(card.preview) : '';
  const hasBody = card.body.trim().length > 0;

  return `<div class="conv-agent${indent}" data-card-id="${escapeHtml(card.id)}">
    <div class="conv-agent-header"${hasBody ? ' style="cursor:pointer;"' : ''}>
      ${statusIcon}
      <span class="conv-agent-label">${label}</span>
      ${preview ? `<span class="conv-tool-preview">${preview}</span>` : ''}
      ${hasBody ? '<span class="conv-tool-chevron">&#9662;</span>' : ''}
    </div>
    ${hasBody ? `<div class="conv-agent-body">${escapeHtml(card.body)}</div>` : ''}
  </div>`;
}

/** Subtypes considered "lifecycle" noise — eligible for auto-collapse. */
const LIFECYCLE_SUBTYPES = new Set([
  'init', 'hook_started', 'hook_response', 'hook_progress',
  'task_started', 'task_progress', 'task_notification',
  'compact_boundary',
]);

function isLifecycleSubtype(subtype: string | undefined): boolean {
  return subtype != null && LIFECYCLE_SUBTYPES.has(subtype);
}

/** Render 2+ consecutive lifecycle system cards as a collapsed summary. */
function renderLifecycleGroup(cards: CCCard[]): string {
  const count = cards.length;
  const summaries = cards.map(c => escapeHtml(c.preview || c.title));
  const previewLine = summaries.slice(0, 3).join(' \u2022 ') + (count > 3 ? ` +${count - 3} more` : '');
  const bodyHtml = cards.map(c => {
    const icon = systemIcon(c);
    return `<div class="cc-lifecycle-item">${icon} ${escapeHtml(c.preview || c.title)}</div>`;
  }).join('');

  return `<div class="conv-system conv-system--lifecycle cc-lifecycle-group" data-card-count="${count}">
    <div class="conv-system-header" style="cursor:pointer;">
      <span class="conv-system-icon">&#8505;</span>
      <span class="conv-system-text">${previewLine}</span>
      <span class="conv-tool-chevron">&#9662;</span>
    </div>
    <div class="conv-tool-body">${bodyHtml}</div>
  </div>`;
}

function systemIcon(card: CCCard): string {
  if (card.type === 'error') return '&#9888;';
  const sub = card._systemSubtype ?? '';
  if (sub === 'init') return '&#9881;';  // gear
  if (sub.startsWith('hook')) return '&#9875;'; // anchor
  if (sub.startsWith('task')) return '&#9654;'; // play
  if (sub === 'api_retry') return '&#8635;'; // clockwise arrow
  if (sub === 'compact_boundary') return '&#9986;'; // scissors
  return '&#8505;'; // info
}

function renderSystemMessage(card: CCCard): string {
  const isError = card.type === 'error';
  const sub = card._systemSubtype ?? '';
  const isLifecycle = ['init', 'hook_started', 'hook_response', 'hook_progress'].includes(sub);
  const cls = isError
    ? 'conv-system conv-system--error'
    : isLifecycle
      ? 'conv-system conv-system--lifecycle'
      : 'conv-system';
  const hasBody = card.body.trim().length > card.preview.trim().length;

  let classificationHtml = '';
  if (isError && card.body) {
    const ec = classifyError(card.body);
    if (ec.category !== 'unknown') {
      classificationHtml = `<div class="ec-badge"><span class="ec-icon">${ec.icon}</span> ${escapeHtml(ec.label)}</div>`;
      if (ec.suggestion) {
        classificationHtml += `<div class="ec-suggestion">${escapeHtml(ec.suggestion)}</div>`;
      }
    }
  }

  return `<div class="${cls}" data-card-id="${escapeHtml(card.id)}">
    <div class="conv-system-header"${hasBody ? ' style="cursor:pointer;"' : ''}>
      <span class="conv-system-icon">${systemIcon(card)}</span>
      <span class="conv-system-text">${escapeHtml(card.preview || card.title)}</span>
      ${hasBody ? '<span class="conv-tool-chevron">&#9662;</span>' : ''}
    </div>
    ${classificationHtml}
    ${hasBody ? `<div class="conv-tool-body">${escapeHtml(card.body)}</div>` : ''}
  </div>`;
}

function renderFileContext(card: CCCard): string {
  const paths = card.fileContextPaths ?? [];
  const basenames = paths.map(p => p.split('/').pop() ?? p);
  const isLoading = card.fileContextLoading === true;
  const hasBody = !isLoading && card.body.trim().length > 0;

  const spinnerHtml = isLoading
    ? '<span class="conv-tool-spinner" style="margin-right:6px;"></span>'
    : '<span style="color:var(--accent-dim, #4a9eff); margin-right:6px;">&#128196;</span>';

  const labelHtml = isLoading
    ? `<span class="conv-fc-label conv-fc-label--loading" title="${escapeHtml(basenames.join(', '))}">Injecting context: ${escapeHtml(basenames.join(', '))}</span>`
    : `<span class="conv-fc-label" title="${escapeHtml(basenames.join(', '))}">${escapeHtml(basenames.join(', '))}</span>`;

  const chevron = hasBody ? '<span class="conv-tool-chevron">&#9662;</span>' : '';

  const bodyHtml = hasBody ? `
    <div class="conv-fc-body">
      ${paths.map(p => {
        const start = card.body.indexOf(`=== ${p} ===\n`);
        const content = start >= 0
          ? card.body.slice(start + `=== ${p} ===\n`.length).split('\n\n---\n\n')[0]
          : '';
        return `<div class="conv-fc-file">
          <div class="conv-fc-file-name">${escapeHtml(p)}</div>
          <pre class="conv-fc-file-content">${escapeHtml(content.slice(0, 2000))}${content.length > 2000 ? '\n…' : ''}</pre>
        </div>`;
      }).join('')}
    </div>` : '';

  return `<div class="conv-fc${isLoading ? ' conv-fc--loading' : ''}" data-card-id="${escapeHtml(card.id)}">
    <div class="conv-fc-header"${hasBody ? ' style="cursor:pointer;"' : ''}>
      ${spinnerHtml}
      ${labelHtml}
      ${chevron}
    </div>
    ${bodyHtml}
  </div>`;
}

function renderResultBlock(card: CCCard): string {
  const hasBody = card.body.trim().length > card.preview.trim().length;
  const actionBtn = card.title.includes('Suggested Tasks')
    ? '<button class="cc-create-tasks-btn" style="margin:6px 0 4px; padding:4px 12px; background:transparent; border:1px solid var(--accent-dim); border-radius:2px; color:var(--accent); cursor:pointer; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Create All Tasks</button>'
    : '';
  return `<div class="conv-result expanded" data-card-id="${escapeHtml(card.id)}">
    <div class="conv-result-header"${hasBody ? ' style="cursor:pointer;"' : ''}>
      <span style="color:var(--green);">&#10003;</span>
      <span class="conv-result-title">${escapeHtml(card.title)}</span>
      ${hasBody ? '<span class="conv-tool-chevron">&#9662;</span>' : ''}
    </div>
    <div class="conv-result-preview">${escapeHtml(card.preview)}</div>
    ${hasBody ? `<div class="conv-tool-body">${renderMarkdownSafe(card.body)}</div>` : ''}
    ${actionBtn}
  </div>`;
}

/** Map a CCCard to a GroupableItem for use with shouldGroup. */
function cardToGroupable(card: CCCard): GroupableItem {
  return {
    id: card.id,
    type: card.title, // group by tool name (e.g. "Read", "Bash") for same-tool runs
    title: card.title,
    preview: card.preview,
    body: card.body,
    depth: card.depth ?? 0,
    status: card.toolStatus ?? 'done',
  };
}

/** Render a group of 3+ consecutive tool cards as a collapsible cc-group block. */
function renderToolGroup(group: CCCard[]): string {
  const count = group.length;
  const label = escapeHtml(group[0]?.title ?? 'Tools');
  const typeClass = toolTypeClass(group[0]?.title ?? '');
  const items = group.map(card => {
    const preview = card.preview ? escapeHtml(card.preview) : escapeHtml(card.title);
    return `<div class="cc-group-item" data-id="${escapeHtml(card.id)}">${preview}</div>`;
  }).join('');
  return `<div class="cc-group">
    <div class="cc-group-header">
      <span class="cc-group-chevron">&#9658;</span>
      <span class="cc-group-badge ${typeClass}">${count}</span>
      <span class="cc-group-label">${label}</span>
    </div>
    <div class="cc-group-body">${items}</div>
  </div>`;
}

/** Render a full session as a conversation thread. */
export function renderConversationThread(session: CCSession): string {
  const isLocal = session.backend === 'ollama' || session.backend === 'aider';
  const backendIcon = isLocal ? llamaIcon(14) : claudeIcon(14);
  const backendLabel = isLocal ? (session.backend === 'aider' ? 'Aider (Local)' : 'Qwen (Local)') : 'Claude';
  const backendClass = isLocal ? 'conv-backend--ollama' : 'conv-backend--cc';

  let html = '';

  // Session header with backend info
  html += `<div class="conv-session-header">
    <span class="conv-backend-icon ${backendClass}">${backendIcon}</span>
    <span class="conv-backend-label">${backendLabel}</span>
    <span class="conv-session-time">${new Date(session.startedAt).toLocaleTimeString()}</span>
  </div>`;

  // Initial prompt as first user message (if not already in cards)
  const hasUserCard = session.cards.some(c => c.role === 'user');
  if (!hasUserCard && session.prompt) {
    html += renderUserTurn({
      id: 'initial-prompt',
      type: 'text',
      title: 'You',
      preview: session.prompt,
      body: session.prompt,
      ts: session.startedAt,
      role: 'user',
    });
  }

  // Pre-process cards for auto-grouping of consecutive tool runs.
  // We work with "segments": contiguous slices of cards that are all
  // role='tool', grouped via shouldGroup. Non-tool cards render individually.
  const cards = session.cards;
  const lastIdx = cards.length - 1;
  let i = 0;
  const segments: string[] = [];

  while (i < cards.length) {
    const card = cards[i];
    const isLast = i === lastIdx;
    const isLiveStreaming = isLast && session.status === 'running' && card.role === 'assistant' && card.type === 'text' && card.toolStatus !== 'done';

    // Auto-collapse consecutive lifecycle system cards into a single summary
    if (card.role === 'system' && card.type !== 'error' && card.type !== 'file-context' && isLifecycleSubtype(card._systemSubtype)) {
      const lifecycleRun: CCCard[] = [];
      while (i < cards.length
        && cards[i].role === 'system'
        && cards[i].type !== 'error'
        && cards[i].type !== 'file-context'
        && isLifecycleSubtype(cards[i]._systemSubtype)) {
        lifecycleRun.push(cards[i]);
        i++;
      }
      if (lifecycleRun.length >= 2) {
        segments.push(renderLifecycleGroup(lifecycleRun));
      } else {
        segments.push(renderSystemMessage(lifecycleRun[0]));
      }
      continue;
    }

    if (card.role === 'tool') {
      // Collect a run of consecutive tool cards
      const toolRun: CCCard[] = [];
      while (i < cards.length && cards[i].role === 'tool') {
        toolRun.push(cards[i]);
        i++;
      }

      // Use shouldGroup to decide grouping
      const groupableRun = toolRun.map(cardToGroupable);
      const groups = shouldGroup(groupableRun);

      for (const group of groups) {
        if (group.length >= 3) {
          // Find the actual CCCard objects in toolRun by ID
          const groupIds = new Set(group.map(g => g.id));
          const groupCards = toolRun.filter(c => groupIds.has(c.id));
          segments.push(renderToolGroup(groupCards));
        } else {
          // Render individually
          for (const item of group) {
            const origCard = toolRun.find(c => c.id === item.id);
            if (origCard) segments.push(renderToolCall(origCard));
          }
        }
      }
    } else {
      let seg: string;
      switch (card.role) {
        case 'user':
          seg = renderUserTurn(card);
          break;
        case 'assistant':
          if (card.type === 'result') {
            seg = renderResultBlock(card);
          } else {
            seg = renderAssistantText(card, isLiveStreaming);
          }
          break;
        case 'agent':
          seg = renderAgentBlock(card);
          break;
        case 'system':
          if (card.type === 'file-context') {
            seg = renderFileContext(card);
          } else {
            seg = renderSystemMessage(card);
          }
          break;
        default:
          // Legacy cards without role — use type-based fallback
          if (card.type === 'text' && card.title === 'You') {
            seg = renderUserTurn(card);
          } else if (card.type === 'tool') {
            seg = renderToolCall(card);
          } else if (card.type === 'result') {
            seg = renderResultBlock(card);
          } else if (card.type === 'error' || card.type === 'system') {
            seg = renderSystemMessage(card);
          } else {
            seg = renderAssistantText(card, isLiveStreaming);
          }
      }
      segments.push(seg);
      i++;
    }
  }

  // Mark the last segment with conv-turn-new for fadeSlideUp animation
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    // Inject conv-turn-new into the first opening div tag of the last segment
    segments[segments.length - 1] = last.replace(/^(\s*<div\s+class=")([\w\s-]*)(")/,
      (_m, pre, cls, post) => `${pre}${cls} conv-turn-new${post}`);
  }

  html += segments.join('');

  // Streaming indicator when assistant is thinking (with optional progress text)
  if (session.status === 'running') {
    const lastCard = session.cards[session.cards.length - 1];
    const isTextStreaming = lastCard?.role === 'assistant' && lastCard.type === 'text';
    if (!isTextStreaming) {
      const progressHtml = session.progressText
        ? `<span class="conv-progress-text">${escapeHtml(session.progressText)}</span>`
        : '';
      html += `<div class="conv-thinking">
        <div class="conv-thinking-mount"></div>
        ${progressHtml}
      </div>`;
    }
  }

  return html;
}

// ── Flyout Renderer ─────────────────────────────────────

/** Toggle the timeline view on/off and re-render the flyout. */
export function toggleTimelineMode(): void {
  _timelineMode = !_timelineMode;
  renderFlyout();
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Inline icons for agent backends ────────────────────

/** Official Claude icon (Bootstrap Icons bi-claude) */
export function claudeIcon(size = 12): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;"><path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/></svg>`;
}

/** Official Ollama llama icon */
export function llamaIcon(size = 12): string {
  const h = Math.round(size * 25 / 17);
  return `<svg width="${size}" height="${h}" viewBox="0 0 17 25" fill="currentColor" style="flex-shrink:0;"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.405.102C4.621.199 4.816.358 4.993.568c.295.348.544.845.734 1.435.191.593.315 1.25.362 1.91a5.5 5.5 0 0 1 2.049-.724l.051-.005a4.3 4.3 0 0 1 2.48.539c.101.06.2.125.297.193.05-.646.172-1.288.36-1.868.19-.59.44-1.087.734-1.436.164-.202.365-.361.589-.466A.87.87 0 0 1 13.444.1c.401.13.745.418 1.016.837.248.383.434.874.561 1.463.23 1.061.27 2.457.115 4.142l.053.045.026.022c.757.654 1.284 1.587 1.563 2.67.435 1.69.216 3.586-.534 4.646l-.018.024.002.003c.417.866.67 1.781.724 2.728l.002.034c.064 1.21-.2 2.428-.814 3.625l-.007.011.01.027a10.3 10.3 0 0 1 .438 3.961l-.006.045a.54.54 0 0 1-.263.48.47.47 0 0 1-.484-.07.54.54 0 0 1-.194-.555c.167-1.174.01-2.351-.48-3.549a.6.6 0 0 1-.059-.356.6.6 0 0 1 .099-.345c.604-1.05.854-2.08.8-3.091a6.2 6.2 0 0 0-.8-2.583.53.53 0 0 1-.092-.545.54.54 0 0 1 .272-.396c.243-.181.467-.642.58-1.272a5.6 5.6 0 0 0-.095-2.244 4.2 4.2 0 0 0-1.105-1.912c-.595-.516-1.383-.765-2.38-.693a.5.5 0 0 1-.373-.101.53.53 0 0 1-.26-.321 3.4 3.4 0 0 0-1.343-1.632 2.7 2.7 0 0 0-1.772-.377c-1.245.113-2.343.91-2.67 1.916a.5.5 0 0 1-.239.35.48.48 0 0 1-.371.083C3.947 7.052 3.121 7.336 2.517 7.849a3.4 3.4 0 0 0-1.066 1.804 5.6 5.6 0 0 0-.068 2.143c.112.634.331 1.16.582 1.442.212.235.257.602.109.892a6.1 6.1 0 0 0-.677 2.773c-.05 1.157.186 2.161.719 2.882a.56.56 0 0 1 .016.397.56.56 0 0 1-.254.396c-.576 1.405-.753 2.56-.562 3.469a.55.55 0 0 1-.09.548.47.47 0 0 1-.49.118.5.5 0 0 1-.295-.086.55.55 0 0 1-.294-.555c.165-1.157 0-2.48-.551-3.975l.016-.04a5.6 5.6 0 0 1-.598-1.501 6.6 6.6 0 0 1-.182-2.028c.044-1.034.278-2.093.622-2.943l.012-.03-.002-.002a3.9 3.9 0 0 1-.63-1.756l-.005-.027A6.5 6.5 0 0 1 .197 9.252 4.7 4.7 0 0 1 1.733 6.674l.186-.15C1.76 4.827 1.8 3.421 2.031 2.353c.127-.589.314-1.079.562-1.462C2.863.473 3.207.184 3.608.053a.87.87 0 0 1 .797.049m4.116 10.33c.936 0 1.8.355 2.446.971a2.9 2.9 0 0 1 1.005 2.204c0 1.009-.406 1.796-1.133 2.298-.62.426-1.451.633-2.403.633-1.009 0-1.871-.294-2.493-.834a2.6 2.6 0 0 1-.963-2.097c0-.803.398-1.61 1.056-2.211a3.5 3.5 0 0 1 2.485-1.013z"/></svg>`;
}

// ── Tab context menu (Fix 4) ────────────────────────────

function showTabContextMenu(x: number, y: number, sessionId: string): void {
  document.querySelector('.cc-tab-context-menu')?.remove();

  const session = sessionManager.all().find(s => s.id === sessionId);
  if (!session) return;

  const menu = document.createElement('div');
  menu.className = 'cc-tab-context-menu';
  menu.style.cssText = `position:fixed; left:${x}px; top:${y}px;`;

  const items: { label: string; action: () => void }[] = [
    {
      label: sessionManager.isPinned(sessionId) ? 'Unpin' : 'Pin',
      action: () => sessionManager.togglePin(sessionId),
    },
    {
      label: 'Close',
      action: () => sessionManager.removeSession(sessionId),
    },
    {
      label: 'Close All Done',
      action: () => sessionManager.closeAllDone(),
    },
  ];

  if (session.status !== 'running' && session.prompt) {
    items.push({
      label: 'Retry',
      action: () => {
        document.dispatchEvent(new CustomEvent('cc:retry-session', {
          detail: { sessionId },
          bubbles: true,
        }));
      },
    });
  }

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'cc-tab-context-item';
    el.textContent = item.label;
    el.addEventListener('click', () => {
      item.action();
      menu.remove();
    });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);

  const escHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const close = (): void => {
    menu.remove();
    document.removeEventListener('click', close);
    document.removeEventListener('keydown', escHandler);
  };
  setTimeout(() => {
    document.addEventListener('click', close);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

// ── Agent throbber (ring spinner + inline timer) ────────

function agentThrobber(session: CCSession): string {
  const isOllama = session.backend === 'ollama' || session.backend === 'aider';
  const ollamaClass = isOllama ? ' cc-throbber--ollama' : '';

  if (session.status === 'running') {
    const idleMs = Date.now() - (session.lastActivityTs ?? session.startedAt);
    const elapsedMs = Date.now() - session.startedAt;
    let state: string;
    if (idleMs >= 60000) state = 'stalled';
    else if (idleMs >= 30000) state = 'dim';
    else state = 'running';
    const timeStr = formatElapsed(elapsedMs);
    return `<span class="cc-throbber cc-throbber--${state}${ollamaClass}"><span class="cc-throbber-ring"></span><span class="cc-throbber-time" data-throbber-sid="${escapeHtml(session.id)}">${timeStr}</span></span>`;
  }

  if (session.status === 'error') {
    const dur = session.duration ? formatElapsed(session.duration) : '';
    return `<span class="cc-throbber cc-throbber--error${ollamaClass}"><span class="cc-throbber-ring"></span>${dur ? `<span class="cc-throbber-time">${dur}</span>` : ''}</span>`;
  }

  if (session.status === 'done') {
    const dur = session.duration ? formatElapsed(session.duration) : '';
    return `<span class="cc-throbber cc-throbber--done${ollamaClass}"><span class="cc-throbber-ring"></span>${dur ? `<span class="cc-throbber-time">${dur}</span>` : ''}</span>`;
  }

  // Cancelled or other
  return `<span class="cc-throbber cc-throbber--idle"><span class="cc-throbber-ring"></span></span>`;
}

export function renderFlyout(): void {
  const runningCount = sessionManager.running().length;
  const externalSessions = getExternalSessions();
  const totalActive = runningCount + externalSessions.length;
  const sessions = sessionManager.all();
  const selectedExternal = getSelectedExternal();
  const displaySession = selectedExternal ? null : (sessionManager.selected() ?? sessions[0] ?? null);

  // Update banner button — count all active agents
  const ccBtn = document.getElementById('cc-status-btn');
  const ccStatusText = document.getElementById('cc-status-text');
  if (ccBtn && ccStatusText) {
    const localRunning = sessions.some(s => s.status === 'running' && (s.backend === 'ollama' || s.backend === 'aider'));
    if (totalActive > 0) {
      const qLen = sessionManager.queueLength();
      const qText = qLen > 0 ? ` +${qLen}Q` : '';
      if (localRunning && totalActive === 1 && runningCount === 1) {
        ccStatusText.textContent = `Qwen Running${qText}`;
      } else if (totalActive === 1) {
        ccStatusText.textContent = `Agent Running${qText}`;
      } else {
        ccStatusText.textContent = `${totalActive} Agents${qText}`;
      }
      ccBtn.classList.add('running');
    } else {
      ccStatusText.textContent = 'Agents Idle';
      ccBtn.classList.remove('running');
    }
  }

  // Render agent tabs — unified: web-spawned (WEB) and external (EXT)
  const tabsEl = document.getElementById('cc-agent-tabs');
  if (tabsEl) {
    const tabSessions = sortByTabOrder(sessions.filter(s =>
      !detachedSessions.has(s.id) && (
        s.status === 'running' ||
        sessionManager.isPinned(s.id) ||
        sessions.indexOf(s) < 5
      )
    ));

    const visibleExternals = externalSessions.filter(s => !detachedSessions.has(s.id));

    // Compute a structure key from tab IDs + order to avoid unnecessary innerHTML
    // replacement. Replacing innerHTML during streaming (~80ms cadence) destroys
    // tab DOM elements mid-click, causing the browser to lose the click event when
    // the target is removed between mousedown and mouseup.
    const activeId = displaySession?.id ?? '';
    const activeExtId = selectedExternal?.id ?? '';
    const structureKey = tabSessions.map(s => s.id).join(',')
      + '|' + visibleExternals.map(s => s.id).join(',')
      + '|' + activeId + '|' + activeExtId;

    if (_lastTabStructureKey === structureKey) {
      // Structure unchanged — patch in-place: update active class, heartbeat dots, timers
      tabsEl.querySelectorAll<HTMLElement>('.cc-agent-tab[data-agent-id]').forEach(tab => {
        const sid = tab.dataset.agentId!;
        const isActive = sid === activeId && !selectedExternal;
        tab.classList.toggle('active', isActive);

        // Update throbber state
        const sess = sessions.find(s => s.id === sid);
        const throbber = tab.querySelector('.cc-throbber') as HTMLElement | null;
        if (sess && throbber) {
          const isOllama = sess.backend === 'ollama' || sess.backend === 'aider';
          const ollamaClass = isOllama ? ' cc-throbber--ollama' : '';
          if (sess.status === 'running') {
            const idleMs = Date.now() - (sess.lastActivityTs ?? sess.startedAt);
            let state: string;
            if (idleMs >= 60000) state = 'stalled';
            else if (idleMs >= 30000) state = 'dim';
            else state = 'running';
            throbber.className = `cc-throbber cc-throbber--${state}${ollamaClass}`;
          } else if (sess.status === 'error') {
            throbber.className = `cc-throbber cc-throbber--error${ollamaClass}`;
          } else if (sess.status === 'done') {
            throbber.className = `cc-throbber cc-throbber--done${ollamaClass}`;
          } else {
            throbber.className = 'cc-throbber cc-throbber--idle';
          }
          // Timer text is updated by the 1s interval in ccPanel via data-throbber-sid
        }
      });

      // Update external tab active states
      tabsEl.querySelectorAll<HTMLElement>('.cc-agent-tab[data-external-id]').forEach(tab => {
        const eid = tab.dataset.externalId!;
        tab.classList.toggle('active', eid === activeExtId);
      });
    } else {
      // Structure changed — full rebuild
      _lastTabStructureKey = structureKey;

      let tabsHtml = '';

      // Web-spawned agent tabs — icon + dot + label (draggable)
      if (tabSessions.length > 0) {
        tabsHtml = tabSessions.map(s => {
          const isActive = displaySession?.id === s.id && !selectedExternal;
          const isLocal = s.backend === 'ollama' || s.backend === 'aider';
          const chainIcon = s.label === 'Follow-up' ? '\u26D3 ' : '';
          const shortLabel = chainIcon + (s.label.length > 20 ? s.label.slice(0, 18) + '\u2026' : s.label);
          const effortGlyph = s.effort ? `<span class="cc-tab-effort" title="Effort: ${s.effort}">${EFFORT_GLYPHS[s.effort]}</span>` : '';
          const pinIcon = sessionManager.isPinned(s.id) ? '<span style="font-size:8px;">&#128204;</span>' : '';
          const backendIcon = isLocal ? llamaIcon(11) : claudeIcon(11);
          // Build rich tooltip: backend + status + duration + preview
          const tooltipParts: string[] = [];
          tooltipParts.push(isLocal ? (s.backend === 'aider' ? 'Aider' : (getPool('local')?.model ?? 'Ollama')) : 'Claude Code');
          tooltipParts.push(`Status: ${s.status}`);
          if (s.status === 'running') {
            tooltipParts.push(`Elapsed: ${formatElapsed(Date.now() - s.startedAt)}`);
          } else if (s.duration) {
            tooltipParts.push(`Duration: ${formatElapsed(s.duration)}`);
          }
          // Preview from last assistant text card
          const lastText = [...s.cards].reverse().find(c => c.role === 'assistant' && c.type === 'text');
          if (lastText) {
            const previewText = lastText.body.split('\n')[0].slice(0, 80);
            if (previewText) tooltipParts.push(previewText);
          }
          const tooltip = ` title="${escapeHtml(tooltipParts.join('\n'))}"`;
          return `<button class="cc-agent-tab${isActive ? ' active' : ''}" draggable="true" data-agent-id="${escapeHtml(s.id)}"${tooltip}><span class="cc-tab-icon">${backendIcon}</span>${agentThrobber(s)}${pinIcon}${effortGlyph}${escapeHtml(shortLabel)}<span class="cc-session-close" data-close-id="${escapeHtml(s.id)}" title="Close tab">&times;</span></button>`;
        }).join('');
      }

      // External session tabs — throbber + label + close button
      if (visibleExternals.length > 0) {
        const extState: Record<string, string> = {
          'active': 'running',
          'needs-attention': 'error',
          'blocked': 'stalled',
        };
        tabsHtml += visibleExternals.map(s => {
          const state = extState[s.status] ?? 'idle';
          const label = s.summary.length > 16 ? s.summary.slice(0, 14) + '...' : s.summary;
          const isActive = selectedExternal?.id === s.id;
          return `<button class="cc-agent-tab cc-external-tab${isActive ? ' active' : ''}" draggable="true" data-external-id="${escapeHtml(s.id)}" title="${escapeHtml(s.summary)}"><span class="cc-throbber cc-throbber--${state}"><span class="cc-throbber-ring"></span></span>${escapeHtml(label)}<span class="cc-session-close" data-close-id="${escapeHtml(s.id)}" title="Close session">&times;</span></button>`;
        }).join('');
      }

      // Append new-tab button
      tabsHtml += `<button class="cc-tab-new" title="New agent (+ NEW)">+</button>`;

      tabsEl.innerHTML = tabsHtml;

      // Wire new-tab button → create idle session ready for prompt input
      tabsEl.querySelector('.cc-tab-new')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const session = sessionManager.createSession('Agent');
        // Mark idle so no thinking spinner shows — must re-notify since
        // createSession already fired _notify() with status 'running'
        session.status = 'done';
        renderFlyout();
      });

      // Timer is now integrated in agentThrobber() — no separate timer span needed

      // Wire right-click context menu on tabs
      tabsEl.querySelectorAll<HTMLButtonElement>('.cc-agent-tab[data-agent-id]').forEach(tab => {
        tab.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showTabContextMenu(e.clientX, e.clientY, tab.dataset.agentId!);
        });
      });
    }

  }

  // Queue indicator
  const queueLen = sessionManager.queueLength();
  if (!document.getElementById('cc-agent-queue')) {
    const q = document.createElement('div');
    q.id = 'cc-agent-queue';
    q.style.cssText = 'padding:4px 14px; font-size:10px; color:var(--text-dim); border-bottom:1px solid var(--border); display:none;';
    tabsEl?.parentElement?.insertBefore(q, tabsEl!.nextSibling);
  }
  const qEl = document.getElementById('cc-agent-queue');
  if (qEl) {
    if (queueLen > 0) {
      qEl.style.display = 'block';
      qEl.textContent = `${queueLen} agent(s) queued`;
    } else {
      qEl.style.display = 'none';
    }
  }

  // Update flyout header
  const labelEl = document.getElementById('cc-flyout-label');
  const timerEl = document.getElementById('cc-flyout-timer');
  const cancelBtn = document.getElementById('cc-flyout-cancel');

  if (selectedExternal) {
    // External session selected — show header but hide web-only controls
    if (labelEl) labelEl.textContent = `Agents (${totalActive} active)`;
    if (timerEl) timerEl.textContent = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    const retryBtnEl = document.getElementById('cc-flyout-retry');
    if (retryBtnEl) retryBtnEl.style.display = 'none';
    const pinBtn = document.getElementById('cc-flyout-pin');
    if (pinBtn) pinBtn.style.display = 'none';
    const diffBtnEl = document.getElementById('cc-flyout-diff');
    if (diffBtnEl) diffBtnEl.style.display = 'none';
    const timelineBtnElExt = document.getElementById('cc-timeline-toggle');
    if (timelineBtnElExt) timelineBtnElExt.style.display = 'none';
  } else if (displaySession) {
    if (labelEl) labelEl.textContent = `Agents (${totalActive} active)`;
    if (timerEl && displaySession.status === 'running') {
      timerEl.textContent = formatElapsed(Date.now() - displaySession.startedAt);
    } else if (timerEl) {
      timerEl.textContent = displaySession.duration ? formatElapsed(displaySession.duration) : '';
    }
    if (cancelBtn) cancelBtn.style.display = displaySession.status === 'running' ? 'inline-block' : 'none';
    const retryBtnEl = document.getElementById('cc-flyout-retry');
    if (retryBtnEl) {
      const canRetry = displaySession.status !== 'running' && !!displaySession.prompt;
      retryBtnEl.style.display = canRetry ? 'inline-block' : 'none';
    }
    const pinBtn = document.getElementById('cc-flyout-pin');
    if (pinBtn && displaySession) {
      pinBtn.style.display = 'inline-block';
      pinBtn.textContent = sessionManager.isPinned(displaySession.id) ? 'Unpin' : 'Pin';
    } else if (pinBtn) {
      pinBtn.style.display = 'none';
    }
    const diffBtnEl = document.getElementById('cc-flyout-diff');
    if (diffBtnEl) {
      diffBtnEl.style.display = displaySession && displaySession.status !== 'running' ? 'inline-block' : 'none';
    }
    const timelineBtnEl = document.getElementById('cc-timeline-toggle');
    if (timelineBtnEl) {
      timelineBtnEl.style.display = 'inline-block';
      timelineBtnEl.textContent = _timelineMode ? '\u25ae Thread' : '\u25ae Timeline';
      (timelineBtnEl as HTMLButtonElement).classList.toggle('active', _timelineMode);
    }
  } else {
    if (labelEl) labelEl.textContent = totalActive > 0 ? `Agents (${totalActive} active)` : 'Agents';
    if (timerEl) timerEl.textContent = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    const retryBtnEl = document.getElementById('cc-flyout-retry');
    if (retryBtnEl) retryBtnEl.style.display = 'none';
    const pinBtn = document.getElementById('cc-flyout-pin');
    if (pinBtn) pinBtn.style.display = 'none';
    const diffBtnEl = document.getElementById('cc-flyout-diff');
    if (diffBtnEl) diffBtnEl.style.display = 'none';
    const timelineBtnEl = document.getElementById('cc-timeline-toggle');
    if (timelineBtnEl) timelineBtnEl.style.display = 'none';
  }

  // Update output panel
  const outputEl = document.getElementById('cc-flyout-output');

  // Dismiss flyout-related overlays on session switch
  const switchingSession = displaySession
    ? _renderedSessionId !== null && _renderedSessionId !== displaySession.id
    : !!_renderedSessionId;
  if (switchingSession) {
    document.getElementById('cc-diff-modal')?.remove();
    document.querySelector('.cc-tab-context-menu')?.remove();
  }

  if (outputEl && selectedExternal) {
    // Render external session detail
    outputEl.innerHTML = renderExternalSessionDetail(selectedExternal);
  } else if (outputEl && displaySession) {
    // Preserve expanded states (works for both old .cc-card and new conv elements)
    const expandedIds = new Set<string>();
    outputEl.querySelectorAll('.expanded').forEach(el => {
      const id = (el as HTMLElement).dataset.cardId;
      if (id) expandedIds.add(id);
    });

    // Track if user is following the stream (at or near bottom)
    const isFollowing = !outputEl.dataset.userScrolled || outputEl.dataset.userScrolled === 'false';

    // Render as timeline or conversation thread
    if (_timelineMode && displaySession.cards.some(c => c.type === 'tool')) {
      renderToolTimeline(displaySession.cards, outputEl);
      _renderedSessionId = null; // timeline mode doesn't use incremental
    } else {
      const cards = displaySession.cards;
      const lastCard = cards[cards.length - 1];
      const sameSession = _renderedSessionId === displaySession.id;
      const sameStatus = _renderedSessionStatus === displaySession.status;
      let patched = false;

      if (sameSession && sameStatus && cards.length > 0) {
        // Fast path A: same card count, only last card body changed
        // → patch the DOM element in-place (no flicker)
        if (cards.length === _renderedCardCount && lastCard.body !== _renderedLastCardBody) {
          const lastTurn = outputEl.querySelector(`[data-card-id="${CSS.escape(lastCard.id)}"]`) as HTMLElement | null;
          const bodyEl = lastTurn?.querySelector('.conv-assistant-body') as HTMLElement | null;
          if (bodyEl) {
            bodyEl.innerHTML = renderMarkdownSafe(lastCard.body);
            _renderedLastCardBody = lastCard.body;
            if (isFollowing) outputEl.scrollTop = outputEl.scrollHeight;
            patched = true;
          }
        }

        // Fast path B: new cards appended → append only the new ones
        if (!patched && cards.length > _renderedCardCount && _renderedCardCount > 0) {
          const thread = outputEl.querySelector('.conv-thread');
          if (thread) {
            // Remove old thinking indicator before appending
            thread.querySelector('.conv-thinking')?.remove();
            // Render only the new cards via a partial session
            const partialHtml = renderConversationThread({ ...displaySession, cards: cards.slice(_renderedCardCount) });
            const tmp = document.createElement('div');
            tmp.innerHTML = partialHtml;
            // Strip duplicate session header and initial-prompt from partial
            tmp.querySelector('.conv-session-header')?.remove();
            if (!cards.slice(_renderedCardCount).some(c => c.role === 'user')) {
              tmp.querySelector('.conv-turn--user')?.remove();
            }
            thread.insertAdjacentHTML('beforeend', tmp.innerHTML);
            _renderedCardCount = cards.length;
            _renderedLastCardBody = lastCard.body;
            _renderedSessionStatus = displaySession.status;
            if (isFollowing) outputEl.scrollTop = outputEl.scrollHeight;
            patched = true;
          }
        }

        // No change at all — skip
        if (!patched && cards.length === _renderedCardCount && lastCard.body === _renderedLastCardBody) {
          patched = true;
        }
      }

      // Slow path: full re-render (session switch, first load, or structural change)
      if (!patched) {
        outputEl.innerHTML = `<div class="conv-thread">${renderConversationThread(displaySession)}</div>`;
        _renderedSessionId = displaySession.id;
        _renderedCardCount = cards.length;
        _renderedLastCardBody = lastCard?.body ?? '';
        _renderedSessionStatus = displaySession.status;
      }
    }

    // Mount / update context gauge
    const gaugeContainer = document.getElementById('cc-ctx-gauge-wrap');
    if (gaugeContainer) {
      if (_ctxGaugeSessionId !== displaySession.id) {
        _ctxGauge?.destroy();
        _ctxGauge = createContextGauge(gaugeContainer);
        _ctxGaugeSessionId = displaySession.id;
      }
      if (displaySession.tokenCount && _ctxGauge) {
        _ctxGauge.update(displaySession.tokenCount.input, displaySession.tokenCount.output, displaySession.tokenCount.cacheRead);
      }
    }

    // Mount spinner component into the thinking indicator placeholder
    const thinkingMount = outputEl.querySelector('.conv-thinking-mount') as HTMLElement | null;
    if (thinkingMount && !thinkingMount.hasAttribute('data-spinner')) {
      thinkingMount.setAttribute('data-spinner', 'true');
      createSpinner(thinkingMount);
    }

    // Restore expanded states
    for (const id of expandedIds) {
      const el = outputEl.querySelector(`[data-card-id="${id}"]`);
      if (el) el.classList.add('expanded');
    }

    if (isFollowing) {
      outputEl.scrollTop = outputEl.scrollHeight;
    }

    // Scroll-to-bottom button
    let scrollBtn = document.getElementById('cc-scroll-bottom');
    if (!scrollBtn) {
      scrollBtn = document.createElement('button');
      scrollBtn.id = 'cc-scroll-bottom';
      scrollBtn.textContent = '\u2193 Latest';
      scrollBtn.style.cssText = 'position:absolute; bottom:8px; right:20px; padding:4px 10px; font-size:10px; font-weight:700; background:var(--bg-panel); border:1px solid var(--accent-dim); border-radius:3px; color:var(--accent); cursor:pointer; z-index:5; display:none; transition:opacity 0.15s;';
      scrollBtn.addEventListener('click', () => {
        outputEl.scrollTop = outputEl.scrollHeight;
        outputEl.dataset.userScrolled = 'false';
      });
      outputEl.parentElement?.style.setProperty('position', 'relative');
      outputEl.parentElement?.appendChild(scrollBtn);
    }
    scrollBtn.style.display = outputEl.dataset.userScrolled === 'true' ? 'block' : 'none';
  } else if (outputEl) {
    outputEl.innerHTML = '<div style="color:var(--text-dim); padding:20px; text-align:center;">No agents yet. Click + to spawn one.</div>';
  }

  // Mount ambient status bar once into #cc-status-bar-wrap
  if (!_ambientBar) {
    const wrapEl = document.getElementById('cc-status-bar-wrap');
    if (wrapEl) {
      _ambientBar = createAmbientStatusBar(wrapEl);
    }
  }
  _ambientBar?.update();

  // Mount pool dashboard once into #cc-pool-dashboard-wrap
  if (!_poolDashboard) {
    const poolWrap = document.getElementById('cc-pool-dashboard-wrap');
    if (poolWrap) {
      _poolDashboard = renderPoolDashboard(poolWrap);
    }
  }
  _poolDashboard?.update();

  // Update history (non-tabbed completed sessions)
  const historyEl = document.getElementById('cc-flyout-history');
  const historyItems = sessions.filter(s => s !== displaySession && s.status !== 'running').slice(5);
  if (historyEl) {
    if (historyItems.length === 0) {
      historyEl.innerHTML = '';
    } else {
      historyEl.innerHTML = `<div style="color:var(--text-dim); font-size:10px; text-transform:uppercase; margin-bottom:4px;">Older</div>` +
        historyItems.map(s => {
          const color = s.status === 'done' ? 'var(--green)' : s.status === 'error' ? 'var(--red)' : 'var(--text-dim)';
          const dur = s.duration ? formatElapsed(s.duration) : '\u2014';
          return `<div class="cc-history-item" data-session-id="${escapeHtml(s.id)}"><span style="color:${color};">&#9679;</span> ${escapeHtml(s.label)} <span style="color:var(--text-dim);">(${s.status}, ${dur})</span></div>`;
        }).join('');
    }
  }
}

// ── Diff modal ─────────────────────────────────────────

export function showDiffModal(diff: string): void {
  // Remove existing modal
  document.getElementById('cc-diff-modal')?.remove();

  if (!diff.trim()) {
    diff = '(no changes)';
  }

  const modal = document.createElement('div');
  modal.id = 'cc-diff-modal';
  modal.style.cssText = 'position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; background:rgba(2,3,5,0.8);';

  // Parse diff for basic syntax highlighting
  const highlighted = diff.split('\n').map(line => {
    const escaped = escapeHtml(line);
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span style="color:var(--green);">${escaped}</span>`;
    if (line.startsWith('-') && !line.startsWith('---')) return `<span style="color:var(--red-bright, #d45234);">${escaped}</span>`;
    if (line.startsWith('@@')) return `<span style="color:var(--accent);">${escaped}</span>`;
    if (line.startsWith('diff ') || line.startsWith('index ')) return `<span style="color:var(--text-dim);">${escaped}</span>`;
    return escaped;
  }).join('\n');

  modal.innerHTML = `
    <div style="background:var(--bg); border:1px solid var(--border); border-radius:6px; width:80vw; max-width:900px; max-height:80vh; display:flex; flex-direction:column;">
      <div style="padding:12px 16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
        <span style="font-family:var(--font-display); font-size:10px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--text-heading);">Git Diff</span>
        <button id="cc-diff-close" style="background:none; border:1px solid var(--border); border-radius:2px; color:var(--text-dim); cursor:pointer; font-size:16px; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">&times;</button>
      </div>
      <pre style="flex:1; overflow:auto; padding:12px 16px; margin:0; font-family:var(--font-mono); font-size:11px; line-height:1.6; white-space:pre-wrap; word-break:break-all;">${highlighted}</pre>
    </div>
  `;

  document.body.appendChild(modal);

  const close = (): void => { modal.remove(); };
  modal.querySelector('#cc-diff-close')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function handler(e: KeyboardEvent) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); }
  });
}

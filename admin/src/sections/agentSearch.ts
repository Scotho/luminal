// admin/src/sections/agentSearch.ts — Cross-agent search across all session cards
import { sessionManager } from '../ui/ccSessionManager';
import type { CCSession, CCCard } from '../types';

// ── Types ────────────────────────────────────────────────────

interface PinEntry {
  sessionLabel: string;
  sessionId: string;
  cardId: string;
  ts: number;
  content: string;
}

interface SearchResult {
  session: CCSession;
  matchingCards: { card: CCCard; context: string }[];
}

type ScopeFilter = 'All' | 'Tool Output' | 'Assistant Text' | 'User Prompts' | 'Errors Only';
type BackendFilter = 'All' | 'CC' | 'Qwen' | 'Aider';

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length));
  return `${before}<mark class="search-match-highlight">${match}</mark>${after}`;
}

function getContext(card: CCCard, query: string): string {
  const text = card.body || card.preview || '';
  const lines = text.split('\n').filter(l => l.trim());
  const qLower = query.toLowerCase();
  // Find the line containing the match
  const matchIdx = lines.findIndex(l => l.toLowerCase().includes(qLower));
  if (matchIdx === -1) {
    return lines.slice(0, 3).join('\n');
  }
  const start = Math.max(0, matchIdx - 1);
  const end = Math.min(lines.length, start + 3);
  return lines.slice(start, end).join('\n');
}

function cardMatchesScope(card: CCCard, scope: ScopeFilter): boolean {
  if (scope === 'All') return true;
  if (scope === 'Tool Output') return card.role === 'tool';
  if (scope === 'Assistant Text') return card.role === 'assistant';
  if (scope === 'User Prompts') return card.role === 'user';
  if (scope === 'Errors Only') return card.type === 'error';
  return true;
}

function sessionMatchesBackend(session: CCSession, backend: BackendFilter): boolean {
  if (backend === 'All') return true;
  if (backend === 'CC') return session.backend === 'cc';
  if (backend === 'Qwen') return session.backend === 'ollama';
  if (backend === 'Aider') return session.backend === 'aider';
  return true;
}

function cardMatchesQuery(card: CCCard, query: string): boolean {
  const q = query.toLowerCase();
  return (
    (card.body ?? '').toLowerCase().includes(q) ||
    (card.title ?? '').toLowerCase().includes(q) ||
    (card.preview ?? '').toLowerCase().includes(q)
  );
}

// ── Search logic ─────────────────────────────────────────────

function runSearch(
  query: string,
  scope: ScopeFilter,
  backend: BackendFilter,
): SearchResult[] {
  if (!query.trim()) return [];

  const sessions = sessionManager.getAllSessions();
  const results: SearchResult[] = [];

  for (const session of sessions) {
    if (!sessionMatchesBackend(session, backend)) continue;

    const matchingCards: { card: CCCard; context: string }[] = [];
    for (const card of session.cards) {
      if (!cardMatchesScope(card, scope)) continue;
      if (!cardMatchesQuery(card, query)) continue;
      matchingCards.push({ card, context: getContext(card, query) });
    }

    if (matchingCards.length > 0) {
      results.push({ session, matchingCards });
    }
  }

  // Sort by match count (most first)
  results.sort((a, b) => b.matchingCards.length - a.matchingCards.length);
  return results;
}

// ── Render helpers ────────────────────────────────────────────

function renderResultGroup(
  result: SearchResult,
  query: string,
  onJump: (sessionId: string, cardId: string) => void,
  onPin: (pin: PinEntry) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'agent-search-result-group';
  group.innerHTML = `
    <div class="agent-search-result-header">
      <span class="agent-search-session-label">${escapeHtml(result.session.label)}</span>
      <span class="agent-search-match-count">${result.matchingCards.length} match${result.matchingCards.length === 1 ? '' : 'es'}</span>
    </div>
  `;

  for (const { card, context } of result.matchingCards) {
    const item = document.createElement('div');
    item.className = 'agent-search-result-item';

    const ts = formatTime(card.ts);
    const contextHtml = highlightMatch(context.slice(0, 300), query);

    item.innerHTML = `
      <div class="agent-search-result-meta">
        <span class="agent-search-result-role">${escapeHtml(card.role ?? card.type)}</span>
        <span class="agent-search-result-time">${ts}</span>
        <span class="agent-search-result-title">${escapeHtml(card.title)}</span>
      </div>
      <div class="agent-search-result-context">${contextHtml}</div>
      <div class="agent-search-result-actions">
        <button class="agent-search-jump-btn admin-btn admin-btn--small" data-session="${escapeHtml(result.session.id)}" data-card="${escapeHtml(card.id)}">Jump</button>
        <button class="agent-search-pin-btn admin-btn admin-btn--small" data-session="${escapeHtml(result.session.id)}" data-card="${escapeHtml(card.id)}">Pin</button>
      </div>
    `;

    item.querySelector('.agent-search-jump-btn')?.addEventListener('click', () => {
      onJump(result.session.id, card.id);
    });

    item.querySelector('.agent-search-pin-btn')?.addEventListener('click', () => {
      const snippet = (card.body || card.preview || '').slice(0, 200);
      onPin({
        sessionLabel: result.session.label,
        sessionId: result.session.id,
        cardId: card.id,
        ts: card.ts,
        content: snippet,
      });
    });

    group.appendChild(item);
  }

  return group;
}

// ── Main init function ────────────────────────────────────────

export function initAgentSearch(): void {
  const sectionEl = document.getElementById('section-agent-search');
  if (!sectionEl) return;
  const section: HTMLElement = sectionEl;

  const pins: PinEntry[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  section.innerHTML = `
    <div class="agent-search">
      <div class="agent-search-bar">
        <input class="agent-search-input" placeholder="Search across all agents..." type="text" />
        <select class="agent-search-scope">
          <option>All</option>
          <option>Tool Output</option>
          <option>Assistant Text</option>
          <option>User Prompts</option>
          <option>Errors Only</option>
        </select>
        <select class="agent-search-backend">
          <option>All</option>
          <option>CC</option>
          <option>Qwen</option>
          <option>Aider</option>
        </select>
      </div>
      <div class="agent-search-body">
        <div class="agent-search-results"></div>
        <div class="agent-search-pinned">
          <div class="agent-search-pinned-header">
            <span class="agent-search-pinned-title">Pinned</span>
            <div class="agent-search-pinned-actions">
              <button class="agent-search-send-prompt admin-btn admin-btn--small">Send to Prompt</button>
              <button class="agent-search-export-md admin-btn admin-btn--small">Export as MD</button>
            </div>
          </div>
          <div class="agent-search-pinned-list"></div>
        </div>
      </div>
    </div>
  `;

  const input = section.querySelector('.agent-search-input') as HTMLInputElement;
  const scopeSelect = section.querySelector('.agent-search-scope') as HTMLSelectElement;
  const backendSelect = section.querySelector('.agent-search-backend') as HTMLSelectElement;
  const resultsEl = section.querySelector('.agent-search-results') as HTMLElement;
  const pinnedList = section.querySelector('.agent-search-pinned-list') as HTMLElement;

  // ── Search execution ─────────────────────────────────────────

  function executeSearch(): void {
    const query = input.value.trim();
    const scope = scopeSelect.value as ScopeFilter;
    const backend = backendSelect.value as BackendFilter;

    resultsEl.innerHTML = '';

    if (!query) return;

    const results = runSearch(query, scope, backend);

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="agent-search-empty">No results found.</div>';
      return;
    }

    for (const result of results) {
      const groupEl = renderResultGroup(
        result,
        query,
        (sessionId, cardId) => {
          section.dispatchEvent(new CustomEvent('agent-search:jump', {
            bubbles: true,
            detail: { sessionId, cardId },
          }));
        },
        (pin) => {
          addPin(pin);
        },
      );
      resultsEl.appendChild(groupEl);
    }
  }

  function onInputChange(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(executeSearch, 200);
  }

  input.addEventListener('input', onInputChange);
  scopeSelect.addEventListener('change', executeSearch);
  backendSelect.addEventListener('change', executeSearch);

  // ── Pin management ────────────────────────────────────────────

  function renderPins(): void {
    pinnedList.innerHTML = '';
    for (const pin of pins) {
      const el = document.createElement('div');
      el.className = 'agent-search-pin-item';
      el.innerHTML = `
        <div class="agent-search-pin-meta">
          <span class="agent-search-pin-label">${escapeHtml(pin.sessionLabel)}</span>
          <span class="agent-search-pin-time">${formatTime(pin.ts)}</span>
        </div>
        <div class="agent-search-pin-content">${escapeHtml(pin.content)}</div>
        <button class="agent-search-pin-remove admin-btn admin-btn--small" data-card="${escapeHtml(pin.cardId)}">Remove</button>
      `;
      el.querySelector('.agent-search-pin-remove')?.addEventListener('click', () => {
        const idx = pins.findIndex(p => p.cardId === pin.cardId && p.sessionId === pin.sessionId);
        if (idx !== -1) pins.splice(idx, 1);
        renderPins();
      });
      pinnedList.appendChild(el);
    }
  }

  function addPin(pin: PinEntry): void {
    // Avoid duplicate pins for the same card in the same session
    const exists = pins.some(p => p.cardId === pin.cardId && p.sessionId === pin.sessionId);
    if (!exists) {
      pins.push(pin);
      renderPins();
    }
  }

  // ── Send to Prompt ────────────────────────────────────────────

  section.querySelector('.agent-search-send-prompt')?.addEventListener('click', () => {
    if (pins.length === 0) return;
    const parts = pins.map(p => {
      const time = formatTime(p.ts);
      return `--- ${p.sessionLabel} (${time}) ---\n${p.content}`;
    });
    const text = `[Context from Agent Search]\n${parts.join('\n\n')}\n[End Context]`;
    document.dispatchEvent(new CustomEvent('cc:inject-prompt', {
      detail: { text },
      bubbles: true,
    }));
  });

  // ── Export as MD ──────────────────────────────────────────────

  section.querySelector('.agent-search-export-md')?.addEventListener('click', () => {
    if (pins.length === 0) return;
    const lines: string[] = ['# Agent Search — Pinned Findings', ''];
    for (const pin of pins) {
      const time = formatTime(pin.ts);
      lines.push(`## ${pin.sessionLabel} (${time})`);
      lines.push('');
      lines.push(pin.content);
      lines.push('');
    }
    const md = lines.join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-search-pins.md';
    a.click();
    URL.revokeObjectURL(url);
  });
}

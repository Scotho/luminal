import { DEFAULT_ORDER } from './sidebarOrder';
import { BUILTIN_TEMPLATES } from './agentTemplates';
import { sessionManager } from './ccPanel';
import { getSkillEntries } from './skillRegistry';
import { dispatchCC } from './ccDispatch';

// ── Types ──────────────────────────────────────────────────

interface CommandAction {
  label: string;
  category: string; // 'Navigate' | 'Agent' | 'Action' | 'Skills' | 'Templates'
  handler: () => void;
}

// ── Recently-used tracking ─────────────────────────────────

const RECENT_KEY = 'luminal-cmd-recent';
const MAX_RECENT = 5;

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; }
  catch { return []; }
}

function addRecent(label: string): void {
  const recent = getRecent().filter(r => r !== label);
  recent.unshift(label);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

// ── Section label map (mirrors sidebarOrder) ───────────────

const SECTION_LABELS: Record<string, string> = {
  'live': 'Status',
  'tasks': 'Tasks',
  'bugs': 'Bug Reports',
  'notifications': 'Notifications',
  'sessions': 'Sessions',
  'notes': 'Notes',
  'specs': 'Specs',
  'audits': 'Audits',
  'test-runner': 'Test Runner',
  'test-center': 'Manual',
  'e2e-matrix': 'E2E Matrix',
  'pipeline': 'Pipeline',
  'pulls': 'PR Reviews',
  'users': 'Users',
  'matches': 'Matches',
  'playtime': 'Playtime',
  'purge': 'Admin Actions',
  'links': 'Links',
  'viewer': 'Viewer',
  'ollama': 'Ollama',
  'help': 'Help',
  'settings': 'Settings',
};

// ── Build action list ──────────────────────────────────────

function buildActions(): CommandAction[] {
  const actions: CommandAction[] = [];

  // 1. Section navigation
  for (const section of DEFAULT_ORDER) {
    const label = SECTION_LABELS[section] ?? section;
    actions.push({
      label: `Go to ${label}`,
      category: 'Navigate',
      handler: () => {
        const navItem = document.querySelector<HTMLElement>(`.nav-item[data-section="${section}"]`);
        navItem?.click();
      },
    });
  }

  // 2. Registered skills (from commandRegistry via skillRegistry)
  for (const skill of getSkillEntries()) {
    const skillName = skill.name;
    actions.push({
      label: skillName,
      category: 'Skills',
      handler: () => {
        dispatchCC(skillName, skillName).catch(() => {/* handled internally */});
      },
    });
  }

  // 3. Agent templates
  for (const tpl of BUILTIN_TEMPLATES) {
    actions.push({
      label: `Run: ${tpl.label}`,
      category: 'Templates',
      handler: () => {
        dispatchCC(tpl.label, tpl.prompt).catch(() => {/* handled internally */});
      },
    });
  }

  // 4. Fixed actions
  actions.push({
    label: 'Toggle CC Panel',
    category: 'Action',
    handler: () => {
      const flyout = document.getElementById('cc-flyout');
      flyout?.classList.toggle('open');
    },
  });

  actions.push({
    label: 'New Custom Agent',
    category: 'Action',
    handler: () => {
      // Open CC panel then click new-agent button
      const flyout = document.getElementById('cc-flyout');
      if (flyout && !flyout.classList.contains('open')) {
        flyout.classList.add('open');
      }
      const btn = document.getElementById('cc-new-agent');
      btn?.click();
    },
  });

  actions.push({
    label: 'Refresh Usage',
    category: 'Action',
    handler: () => {
      const btn = document.getElementById('cc-usage-refresh');
      btn?.click();
    },
  });

  return actions;
}

// ── Fuzzy matching ─────────────────────────────────────────

function fuzzyMatch(query: string, actions: CommandAction[]): CommandAction[] {
  const q = query.toLowerCase();
  if (!q) return actions;

  const scored: { action: CommandAction; pos: number }[] = [];
  for (const action of actions) {
    const idx = action.label.toLowerCase().indexOf(q);
    if (idx !== -1) {
      scored.push({ action, pos: idx });
    }
  }

  scored.sort((a, b) => a.pos - b.pos);
  return scored.map(s => s.action);
}

// ── Category tag colors ────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Navigate: '#4fc3f7',
  Agent: '#ce93d8',
  Action: '#ffd54f',
  Skills: '#a5d6a7',
  Templates: '#ffcc80',
  Recent: '#ef9a9a',
};

// ── DOM ────────────────────────────────────────────────────

let _overlay: HTMLElement | null = null;
let _input: HTMLInputElement | null = null;
let _resultsList: HTMLElement | null = null;
let _highlightIdx = 0;
let _currentResults: CommandAction[] = [];

function createOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'cmd-bar-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: 15vh;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    width: 500px; max-width: calc(100vw - 32px); max-height: 400px;
    background: rgb(7, 15, 19);
    border: 1px solid var(--border);
    border-radius: 8px;
    display: flex; flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    overflow: hidden;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type a command...';
  input.style.cssText = `
    width: 100%; box-sizing: border-box;
    padding: 12px 16px;
    background: transparent; border: none; border-bottom: 1px solid var(--border);
    color: var(--fg, #e0e0e0);
    font-size: 16px; font-family: var(--font-body);
    outline: none;
    min-height: 44px;
  `;

  const results = document.createElement('div');
  results.style.cssText = `
    flex: 1; overflow-y: auto;
  `;

  panel.appendChild(input);
  panel.appendChild(results);
  overlay.appendChild(panel);

  _input = input;
  _resultsList = results;

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return overlay;
}

function renderResults(actions: CommandAction[], showRecent = false): void {
  if (!_resultsList) return;

  // When query is empty, prepend recently-used entries at top
  let displayActions = actions;
  let recentCount = 0;
  if (showRecent) {
    const recentLabels = getRecent();
    const recentActions: CommandAction[] = [];
    for (const label of recentLabels) {
      const found = actions.find(a => a.label === label);
      if (found) recentActions.push({ ...found, category: 'Recent' });
    }
    recentCount = recentActions.length;
    displayActions = recentCount > 0 ? [...recentActions, ...actions] : actions;
  }

  _currentResults = displayActions;
  _highlightIdx = 0;

  _resultsList.innerHTML = '';
  if (displayActions.length === 0) {
    _resultsList.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-dim); font-size:13px;">No matching commands</div>';
    return;
  }

  let recentHeaderInserted = false;
  let mainHeaderInserted = false;

  for (let i = 0; i < displayActions.length; i++) {
    const action = displayActions[i];
    const isRecent = showRecent && i < recentCount;

    // Section headers
    if (showRecent && recentCount > 0 && i === 0 && !recentHeaderInserted) {
      const header = document.createElement('div');
      header.className = 'cmd-recent-header';
      header.textContent = 'Recent';
      _resultsList.appendChild(header);
      recentHeaderInserted = true;
    }
    if (showRecent && recentCount > 0 && i === recentCount && !mainHeaderInserted) {
      const header = document.createElement('div');
      header.className = 'cmd-recent-header';
      header.textContent = 'All Commands';
      _resultsList.appendChild(header);
      mainHeaderInserted = true;
    }

    const item = document.createElement('div');
    item.style.cssText = `
      padding: 10px 16px;
      cursor: pointer;
      display: flex; align-items: center; gap: 8px;
      font-family: var(--font-body); font-size: 14px;
      color: var(--fg, #e0e0e0);
      min-height: 44px; box-sizing: border-box;
    `;
    // Store logical index for keyboard nav (headers don't count)
    item.dataset.idx = String(i);

    const tag = document.createElement('span');
    const displayCategory = isRecent ? 'Recent' : action.category;
    tag.textContent = displayCategory;
    const tagColor = CATEGORY_COLORS[displayCategory] ?? '#aaa';
    tag.style.cssText = `
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      padding: 1px 6px; border-radius: 3px;
      background: ${tagColor}22; color: ${tagColor};
      flex-shrink: 0;
    `;

    const label = document.createElement('span');
    label.textContent = action.label;

    item.appendChild(tag);
    item.appendChild(label);

    item.addEventListener('click', () => {
      addRecent(action.label);
      close();
      action.handler();
    });

    item.addEventListener('mouseenter', () => {
      _highlightIdx = i;
      updateHighlight();
    });

    _resultsList.appendChild(item);
  }

  updateHighlight();
}

function updateHighlight(): void {
  if (!_resultsList) return;
  // Only highlight items that have data-idx (not header divs)
  const items = _resultsList.querySelectorAll<HTMLElement>('[data-idx]');
  for (const el of items) {
    const idx = parseInt(el.dataset.idx ?? '-1');
    if (idx === _highlightIdx) {
      el.style.background = 'var(--bg-hover, rgba(255,255,255,0.08))';
      el.style.color = 'var(--accent, #4fc3f7)';
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.style.background = 'transparent';
      el.style.color = 'var(--fg, #e0e0e0)';
    }
  }
}

function open(categoryFilter?: string): void {
  if (_overlay) return;
  const allActions = buildActions();
  const baseActions = categoryFilter
    ? allActions.filter(a => a.category.toLowerCase() === categoryFilter.toLowerCase())
    : allActions;

  _overlay = createOverlay();
  document.body.appendChild(_overlay);

  // Show recently-used entries pinned at top when query is empty
  renderResults(baseActions, /* showRecent */ !categoryFilter);

  _input!.addEventListener('input', () => {
    const query = _input!.value;
    if (!query) {
      renderResults(baseActions, /* showRecent */ !categoryFilter);
      return;
    }
    const matched = fuzzyMatch(query, baseActions);
    renderResults(matched, false);
  });

  _input!.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (_currentResults.length > 0) {
        _highlightIdx = (_highlightIdx + 1) % _currentResults.length;
        updateHighlight();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (_currentResults.length > 0) {
        _highlightIdx = (_highlightIdx - 1 + _currentResults.length) % _currentResults.length;
        updateHighlight();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_currentResults[_highlightIdx]) {
        const action = _currentResults[_highlightIdx];
        addRecent(action.label);
        close();
        action.handler();
      }
    }
  });

  _input!.focus();
}

/** Open the command bar programmatically, optionally pre-filtered to a category. */
export function openCommandBar(categoryFilter?: string): void {
  if (_overlay) {
    close();
  } else {
    open(categoryFilter);
  }
}

function close(): void {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
    _input = null;
    _resultsList = null;
    _currentResults = [];
    _highlightIdx = 0;
  }
}

// ── Init ───────────────────────────────────────────────────

export function initCommandBar(): void {
  document.addEventListener('keydown', (e) => {
    // Backtick (`) opens/closes command palette — skip if typing in an input
    const target = e.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (e.key === '`' && !isTyping) {
      e.preventDefault();
      if (_overlay) {
        close();
      } else {
        open();
      }
    }
    // Keep Ctrl+K as alternate
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (_overlay) {
        close();
      } else {
        open();
      }
    }
  });
}

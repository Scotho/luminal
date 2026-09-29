import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';

// ── Data Model ──────────────────────────────────────────────────────────────

interface Decision {
  id: string;
  title: string;
  context: string;
  options: string[];
  decision: string;
  rationale: string;
  created: string;
  tags: string[];
}

// ── State ───────────────────────────────────────────────────────────────────

let _decisions: Decision[] = [];
let _container: HTMLElement | null = null;
let _searchQuery = '';
let _expandedIds = new Set<string>();
let _showForm = false;

// ── Persistence ─────────────────────────────────────────────────────────────

async function loadDecisions(): Promise<Decision[]> {
  try {
    const res = await fetch('/data/decisions.json');
    if (!res.ok) return [];
    const data = await res.json() as Decision[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveDecisions(): Promise<void> {
  try {
    await fetch('/__admin_save?file=decisions.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_decisions, null, 2),
    });
  } catch (e) {
    console.warn('Failed to save decisions:', e);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function genId(): string {
  return `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function matchesSearch(d: Decision, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return d.title.toLowerCase().includes(q)
    || d.context.toLowerCase().includes(q)
    || d.rationale.toLowerCase().includes(q);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

export async function renderDecisions(container: HTMLElement): Promise<void> {
  _container = container;
  container.innerHTML = '<div style="padding:20px;color:var(--text-dim);">Loading decisions...</div>';
  _decisions = await loadDecisions();
  fullRender();
}

function fullRender(): void {
  if (!_container) return;

  const filtered = _decisions
    .filter(d => matchesSearch(d, _searchQuery))
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  _container.innerHTML = `
    <style>${decisionsCSS()}</style>
    <div class="dec-root">
      <div class="dec-header">
        <h2 class="dec-title">${icon('scale', 18)} Decisions</h2>
        <button class="dec-new-btn" id="dec-new-btn">${_showForm ? 'Cancel' : '+ New Decision'}</button>
      </div>
      <input type="text" id="dec-search" class="dec-search" placeholder="Search decisions..." value="${escapeHtml(_searchQuery)}" />
      <div id="dec-form-area"></div>
      <div class="dec-list" id="dec-list">
        ${filtered.length === 0
          ? '<div class="dec-empty">No decisions found.</div>'
          : filtered.map(d => renderCard(d)).join('')}
      </div>
    </div>
  `;

  // Wire search
  const searchEl = _container.querySelector<HTMLInputElement>('#dec-search')!;
  searchEl.addEventListener('input', () => {
    _searchQuery = searchEl.value;
    fullRender();
    // Re-focus search and restore cursor
    const newSearch = _container!.querySelector<HTMLInputElement>('#dec-search');
    if (newSearch) {
      newSearch.focus();
      newSearch.setSelectionRange(newSearch.value.length, newSearch.value.length);
    }
  });

  // Wire new button
  _container.querySelector('#dec-new-btn')!.addEventListener('click', () => {
    _showForm = !_showForm;
    fullRender();
    if (_showForm) {
      const titleInput = _container!.querySelector<HTMLInputElement>('#dec-form-title');
      if (titleInput) titleInput.focus();
    }
  });

  // Wire form if visible
  if (_showForm) renderForm();

  // Wire card toggles
  _container.querySelectorAll<HTMLElement>('.dec-card-header').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.dataset.decId!;
      if (_expandedIds.has(id)) {
        _expandedIds.delete(id);
      } else {
        _expandedIds.add(id);
      }
      fullRender();
    });
  });

  // Wire delete buttons
  _container.querySelectorAll<HTMLElement>('.dec-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.decId!;
      if (!confirm('Delete this decision?')) return;
      _decisions = _decisions.filter(d => d.id !== id);
      _expandedIds.delete(id);
      saveDecisions();
      fullRender();
    });
  });
}

function renderCard(d: Decision): string {
  const expanded = _expandedIds.has(d.id);
  const chevron = expanded ? '\u25BE' : '\u25B8';
  const tagsHtml = d.tags.length > 0
    ? d.tags.map(t => `<span class="dec-tag">${escapeHtml(t)}</span>`).join('')
    : '';

  let body = '';
  if (expanded) {
    body = `
      <div class="dec-card-body">
        <div class="dec-field">
          <div class="dec-label">Context</div>
          <div class="dec-value">${escapeHtml(d.context)}</div>
        </div>
        <div class="dec-field">
          <div class="dec-label">Options Considered</div>
          <ul class="dec-options-list">
            ${d.options.map(o => `<li>${escapeHtml(o)}</li>`).join('')}
          </ul>
        </div>
        <div class="dec-field">
          <div class="dec-label">Decision</div>
          <div class="dec-value dec-value--decision">${escapeHtml(d.decision)}</div>
        </div>
        <div class="dec-field">
          <div class="dec-label">Rationale</div>
          <div class="dec-value">${escapeHtml(d.rationale)}</div>
        </div>
        <div class="dec-card-footer">
          <button class="dec-delete-btn" data-dec-id="${d.id}">Delete</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="dec-card${expanded ? ' dec-card--expanded' : ''}">
      <div class="dec-card-header" data-dec-id="${d.id}">
        <span class="dec-chevron">${chevron}</span>
        <span class="dec-card-title">${escapeHtml(d.title)}</span>
        <span class="dec-card-date">${formatDate(d.created)}</span>
        ${tagsHtml ? `<span class="dec-card-tags">${tagsHtml}</span>` : ''}
      </div>
      ${body}
    </div>
  `;
}

function renderForm(): void {
  const area = _container!.querySelector<HTMLElement>('#dec-form-area');
  if (!area) return;

  area.innerHTML = `
    <div class="dec-form">
      <input type="text" id="dec-form-title" class="dec-input" placeholder="Title" />
      <textarea id="dec-form-context" class="dec-textarea" placeholder="Context — what problem or situation prompted this decision?" rows="3"></textarea>
      <textarea id="dec-form-options" class="dec-textarea" placeholder="Options considered (one per line)" rows="3"></textarea>
      <input type="text" id="dec-form-decision" class="dec-input" placeholder="Decision — what was decided?" />
      <textarea id="dec-form-rationale" class="dec-textarea" placeholder="Rationale — why this option?" rows="3"></textarea>
      <input type="text" id="dec-form-tags" class="dec-input" placeholder="Tags (comma-separated)" />
      <button class="dec-save-btn" id="dec-form-save">Save Decision</button>
    </div>
  `;

  area.querySelector('#dec-form-save')!.addEventListener('click', () => {
    const title = (area.querySelector<HTMLInputElement>('#dec-form-title')!).value.trim();
    const context = (area.querySelector<HTMLTextAreaElement>('#dec-form-context')!).value.trim();
    const optionsRaw = (area.querySelector<HTMLTextAreaElement>('#dec-form-options')!).value.trim();
    const decision = (area.querySelector<HTMLInputElement>('#dec-form-decision')!).value.trim();
    const rationale = (area.querySelector<HTMLTextAreaElement>('#dec-form-rationale')!).value.trim();
    const tagsRaw = (area.querySelector<HTMLInputElement>('#dec-form-tags')!).value.trim();

    if (!title) return;

    const entry: Decision = {
      id: genId(),
      title,
      context,
      options: optionsRaw ? optionsRaw.split('\n').map(s => s.trim()).filter(Boolean) : [],
      decision,
      rationale,
      created: new Date().toISOString(),
      tags: tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    };

    _decisions.push(entry);
    _showForm = false;
    _expandedIds.add(entry.id);
    saveDecisions();
    fullRender();
  });
}

// ── CSS ─────────────────────────────────────────────────────────────────────

function decisionsCSS(): string {
  return `
    .dec-root {
      max-width: 800px;
    }
    .dec-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .dec-title {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--text-heading);
    }
    .dec-new-btn {
      padding: 6px 14px;
      background: transparent;
      border: 1px solid var(--accent-dim);
      border-radius: var(--r-sm);
      color: var(--accent);
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--tr-fast);
    }
    .dec-new-btn:hover {
      border-color: var(--accent);
      color: var(--accent-bright);
    }
    .dec-search {
      width: 100%;
      padding: 6px 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      color: var(--text);
      font-family: var(--font-body);
      font-size: 12px;
      margin-bottom: 12px;
      outline: none;
      transition: border-color var(--tr-fast);
    }
    .dec-search:focus {
      border-color: var(--accent-dim);
    }
    .dec-search::placeholder {
      color: var(--text-quiet);
    }
    .dec-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dec-empty {
      padding: 20px;
      color: var(--text-dim);
      font-size: 13px;
    }

    /* Card */
    .dec-card {
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      background: var(--bg-panel);
      transition: border-color var(--tr-fast);
    }
    .dec-card--expanded {
      border-color: var(--accent-dim);
    }
    .dec-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      cursor: pointer;
      user-select: none;
      transition: background var(--tr-fast);
    }
    .dec-card-header:hover {
      background: var(--bg-hover);
    }
    .dec-chevron {
      font-size: 10px;
      color: var(--text-dim);
      width: 12px;
      flex-shrink: 0;
    }
    .dec-card-title {
      flex: 1;
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }
    .dec-card-date {
      font-size: 11px;
      color: var(--text-quiet);
      flex-shrink: 0;
    }
    .dec-card-tags {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }
    .dec-tag {
      padding: 1px 6px;
      background: rgba(110, 224, 240, 0.1);
      border: 1px solid rgba(110, 224, 240, 0.2);
      border-radius: 2px;
      font-size: 10px;
      color: var(--accent);
      font-family: var(--font-mono);
    }

    /* Card body */
    .dec-card-body {
      padding: 0 14px 14px;
      border-top: 1px solid var(--border);
    }
    .dec-field {
      margin-top: 10px;
    }
    .dec-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-quiet);
      margin-bottom: 3px;
    }
    .dec-value {
      font-size: 13px;
      color: var(--text-dim);
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .dec-value--decision {
      color: var(--accent);
      font-weight: 600;
    }
    .dec-options-list {
      margin: 0;
      padding-left: 18px;
      color: var(--text-dim);
      font-size: 13px;
      line-height: 1.6;
    }
    .dec-card-footer {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
    }
    .dec-delete-btn {
      padding: 4px 10px;
      background: transparent;
      border: 1px solid var(--red);
      border-radius: var(--r-sm);
      color: var(--red-bright);
      font-family: var(--font-body);
      font-size: 11px;
      cursor: pointer;
      transition: all var(--tr-fast);
    }
    .dec-delete-btn:hover {
      background: rgba(176, 45, 28, 0.15);
    }

    /* Form */
    .dec-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px;
      margin-bottom: 12px;
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      background: var(--bg-panel-alt);
    }
    .dec-input {
      padding: 6px 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      color: var(--text);
      font-family: var(--font-body);
      font-size: 12px;
      outline: none;
      transition: border-color var(--tr-fast);
    }
    .dec-input:focus {
      border-color: var(--accent-dim);
    }
    .dec-input::placeholder, .dec-textarea::placeholder {
      color: var(--text-quiet);
    }
    .dec-textarea {
      padding: 6px 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      color: var(--text);
      font-family: var(--font-body);
      font-size: 12px;
      resize: vertical;
      outline: none;
      transition: border-color var(--tr-fast);
    }
    .dec-textarea:focus {
      border-color: var(--accent-dim);
    }
    .dec-save-btn {
      align-self: flex-end;
      padding: 6px 18px;
      background: transparent;
      border: 1px solid var(--accent-dim);
      border-radius: var(--r-sm);
      color: var(--accent);
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--tr-fast);
    }
    .dec-save-btn:hover {
      border-color: var(--accent);
      color: var(--accent-bright);
    }
  `;
}

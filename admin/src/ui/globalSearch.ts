// admin/src/ui/globalSearch.ts — Global search across all admin sections
import { escapeHtml } from './render';

type SearchResult = { section: string; label: string; match: string; score: number };

let _overlay: HTMLElement | null = null;
let _switchSection: ((name: string) => void) | null = null;

const SECTION_LABELS: Record<string, string> = {
  'live': 'Status', 'tasks': 'Tasks', 'sessions': 'Sessions',
  'notes': 'Notes', 'specs': 'Specs',
  'pipeline': 'Pipeline', 'pulls': 'PR Reviews', 'audits': 'Audits',
  'test-center': 'Test Center', 'e2e-matrix': 'E2E Matrix',
  'users': 'Users', 'matches': 'Matches', 'database': 'Database',
  'playtime': 'Playtime', 'ollama': 'Agents', 'bugs': 'Bug Reports',
  'purge': 'Admin Actions', 'settings': 'Settings', 'feature-flags': 'Feature Flags',
  'function-logs': 'Logs', 'incidents': 'Incidents',
  'firebase-metrics': 'Firebase Metrics',
  'overseer': 'Overseer',
};

export function initGlobalSearch(switchFn: (name: string) => void): void {
  _switchSection = switchFn;
}

export function showGlobalSearch(): void {
  if (_overlay) return;

  _overlay = document.createElement('div');
  _overlay.id = 'global-search-overlay';
  _overlay.setAttribute('role', 'presentation');
  _overlay.innerHTML = `
    <div class="global-search-modal" role="dialog" aria-modal="true" aria-labelledby="global-search-label">
      <div id="global-search-label" class="global-search-title">Quick Switch</div>
      <input id="global-search-input" type="text" placeholder="Search sections, tasks, users..." autocomplete="off" aria-describedby="global-search-help" />
      <div id="global-search-help" class="global-search-help">Press Enter to open the first result. Press Escape to close.</div>
      <div id="global-search-results"></div>
    </div>
  `;

  document.body.appendChild(_overlay);

  const input = document.getElementById('global-search-input') as HTMLInputElement;
  input?.focus();

  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    renderResults(q);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGlobalSearch();
    if (e.key === 'Enter') {
      const first = document.querySelector('.global-search-result') as HTMLElement;
      if (first) first.click();
    }
  });

  _overlay.addEventListener('click', (e) => {
    if (e.target === _overlay) closeGlobalSearch();
    const result = (e.target as HTMLElement).closest('.global-search-result') as HTMLElement;
    if (result?.dataset.section && _switchSection) {
      _switchSection(result.dataset.section);
      closeGlobalSearch();
    }
  });
}

export function closeGlobalSearch(): void {
  _overlay?.remove();
  _overlay = null;
}

function renderResults(query: string): void {
  const resultsEl = document.getElementById('global-search-results');
  if (!resultsEl) return;

  if (!query) {
    resultsEl.innerHTML = '<div style="color:var(--text-quiet);font-size:11px;padding:8px;">Type to search...</div>';
    return;
  }

  const results: SearchResult[] = [];

  // Search section names
  for (const [section, label] of Object.entries(SECTION_LABELS)) {
    if (label.toLowerCase().includes(query) || section.includes(query)) {
      results.push({ section, label, match: `Section: ${label}`, score: label.toLowerCase().startsWith(query) ? 10 : 5 });
    }
  }

  results.sort((a, b) => b.score - a.score);

  if (results.length === 0) {
    resultsEl.innerHTML = '<div style="color:var(--text-quiet);font-size:11px;padding:8px;">No results</div>';
    return;
  }

  resultsEl.innerHTML = results.slice(0, 15).map(r => `
    <button class="global-search-result" type="button" data-section="${r.section}" style="
      width:100%;padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;
      border:none;border-bottom:1px solid var(--border);background:transparent;color:inherit;transition:background 0.1s;
    " onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
      <span style="font-size:12px;font-weight:600;">${escapeHtml(r.label)}</span>
      <span style="font-size:10px;color:var(--text-quiet);">${escapeHtml(r.match)}</span>
    </button>
  `).join('');
}

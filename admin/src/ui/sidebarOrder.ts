// ── Sidebar Reorder with Drag-and-Drop ──────────────────────────────────────

import { icon } from './icons';

const STORAGE_KEY = 'luminal-admin-sidebar-order';
const FAV_KEY = 'luminal-admin-favorites';
const COLLAPSED_KEY = 'luminal-admin-collapsed-groups';
const DEFAULT_COLLAPSED = new Set(['Data', 'Operations', 'Utilities']);

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAV_KEY);
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
  } catch { return new Set(); }
}

function saveFavorites(favs: Set<string>): void {
  localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
}

export function toggleFavorite(section: string): void {
  const favs = loadFavorites();
  if (favs.has(section)) favs.delete(section); else favs.add(section);
  saveFavorites(favs);
}

export function isFavorite(section: string): boolean {
  return loadFavorites().has(section);
}

// ── Collapsed groups ────────────────────────────────────

function loadCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set(DEFAULT_COLLAPSED);
  } catch { return new Set(DEFAULT_COLLAPSED); }
}

function saveCollapsed(collapsed: Set<string>): void {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
}

export function toggleGroupCollapse(group: string): void {
  const collapsed = loadCollapsed();
  if (collapsed.has(group)) collapsed.delete(group); else collapsed.add(group);
  saveCollapsed(collapsed);
}

/** Default section order with group boundaries. */
export const DEFAULT_ORDER: string[] = [
  'live', 'tasks',
  'sessions', 'notes', 'specs',
  'git', 'audits', 'function-logs', 'impact-analysis', 'file-browser', 'animation-viewer',
  'test-center', 'e2e-matrix', 'testing', 'flakiness-tracker',
  'agents', 'overseer', 'iterative-loop', 'live-diff', 'memory-economy',
  'users', 'matches', 'leaderboard', 'ranked-sim', 'xp-sim', 'database', 'playtime', 'firebase-metrics', 'match-replay', 'analytics', 'perf-tracker',
  'ollama', 'chat-moderation', 'feature-flags', 'announcements', 'bugs', 'purge', 'incidents', 'notifications', 'scheduler',
  'deploy-pipeline',
  'links', 'viewer', 'trail-lab', 'help', 'settings',
];

/** Top-level sections that appear ungrouped at the top of the sidebar. */
const UNGROUPED = new Set(['live']);

/** Group definitions. */
export const GROUPS: { label: string; sections: string[] }[] = [
  { label: 'Planning',    sections: ['tasks', 'sessions', 'notes', 'specs'] },
  { label: 'Dev',         sections: ['git', 'audits', 'function-logs', 'impact-analysis', 'file-browser', 'animation-viewer'] },
  { label: 'Testing',     sections: ['test-center', 'e2e-matrix', 'testing', 'flakiness-tracker'] },
  { label: 'Agents',      sections: ['agents', 'overseer', 'iterative-loop', 'live-diff', 'memory-economy'] },
  { label: 'Data',        sections: ['users', 'matches', 'leaderboard', 'ranked-sim', 'xp-sim', 'database', 'playtime', 'firebase-metrics', 'match-replay', 'analytics', 'perf-tracker'] },
  { label: 'Operations',  sections: ['ollama', 'chat-moderation', 'feature-flags', 'announcements', 'bugs', 'purge', 'incidents', 'notifications', 'scheduler', 'deploy-pipeline'] },
  { label: 'Utilities',   sections: ['links', 'viewer', 'trail-lab', 'help', 'settings'] },
];

/** Get group label for a section based on default grouping. Returns '' for ungrouped. */
export function getGroupForSection(section: string): string {
  if (UNGROUPED.has(section)) return '';
  for (const g of GROUPS) {
    if (g.sections.includes(section)) return g.label;
  }
  return 'Other';
}

/** Load saved order from localStorage, or return default. */
export function loadOrder(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [...DEFAULT_ORDER];
    const parsed = JSON.parse(stored) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_ORDER];
    const known = new Set(parsed);
    const merged = [...parsed];
    for (const s of DEFAULT_ORDER) {
      if (!known.has(s)) merged.push(s);
    }
    return merged;
  } catch {
    return [...DEFAULT_ORDER];
  }
}

/** Save order to localStorage. */
export function saveOrder(order: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

/** Map from section data-section to display label. */
const SECTION_LABELS: Record<string, string> = {
  'live': 'Status',
  'tasks': 'Tasks',
  'sessions': 'Sessions',
  'notes': 'Notes',
  'specs': 'Specs',
  'test-center': 'Test Center',
  'e2e-matrix': 'E2E Matrix',
  'flakiness-tracker': 'Flakiness',
  'agents': 'Agents',
  'pipeline': 'Pipeline',
  'pulls': 'PR Reviews',
  'audits': 'Audits',
  'users': 'Users',
  'matches': 'Matches',
  'database': 'Database',
  'playtime': 'Playtime',
  'bugs': 'Bug Reports',
  'purge': 'Admin Actions',
  'file-browser': 'Files',
  'testing': 'Testing Ground',
  'links': 'Links',
  'notifications': 'Activity',
  'viewer': 'Viewer',
  'trail-lab': 'Trail Lab',
  'ollama': 'Agents',
  'overseer': 'Overseer',
  'feature-flags': 'Feature Flags',
  'announcements': 'Announcements',
  'help': 'Help',
  'settings': 'Settings',
  'git': 'Git',
  'function-logs': 'Logs',
  'incidents': 'Incidents',
  'firebase-metrics': 'Firebase',
  'match-replay': 'Match Replay',
  'chat-moderation': 'Chat Mod',
  'leaderboard': 'Leaderboard',
  'analytics': 'Analytics',
  'perf-tracker': 'Perf Tracker',
  'scheduler': 'Scheduler',
  'live-diff': 'Live Diff',
  'impact-analysis': 'Impact Analysis',
  'memory-economy': 'Memory & Tokens',
  'iterative-loop': 'Iterative Loop',
  'ranked-sim': 'Ranked Sim',
  'xp-sim': 'XP Simulator',
  'animation-viewer': 'Animations',
  'deploy-pipeline': 'Deploy Pipeline',
};

/** Icon name for each sidebar section. */
const SECTION_ICONS: Record<string, string> = {
  'live': 'circle-dot',
  'tasks': 'list-checks',
  'sessions': 'layout-list',
  'notes': 'notebook-text',
  'specs': 'file-text',
  'git': 'git-branch',
  'pipeline': 'git-branch',
  'pulls': 'git-pull-request',
  'audits': 'clipboard-check',
  'function-logs': 'server',
  'test-center': 'flask-conical',
  'e2e-matrix': 'grid-2x2',
  'flakiness-tracker': 'activity',
  'overseer': 'shield',
  'agents': 'bot',
  'users': 'users',
  'matches': 'swords',
  'database': 'database',
  'playtime': 'clock',
  'firebase-metrics': 'activity',
  'match-replay': 'monitor',
  'leaderboard': 'trophy',
  'analytics': 'bar-chart-3',
  'perf-tracker': 'activity',
  'ollama': 'cpu',
  'chat-moderation': 'message-square',
  'feature-flags': 'flag',
  'announcements': 'bell',
  'bugs': 'bug',
  'purge': 'trash-2',
  'incidents': 'alert-triangle',
  'notifications': 'bell',
  'scheduler': 'zap',
  'file-browser': 'file',
  'testing': 'flask-conical',
  'links': 'link',
  'viewer': 'eye',
  'trail-lab': 'zap',
  'help': 'circle-help',
  'settings': 'settings',
  'live-diff': 'git-branch',
  'impact-analysis': 'git-branch',
  'memory-economy': 'brain',
  'iterative-loop': 'repeat',
  'animation-viewer': 'play',
  'xp-sim': 'bar-chart-3',
  'deploy-pipeline': 'rocket',
};

/** Initialize sidebar ordering and drag-and-drop. Call once after auth. */
export function initSidebarOrder(): void {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.setAttribute('aria-label', 'Primary navigation');

  const order = loadOrder();
  renderSidebar(sidebar, order);
  rewireNavClicks(sidebar);

  // Group collapse/expand click delegation
  sidebar.addEventListener('click', (e) => {
    const header = (e.target as HTMLElement).closest('.nav-group-header[data-group]') as HTMLElement;
    if (header?.dataset.group) {
      e.stopPropagation();
      toggleGroupCollapse(header.dataset.group);
      renderSidebar(sidebar, loadOrder());
      rewireNavClicks(sidebar);
    }
  });

  // Star/favorite click delegation
  sidebar.addEventListener('click', (e) => {
    const star = (e.target as HTMLElement).closest('.nav-star') as HTMLElement;
    if (star?.dataset.section) {
      e.stopPropagation();
      toggleFavorite(star.dataset.section);
      renderSidebar(sidebar, loadOrder());
      rewireNavClicks(sidebar);
    }
  });

  // Keyboard navigation for accessibility
  sidebar.addEventListener('keydown', (e) => {
    const items = sidebar.querySelectorAll<HTMLElement>('.nav-item');
    const current = document.activeElement as HTMLElement;
    const idx = Array.from(items).indexOf(current);

    if (e.key === 'Enter' && idx >= 0) {
      current.click();
    } else if (e.key === 'ArrowDown' && idx < items.length - 1) {
      e.preventDefault();
      items[idx + 1].focus();
    } else if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      items[idx - 1].focus();
    }
  });
}

function renderSidebar(sidebar: HTMLElement, order: string[]): void {
  // Preserve the <h1> title
  const title = sidebar.querySelector('h1');

  // Collect existing nav items as a map for preserving event state
  const existingItems = new Map<string, HTMLButtonElement>();
  sidebar.querySelectorAll<HTMLButtonElement>('.nav-item[data-section]').forEach(el => {
    existingItems.set(el.dataset.section!, el);
  });

  // Remove existing nav items and group headers
  sidebar.querySelectorAll('.nav-item, .nav-group-header').forEach(el => el.remove());

  // Build Favorites pseudo-group at the top
  const favs = loadFavorites();
  if (favs.size > 0) {
    const header = document.createElement('div');
    header.className = 'nav-group-header';
    header.textContent = 'Favorites';
    header.style.cssText = 'padding:12px 16px 4px; margin-top:6px; font-family:var(--font-display); font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:3px; color:var(--gold); user-select:none;';
    sidebar.appendChild(header);

    for (const section of order) {
      if (!favs.has(section)) continue;
      const item = document.createElement('button');
      item.className = 'nav-item nav-item--grouped nav-item--group-start nav-item--group-end';
      item.dataset.section = section;
      item.textContent = SECTION_LABELS[section] ?? section;
      item.type = 'button';
      sidebar.appendChild(item);
    }
  }

  // Build ordered nav items with group headers
  let lastGroup: string | null = null;
  const collapsed = loadCollapsed();

  for (const [index, section] of order.entries()) {
    const group = getGroupForSection(section);
    const isGrouped = group !== '';
    const prevSection = order[index - 1] ?? null;
    const nextSection = order[index + 1] ?? null;
    const prevGroup = prevSection ? getGroupForSection(prevSection) : null;
    const nextGroup = nextSection ? getGroupForSection(nextSection) : null;
    const isGroupStart = !prevSection || prevGroup !== group;
    const isGroupEnd = !nextSection || nextGroup !== group;

    // Insert collapsible group header if entering a new named group
    if (isGrouped && group !== lastGroup) {
      lastGroup = group;
      const isCollapsed = collapsed.has(group);
      const header = document.createElement('button');
      header.className = 'nav-group-header';
      header.dataset.group = group;
      header.type = 'button';
      header.setAttribute('aria-expanded', String(!isCollapsed));
      header.innerHTML = `<span class="nav-group-chevron${isCollapsed ? ' collapsed' : ''}">${isCollapsed ? '\u25B6' : '\u25BC'}</span>${group}`;
      sidebar.appendChild(header);
    } else if (!isGrouped) {
      lastGroup = null;
    }

    // Create or reuse nav item
    const existing = existingItems.get(section);
    const el = existing ?? document.createElement('button');
    const fav = isFavorite(section);
    const showGrip = !UNGROUPED.has(section);
    const gripHtml = showGrip ? `<span class="nav-drag-grip" draggable="true" data-section="${section}" title="Drag to reorder">\u2807</span>` : '';
    const labelText = SECTION_LABELS[section] ?? section;
    const starHtml = `<span class="nav-star" data-section="${section}" style="cursor:pointer; font-size:12px; color:${fav ? 'var(--gold)' : 'var(--text-quiet)'}; opacity:${fav ? '1' : '0'}; transition:opacity 0.15s;">${fav ? '\u2605' : '\u2606'}</span>`;
    el.className = 'nav-item';
    el.type = 'button';
    el.dataset.section = section;
    el.setAttribute('aria-label', `Open ${labelText}`);
    el.title = labelText;
    const iconName = SECTION_ICONS[section];
    const iconHtml = iconName ? `<span class="nav-icon">${icon(iconName, 14)}</span>` : '';
    if (section === 'live') {
      el.innerHTML = `${gripHtml}<span class="live-dot"></span>${iconHtml}<span class="nav-label">${labelText}</span>${starHtml}`;
    } else {
      el.innerHTML = `${gripHtml}${iconHtml}<span class="nav-label">${labelText}</span>${starHtml}`;
    }

    // Add indent for grouped children + collapse hiding
    if (isGrouped) {
      el.classList.add('nav-item--grouped');
      if (isGroupStart) el.classList.add('nav-item--group-start');
      else el.classList.remove('nav-item--group-start');
      if (isGroupEnd) el.classList.add('nav-item--group-end');
      else el.classList.remove('nav-item--group-end');
      if (collapsed.has(group)) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    } else {
      el.classList.remove('nav-item--grouped');
      el.classList.add('nav-item--group-start', 'nav-item--group-end');
      el.style.display = '';
    }

    sidebar.appendChild(el);
    wireDrag(el, order, sidebar);
  }
}

let _draggedSection: string | null = null;

function wireDrag(item: HTMLElement, order: string[], sidebar: HTMLElement): void {
  // Bind drag start on the grip handle, not the whole item
  const grip = item.querySelector<HTMLElement>('.nav-drag-grip');
  if (grip) {
    grip.addEventListener('dragstart', (e) => {
      _draggedSection = item.dataset.section ?? null;
      item.style.opacity = '0.4';
      e.dataTransfer!.effectAllowed = 'move';
    });

    grip.addEventListener('dragend', () => {
      _draggedSection = null;
      item.style.opacity = '1';
      sidebar.querySelectorAll<HTMLElement>('.nav-item').forEach(el => {
        el.style.borderTop = '';
        el.style.borderBottom = '';
      });
    });
  }

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    if (!_draggedSection || item.dataset.section === _draggedSection) return;

    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    sidebar.querySelectorAll<HTMLElement>('.nav-item').forEach(el => {
      el.style.borderTop = '';
      el.style.borderBottom = '';
    });
    if (e.clientY < midY) {
      item.style.borderTop = '2px solid var(--accent)';
    } else {
      item.style.borderBottom = '2px solid var(--accent)';
    }
  });

  item.addEventListener('dragleave', () => {
    item.style.borderTop = '';
    item.style.borderBottom = '';
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    item.style.borderTop = '';
    item.style.borderBottom = '';

    if (!_draggedSection || item.dataset.section === _draggedSection) return;

    const targetSection = item.dataset.section!;
    const fromIdx = order.indexOf(_draggedSection);
    const toIdx = order.indexOf(targetSection);
    if (fromIdx === -1 || toIdx === -1) return;

    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertBefore = e.clientY < midY;

    order.splice(fromIdx, 1);
    const newToIdx = order.indexOf(targetSection);
    const insertIdx = insertBefore ? newToIdx : newToIdx + 1;
    order.splice(insertIdx, 0, _draggedSection);

    saveOrder(order);
    renderSidebar(sidebar, order);
    rewireNavClicks(sidebar);
  });
}

/** Re-attach click listeners after reorder. Called externally from main.ts. */
let _onNavClick: ((section: string) => void) | null = null;

export function setNavClickHandler(handler: (section: string) => void): void {
  _onNavClick = handler;
}

function rewireNavClicks(sidebar: HTMLElement): void {
  if (!_onNavClick) return;
  sidebar.querySelectorAll<HTMLElement>('.nav-item[data-section]').forEach(item => {
    const section = item.dataset.section!;
    item.addEventListener('click', () => {
      _onNavClick!(section);
    });
  });
}

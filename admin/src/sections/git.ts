// admin/src/sections/git.ts — Git section entry point with tab router

import { escapeHtml } from '../ui/render';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GitTab = 'working-tree' | 'log' | 'branches' | 'prs' | 'ci';

export interface GitFileEntry {
  path: string;
  status: string;   // 'M' | 'A' | 'D' | 'R' | '??' | etc.
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
}

export interface GitState {
  git: GitStatus | null;
  activeTab: GitTab;
  container: HTMLElement | null;
}

export interface GitStatusState {
  branch: string;
  oid: string;
  ahead: number;
  behind: number;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  conflicts: string[];
  stashCount: number;
}

// ── Module state ──────────────────────────────────────────────────────────────

const _state: GitState = {
  git: null,
  activeTab: 'working-tree',
  container: null,
};

let _gitStatus: GitStatusState = {
  branch: '', oid: '', ahead: 0, behind: 0,
  staged: [], unstaged: [], untracked: [],
  conflicts: [], stashCount: 0,
};

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getGitState(): GitStatusState {
  return _gitStatus;
}

export function getActiveTab(): GitTab {
  return _state.activeTab;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

export async function refreshGitState(): Promise<void> {
  try {
    const res = await fetch('/__admin_git/status');
    if (!res.ok) return;
    const data = await res.json() as {
      branch?: string; oid?: string; ahead?: number; behind?: number;
      staged?: { path: string; status: string }[];
      unstaged?: { path: string; status: string }[];
      untracked?: string[];
      conflicts?: string[];
      stashCount?: number;
    };
    _gitStatus = {
      branch: data.branch ?? '',
      oid: data.oid ?? '',
      ahead: data.ahead ?? 0,
      behind: data.behind ?? 0,
      staged: (data.staged ?? []).map(f => ({ path: f.path, status: f.status, staged: true })),
      unstaged: (data.unstaged ?? []).map(f => ({ path: f.path, status: f.status, staged: false })),
      untracked: (data.untracked ?? []).map(p => ({ path: p, status: 'A', staged: false })),
      conflicts: data.conflicts ?? [],
      stashCount: data.stashCount ?? 0,
    };
    // Keep legacy GitStatus for tab bar rendering
    _state.git = {
      branch: _gitStatus.branch,
      ahead: _gitStatus.ahead,
      behind: _gitStatus.behind,
      files: [..._gitStatus.staged, ..._gitStatus.unstaged, ..._gitStatus.untracked],
    };
  } catch {
    // non-fatal
  }
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function renderTabBar(container: HTMLElement): void {
  const header = container.querySelector<HTMLElement>('#git-header');
  if (!header) return;

  const { git, activeTab } = _state;
  const branch = git?.branch ?? '—';
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  const changedCount = git?.files.length ?? 0;

  const aheadBehind = (ahead > 0 || behind > 0)
    ? `<span style="color:var(--text-dim); font-size:11px; margin-left:8px;">
        ${ahead > 0 ? `<span style="color:var(--green);">↑${ahead}</span>` : ''}
        ${behind > 0 ? `<span style="color:var(--orange);">↓${behind}</span>` : ''}
       </span>`
    : '';

  const tabs: { id: GitTab; label: string }[] = [
    { id: 'working-tree', label: 'Working Tree' },
    { id: 'log',          label: 'Log' },
    { id: 'branches',     label: 'Branches' },
    { id: 'prs',          label: 'PRs' },
    { id: 'ci',           label: 'CI' },
  ];

  const tabsHtml = tabs.map(t => {
    const isActive = t.id === activeTab;
    const badge = t.id === 'working-tree' && changedCount > 0
      ? `<span style="
          background:var(--accent);
          color:#000;
          border-radius:8px;
          font-size:10px;
          font-weight:700;
          padding:1px 5px;
          margin-left:5px;
          line-height:1.4;
        ">${changedCount}</span>`
      : '';
    return `
      <button
        class="git-tab-btn"
        data-tab="${escapeHtml(t.id)}"
        type="button"
        style="
          background:none;
          border:none;
          border-bottom:2px solid ${isActive ? 'var(--accent)' : 'transparent'};
          color:${isActive ? 'var(--accent)' : 'var(--text-dim)'};
          cursor:pointer;
          font-family:var(--font-display);
          font-size:11px;
          font-weight:${isActive ? '700' : '500'};
          letter-spacing:1px;
          padding:10px 14px 8px;
          text-transform:uppercase;
          transition:color 0.15s, border-color 0.15s;
          white-space:nowrap;
        "
      >${escapeHtml(t.label)}${badge}</button>
    `;
  }).join('');

  header.innerHTML = `
    <div style="
      display:flex;
      align-items:center;
      gap:4px;
      padding:0 16px;
      background:var(--bg-surface);
      border-bottom:1px solid var(--border);
      flex-wrap:wrap;
    ">
      <span style="
        font-family:var(--font-mono);
        font-size:12px;
        color:var(--accent);
        padding:0 12px 0 4px;
        border-right:1px solid var(--border);
        margin-right:4px;
        display:flex;
        align-items:center;
        gap:4px;
        height:40px;
      ">⎇ ${escapeHtml(branch)}${aheadBehind}</span>
      <div style="display:flex; align-items:center; flex:1; overflow-x:auto;">
        ${tabsHtml}
      </div>
      <button
        id="git-refresh-btn"
        type="button"
        title="Refresh"
        style="
          background:none;
          border:1px solid var(--border);
          border-radius:var(--r-sm);
          color:var(--text-dim);
          cursor:pointer;
          font-size:13px;
          height:26px;
          padding:0 8px;
          margin-left:8px;
          transition:color 0.15s, border-color 0.15s;
        "
      >↺</button>
    </div>
  `;
}

// ── Tab loader ────────────────────────────────────────────────────────────────

async function loadTab(bodyContainer: HTMLElement): Promise<void> {
  bodyContainer.innerHTML = `<div style="padding:24px; color:var(--text-dim); font-size:12px;">Loading…</div>`;

  switch (_state.activeTab) {
    case 'working-tree': {
      const m = await import('./git/workingTree');
      m.renderWorkingTree(bodyContainer);
      break;
    }
    case 'log': {
      const m = await import('./git/log');
      m.renderLog(bodyContainer);
      break;
    }
    case 'branches': {
      const m = await import('./git/branches');
      m.renderBranches(bodyContainer);
      break;
    }
    case 'prs': {
      const m = await import('./git/pullRequests');
      m.renderPullRequests(bodyContainer);
      break;
    }
    case 'ci': {
      const m = await import('./git/ciStatus');
      m.renderCIStatus(bodyContainer);
      break;
    }
  }
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderGit(container: HTMLElement): () => void {
  _state.container = container;
  _state.activeTab = 'working-tree';

  container.innerHTML = `
    <div id="git-header"></div>
    <div id="git-body" style="flex:1; overflow:auto; min-height:0;"></div>
  `;
  container.classList.add('section--git');

  const bodyEl = container.querySelector<HTMLElement>('#git-body')!;

  const doRender = async (): Promise<void> => {
    await refreshGitState();
    renderTabBar(container);
    await loadTab(bodyEl);
    wireRefreshButton(container, bodyEl);
  };

  // Tab click delegation
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.git-tab-btn[data-tab]');
    if (!btn?.dataset.tab) return;
    const tab = btn.dataset.tab as GitTab;
    if (tab === _state.activeTab) return;
    _state.activeTab = tab;
    renderTabBar(container);
    void loadTab(bodyEl);
    wireRefreshButton(container, bodyEl);
  });

  void doRender();

  const interval = setInterval(() => {
    void refreshGitState().then(() => {
      renderTabBar(container);
      wireRefreshButton(container, bodyEl);
    });
  }, 10_000);

  return () => {
    clearInterval(interval);
    container.classList.remove('section--git');
    _state.container = null;
  };
}

function wireRefreshButton(container: HTMLElement, bodyEl: HTMLElement): void {
  const btn = container.querySelector<HTMLButtonElement>('#git-refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    void refreshGitState().then(() => {
      renderTabBar(container);
      void loadTab(bodyEl);
      wireRefreshButton(container, bodyEl);
    });
  });
}

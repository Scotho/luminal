// admin/src/sections/git/workingTree.ts — Working Tree tab
import { escapeHtml } from '../../ui/render';
import { getGitState, refreshGitState, type GitFileEntry } from '../git';
import { parseDiff, renderFileDiff, getHunkContext, type DiffFile } from './diffRenderer';
import { createPopover } from './hunkPopover';
import { modelToggle, wireModelToggles, aiInline, aiFlyout } from './aiActions';

let _selectedFile: string | null = null;
let _parsedFiles: DiffFile[] = [];

export function renderWorkingTree(container: HTMLElement): void {
  const g = getGitState();

  container.innerHTML = `
    <div class="wt" style="display:flex;flex-direction:column;height:100%;">
      <div class="wt-toolbar" style="
        display:flex;align-items:center;gap:6px;padding:8px 12px;
        border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap;
      ">
        <button class="wt-stage-all admin-btn admin-btn--small">Stage All</button>
        <button class="wt-unstage-all admin-btn admin-btn--small">Unstage All</button>
        <button class="wt-stash admin-btn admin-btn--small">Stash</button>
        <button class="wt-discard admin-btn admin-btn--small" style="color:var(--red-bright,#d45234);border-color:var(--red-bright,#d45234);">Discard All</button>
        <div style="flex:1;"></div>
        <button class="wt-radar" title="Regression Radar" style="
          background:none;border:1px solid var(--border);border-radius:3px;padding:3px 8px;
          color:var(--text-dim);cursor:pointer;font-size:11px;font-family:inherit;
        ">\uD83D\uDEE1 Radar</button>
        <button class="wt-review admin-btn admin-btn--small" style="color:var(--accent);border-color:var(--accent);">Review Branch</button>
      </div>
      <div class="wt-split" style="display:flex;flex:1;overflow:hidden;">
        <div class="wt-files" style="
          width:280px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--border);
          font-size:12px;
        ">
          ${renderFileList(g)}
        </div>
        <div class="wt-diff" style="flex:1;overflow:auto;padding:12px;">
          <p style="color:var(--text-dim);">Select a file to view its diff</p>
        </div>
      </div>
      <div class="wt-commit" style="
        border-top:1px solid var(--border);padding:10px 14px;
        background:var(--bg-surface);flex-shrink:0;
      ">
        <textarea class="wt-commit-msg" placeholder="Commit message (conventional: feat/fix/refactor...)" style="
          width:100%;min-height:36px;max-height:80px;resize:vertical;
          background:var(--bg);border:1px solid var(--border);border-radius:4px;
          color:var(--text);font-family:var(--font-mono);font-size:12px;padding:8px 10px;
          box-sizing:border-box;
        "></textarea>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;">
          <button class="wt-gen-msg admin-btn admin-btn--small" style="color:var(--accent);border-color:var(--accent);">\u2728 Generate Message</button>
          ${modelToggle('commit-msg')}
          <button class="wt-audit admin-btn admin-btn--small" style="color:var(--orange);border-color:var(--orange);">\uD83D\uDD0D Pre-commit Audit</button>
          ${modelToggle('audit')}
          <div style="flex:1;"></div>
          <button class="wt-commit-btn admin-btn admin-btn--small" style="color:var(--green);border-color:var(--green);font-weight:700;">Commit</button>
          <button class="wt-commit-push admin-btn admin-btn--small" style="color:var(--purple,#aa64ff);border-color:var(--purple,#aa64ff);">C+P</button>
        </div>
      </div>
    </div>`;

  wireModelToggles(container);
  wireEvents(container);
}

function renderFileList(g: ReturnType<typeof getGitState>): string {
  const statusIcon: Record<string, string> = {
    M: '\u25CF', A: '+', D: '\u2715', R: '\u2192', C: '\u2398', U: '\u26A0',
  };
  const statusColor: Record<string, string> = {
    M: 'var(--accent)', A: 'var(--green)', D: 'var(--red-bright,#d45234)',
    R: 'var(--purple,#aa64ff)', U: 'var(--orange)',
  };

  function fileRow(f: GitFileEntry, isStaged: boolean): string {
    const icon = statusIcon[f.status] ?? '\u25CF';
    const color = statusColor[f.status] ?? 'var(--text-dim)';
    const active = _selectedFile === f.path;
    return `
      <div class="wt-file-row" data-path="${escapeHtml(f.path)}" data-staged="${isStaged}" style="
        display:flex;align-items:center;gap:6px;padding:5px 10px;cursor:pointer;
        background:${active ? 'var(--bg-hover)' : 'transparent'};
        border-left:2px solid ${active ? 'var(--accent)' : 'transparent'};
        transition:background 0.1s;
      ">
        <input type="checkbox" class="wt-file-check" data-path="${escapeHtml(f.path)}" data-staged="${isStaged}"
          ${isStaged ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent);" />
        <span style="color:${color};font-size:13px;width:14px;text-align:center;">${icon}</span>
        <span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:11px;"
          title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>
        <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;">${f.status}</span>
      </div>`;
  }

  const unstaged = [...g.unstaged, ...g.untracked];
  const staged = g.staged;

  return `
    <div style="padding:6px 10px;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;">
      Unstaged (${unstaged.length})
    </div>
    ${unstaged.length === 0 ? '<p style="padding:4px 10px;font-size:11px;color:var(--text-dim);">No changes</p>' : unstaged.map(f => fileRow(f, false)).join('')}
    <div style="padding:6px 10px;margin-top:8px;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--green);text-transform:uppercase;">
      Staged (${staged.length})
    </div>
    ${staged.length === 0 ? '<p style="padding:4px 10px;font-size:11px;color:var(--text-dim);">Nothing staged</p>' : staged.map(f => fileRow(f, true)).join('')}
  `;
}

async function loadFileDiff(container: HTMLElement, path: string): Promise<void> {
  const diffPanel = container.querySelector<HTMLElement>('.wt-diff')!;
  diffPanel.innerHTML = '<p style="color:var(--text-dim);">Loading diff...</p>';

  try {
    const [stagedRes, unstagedRes] = await Promise.all([
      fetch(`/__admin_git/diff?staged=true&file=${encodeURIComponent(path)}`),
      fetch(`/__admin_git/diff?staged=false&file=${encodeURIComponent(path)}`),
    ]);
    const [stagedData, unstagedData] = await Promise.all([
      stagedRes.json() as Promise<{ diff: string }>,
      unstagedRes.json() as Promise<{ diff: string }>,
    ]);

    const combined = (stagedData.diff || '') + (unstagedData.diff || '');
    if (!combined.trim()) {
      diffPanel.innerHTML = `<p style="color:var(--text-dim);">No diff available for ${escapeHtml(path)} (new untracked file?)</p>`;
      return;
    }

    _parsedFiles = parseDiff(combined);
    const file = _parsedFiles[0];
    if (!file) {
      diffPanel.innerHTML = '<p style="color:var(--text-dim);">Could not parse diff</p>';
      return;
    }

    diffPanel.innerHTML = renderFileDiff(file, { showStageButtons: true, showAIButton: true });
    wireHunkHovers(diffPanel);
    wireHunkAI(diffPanel, file);
  } catch {
    diffPanel.innerHTML = '<p style="color:var(--red-bright,#d45234);">Failed to load diff</p>';
  }
}

function wireHunkHovers(diffPanel: HTMLElement): void {
  diffPanel.addEventListener('mouseenter', (e) => {
    const hunk = (e.target as HTMLElement).closest<HTMLElement>('.diff-hunk');
    if (hunk) {
      const actions = hunk.querySelector<HTMLElement>('.hunk-actions');
      if (actions) actions.style.opacity = '1';
    }
  }, true);
  diffPanel.addEventListener('mouseleave', (e) => {
    const hunk = (e.target as HTMLElement).closest<HTMLElement>('.diff-hunk');
    if (hunk) {
      const actions = hunk.querySelector<HTMLElement>('.hunk-actions');
      if (actions) actions.style.opacity = '0';
    }
  }, true);
}

function wireHunkAI(diffPanel: HTMLElement, file: DiffFile): void {
  diffPanel.addEventListener('click', (e) => {
    const aiBtn = (e.target as HTMLElement).closest<HTMLElement>('.hunk-ai-btn');
    if (!aiBtn) return;
    const hunkIdx = parseInt(aiBtn.dataset.hunk ?? '0');
    const context = getHunkContext(file, hunkIdx);

    const popover = createPopover({
      anchor: aiBtn,
      title: 'Explain Change',
      onFollowup: (text) => {
        popover.setContent('<span style="color:var(--text-dim);">Thinking...</span>');
        void aiInline('hunk-explain', `${context}\n\nFollow-up question: ${text}`, (token) => popover.appendToken(token));
      },
      onAutofix: () => {
        void aiFlyout('hunk-autofix', 'Hunk Auto-fix', `Fix the following change if there are issues:\n\n${context}\n\nRead the file, understand the context, and fix any problems.`);
      },
    });

    void aiInline('hunk-explain', `Explain what this code change does and why, concisely:\n\n${context}`, (token) => popover.appendToken(token));
  });
}

function wireEvents(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.wt-file-row');
    if (row?.dataset.path && !(e.target as HTMLElement).closest('.wt-file-check')) {
      _selectedFile = row.dataset.path;
      const filePanel = container.querySelector<HTMLElement>('.wt-files')!;
      filePanel.innerHTML = renderFileList(getGitState());
      void loadFileDiff(container, row.dataset.path);
    }
  });

  container.addEventListener('change', async (e) => {
    const check = e.target as HTMLInputElement;
    if (!check.classList.contains('wt-file-check')) return;
    const path = check.dataset.path!;
    const wasStaged = check.dataset.staged === 'true';

    const endpoint = wasStaged ? '/__admin_git/unstage' : '/__admin_git/stage';
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [path] }),
    });

    await refreshGitState();
    const filePanel = container.querySelector<HTMLElement>('.wt-files')!;
    filePanel.innerHTML = renderFileList(getGitState());
  });

  container.addEventListener('click', async (e) => {
    const stageBtn = (e.target as HTMLElement).closest<HTMLElement>('.hunk-stage-btn');
    if (!stageBtn) return;
    const path = stageBtn.dataset.file!;
    await fetch('/__admin_git/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [path] }),
    });
    await refreshGitState();
    const filePanel = container.querySelector<HTMLElement>('.wt-files')!;
    filePanel.innerHTML = renderFileList(getGitState());
  });

  container.querySelector('.wt-stage-all')?.addEventListener('click', async () => {
    await fetch('/__admin_git/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
    await refreshGitState();
    container.querySelector<HTMLElement>('.wt-files')!.innerHTML = renderFileList(getGitState());
  });
  container.querySelector('.wt-unstage-all')?.addEventListener('click', async () => {
    await fetch('/__admin_git/unstage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
    await refreshGitState();
    container.querySelector<HTMLElement>('.wt-files')!.innerHTML = renderFileList(getGitState());
  });

  container.querySelector('.wt-stash')?.addEventListener('click', async () => {
    await fetch('/__admin_git/stash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'push' }) });
    await refreshGitState();
    container.querySelector<HTMLElement>('.wt-files')!.innerHTML = renderFileList(getGitState());
  });

  container.querySelector('.wt-gen-msg')?.addEventListener('click', async () => {
    const textarea = container.querySelector<HTMLTextAreaElement>('.wt-commit-msg')!;
    textarea.value = '';
    textarea.placeholder = 'Generating...';

    const diffRes = await fetch('/__admin_git/diff?staged=true');
    const diffData = await diffRes.json() as { diff: string };
    const g = getGitState();

    const prompt = `Generate a concise conventional commit message for these staged changes. Use the format: type(scope): description. Types: feat, fix, refactor, chore, docs, test. Keep it under 72 chars for the first line. Branch: ${g.branch}\n\nDiff:\n${diffData.diff.slice(0, 8000)}`;

    await aiInline('commit-msg', prompt, (token) => {
      if (textarea.placeholder === 'Generating...') textarea.placeholder = '';
      textarea.value += token;
    });
  });

  container.querySelector('.wt-audit')?.addEventListener('click', async () => {
    const btn = container.querySelector<HTMLElement>('.wt-audit')!;
    const diffRes = await fetch('/__admin_git/diff?staged=true');
    const diffData = await diffRes.json() as { diff: string };

    const popover = createPopover({
      anchor: btn,
      title: 'Pre-commit Audit',
    });

    await aiInline('audit', `Audit these staged changes for issues. Check for: new "as any" casts, empty catch blocks, console.log statements, removed test assertions, security concerns, convention violations. Format each finding as: SEVERITY (CRITICAL/WARNING/NOTE) | file:line | description.\n\nDiff:\n${diffData.diff.slice(0, 8000)}`, (token) => popover.appendToken(token));
  });

  container.querySelector('.wt-commit-btn')?.addEventListener('click', async () => {
    const textarea = container.querySelector<HTMLTextAreaElement>('.wt-commit-msg')!;
    const msg = textarea.value.trim();
    if (!msg) { textarea.style.borderColor = 'var(--red-bright,#d45234)'; return; }

    const res = await fetch('/__admin_git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    });
    const data = await res.json() as { ok: boolean; sha?: string; error?: string };
    if (data.ok) {
      textarea.value = '';
      await refreshGitState();
      container.querySelector<HTMLElement>('.wt-files')!.innerHTML = renderFileList(getGitState());
      container.querySelector<HTMLElement>('.wt-diff')!.innerHTML = '<p style="color:var(--green);">\u2713 Committed ' + escapeHtml(data.sha ?? '') + '</p>';
    } else {
      textarea.style.borderColor = 'var(--red-bright,#d45234)';
    }
  });

  container.querySelector('.wt-commit-push')?.addEventListener('click', async () => {
    const textarea = container.querySelector<HTMLTextAreaElement>('.wt-commit-msg')!;
    const msg = textarea.value.trim();
    if (!msg) { textarea.style.borderColor = 'var(--red-bright,#d45234)'; return; }

    const commitRes = await fetch('/__admin_git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    });
    const commitData = await commitRes.json() as { ok: boolean; sha?: string };
    if (!commitData.ok) { textarea.style.borderColor = 'var(--red-bright,#d45234)'; return; }

    const pushRes = await fetch('/__admin_git/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setUpstream: true }),
    });
    const pushData = await pushRes.json() as { ok: boolean };

    textarea.value = '';
    await refreshGitState();
    container.querySelector<HTMLElement>('.wt-files')!.innerHTML = renderFileList(getGitState());
    const status = pushData.ok ? '\u2713 Committed & Pushed' : '\u2713 Committed (push failed)';
    container.querySelector<HTMLElement>('.wt-diff')!.innerHTML = `<p style="color:var(--green);">${status} ${escapeHtml(commitData.sha ?? '')}</p>`;
  });

  container.querySelector('.wt-review')?.addEventListener('click', async () => {
    const diffRes = await fetch('/__admin_git/diff-branch');
    const diffData = await diffRes.json() as { diff: string };
    const g = getGitState();
    await aiFlyout('code-review', `Code Review: ${g.branch}`,
      `Review the following branch diff for the Luminal project. Check for:\n- Bugs and logic errors\n- Convention violations (TypeScript strict, no as-any, conventional commits)\n- Missing error handling at system boundaries\n- Removed tests or weakened assertions\n- Security concerns\n\nBranch: ${g.branch}\nDiff:\n${diffData.diff.slice(0, 15000)}`
    );
  });

  container.querySelector('.wt-radar')?.addEventListener('click', async () => {
    const btn = container.querySelector<HTMLElement>('.wt-radar')!;
    const diffRes = await fetch('/__admin_git/diff-branch');
    const diffData = await diffRes.json() as { diff: string };

    const popover = createPopover({ anchor: btn, title: 'Regression Radar' });
    await aiInline('radar', `Analyze this diff for potential regressions. Look for:\n- Removed test assertions\n- Changed return types or function signatures\n- Modified default values\n- Altered public API surface\n- Deleted error handling\nFormat: SEVERITY | file:line | what regressed\n\nDiff:\n${diffData.diff.slice(0, 8000)}`, (token) => popover.appendToken(token));
  });
}

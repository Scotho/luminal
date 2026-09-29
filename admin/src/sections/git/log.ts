// admin/src/sections/git/log.ts — Commit history with graph and AI actions
import { escapeHtml } from '../../ui/render';
import { getGitState } from '../git';
import { parseDiff, renderFileDiff } from './diffRenderer';
import { createPopover } from './hunkPopover';
import { modelToggle, wireModelToggles, aiInline, aiFlyout } from './aiActions';

interface Commit {
  hash: string; short: string; message: string;
  author: string; relDate: string; parents: string; refs: string;
}

export async function renderLog(container: HTMLElement): Promise<void> {
  container.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Loading commits...</p>';

  const g = getGitState();
  let commits: Commit[] = [];

  try {
    const res = await fetch(`/__admin_git/log?limit=50&branch=${encodeURIComponent(g.branch)}`);
    const data = await res.json() as { commits: Commit[]; graph: string };
    commits = data.commits ?? [];
  } catch {
    container.innerHTML = '<p style="color:var(--red-bright,#d45234);padding:20px;">Failed to load log</p>';
    return;
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
        <input class="log-search" placeholder="\uD83D\uDD0D Search commits..." style="
          flex:1;min-width:150px;background:var(--bg);border:1px solid var(--border);border-radius:3px;
          color:var(--text);font-size:12px;padding:4px 8px;font-family:inherit;
        "/>
        <button class="log-narrative admin-btn admin-btn--small" style="color:var(--accent);border-color:var(--accent);">Summarize Branch</button>
        ${modelToggle('narrative')}
      </div>
      <div class="log-list" style="flex:1;overflow-y:auto;font-size:12px;">
        ${commits.map(c => renderCommitRow(c)).join('')}
      </div>
      <div class="log-detail" style="display:none;border-top:1px solid var(--border);overflow-y:auto;max-height:50%;"></div>
    </div>`;

  wireModelToggles(container);
  wireLogEvents(container, commits);
}

function authorInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function renderCommitRow(c: Commit): string {
  const refBadges = c.refs ? c.refs.split(',').filter(Boolean).map(r =>
    `<span style="font-size:9px;padding:1px 5px;border-radius:2px;background:rgba(110,224,240,0.1);color:var(--accent);margin-left:4px;">${escapeHtml(r.trim())}</span>`
  ).join('') : '';

  return `
    <div class="log-row" data-sha="${c.hash}" style="
      display:flex;align-items:center;gap:10px;padding:8px 12px;
      border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.1s;
    ">
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent);min-width:60px;">${escapeHtml(c.short)}</span>
      <div style="flex:1;overflow:hidden;">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);">
          ${escapeHtml(c.message)}${refBadges}
        </div>
      </div>
      <span style="
        width:24px;height:24px;border-radius:50%;background:var(--bg-hover);
        display:flex;align-items:center;justify-content:center;font-size:9px;
        font-weight:700;color:var(--text-dim);flex-shrink:0;
      ">${authorInitials(c.author)}</span>
      <span style="font-size:11px;color:var(--text-dim);min-width:60px;text-align:right;">${escapeHtml(c.relDate)}</span>
    </div>`;
}

async function showCommitDetail(container: HTMLElement, sha: string): Promise<void> {
  const detail = container.querySelector<HTMLElement>('.log-detail')!;
  detail.style.display = 'block';
  detail.innerHTML = '<p style="color:var(--text-dim);padding:12px;">Loading commit...</p>';

  try {
    const showRes = await fetch(`/__admin_git/show?sha=${sha}`);
    const showData = await showRes.json() as { show: string; stat: string };

    const lines = showData.show.split('\n');
    const shortSha = sha.slice(0, 7);
    const message = lines[0] ?? '';
    const patch = showData.show.includes('diff --git') ? showData.show.slice(showData.show.indexOf('diff --git')) : '';
    const stat = (showData.stat ?? '').trim();

    const diffFiles = parseDiff(patch);

    detail.innerHTML = `
      <div style="padding:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent);">${escapeHtml(shortSha)}</span>
          <button class="log-detail-close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:14px;">\u2715</button>
        </div>
        <div style="font-weight:700;color:var(--text);margin-bottom:4px;">${escapeHtml(message)}</div>
        ${stat ? `<pre style="font-size:10px;color:var(--text-dim);background:var(--bg);padding:8px;border-radius:3px;margin-bottom:12px;overflow-x:auto;">${escapeHtml(stat)}</pre>` : ''}
        <div style="border:1px solid rgba(110,224,240,0.2);border-radius:4px;padding:10px;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">AI Actions</span>
            <div style="flex:1;"></div>
            ${modelToggle('commit-ai')}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="log-ai-btn admin-btn admin-btn--small" data-action="explain" data-sha="${sha}">Explain</button>
            <button class="log-ai-btn admin-btn admin-btn--small" data-action="issues" data-sha="${sha}">Find Issues</button>
            <button class="log-ai-btn admin-btn admin-btn--small" data-action="test" data-sha="${sha}" style="color:var(--green);border-color:var(--green);">Write Test</button>
            <button class="log-ai-btn admin-btn admin-btn--small" data-action="continue" data-sha="${sha}" style="color:var(--purple,#aa64ff);border-color:var(--purple,#aa64ff);">Continue This Work</button>
          </div>
        </div>
        <details style="margin-top:8px;">
          <summary style="cursor:pointer;font-size:11px;color:var(--accent);">View Full Diff (${diffFiles.length} files)</summary>
          <div style="margin-top:8px;">
            ${diffFiles.map(f => renderFileDiff(f, { showAIButton: true })).join('<div style="height:8px;"></div>')}
          </div>
        </details>
      </div>`;

    wireModelToggles(detail);

    detail.querySelector('.log-detail-close')?.addEventListener('click', () => {
      detail.style.display = 'none';
      detail.innerHTML = '';
    });

    detail.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.log-ai-btn');
      if (!btn) return;
      const action = btn.dataset.action!;

      if (action === 'explain') {
        const popover = createPopover({ anchor: btn, title: 'Commit Explanation' });
        await aiInline('commit-ai', `Explain what this commit does and why, concisely:\n\nMessage: ${message}\n\nDiff:\n${patch.slice(0, 6000)}`, (t) => popover.appendToken(t));
      } else if (action === 'issues') {
        const popover = createPopover({ anchor: btn, title: 'Potential Issues' });
        await aiInline('commit-ai', `Find any bugs, regressions, or concerns in this commit. Rate each by severity.\n\nMessage: ${message}\n\nDiff:\n${patch.slice(0, 6000)}`, (t) => popover.appendToken(t));
      } else if (action === 'test') {
        await aiFlyout('commit-ai', `Write Test: ${shortSha}`, `Generate tests for the changes in this commit:\n\nMessage: ${message}\n\nDiff:\n${patch.slice(0, 8000)}\n\nWrite Vitest tests. Read the modified files for full context.`);
      } else if (action === 'continue') {
        await aiFlyout('commit-ai', `Continue: ${shortSha}`, `This commit started work on: ${message}\n\nDiff:\n${patch.slice(0, 8000)}\n\nContinue this implementation. Read the relevant files and pick up where this left off.`);
      }
    });
  } catch {
    detail.innerHTML = '<p style="color:var(--red-bright,#d45234);padding:12px;">Failed to load commit</p>';
  }
}

function wireLogEvents(container: HTMLElement, commits: Commit[]): void {
  container.querySelector('.log-list')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.log-row');
    if (row?.dataset.sha) void showCommitDetail(container, row.dataset.sha);
  });

  const search = container.querySelector<HTMLInputElement>('.log-search');
  search?.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    const rows = container.querySelectorAll<HTMLElement>('.log-row');
    rows.forEach((row) => {
      const sha = row.dataset.sha ?? '';
      const commit = commits.find(c => c.hash === sha);
      const match = !q || (commit && (
        commit.message.toLowerCase().includes(q) ||
        commit.short.includes(q) ||
        commit.author.toLowerCase().includes(q)
      ));
      row.style.display = match ? '' : 'none';
    });
  });

  container.querySelector('.log-narrative')?.addEventListener('click', async () => {
    const g = getGitState();
    const [logRes, diffRes] = await Promise.all([
      fetch(`/__admin_git/log?limit=30&branch=${encodeURIComponent(g.branch)}`),
      fetch('/__admin_git/diff-branch'),
    ]);
    const [logData, diffData] = await Promise.all([
      logRes.json() as Promise<{ commits: Commit[] }>,
      diffRes.json() as Promise<{ diff: string }>,
    ]);

    const commitList = (logData.commits ?? []).map((c: Commit) => `- ${c.short} ${c.message}`).join('\n');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;width:90%;max-width:700px;max-height:80vh;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);">
          <span style="font-weight:700;color:var(--text-heading);flex:1;">Branch Narrative: ${escapeHtml(g.branch)}</span>
          <button class="narrative-close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:16px;">\u2715</button>
        </div>
        <div class="narrative-body" style="flex:1;overflow-y:auto;padding:16px;font-size:12px;line-height:1.7;white-space:pre-wrap;color:var(--text);">
          <span style="color:var(--text-dim);">Generating narrative...</span>
        </div>
        <div style="display:flex;gap:6px;padding:10px 16px;border-top:1px solid var(--border);">
          <button class="narrative-copy admin-btn admin-btn--small">Copy All</button>
          <button class="narrative-copy-pr admin-btn admin-btn--small" style="color:var(--accent);border-color:var(--accent);">Copy as PR Description</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const body = overlay.querySelector<HTMLElement>('.narrative-body')!;
    let fullText = '';

    overlay.querySelector('.narrative-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.narrative-copy')?.addEventListener('click', () => void navigator.clipboard.writeText(fullText));
    overlay.querySelector('.narrative-copy-pr')?.addEventListener('click', () => void navigator.clipboard.writeText(fullText));

    await aiInline('narrative', `Summarize this branch for a PR description. Include: what was built, files affected, and a ready-to-paste PR description with ## Summary and ## Test plan sections.\n\nBranch: ${g.branch}\n\nCommits:\n${commitList}\n\nDiff (truncated):\n${diffData.diff.slice(0, 10000)}`, (token) => {
      if (body.querySelector('span')) body.innerHTML = '';
      fullText += token;
      body.textContent = fullText;
    });
  });
}

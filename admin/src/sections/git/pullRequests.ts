// admin/src/sections/git/pullRequests.ts — PRs tab (absorbs pulls.ts)
import { escapeHtml } from '../../ui/render';
import { dispatchCC } from '../../ui/ccPanel';
import { getGitState } from '../git';
import { modelToggle, wireModelToggles, aiFlyout, aiInline } from './aiActions';

interface PR {
  number: number; title: string; state: string; merged_at: string | null;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string }; base: { ref: string };
  created_at: string; updated_at: string; html_url: string;
  body: string | null; draft: boolean;
}

export async function renderPullRequests(container: HTMLElement): Promise<void> {
  container.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Loading PRs...</p>';

  let pulls: PR[] = [];
  try {
    const res = await fetch('/__admin_ci/pulls');
    const raw = await res.json() as unknown;
    pulls = Array.isArray(raw) ? raw as PR[] : [];
  } catch {
    container.innerHTML = '<p style="color:var(--red-bright,#d45234);padding:20px;">Failed to load PRs</p>';
    return;
  }

  const openPRs = pulls.filter(p => p.state === 'open');
  const closedPRs = pulls.filter(p => p.state !== 'open');

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
        <button class="pr-filter active" data-filter="open" style="font-size:11px;padding:3px 10px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:var(--bg-hover);color:var(--text);font-family:inherit;">Open (${openPRs.length})</button>
        <button class="pr-filter" data-filter="closed" style="font-size:11px;padding:3px 10px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:transparent;color:var(--text-dim);font-family:inherit;">Closed</button>
        <button class="pr-filter" data-filter="all" style="font-size:11px;padding:3px 10px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:transparent;color:var(--text-dim);font-family:inherit;">All</button>
        <div style="flex:1;"></div>
        <button class="pr-create-btn admin-btn admin-btn--small" style="color:var(--green);border-color:var(--green);">+ Create PR</button>
        <button class="pr-review-btn admin-btn admin-btn--small" style="color:var(--accent);border-color:var(--accent);">Request AI Review</button>
        ${modelToggle('pr-review')}
      </div>
      <div class="pr-create-form" style="display:none;padding:12px;border-bottom:1px solid var(--border);background:var(--bg-surface);">
        <input class="pr-title-input" placeholder="PR Title" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:12px;padding:6px 8px;font-family:inherit;box-sizing:border-box;margin-bottom:6px;" />
        <textarea class="pr-body-input" placeholder="Description (markdown)" style="width:100%;min-height:60px;background:var(--bg);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:12px;padding:6px 8px;font-family:inherit;box-sizing:border-box;resize:vertical;margin-bottom:6px;"></textarea>
        <div style="display:flex;align-items:center;gap:8px;">
          <select class="pr-base-select" style="background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:12px;padding:4px 8px;border-radius:3px;">
            <option value="main">main</option>
          </select>
          <label style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:4px;">
            <input type="checkbox" class="pr-draft-check" /> Draft
          </label>
          <div style="flex:1;"></div>
          <button class="pr-gen-desc admin-btn admin-btn--small" style="color:var(--accent);border-color:var(--accent);">Generate Description</button>
          <button class="pr-submit admin-btn admin-btn--small" style="color:var(--green);border-color:var(--green);font-weight:700;">Create</button>
        </div>
      </div>
      <div class="pr-list" style="flex:1;overflow-y:auto;font-size:12px;">
        ${openPRs.map(pr => renderPRRow(pr)).join('')}
      </div>
      <div class="pr-detail" style="display:none;border-top:1px solid var(--border);overflow-y:auto;max-height:50%;"></div>
    </div>`;

  wireModelToggles(container);
  wirePREvents(container, pulls, openPRs, closedPRs);
}

function renderPRRow(pr: PR): string {
  const merged = !!pr.merged_at;
  const stateColor = merged ? 'var(--purple,#aa64ff)' : pr.state === 'open' ? 'var(--green)' : 'var(--red-bright,#d45234)';
  const stateLabel = merged ? 'Merged' : pr.state === 'open' ? 'Open' : 'Closed';
  const icon = merged ? '\u2705' : pr.state === 'open' ? '\uD83D\uDFE2' : '\uD83D\uDD34';

  return `
    <div class="pr-row" data-pr="${pr.number}" style="
      padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;
      display:flex;align-items:center;gap:10px;transition:background 0.1s;
    ">
      <span style="font-size:14px;">${icon}</span>
      <div style="flex:1;overflow:hidden;">
        <div style="font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          #${pr.number} ${escapeHtml(pr.title)}${pr.draft ? ' <span style="color:var(--text-dim);font-size:10px;">[DRAFT]</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text-dim);">${escapeHtml(pr.head.ref)} \u2192 ${escapeHtml(pr.base.ref)} \u00B7 ${escapeHtml(pr.user.login)}</div>
      </div>
      <span style="color:${stateColor};font-size:11px;font-weight:700;">${stateLabel}</span>
    </div>`;
}

function wirePREvents(container: HTMLElement, pulls: PR[], openPRs: PR[], closedPRs: PR[]): void {
  container.addEventListener('click', (e) => {
    const filter = (e.target as HTMLElement).closest<HTMLElement>('.pr-filter');
    if (!filter?.dataset.filter) return;
    container.querySelectorAll('.pr-filter').forEach(b => {
      (b as HTMLElement).style.background = 'transparent';
      (b as HTMLElement).style.color = 'var(--text-dim)';
    });
    filter.style.background = 'var(--bg-hover)';
    filter.style.color = 'var(--text)';

    const list = container.querySelector<HTMLElement>('.pr-list')!;
    const f = filter.dataset.filter;
    const filtered = f === 'open' ? openPRs : f === 'closed' ? closedPRs : pulls;
    list.innerHTML = filtered.map(pr => renderPRRow(pr)).join('');
  });

  container.querySelector('.pr-list')?.addEventListener('click', async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.pr-row');
    if (!row?.dataset.pr) return;
    const prNum = parseInt(row.dataset.pr);
    const pr = pulls.find(p => p.number === prNum);
    if (!pr) return;
    await showPRDetail(container, pr);
  });

  container.querySelector('.pr-create-btn')?.addEventListener('click', () => {
    const form = container.querySelector<HTMLElement>('.pr-create-form')!;
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    const g = getGitState();
    const titleInput = container.querySelector<HTMLInputElement>('.pr-title-input')!;
    if (!titleInput.value) titleInput.value = g.branch.replace(/[-_]/g, ' ').replace(/^feat\/|fix\/|chore\//i, '');
  });

  container.querySelector('.pr-submit')?.addEventListener('click', async () => {
    const title = container.querySelector<HTMLInputElement>('.pr-title-input')!.value.trim();
    const body = container.querySelector<HTMLTextAreaElement>('.pr-body-input')!.value;
    const base = container.querySelector<HTMLSelectElement>('.pr-base-select')!.value;
    const draft = container.querySelector<HTMLInputElement>('.pr-draft-check')!.checked;
    if (!title) return;

    const res = await fetch('/__admin_git/create-pr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, base, draft }),
    });
    const data = await res.json() as { ok: boolean; url?: string };
    if (data.ok && data.url) {
      window.open(data.url, '_blank');
      void renderPullRequests(container);
    }
  });

  container.querySelector('.pr-gen-desc')?.addEventListener('click', async () => {
    const textarea = container.querySelector<HTMLTextAreaElement>('.pr-body-input')!;
    textarea.value = '';
    textarea.placeholder = 'Generating...';
    const g = getGitState();
    const diffRes = await fetch('/__admin_git/diff-branch');
    const diffData = await diffRes.json() as { diff: string };
    await aiInline('narrative', `Generate a PR description with ## Summary (bullet points) and ## Test plan sections for branch ${g.branch}.\n\nDiff:\n${diffData.diff.slice(0, 10000)}`, (token) => {
      if (textarea.placeholder === 'Generating...') textarea.placeholder = '';
      textarea.value += token;
    });
  });

  container.querySelector('.pr-review-btn')?.addEventListener('click', async () => {
    const g = getGitState();
    const diffRes = await fetch('/__admin_git/diff-branch');
    const diffData = await diffRes.json() as { diff: string };
    await aiFlyout('pr-review', `Code Review: ${g.branch}`,
      `Review this branch diff. Check for bugs, style issues, missing tests, and convention violations.\n\nBranch: ${g.branch}\nDiff:\n${diffData.diff.slice(0, 15000)}`
    );
  });
}

async function showPRDetail(container: HTMLElement, pr: PR): Promise<void> {
  const detail = container.querySelector<HTMLElement>('.pr-detail')!;
  detail.style.display = 'block';
  detail.innerHTML = '<p style="color:var(--text-dim);padding:12px;">Loading...</p>';

  const [reviewsRes, commentsRes, issueRes] = await Promise.allSettled([
    fetch(`/__admin_ci/pull/reviews?number=${pr.number}`).then(r => r.ok ? r.json() : []),
    fetch(`/__admin_ci/pull/comments?number=${pr.number}`).then(r => r.ok ? r.json() : []),
    fetch(`/__admin_ci/issue/comments?number=${pr.number}`).then(r => r.ok ? r.json() : []),
  ]);

  interface Comment { id: number; user: string; body: string; date: string; path?: string; isAI: boolean }
  const AI_PATTERNS = /chatgpt|openai|copilot|github-actions|coderabbit|\[bot\]/i;
  const timeline: Comment[] = [];

  type ReviewAPI = { id: number; user: { login: string }; body: string | null; submitted_at: string };
  type CommentAPI = { id: number; user: { login: string }; body: string; path: string; created_at: string };
  type IssueCommentAPI = { id: number; user: { login: string }; body: string; created_at: string };

  const reviews = (reviewsRes.status === 'fulfilled' ? reviewsRes.value : []) as ReviewAPI[];
  const comments = (commentsRes.status === 'fulfilled' ? commentsRes.value : []) as CommentAPI[];
  const issueComments = (issueRes.status === 'fulfilled' ? issueRes.value : []) as IssueCommentAPI[];

  for (const r of reviews) {
    if (r.body) timeline.push({ id: r.id, user: r.user.login, body: r.body, date: r.submitted_at, isAI: AI_PATTERNS.test(r.user.login) });
  }
  for (const c of comments) {
    timeline.push({ id: c.id, user: c.user.login, body: c.body, date: c.created_at, path: c.path, isAI: AI_PATTERNS.test(c.user.login) });
  }
  for (const c of issueComments) {
    timeline.push({ id: c.id, user: c.user.login, body: c.body, date: c.created_at, isAI: AI_PATTERNS.test(c.user.login) });
  }

  timeline.sort((a, b) => a.date.localeCompare(b.date));

  detail.innerHTML = `
    <div style="padding:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-weight:700;color:var(--text);">#${pr.number}: ${escapeHtml(pr.title)}</span>
        <button class="pr-detail-close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:14px;">\u2715</button>
      </div>
      ${pr.body ? `<div style="font-size:11px;color:var(--text-dim);white-space:pre-wrap;margin-bottom:12px;max-height:100px;overflow-y:auto;">${escapeHtml(pr.body)}</div>` : ''}
      ${timeline.length === 0 ? '<p style="font-size:11px;color:var(--text-dim);">No comments</p>' : timeline.map(c => `
        <div style="padding:8px 10px;border:1px solid ${c.isAI ? 'var(--orange)' : 'var(--border)'};border-left:3px solid ${c.isAI ? 'var(--orange)' : 'var(--border)'};border-radius:4px;margin-bottom:6px;font-size:11px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-weight:700;color:var(--text);">${escapeHtml(c.user)}</span>
            ${c.isAI ? '<span style="font-size:9px;padding:1px 4px;background:rgba(245,158,11,0.15);color:var(--orange);border-radius:2px;">AI</span>' : ''}
            ${c.path ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${escapeHtml(c.path)}</span>` : ''}
          </div>
          <div style="white-space:pre-wrap;color:var(--text);line-height:1.5;">${escapeHtml(c.body)}</div>
          <div style="margin-top:6px;display:flex;gap:4px;">
            <button class="pr-copy-comment admin-btn admin-btn--small" data-body="${escapeHtml(c.body)}" style="font-size:10px;padding:2px 6px;">Copy</button>
            <button class="pr-cc-comment admin-btn admin-btn--small" data-body="${escapeHtml(c.body)}" data-path="${escapeHtml(c.path ?? '')}" data-user="${escapeHtml(c.user)}" data-pr="${pr.number}" style="font-size:10px;padding:2px 6px;color:var(--accent);border-color:var(--accent);">Address in CC</button>
          </div>
        </div>
      `).join('')}
    </div>`;

  detail.querySelector('.pr-detail-close')?.addEventListener('click', () => { detail.style.display = 'none'; detail.innerHTML = ''; });

  detail.addEventListener('click', async (e) => {
    const copyBtn = (e.target as HTMLElement).closest<HTMLElement>('.pr-copy-comment');
    if (copyBtn) { await navigator.clipboard.writeText(copyBtn.dataset.body ?? ''); return; }

    const ccBtn = (e.target as HTMLElement).closest<HTMLElement>('.pr-cc-comment');
    if (ccBtn) {
      let prompt = `Review comment on PR #${ccBtn.dataset.pr}:\n`;
      if (ccBtn.dataset.path) prompt += `File: ${ccBtn.dataset.path}\n`;
      prompt += `From ${ccBtn.dataset.user}:\n${ccBtn.dataset.body}\n\nAddress this review comment.`;
      await dispatchCC(`PR #${ccBtn.dataset.pr} Review`, prompt);
    }
  });
}

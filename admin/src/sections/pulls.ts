import { escapeHtml } from '../ui/render';
import { dispatchCC } from '../ui/ccPanel';
import { icon } from '../ui/icons';

interface PR {
  number: number;
  title: string;
  state: string;        // 'open' | 'closed'
  merged_at: string | null;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  body: string | null;
  draft: boolean;
}

interface ReviewComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  path: string;
  line: number | null;
  created_at: string;
  html_url: string;
  diff_hunk: string;
}

interface Review {
  id: number;
  user: { login: string; avatar_url: string };
  body: string | null;
  state: string;  // 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'
  submitted_at: string;
  html_url: string;
}

interface IssueComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  created_at: string;
  html_url: string;
}

export async function renderPulls(container: HTMLElement): Promise<void> {
  container.innerHTML = `<h2>${icon('git-pull-request', 18)} Pull Requests</h2><p style="color:var(--text-dim);">Loading...</p>`;

  let pulls: PR[] = [];
  try {
    const res = await fetch('/__admin_ci/pulls');
    pulls = await res.json() as PR[];
    if (!Array.isArray(pulls)) { pulls = []; }
  } catch {
    container.innerHTML = `<h2>${icon('git-pull-request', 18)} Pull Requests</h2><p style="color:var(--red-bright,#d45234);">Failed to load PRs</p>`;
    return;
  }

  container.innerHTML = `
    <h2>${icon('git-pull-request', 18)} Pull Requests <button id="pulls-refresh" class="refresh-btn" style="margin-left:auto;">Refresh</button></h2>
    <div id="pulls-list">
      ${pulls.length === 0 ? '<p style="color:var(--text-dim);">No PRs found</p>' : pulls.map(pr => renderPRRow(pr)).join('')}
    </div>
    <div id="pull-detail"></div>
  `;

  document.getElementById('pulls-refresh')?.addEventListener('click', () => renderPulls(container));

  // Use a single delegated handler — replace previous if re-rendered
  if (_containerHandler) container.removeEventListener('click', _containerHandler);
  _containerHandler = async (e: Event) => {
    const row = (e.target as HTMLElement).closest('.pr-row') as HTMLElement;
    if (row?.dataset.prNumber) {
      await showPRDetail(parseInt(row.dataset.prNumber, 10), pulls, container);
    }
  };
  container.addEventListener('click', _containerHandler);
}

let _containerHandler: ((e: Event) => void) | null = null;

function renderPRRow(pr: PR): string {
  const merged = !!pr.merged_at;
  const icon = merged ? '&#9989;' : pr.state === 'open' ? '&#128309;' : '&#128308;';
  const stateColor = merged ? 'var(--purple,#aa64ff)' : pr.state === 'open' ? 'var(--green)' : 'var(--red-bright,#d45234)';
  const stateLabel = merged ? 'Merged' : pr.state === 'open' ? 'Open' : 'Closed';
  const date = new Date(pr.updated_at);
  const time = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;

  return `<div class="pr-row" data-pr-number="${pr.number}" style="padding:10px 12px; border:1px solid var(--border); border-radius:4px; margin-bottom:6px; cursor:pointer; display:flex; align-items:center; gap:10px; font-size:12px; transition:border-color 0.15s;" >
    <span style="font-size:16px;">${icon}</span>
    <div style="flex:1;">
      <div style="font-weight:700; color:var(--text);">#${pr.number} ${escapeHtml(pr.title)}${pr.draft ? ' <span style="color:var(--text-dim); font-size:10px;">[DRAFT]</span>' : ''}</div>
      <div style="font-size:11px; color:var(--text-dim);">${escapeHtml(pr.head.ref)} &rarr; ${escapeHtml(pr.base.ref)} &middot; ${escapeHtml(pr.user.login)}</div>
    </div>
    <span style="color:${stateColor}; font-size:11px; font-weight:700;">${stateLabel}</span>
    <span style="color:var(--text-dim); font-size:11px;">${time}</span>
  </div>`;
}

async function showPRDetail(prNumber: number, pulls: PR[], container: HTMLElement): Promise<void> {
  const detailEl = document.getElementById('pull-detail');
  if (!detailEl) return;
  detailEl.innerHTML = '<p style="color:var(--text-dim);">Loading comments...</p>';

  const pr = pulls.find(p => p.number === prNumber);

  // Fetch all three comment types in parallel — use allSettled to survive partial failures
  const [reviewsResult, commentsResult, issueCommentsResult] = await Promise.allSettled([
    fetch(`/__admin_ci/pull/reviews?number=${prNumber}`).then(r => r.ok ? r.json() : []),
    fetch(`/__admin_ci/pull/comments?number=${prNumber}`).then(r => r.ok ? r.json() : []),
    fetch(`/__admin_ci/issue/comments?number=${prNumber}`).then(r => r.ok ? r.json() : []),
  ]);

  const reviews: Review[] = Array.isArray(reviewsResult.status === 'fulfilled' ? reviewsResult.value : [])
    ? (reviewsResult.status === 'fulfilled' ? reviewsResult.value as Review[] : []) : [];
  const comments: ReviewComment[] = Array.isArray(commentsResult.status === 'fulfilled' ? commentsResult.value : [])
    ? (commentsResult.status === 'fulfilled' ? commentsResult.value as ReviewComment[] : []) : [];
  const issueComments: IssueComment[] = Array.isArray(issueCommentsResult.status === 'fulfilled' ? issueCommentsResult.value : [])
    ? (issueCommentsResult.status === 'fulfilled' ? issueCommentsResult.value as IssueComment[] : []) : [];

  // Detect AI reviewers (ChatGPT, Copilot, bots, [bot] suffix accounts)
  const AI_PATTERNS = /chatgpt|openai|copilot|github-actions|coderabbit|codereview|\[bot\]/i;

  function isAIComment(login: string): boolean {
    return AI_PATTERNS.test(login);
  }

  // Build a unified comment timeline sorted by date
  type UnifiedComment = {
    id: number;
    type: 'review' | 'inline' | 'comment';
    user: string;
    avatar: string;
    body: string;
    path?: string;
    line?: number | null;
    diffHunk?: string;
    state?: string;
    date: string;
    url: string;
    isAI: boolean;
  };

  const timeline: UnifiedComment[] = [];

  for (const r of reviews) {
    if (r.body) {
      timeline.push({
        id: r.id, type: 'review', user: r.user.login, avatar: r.user.avatar_url,
        body: r.body, state: r.state, date: r.submitted_at, url: r.html_url,
        isAI: isAIComment(r.user.login),
      });
    }
  }

  for (const c of comments) {
    timeline.push({
      id: c.id, type: 'inline', user: c.user.login, avatar: c.user.avatar_url,
      body: c.body, path: c.path, line: c.line, diffHunk: c.diff_hunk,
      date: c.created_at, url: c.html_url,
      isAI: isAIComment(c.user.login),
    });
  }

  for (const ic of issueComments) {
    timeline.push({
      id: ic.id, type: 'comment', user: ic.user.login, avatar: ic.user.avatar_url,
      body: ic.body, date: ic.created_at, url: ic.html_url,
      isAI: isAIComment(ic.user.login),
    });
  }

  timeline.sort((a, b) => a.date.localeCompare(b.date));

  // Separate AI comments for prominent display
  const aiComments = timeline.filter(c => c.isAI);
  const humanComments = timeline.filter(c => !c.isAI);

  detailEl.innerHTML = `
    <div style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <h3 style="font-size:14px; color:var(--text-heading); margin:0;">
          PR #${prNumber}: ${pr ? escapeHtml(pr.title) : ''}
        </h3>
        <button class="pr-back-btn refresh-btn" style="font-size:11px;">Close</button>
      </div>

      ${pr?.body ? `<div style="padding:10px 12px; background:var(--bg); border:1px solid var(--border); border-radius:4px; margin-bottom:16px; font-size:12px; line-height:1.6; color:var(--text-dim); white-space:pre-wrap;">${escapeHtml(pr.body)}</div>` : ''}

      ${aiComments.length > 0 ? `
        <div style="margin-bottom:20px;">
          <h4 style="font-size:12px; color:var(--orange); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">
            &#129302; AI Review Comments (${aiComments.length})
          </h4>
          <div style="display:flex; gap:6px; margin-bottom:8px;">
            <button class="refresh-btn pr-copy-all-ai" style="font-size:10px; padding:2px 10px;">Copy All AI Comments</button>
            <button class="refresh-btn pr-cc-all-ai" style="font-size:10px; padding:2px 10px; border-color:var(--accent-dim); color:var(--accent);">Address All in CC</button>
          </div>
          ${aiComments.map(c => renderComment(c, true)).join('')}
        </div>
      ` : ''}

      ${humanComments.length > 0 ? `
        <div>
          <h4 style="font-size:12px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">
            Comments (${humanComments.length})
          </h4>
          ${humanComments.map(c => renderComment(c, false)).join('')}
        </div>
      ` : ''}

      ${timeline.length === 0 ? '<p style="color:var(--text-dim); font-size:12px;">No comments on this PR</p>' : ''}
    </div>
  `;

  // Wire close button
  detailEl.querySelector('.pr-back-btn')?.addEventListener('click', () => {
    detailEl.innerHTML = '';
  });

  // Wire copy + dispatch buttons
  detailEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // Copy comment
    const copyBtn = target.closest('.pr-comment-copy') as HTMLElement;
    if (copyBtn) {
      const commentId = copyBtn.dataset.commentId;
      const comment = timeline.find(c => String(c.id) === commentId);
      if (comment) {
        await navigator.clipboard.writeText(comment.body);
        copyBtn.textContent = '✓ Copied';
        copyBtn.style.color = 'var(--green)';
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.style.color = ''; }, 1200);
      }
      return;
    }

    // Dispatch to CC
    const ccBtn = target.closest('.pr-comment-cc') as HTMLElement;
    if (ccBtn) {
      const commentId = ccBtn.dataset.commentId;
      const comment = timeline.find(c => String(c.id) === commentId);
      if (comment) {
        let prompt = `Review comment on PR #${prNumber}:\n\n`;
        if (comment.path) prompt += `File: ${comment.path}${comment.line ? `:${comment.line}` : ''}\n\n`;
        if (comment.diffHunk) prompt += `Diff context:\n\`\`\`\n${comment.diffHunk}\n\`\`\`\n\n`;
        prompt += `Comment from ${comment.user}:\n<review-comment>\n${comment.body}\n</review-comment>\n\n`;
        prompt += `Please address this review comment:\n1. Read the relevant file(s)\n2. Understand the suggestion\n3. Implement the fix or explain why it shouldn't be changed\n4. If the suggestion is valid, make the code change`;

        await dispatchCC(`PR #${prNumber} Review`, prompt);
      }
      return;
    }

    // Copy all AI comments
    const copyAllBtn = target.closest('.pr-copy-all-ai') as HTMLElement;
    if (copyAllBtn) {
      const allText = aiComments.map(c => {
        let text = `## ${c.user} (${c.type})\n`;
        if (c.path) text += `File: ${c.path}${c.line ? `:${c.line}` : ''}\n`;
        text += `\n${c.body}\n`;
        return text;
      }).join('\n---\n\n');
      await navigator.clipboard.writeText(allText);
      copyAllBtn.textContent = '✓ Copied';
      copyAllBtn.style.color = 'var(--green)';
      setTimeout(() => { copyAllBtn.textContent = 'Copy All AI Comments'; copyAllBtn.style.color = ''; }, 1200);
      return;
    }

    // Dispatch all AI comments to CC
    const ccAllBtn = target.closest('.pr-cc-all-ai') as HTMLElement;
    if (ccAllBtn) {
      let prompt = `Address ALL review comments from AI reviewers on PR #${prNumber}:\n\n`;
      for (const c of aiComments) {
        prompt += `---\n`;
        if (c.path) prompt += `File: ${c.path}${c.line ? `:${c.line}` : ''}\n`;
        prompt += `${c.user}:\n<review-comment>\n${c.body}\n</review-comment>\n\n`;
      }
      prompt += `For each comment:\n1. Read the relevant file\n2. Implement the suggested fix if valid\n3. Skip suggestions that are incorrect or unnecessary, explaining why`;

      await dispatchCC(`PR #${prNumber} AI Review`, prompt);
      return;
    }
  });
}

function renderComment(c: { id: number; type: string; user: string; avatar: string; body: string; path?: string; line?: number | null; diffHunk?: string; state?: string; date: string; url: string; isAI: boolean }, _isAISection: boolean): string {
  const date = new Date(c.date);
  const time = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;

  const typeBadge = c.type === 'review'
    ? `<span style="font-size:9px; padding:1px 6px; border-radius:2px; background:rgba(110,224,240,0.1); color:var(--accent); text-transform:uppercase; letter-spacing:0.5px;">${c.state ?? 'review'}</span>`
    : c.type === 'inline'
    ? `<span style="font-size:9px; padding:1px 6px; border-radius:2px; background:rgba(170,100,255,0.1); color:var(--purple,#aa64ff); text-transform:uppercase; letter-spacing:0.5px;">inline</span>`
    : '';

  const fileLine = c.path
    ? `<div style="font-family:var(--font-mono); font-size:10px; color:var(--accent); margin-bottom:4px;">${escapeHtml(c.path)}${c.line ? `:${c.line}` : ''}</div>`
    : '';

  const diffHunk = c.diffHunk
    ? `<pre style="font-size:10px; font-family:var(--font-mono); background:var(--bg); border:1px solid var(--border); border-radius:3px; padding:6px 8px; margin:4px 0 8px; overflow-x:auto; max-height:120px; color:var(--text-dim);">${escapeHtml(c.diffHunk)}</pre>`
    : '';

  const borderColor = c.isAI ? 'var(--orange)' : 'var(--border)';

  return `<div style="padding:10px 12px; border:1px solid ${borderColor}; border-left:3px solid ${borderColor}; border-radius:4px; margin-bottom:8px; font-size:12px;">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <img src="${escapeHtml(c.avatar || '')}" style="width:20px; height:20px; border-radius:50%; background:var(--bg-hover);" alt="" onerror="this.style.display='none'" />
      <span style="font-weight:700; color:var(--text);">${escapeHtml(c.user)}</span>
      ${typeBadge}
      <span style="color:var(--text-dim); font-size:11px; margin-left:auto;">${time}</span>
      <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener" style="color:var(--accent); font-size:10px;" onclick="event.stopPropagation();">GitHub</a>
    </div>
    ${fileLine}
    ${diffHunk}
    <div style="white-space:pre-wrap; line-height:1.6; color:var(--text);">${escapeHtml(c.body)}</div>
    <div style="margin-top:8px; display:flex; gap:6px;">
      <button class="refresh-btn pr-comment-copy" data-comment-id="${c.id}" style="font-size:10px; padding:2px 8px;">Copy</button>
      <button class="refresh-btn pr-comment-cc" data-comment-id="${c.id}" style="font-size:10px; padding:2px 8px; border-color:var(--accent-dim); color:var(--accent);">Address in CC</button>
    </div>
  </div>`;
}

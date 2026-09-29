import { escapeHtml, statCard } from '../ui/render';
import { dispatchCC } from '../ui/ccPanel';
import { confirmAction } from '../ui/confirm';
import { icon } from '../ui/icons';
import type { PipelineStatus, DeployEntry, CoverageEntry } from '../types';

// ── CI types ─────────────────────────────────────────────
interface WorkflowRun {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  run_number: number;
  event: string;
}

interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
}

// ── AI reviewer detection (shared with pulls.ts) ──────────
const AI_PATTERNS = /chatgpt|openai|copilot|github-actions|coderabbit|codereview|\[bot\]/i;

// ── Sparkline renderer ────────────────────────────────────
const SPARK_CHARS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => {
    const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[idx];
  }).join('');
}

// ── Relative time ─────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Status strip ──────────────────────────────────────────
function renderStatusStrip(status: PipelineStatus): string {
  const buildIcon = status.build
    ? (status.build.conclusion === 'success' ? '<span style="color:var(--green);">&#10003;</span>'
      : status.build.conclusion === 'failure' ? '<span style="color:var(--red-bright);">&#10007;</span>'
      : '<span style="color:var(--orange);">&#9881;</span>')
    : '<span style="color:var(--text-dim);">\u2014</span>';

  const buildLabel = status.build
    ? `BUILD ${buildIcon} #${status.build.runNumber}`
    : 'BUILD \u2014';

  const deployLabel = status.deploy
    ? `LIVE ${escapeHtml(status.deploy.version)}`
    : 'LIVE \u2014';

  const covLabel = status.coverage
    ? `COV ${status.coverage.percent}%`
    : 'COV \u2014';

  const covDelta = status.coverage && status.coverage.delta !== 0
    ? `<span style="color:${status.coverage.delta > 0 ? 'var(--green)' : 'var(--red-bright)'}; font-size:10px;">${status.coverage.delta > 0 ? '+' : ''}${status.coverage.delta}%</span>`
    : '';

  const prLabel = `PRs ${status.prs.open} open`;

  return `<div style="display:flex; gap:16px; padding:10px 14px; background:var(--bg-surface); border:1px solid var(--border); border-radius:4px; font-size:12px; font-family:var(--font-mono); align-items:center; flex-wrap:wrap;">
    <span>${buildLabel}</span>
    <span style="color:var(--border);">|</span>
    <span style="color:var(--gold);">${deployLabel}</span>
    <span style="color:var(--border);">|</span>
    <span>${covLabel} ${covDelta}</span>
    <span style="color:var(--border);">|</span>
    <span>${prLabel}</span>
  </div>`;
}

// ── Deploy history panel ──────────────────────────────────
function renderDeployPanel(deploys: DeployEntry[]): string {
  if (deploys.length === 0) {
    return '<p style="color:var(--text-dim); font-size:12px;">No deploys recorded yet. Run /deploy to start tracking.</p>';
  }

  return deploys.map((d, i) => {
    const isLatest = i === 0;
    const isHosting = d.target.includes('live') || d.target.includes('test') || d.target === 'rollback';
    const targetColor = d.target === 'rollback' ? 'var(--orange)' : d.target.includes('live') ? 'var(--green)' : 'var(--accent)';

    return `<div style="padding:8px 12px; border:1px solid ${isLatest ? 'var(--border-accent)' : 'var(--border)'}; border-radius:4px; margin-bottom:6px; font-size:12px; display:flex; align-items:center; gap:10px;">
      <div style="flex:1;">
        <div>
          <span style="font-weight:700; color:${isLatest ? 'var(--gold)' : 'var(--text)'};">${escapeHtml(d.version)}</span>
          <span style="color:${targetColor}; font-size:10px; margin-left:6px;">${escapeHtml(d.target)}</span>
        </div>
        <div style="font-size:11px; color:var(--text-dim);">
          ${escapeHtml(d.commit)} &middot; ${escapeHtml(d.branch)} &middot; ${relativeTime(d.timestamp)} &middot; ${Math.round(d.duration)}s
        </div>
      </div>
      ${isHosting && !isLatest ? `<button class="refresh-btn pipeline-rollback" data-version="${escapeHtml(d.version)}" data-commit="${escapeHtml(d.commit)}" style="font-size:10px; padding:2px 8px; color:var(--orange); border-color:var(--orange);">Rollback</button>` : ''}
    </div>`;
  }).join('');
}

// ── Coverage trend panel ──────────────────────────────────
function renderCoveragePanel(entries: CoverageEntry[]): string {
  if (entries.length === 0) {
    return '<p style="color:var(--text-dim); font-size:12px;">No coverage data yet. Run npm run test:coverage to start tracking.</p>';
  }

  const latest = entries[entries.length - 1];
  const prev = entries.length > 1 ? entries[entries.length - 2] : null;
  const delta = prev ? Math.round((latest.coverage - prev.coverage) * 10) / 10 : 0;
  const deltaStr = delta !== 0
    ? `<span style="color:${delta > 0 ? 'var(--green)' : 'var(--red-bright)'};">${delta > 0 ? '+' : ''}${delta}%</span>`
    : '';

  const covValues = entries.map(e => e.coverage);
  const testValues = entries.map(e => e.testCount ?? 0);

  return `
    <div style="font-size:24px; font-weight:700; color:var(--accent); margin-bottom:4px;">
      ${latest.coverage}% ${deltaStr}
    </div>
    <div style="font-family:var(--font-mono); font-size:14px; letter-spacing:1px; color:var(--accent); margin-bottom:8px;">
      ${sparkline(covValues)}
    </div>
    <div style="font-size:12px; color:var(--text-dim); margin-bottom:4px;">
      ${latest.testCount ?? '?'} tests
      <span style="font-family:var(--font-mono); font-size:11px; letter-spacing:1px; margin-left:8px; color:var(--text-quiet);">${sparkline(testValues)}</span>
    </div>
    <div style="font-size:10px; color:var(--text-quiet);">(last ${entries.length} runs)</div>
  `;
}

// ── AI Review summary panel ───────────────────────────────
async function fetchAIReviewSummary(): Promise<{ prNumber: number; title: string; aiComments: number; unaddressed: number }[]> {
  try {
    const pullsRes = await fetch('/__admin_ci/pulls');
    const pulls = await pullsRes.json() as Array<{ number: number; title: string; state: string; head: { sha: string } }>;
    const openPRs = pulls.filter(p => p.state === 'open');

    const summaries: { prNumber: number; title: string; aiComments: number; unaddressed: number }[] = [];

    for (const pr of openPRs.slice(0, 5)) {
      const [reviewsRes, commentsRes, issueRes] = await Promise.all([
        fetch(`/__admin_ci/pull/reviews?number=${pr.number}`).then(r => r.ok ? r.json() : []),
        fetch(`/__admin_ci/pull/comments?number=${pr.number}`).then(r => r.ok ? r.json() : []),
        fetch(`/__admin_ci/issue/comments?number=${pr.number}`).then(r => r.ok ? r.json() : []),
      ]);

      const allComments = [
        ...(Array.isArray(reviewsRes) ? reviewsRes : []).filter((r: { body?: string }) => r.body),
        ...(Array.isArray(commentsRes) ? commentsRes : []),
        ...(Array.isArray(issueRes) ? issueRes : []),
      ];

      const aiComments = allComments.filter((c: { user?: { login?: string } }) =>
        c.user?.login && AI_PATTERNS.test(c.user.login)
      );

      if (aiComments.length > 0) {
        const approvedReviews = (Array.isArray(reviewsRes) ? reviewsRes : []).filter(
          (r: { state?: string }) => r.state === 'APPROVED' || r.state === 'DISMISSED'
        );
        const isResolved = approvedReviews.length > 0;

        summaries.push({
          prNumber: pr.number,
          title: pr.title,
          aiComments: aiComments.length,
          unaddressed: isResolved ? 0 : aiComments.length,
        });
      }
    }

    return summaries;
  } catch {
    return [];
  }
}

function renderAIReviewPanel(summaries: { prNumber: number; title: string; aiComments: number; unaddressed: number }[]): string {
  if (summaries.length === 0) {
    return '<p style="color:var(--text-dim); font-size:12px;">No AI review comments on open PRs</p>';
  }

  const totalUnaddressed = summaries.reduce((sum, s) => sum + s.unaddressed, 0);

  const rows = summaries.map(s => {
    const color = s.unaddressed > 0 ? 'var(--orange)' : 'var(--green)';
    return `<div style="padding:6px 0; border-bottom:1px solid var(--border); font-size:12px; display:flex; justify-content:space-between; align-items:center;">
      <span>
        <span style="font-weight:700; color:var(--text);">#${s.prNumber}</span>
        <span style="color:var(--text-dim); margin-left:6px;">${escapeHtml(s.title.slice(0, 40))}</span>
      </span>
      <span style="color:${color}; font-weight:700; white-space:nowrap; margin-left:12px;">
        ${s.aiComments} comment${s.aiComments !== 1 ? 's' : ''}${s.unaddressed > 0 ? ` (${s.unaddressed} open)` : ''}
      </span>
    </div>`;
  }).join('');

  return `
    ${rows}
    ${totalUnaddressed > 0 ? `
      <div style="margin-top:10px;">
        <button class="refresh-btn pipeline-address-all" style="font-size:10px; padding:4px 12px; border-color:var(--accent-dim); color:var(--accent);">Address All in CC (${totalUnaddressed})</button>
      </div>
    ` : ''}
  `;
}

// ── Sidebar badge for pipeline ───────────────────────────
function updatePipelineBadge(status: PipelineStatus, runs: WorkflowRun[]): void {
  const navItem = document.querySelector('.nav-item[data-section="pipeline"]');
  if (!navItem) return;
  const existing = navItem.querySelector('.nav-badge');
  const badge = (existing || document.createElement('span')) as HTMLElement;
  badge.className = 'nav-badge';

  const inProgress = runs.filter(r => r.status === 'in_progress').length;
  if (inProgress > 0) {
    badge.textContent = `${inProgress} running`;
    badge.style.background = 'var(--orange)';
  } else if (status.build?.conclusion === 'failure') {
    badge.textContent = 'failing';
    badge.style.background = 'var(--red-bright, #d45234)';
  } else if (status.build?.conclusion === 'success') {
    badge.textContent = 'passing';
    badge.style.background = 'var(--green)';
  } else {
    badge.textContent = '';
    badge.style.background = '';
  }
  if (!existing && badge.textContent) navItem.appendChild(badge);
}

// ── CI run row ───────────────────────────────────────────
function renderRunRow(run: WorkflowRun): string {
  const icon = run.conclusion === 'success' ? '&#10003;' : run.conclusion === 'failure' ? '&#10007;' : run.status === 'in_progress' ? '&#9881;' : '&#8226;';
  const color = run.conclusion === 'success' ? 'var(--green)' : run.conclusion === 'failure' ? 'var(--red-bright,#d45234)' : run.status === 'in_progress' ? 'var(--orange)' : 'var(--text-dim)';
  const date = new Date(run.created_at);
  const time = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;

  return `<div class="ci-run-row" data-run-id="${run.id}" data-run-number="${run.run_number}" style="padding:10px 12px; border:1px solid var(--border); border-radius:4px; margin-bottom:6px; cursor:pointer; display:flex; align-items:center; gap:10px; font-size:12px; transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--accent-dim)'" onmouseout="this.style.borderColor='var(--border)'">
    <span style="color:${color}; font-size:16px;">${icon}</span>
    <div style="flex:1;">
      <div style="font-weight:700; color:var(--text);">#${run.run_number} ${escapeHtml(run.name)}</div>
      <div style="font-size:11px; color:var(--text-dim);">${escapeHtml(run.head_branch)} &middot; ${escapeHtml(run.head_sha.slice(0, 7))} &middot; ${escapeHtml(run.event)}</div>
    </div>
    <span style="color:var(--text-dim); font-size:11px;">${time}</span>
    <a href="${escapeHtml(run.html_url)}" target="_blank" rel="noopener" style="color:var(--accent); font-size:11px;" onclick="event.stopPropagation();">GitHub</a>
  </div>`;
}

function renderCISection(runs: WorkflowRun[]): string {
  const recent = runs.slice(0, 10);
  const successCount = recent.filter(r => r.conclusion === 'success').length;
  const failCount = recent.filter(r => r.conclusion === 'failure').length;
  const inProgress = runs.filter(r => r.status === 'in_progress').length;

  return `
    <div style="margin-top:24px;">
      <h3>CI / GitHub Actions</h3>
      <div class="stat-grid" style="margin-bottom:12px;">
        ${statCard(successCount, 'Passed (last 10)')}
        ${statCard(failCount, 'Failed (last 10)')}
        ${statCard(inProgress, 'In Progress')}
        ${statCard(runs.length, 'Total Runs')}
      </div>
      <div id="ci-runs">
        ${runs.length === 0
          ? '<p style="color:var(--text-dim);">No CI runs found. Push to main/develop to trigger.</p>'
          : runs.map(run => renderRunRow(run)).join('')}
      </div>
      <div id="ci-jobs" style="margin-top:16px;"></div>
    </div>
  `;
}

function wireCIEvents(container: HTMLElement): void {
  container.addEventListener('click', async (e) => {
    const row = (e.target as HTMLElement).closest('.ci-run-row') as HTMLElement;
    if (!row?.dataset.runId) return;

    const jobsEl = document.getElementById('ci-jobs')!;
    jobsEl.innerHTML = '<p style="color:var(--text-dim);">Loading jobs...</p>';

    try {
      const jobRes = await fetch(`/__admin_ci/run?id=${row.dataset.runId}`);
      const jobData = await jobRes.json() as { jobs?: Job[] };
      const jobs = jobData.jobs ?? [];

      jobsEl.innerHTML = `
        <h4>Jobs for Run #${escapeHtml(row.dataset.runNumber ?? '')}</h4>
        ${jobs.map(job => {
          const icon = job.conclusion === 'success' ? '&#10003;' : job.conclusion === 'failure' ? '&#10007;' : job.status === 'in_progress' ? '&#9881;' : '&#8226;';
          const color = job.conclusion === 'success' ? 'var(--green)' : job.conclusion === 'failure' ? 'var(--red-bright,#d45234)' : job.status === 'in_progress' ? 'var(--orange)' : 'var(--text-dim)';
          const dur = job.started_at && job.completed_at
            ? Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000) + 's'
            : '\u2014';
          return `<div style="padding:8px 12px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; font-size:12px;">
            <span style="color:${color}; font-size:14px;">${icon}</span>
            <span style="flex:1; font-weight:700;">${escapeHtml(job.name)}</span>
            <span style="color:var(--text-dim);">${dur}</span>
            <a href="${escapeHtml(job.html_url)}" target="_blank" rel="noopener" style="color:var(--accent); font-size:11px;">View</a>
          </div>`;
        }).join('')}
      `;
    } catch {
      jobsEl.innerHTML = '<p style="color:var(--red-bright,#d45234);">Failed to load jobs</p>';
    }
  });
}

// ── Main render ───────────────────────────────────────────
export async function renderPipeline(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2>${icon('git-branch', 18)} Pipeline</h2>
    <p style="color:var(--text-dim);">Loading...</p>
  `;

  try {
    const [statusRes, deploysRes, coverageRes, ciRes] = await Promise.all([
      fetch('/__admin_pipeline/status').then(r => r.json()) as Promise<PipelineStatus>,
      fetch('/__admin_pipeline/deploys').then(r => r.json()) as Promise<DeployEntry[]>,
      fetch('/__admin_pipeline/coverage').then(r => r.json()) as Promise<CoverageEntry[]>,
      fetch('/__admin_ci/runs').then(r => r.ok ? r.json() : { workflow_runs: [] }).catch(() => ({ workflow_runs: [] })) as Promise<{ workflow_runs?: WorkflowRun[] }>,
    ]);

    const aiSummaries = await fetchAIReviewSummary();
    const runs = ciRes.workflow_runs ?? [];

    updatePipelineBadge(statusRes, runs);

    container.innerHTML = `
      <h2>${icon('git-branch', 18)} Pipeline</h2>

      ${renderStatusStrip(statusRes)}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
        <div>
          <h3>Deploy History</h3>
          <div id="pipeline-deploys">${renderDeployPanel(deploysRes)}</div>
        </div>
        <div>
          <h3>Coverage Trend</h3>
          ${renderCoveragePanel(coverageRes)}
        </div>
      </div>

      <div style="margin-top:16px;">
        <h3>AI Review Summary</h3>
        <div id="pipeline-ai-reviews">${renderAIReviewPanel(aiSummaries)}</div>
      </div>

      ${renderCISection(runs)}
    `;

    // Wire refresh
    document.getElementById('pipeline-refresh')?.addEventListener('click', () => renderPipeline(container));

    // Wire CI job detail clicks
    wireCIEvents(container);

    // Wire rollback buttons
    container.querySelectorAll<HTMLElement>('.pipeline-rollback').forEach(btn => {
      const version = btn.dataset.version ?? '';
      const commit = btn.dataset.commit ?? '';
      confirmAction(btn, 'Rollback', async () => {
        const res = await fetch('/__admin_pipeline/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version, commit, site: 'luminal-game', confirm: true }),
        });
        const data = await res.json() as { ok: boolean; error?: string };
        if (!data.ok) throw new Error(data.error ?? 'Rollback failed');
      });
    });

    // Wire "Address All in CC"
    container.querySelector('.pipeline-address-all')?.addEventListener('click', () => {
      const totalComments = aiSummaries.reduce((sum, s) => sum + s.unaddressed, 0);
      let prompt = `Address ALL unaddressed AI review comments across open PRs:\n\n`;
      for (const s of aiSummaries) {
        if (s.unaddressed > 0) {
          prompt += `- PR #${s.prNumber}: ${s.title} \u2014 ${s.unaddressed} comments\n`;
        }
      }
      prompt += `\nFor each PR, open the PR Reviews section, read the AI comments, and address them.`;
      void dispatchCC(`AI Reviews (${totalComments})`, prompt);
    });

  } catch (err) {
    container.innerHTML = `
      <h2>${icon('git-branch', 18)} Pipeline</h2>
      <p style="color:var(--red-bright);">Failed to load: ${escapeHtml(String(err))}</p>
      <button id="pipeline-refresh" class="refresh-btn">Retry</button>
    `;
    document.getElementById('pipeline-refresh')?.addEventListener('click', () => renderPipeline(container));
  }
}

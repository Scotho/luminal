// admin/src/sections/git/ciStatus.ts — CI workflow runs (absorbs CI section)
import { escapeHtml } from '../../ui/render';
import { getGitState } from '../git';
import { createPopover } from './hunkPopover';
import { modelToggle, wireModelToggles, aiInline, aiFlyout } from './aiActions';

interface WorkflowRun {
  id: number; name: string; status: string; conclusion: string | null;
  head_branch: string; run_number: number; created_at: string;
  updated_at: string; html_url: string;
  head_commit?: { message?: string };
}

interface Job {
  id: number; name: string; status: string; conclusion: string | null;
  started_at: string; completed_at: string;
}

export async function renderCIStatus(container: HTMLElement): Promise<void> {
  container.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Loading CI...</p>';

  let runs: WorkflowRun[] = [];
  try {
    const res = await fetch('/__admin_ci/runs');
    const data = await res.json() as { workflow_runs?: WorkflowRun[] };
    runs = data.workflow_runs ?? [];
  } catch {
    container.innerHTML = '<p style="color:var(--red-bright,#d45234);padding:20px;">Failed to load CI</p>';
    return;
  }

  const g = getGitState();
  const branchRuns = runs.filter(r => r.head_branch === g.branch);
  const showBranchOnly = branchRuns.length > 0;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
        <button class="ci-filter ${showBranchOnly ? 'active' : ''}" data-filter="branch" style="font-size:11px;padding:3px 10px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:${showBranchOnly ? 'var(--bg-hover)' : 'transparent'};color:${showBranchOnly ? 'var(--text)' : 'var(--text-dim)'};font-family:inherit;">This Branch</button>
        <button class="ci-filter ${!showBranchOnly ? 'active' : ''}" data-filter="all" style="font-size:11px;padding:3px 10px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:${!showBranchOnly ? 'var(--bg-hover)' : 'transparent'};color:${!showBranchOnly ? 'var(--text)' : 'var(--text-dim)'};font-family:inherit;">All Workflows</button>
        <div style="flex:1;"></div>
        <button class="ci-refresh admin-btn admin-btn--small">\u21BB Refresh</button>
      </div>
      <div class="ci-list" style="flex:1;overflow-y:auto;font-size:12px;">
        ${(showBranchOnly ? branchRuns : runs).map(r => renderRunRow(r)).join('')}
      </div>
      <div class="ci-detail" style="display:none;border-top:1px solid var(--border);overflow-y:auto;max-height:50%;"></div>
    </div>`;

  wireModelToggles(container);
  wireCIEvents(container, runs, branchRuns);

  const hasRunning = runs.some(r => r.status === 'in_progress' || r.status === 'queued');
  if (hasRunning) {
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/__admin_ci/runs');
        const data = await res.json() as { workflow_runs?: WorkflowRun[] };
        if (!data.workflow_runs?.some(r => r.status === 'in_progress' || r.status === 'queued')) {
          clearInterval(timer);
        }
        void renderCIStatus(container);
      } catch {
        clearInterval(timer);
      }
    }, 15_000);
  }
}

function renderRunRow(r: WorkflowRun): string {
  const dotColor = r.status === 'in_progress' ? 'var(--orange)' : r.conclusion === 'success' ? 'var(--green)' : 'var(--red-bright,#d45234)';
  const statusDot = r.status === 'in_progress' ? '\u25CB' : r.conclusion === 'success' ? '\u25CF' : '\u25CF';
  const label = r.status === 'in_progress' ? 'running' : r.conclusion ?? r.status;
  const pulse = r.status === 'in_progress' ? 'animation:pulse 1.5s infinite;' : '';

  const date = new Date(r.updated_at);
  const time = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  return `
    <div class="ci-row" data-run="${r.id}" style="
      padding:8px 12px;border-bottom:1px solid var(--border);cursor:pointer;
      display:flex;align-items:center;gap:10px;transition:background 0.1s;
    ">
      <span style="color:${dotColor};font-size:14px;${pulse}">${statusDot}</span>
      <div style="flex:1;overflow:hidden;">
        <div style="font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.name)}</div>
        <div style="font-size:11px;color:var(--text-dim);">${escapeHtml(r.head_branch)} \u00B7 #${r.run_number}</div>
      </div>
      <span style="font-size:11px;color:${dotColor};font-weight:600;">${label}</span>
      <span style="font-size:11px;color:var(--text-dim);">${time}</span>
    </div>`;
}

function wireCIEvents(container: HTMLElement, allRuns: WorkflowRun[], branchRuns: WorkflowRun[]): void {
  container.addEventListener('click', (e) => {
    const filter = (e.target as HTMLElement).closest<HTMLElement>('.ci-filter');
    if (!filter?.dataset.filter) return;
    container.querySelectorAll('.ci-filter').forEach(b => {
      (b as HTMLElement).style.background = 'transparent';
      (b as HTMLElement).style.color = 'var(--text-dim)';
    });
    filter.style.background = 'var(--bg-hover)';
    filter.style.color = 'var(--text)';
    const list = container.querySelector<HTMLElement>('.ci-list')!;
    const filtered = filter.dataset.filter === 'branch' ? branchRuns : allRuns;
    list.innerHTML = filtered.map(r => renderRunRow(r)).join('');
  });

  container.querySelector('.ci-refresh')?.addEventListener('click', () => void renderCIStatus(container));

  container.querySelector('.ci-list')?.addEventListener('click', async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ci-row');
    if (!row?.dataset.run) return;
    const runId = parseInt(row.dataset.run);
    const run = allRuns.find(r => r.id === runId);
    const detail = container.querySelector<HTMLElement>('.ci-detail')!;
    detail.style.display = 'block';
    detail.innerHTML = '<p style="color:var(--text-dim);padding:12px;">Loading jobs...</p>';

    try {
      const res = await fetch(`/__admin_ci/run?id=${runId}`);
      const data = await res.json() as { jobs?: Job[] };
      const jobs = data.jobs ?? [];
      const failed = run?.conclusion === 'failure';

      detail.innerHTML = `
        <div style="padding:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-weight:700;color:var(--text);">${escapeHtml(run?.name ?? '')} #${run?.run_number ?? ''}</span>
            <button class="ci-detail-close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:14px;">\u2715</button>
          </div>
          <div style="margin-bottom:12px;">
            ${jobs.map(j => {
              const jDot = j.conclusion === 'success' ? '\u2713' : j.conclusion === 'failure' ? '\u2715' : j.status === 'in_progress' ? '\u25CB' : '\u25CC';
              const jColor = j.conclusion === 'success' ? 'var(--green)' : j.conclusion === 'failure' ? 'var(--red-bright,#d45234)' : 'var(--text-dim)';
              return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;">
                <span style="color:${jColor};">${jDot}</span>
                <span style="flex:1;color:var(--text);">${escapeHtml(j.name)}</span>
                <span style="color:var(--text-dim);">${j.conclusion ?? j.status}</span>
              </div>`;
            }).join('')}
          </div>
          ${failed ? `
            <div style="border:1px solid rgba(110,224,240,0.2);border-radius:4px;padding:10px;margin-top:8px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">AI Actions</span>
                <div style="flex:1;"></div>
                ${modelToggle('ci-ai')}
              </div>
              <div style="display:flex;gap:6px;">
                <button class="ci-explain admin-btn admin-btn--small">Explain Failure</button>
                <button class="ci-fix admin-btn admin-btn--small" style="color:var(--accent);border-color:var(--accent);">Fix CI</button>
              </div>
            </div>
          ` : ''}
          <a href="${escapeHtml(run?.html_url ?? '')}" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);margin-top:8px;display:inline-block;">View on GitHub \u2197</a>
        </div>`;

      wireModelToggles(detail);
      detail.querySelector('.ci-detail-close')?.addEventListener('click', () => { detail.style.display = 'none'; detail.innerHTML = ''; });

      detail.querySelector('.ci-explain')?.addEventListener('click', async () => {
        const btn = detail.querySelector<HTMLElement>('.ci-explain')!;
        const popover = createPopover({ anchor: btn, title: 'CI Failure Explanation' });
        const failedJobs = jobs.filter(j => j.conclusion === 'failure').map(j => j.name).join(', ');
        await aiInline('ci-ai', `Explain why this CI run failed. Failed jobs: ${failedJobs}. Workflow: ${run?.name}. Branch: ${run?.head_branch}. What likely went wrong and how to fix it?`, (t) => popover.appendToken(t));
      });

      detail.querySelector('.ci-fix')?.addEventListener('click', async () => {
        const failedJobs = jobs.filter(j => j.conclusion === 'failure').map(j => j.name).join(', ');
        await aiFlyout('ci-ai', `Fix CI: ${run?.name ?? ''}`, `CI run failed. Workflow: ${run?.name}. Branch: ${run?.head_branch}. Failed jobs: ${failedJobs}. Read the relevant config and source files, diagnose the failure, and fix it.`);
      });
    } catch {
      detail.innerHTML = '<p style="color:var(--red-bright,#d45234);padding:12px;">Failed to load jobs</p>';
    }
  });
}

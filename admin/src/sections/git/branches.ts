// admin/src/sections/git/branches.ts — Branch management with stale detection
import { escapeHtml } from '../../ui/render';
import { refreshGitState, getGitState } from '../git';
import { createPopover } from './hunkPopover';
import { modelToggle, wireModelToggles, aiInline } from './aiActions';

interface BranchInfo {
  name: string; sha: string; date: string;
  upstream: string | null; track: string | null;
  aheadOfMain?: number; behindMain?: number;
}

export async function renderBranches(container: HTMLElement): Promise<void> {
  container.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Loading branches...</p>';

  let local: BranchInfo[] = [];
  let remote: BranchInfo[] = [];
  const g = getGitState();

  try {
    const res = await fetch('/__admin_git/branches');
    const data = await res.json() as { local: BranchInfo[]; remote: BranchInfo[] };
    local = data.local ?? [];
    remote = data.remote ?? [];
  } catch {
    container.innerHTML = '<p style="color:var(--red-bright,#d45234);padding:20px;">Failed to load branches</p>';
    return;
  }

  let stashList: string[] = [];
  try {
    const stashRes = await fetch('/__admin_git/stash', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    });
    const stashData = await stashRes.json() as { output: string };
    stashList = (stashData.output ?? '').trim().split('\n').filter(Boolean);
  } catch { /* no stash */ }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
        <input class="branch-filter" placeholder="\uD83D\uDD0D Filter branches..." style="
          flex:1;min-width:120px;background:var(--bg);border:1px solid var(--border);border-radius:3px;
          color:var(--text);font-size:12px;padding:4px 8px;font-family:inherit;
        "/>
        <button class="branch-new admin-btn admin-btn--small" style="color:var(--green);border-color:var(--green);">+ New Branch</button>
        <button class="branch-stale admin-btn admin-btn--small" style="color:var(--orange);border-color:var(--orange);">\uD83E\uDDF9 Stale Scan</button>
        ${modelToggle('stale-scan')}
      </div>
      <div class="branch-conflict-banner"></div>
      <div class="branch-list" style="flex:1;overflow-y:auto;font-size:12px;">
        <div style="padding:8px 12px;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;">Local Branches</div>
        ${local.map(b => renderBranchRow(b, g.branch)).join('')}
        ${remote.length > 0 ? `
          <div style="padding:8px 12px;margin-top:12px;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;">Remote Only</div>
          ${remote.map(b => renderBranchRow(b, g.branch)).join('')}
        ` : ''}
      </div>
      ${stashList.length > 0 ? `
        <div class="branch-stash" style="border-top:1px solid var(--border);max-height:200px;overflow-y:auto;">
          <div style="padding:6px 12px;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-dim);text-transform:uppercase;">
            Stash (${stashList.length})
          </div>
          ${stashList.map((s, i) => `
            <div class="stash-row" style="display:flex;align-items:center;gap:8px;padding:5px 12px;font-size:11px;">
              <span style="color:var(--text-dim);font-family:var(--font-mono);">@{${i}}</span>
              <span style="flex:1;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s)}</span>
              <button class="stash-pop admin-btn admin-btn--small" data-idx="${i}" style="font-size:10px;padding:2px 6px;">Pop</button>
              <button class="stash-drop admin-btn admin-btn--small" data-idx="${i}" style="font-size:10px;padding:2px 6px;color:var(--red-bright,#d45234);border-color:var(--red-bright,#d45234);">Drop</button>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;

  wireModelToggles(container);

  try {
    const conflictRes = await fetch('/__admin_git/conflicts');
    const conflictData = await conflictRes.json() as { files: string[] };
    if (conflictData.files.length > 0) {
      const banner = container.querySelector<HTMLElement>('.branch-conflict-banner')!;
      banner.innerHTML = `
        <div style="padding:10px 14px;background:rgba(245,158,11,0.1);border:1px solid var(--orange);border-radius:4px;margin:8px 12px;">
          <div style="font-weight:700;color:var(--orange);margin-bottom:6px;">\u26A0 Merge Conflicts (${conflictData.files.length} files)</div>
          ${conflictData.files.map(f => `
            <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;">
              <span style="color:var(--orange);">\u2715</span>
              <span style="flex:1;font-family:var(--font-mono);color:var(--text);">${escapeHtml(f)}</span>
              <button class="conflict-resolve admin-btn admin-btn--small" data-file="${escapeHtml(f)}" style="font-size:10px;padding:2px 6px;color:var(--accent);border-color:var(--accent);">AI Resolve</button>
            </div>
          `).join('')}
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="conflict-abort admin-btn admin-btn--small" style="color:var(--red-bright,#d45234);border-color:var(--red-bright,#d45234);">Abort Merge</button>
          </div>
        </div>`;
    }
  } catch { /* no conflicts */ }

  wireBranchEvents(container, local, remote);
}

function renderBranchRow(b: BranchInfo, currentBranch: string): string {
  const isCurrent = b.name === currentBranch;
  const isStale = b.date.includes('week') || b.date.includes('month') || b.date.includes('year');
  const star = isCurrent ? '<span style="color:var(--accent);margin-right:4px;">\u2605</span>' : '';
  const staleBadge = isStale && !isCurrent ? '<span style="font-size:9px;color:var(--orange);margin-left:4px;">\u26A0</span>' : '';
  const syncStatus = b.track
    ? `<span style="font-size:10px;color:${b.track.includes('ahead') || b.track.includes('behind') ? 'var(--orange)' : 'var(--green)'};">${b.track || '\u2713'}</span>`
    : '<span style="font-size:10px;color:var(--text-dim);">no remote</span>';

  return `
    <div class="branch-row" data-branch="${escapeHtml(b.name)}" style="
      padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);
      background:${isCurrent ? 'rgba(110,224,240,0.05)' : 'transparent'};
      transition:background 0.1s;
    ">
      <div style="display:flex;align-items:center;gap:8px;">
        ${star}<span style="font-family:var(--font-mono);font-weight:${isCurrent ? '700' : '400'};color:${isCurrent ? 'var(--accent)' : 'var(--text)'};flex:1;">${escapeHtml(b.name)}</span>
        ${staleBadge}
        <span class="branch-ai-badge" data-branch="${escapeHtml(b.name)}" style="display:none;"></span>
        ${b.aheadOfMain !== undefined ? `<span style="font-size:10px;color:var(--text-dim);">${b.aheadOfMain} commits</span>` : ''}
        <span style="font-size:11px;color:var(--text-dim);">${escapeHtml(b.date)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;padding-left:20px;">
        ${syncStatus}
      </div>
      <div class="branch-actions" style="display:none;margin-top:8px;padding-left:20px;gap:6px;flex-wrap:wrap;">
        ${!isCurrent ? `<button class="branch-checkout admin-btn admin-btn--small" data-branch="${escapeHtml(b.name)}">Checkout</button>` : ''}
        ${!isCurrent ? `<button class="branch-merge admin-btn admin-btn--small" data-branch="${escapeHtml(b.name)}">Merge into current</button>` : ''}
        ${!isCurrent ? `<button class="branch-delete admin-btn admin-btn--small" data-branch="${escapeHtml(b.name)}" style="color:var(--red-bright,#d45234);border-color:var(--red-bright,#d45234);">Delete</button>` : ''}
      </div>
    </div>`;
}

function wireBranchEvents(container: HTMLElement, local: BranchInfo[], remote: BranchInfo[]): void {
  container.querySelector('.branch-list')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.branch-row');
    if (!row || (e.target as HTMLElement).closest('button')) return;
    const actions = row.querySelector<HTMLElement>('.branch-actions')!;
    const visible = actions.style.display !== 'none';
    container.querySelectorAll<HTMLElement>('.branch-actions').forEach(a => { a.style.display = 'none'; });
    actions.style.display = visible ? 'none' : 'flex';
  });

  container.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.branch-checkout');
    if (!btn?.dataset.branch) return;
    await fetch('/__admin_git/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: btn.dataset.branch }),
    });
    await refreshGitState();
    void renderBranches(container);
  });

  container.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.branch-merge');
    if (!btn?.dataset.branch) return;
    await fetch('/__admin_git/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: btn.dataset.branch }),
    });
    await refreshGitState();
    void renderBranches(container);
  });

  container.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.branch-delete');
    if (!btn?.dataset.branch) return;
    if (btn.textContent === 'Delete') {
      btn.textContent = 'Confirm?';
      btn.style.background = 'rgba(239,68,68,0.1)';
      setTimeout(() => { btn.textContent = 'Delete'; btn.style.background = ''; }, 3000);
      return;
    }
    await fetch('/__admin_git/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: btn.dataset.branch }),
    });
    await refreshGitState();
    void renderBranches(container);
  });

  container.querySelector('.branch-new')?.addEventListener('click', () => {
    const toolbar = container.querySelector<HTMLElement>('.branch-new')!.parentElement!;
    if (toolbar.querySelector('.new-branch-form')) return;
    toolbar.insertAdjacentHTML('beforeend', `
      <div class="new-branch-form" style="display:flex;gap:6px;align-items:center;width:100%;margin-top:6px;">
        <input class="new-branch-name" placeholder="branch-name" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:3px;color:var(--text);font-size:12px;padding:4px 8px;font-family:var(--font-mono);" />
        <button class="new-branch-create admin-btn admin-btn--small" style="color:var(--green);border-color:var(--green);">Create</button>
      </div>
    `);
    const input = toolbar.querySelector<HTMLInputElement>('.new-branch-name')!;
    input.focus();
    toolbar.querySelector('.new-branch-create')?.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      await fetch('/__admin_git/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: name, create: true }),
      });
      await refreshGitState();
      void renderBranches(container);
    });
  });

  container.addEventListener('click', async (e) => {
    const pop = (e.target as HTMLElement).closest<HTMLElement>('.stash-pop');
    if (pop) {
      await fetch('/__admin_git/stash', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pop', index: parseInt(pop.dataset.idx ?? '0') }),
      });
      await refreshGitState();
      void renderBranches(container);
      return;
    }
    const drop = (e.target as HTMLElement).closest<HTMLElement>('.stash-drop');
    if (drop) {
      await fetch('/__admin_git/stash', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'drop', index: parseInt(drop.dataset.idx ?? '0') }),
      });
      void renderBranches(container);
    }
  });

  container.addEventListener('click', async (e) => {
    if ((e.target as HTMLElement).closest('.conflict-abort')) {
      await fetch('/__admin_git/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abort: true }),
      });
      await refreshGitState();
      void renderBranches(container);
    }
  });

  container.querySelector('.branch-stale')?.addEventListener('click', async () => {
    const btn = container.querySelector<HTMLElement>('.branch-stale')!;
    const popover = createPopover({ anchor: btn, title: 'Stale Branch Analysis' });
    const currentBranch = getGitState().branch;
    const branchNames = local
      .filter(b => b.name !== currentBranch)
      .map(b => `- ${b.name} (${b.date}, ${b.aheadOfMain ?? '?'} commits ahead)`)
      .join('\n');
    await aiInline('stale-scan', `Analyze these branches and recommend an action for each: Merge (complete work), Rebase (still relevant), Archive (superseded), Delete (empty/trivial). One line per branch.\n\nCurrent branch: ${currentBranch}\n\nBranches:\n${branchNames}`, (token) => popover.appendToken(token));
  });

  container.querySelector<HTMLInputElement>('.branch-filter')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    container.querySelectorAll<HTMLElement>('.branch-row').forEach(row => {
      row.style.display = (row.dataset.branch ?? '').toLowerCase().includes(q) ? '' : 'none';
    });
  });

  // Unused param suppression
  void remote;
}

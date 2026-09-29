// admin/src/sections/worktrees.ts — Worktree manager section

import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';

interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
}

async function fetchWorktrees(): Promise<WorktreeEntry[]> {
  const res = await fetch('/__admin_git/worktrees');
  if (!res.ok) throw new Error(`Failed to fetch worktrees: ${res.status}`);
  return (await res.json()) as WorktreeEntry[];
}

async function removeWorktree(path: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/__admin_git/worktree/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

function isMainWorktree(wt: WorktreeEntry): boolean {
  return wt.branch === 'main' || wt.branch === 'master';
}

function renderWorktreeRow(wt: WorktreeEntry, isMain: boolean): string {
  const shortHead = wt.head ? wt.head.slice(0, 7) : '?';
  const removeBtn = isMain
    ? ''
    : `<button class="worktree-remove admin-btn admin-btn--small" data-path="${escapeHtml(wt.path)}" style="background:transparent; border:1px solid var(--border); color:var(--text-dim); font-size:11px; padding:2px 8px; cursor:pointer;">Remove</button>`;
  return `<div class="worktree-row" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border:1px solid var(--border); border-radius:4px; margin-bottom:4px; font-size:12px;">
  <span style="flex:1; font-family:var(--font-mono); word-break:break-all; color:var(--text);">${escapeHtml(wt.path)}</span>
  <span style="font-weight:700; color:var(--accent); white-space:nowrap;">${icon('git-branch', 14)} ${escapeHtml(wt.branch || '(bare)')}</span>
  <code style="color:var(--text-dim); font-size:11px; white-space:nowrap;" title="${escapeHtml(wt.head)}">${escapeHtml(shortHead)}</code>
  ${removeBtn}
</div>`;
}

export async function renderWorktrees(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="padding:4px 0;"><span style="color:var(--text-dim); font-size:12px;">Loading worktrees...</span></div>`;

  async function render(): Promise<void> {
    try {
      const worktrees = await fetchWorktrees();

      if (worktrees.length === 0) {
        container.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:16px;">
            <h2>${icon('git-branch', 18)} Worktrees</h2>
            <div style="color:var(--text-dim); font-size:12px; padding:20px; text-align:center; border:1px dashed var(--border); border-radius:6px;">
              No worktrees found.
            </div>
          </div>`;
        return;
      }

      const rows = worktrees.map(wt => renderWorktreeRow(wt, isMainWorktree(wt))).join('');
      container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <h2>${icon('git-branch', 18)} Worktrees</h2>
            <button id="worktrees-refresh" class="refresh-btn">Refresh</button>
          </div>
          <div id="worktrees-list">${rows}</div>
        </div>`;

      // Wire refresh
      container.querySelector('#worktrees-refresh')?.addEventListener('click', () => void render());

      // Wire remove buttons
      container.querySelectorAll<HTMLButtonElement>('.worktree-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          const wtPath = btn.dataset.path;
          if (!wtPath || !confirm(`Remove worktree at ${wtPath}?`)) return;
          btn.disabled = true;
          btn.textContent = 'Removing...';
          const result = await removeWorktree(wtPath);
          if (result.ok) {
            void render();
          } else {
            alert(`Failed to remove worktree: ${result.error ?? 'unknown error'}`);
            btn.disabled = false;
            btn.textContent = 'Remove';
          }
        });

        // Hover effect
        btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--red)'; btn.style.borderColor = 'var(--red)'; });
        btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--text-dim)'; btn.style.borderColor = 'var(--border)'; });
      });
    } catch (err) {
      container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
          <h2>${icon('git-branch', 18)} Worktrees</h2>
          <div style="color:var(--red); padding:20px;">
            <strong>Error loading worktrees</strong>
            <pre style="font-size:11px; white-space:pre-wrap; margin-top:8px;">${escapeHtml(String(err))}</pre>
          </div>
        </div>`;
    }
  }

  await render();
}

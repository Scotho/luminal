import { escapeHtml, statCard } from '../ui/render';
import { renderNetworkHealth } from '../ui/networkHealth';
import type { ActivityDigest, TestHealth, ModuleMap, HotModule, WorktreeInfo } from '../types';

// ── Pure render helpers ──────────────────────────────────────────────────────

/** Render the 4 top-level stat cards for the Health section. */
export function renderStatCards(digest: ActivityDigest, testHealth: TestHealth): string {
  return `
    <div class="stat-grid">
      ${statCard(testHealth.coverage.total, 'Modules')}
      ${statCard(testHealth.coverage.percent + '%', 'Test Coverage')}
      ${statCard(digest.aheadOfOrigin, 'Commits Ahead')}
      ${statCard(digest.worktrees.length, 'Active Worktrees')}
    </div>
  `;
}

/** Render the hot-modules table (most-changed files). */
export function renderHotModules(modules: HotModule[]): string {
  if (modules.length === 0) {
    return '<p style="color:var(--text-dim);">No data</p>';
  }

  const rows = modules.map(m => {
    let color: string;
    if (m.commits30d > 40) {
      color = 'var(--red)';
    } else if (m.commits30d > 20) {
      color = 'var(--yellow)';
    } else {
      color = 'var(--accent)';
    }
    return `
      <div style="padding:6px 0; border-bottom:1px solid var(--border); font-size:13px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-family:var(--font-mono); color:var(--text-dim); font-size:12px;">${escapeHtml(m.path)}</span>
        <span style="color:${color}; font-weight:600; white-space:nowrap; margin-left:16px;">${m.commits30d} commits</span>
      </div>
    `;
  }).join('');

  return `<div>${rows}</div>`;
}

/** Render the worktrees list. */
export function renderWorktrees(trees: WorktreeInfo[]): string {
  if (trees.length === 0) {
    return '<p style="color:var(--text-dim);">No active worktrees</p>';
  }

  const rows = trees.map(t => `
    <div style="padding:6px 0; border-bottom:1px solid var(--border); font-size:13px; display:flex; justify-content:space-between; align-items:center;">
      <span>
        <strong>${escapeHtml(t.name)}</strong>
        <span style="color:var(--text-dim); margin-left:8px;">${escapeHtml(t.branch)}</span>
      </span>
      <span style="color:${t.behind > 0 ? 'var(--yellow)' : 'var(--text-dim)'}; font-size:12px; white-space:nowrap; margin-left:16px;">
        ${t.behind > 0 ? `${t.behind} behind` : 'up to date'}
      </span>
    </div>
  `).join('');

  return `<div>${rows}</div>`;
}

/** Render a visual heatmap of test coverage across all source modules. */
export function renderCoverageHeatmap(testHealth: TestHealth, moduleMap: ModuleMap | null): string {
  const untestedSet = new Set(testHealth.untested.map(p => p.replace(/\\/g, '/')));

  if (!moduleMap) {
    // Fallback: just show untested list
    if (testHealth.untested.length === 0) return '<p style="color:var(--text-dim);">All modules have test coverage</p>';

    return `<div style="display:flex; flex-wrap:wrap; gap:4px;">
      ${testHealth.untested.slice(0, 60).map(p => {
        const short = p.split('/').pop() ?? p;
        return `<div title="${escapeHtml(p)}" style="padding:3px 8px; font-size:10px; font-family:var(--font-mono); border-radius:2px; background:rgba(176,45,28,0.15); color:var(--red-bright,#d45234); border:1px solid rgba(176,45,28,0.3);">${escapeHtml(short)}</div>`;
      }).join('')}
    </div>`;
  }

  // With module map: show ALL modules as colored tiles
  const allPaths = Object.keys(moduleMap.modules).sort();

  return `<div style="display:flex; flex-wrap:wrap; gap:3px;">
    ${allPaths.map(p => {
      const short = p.split('/').pop() ?? p;
      const info = moduleMap.modules[p];
      const hasCoverage = !untestedSet.has(p);
      const tier = info?.tier ?? 0;

      let bg: string, color: string, border: string;
      if (hasCoverage) {
        bg = 'rgba(60,255,60,0.08)';
        color = 'var(--green)';
        border = 'rgba(60,255,60,0.2)';
      } else {
        // Color intensity by blast radius
        const blast = info?.blastRadius ?? 0;
        if (blast > 20) {
          bg = 'rgba(176,45,28,0.2)';
          color = 'var(--red-bright,#d45234)';
          border = 'rgba(176,45,28,0.4)';
        } else if (blast > 5) {
          bg = 'rgba(255,188,62,0.12)';
          color = 'var(--yellow)';
          border = 'rgba(255,188,62,0.3)';
        } else {
          bg = 'rgba(176,45,28,0.1)';
          color = 'var(--text-dim)';
          border = 'rgba(176,45,28,0.2)';
        }
      }

      return `<div title="${escapeHtml(p)} (tier ${tier}, blast ${info?.blastRadius ?? 0})" style="padding:2px 6px; font-size:9px; font-family:var(--font-mono); border-radius:2px; background:${bg}; color:${color}; border:1px solid ${border}; cursor:default;">${escapeHtml(short)}</div>`;
    }).join('')}
  </div>
  <div style="margin-top:8px; font-size:10px; color:var(--text-dim); display:flex; gap:16px;">
    <span><span style="color:var(--green);">&#9632;</span> Has tests</span>
    <span><span style="color:var(--red-bright,#d45234);">&#9632;</span> No tests (high blast)</span>
    <span><span style="color:var(--yellow);">&#9632;</span> No tests (medium blast)</span>
    <span><span style="color:var(--text-dim);">&#9632;</span> No tests (low blast)</span>
  </div>`;
}

// ── Script runner ────────────────────────────────────────────────────────────

/**
 * POST to run a script synchronously. The server collects all stdout and
 * returns it in the JSON response body as `output`. No EventSource needed.
 */
async function runScript<T>(name: string): Promise<T> {
  const res = await fetch(`/__admin_exec/script?name=${encodeURIComponent(name)}`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `Script "${name}" failed with status ${res.status}`);
  }
  const body = await res.json() as { ok: boolean; output: string };
  try {
    return JSON.parse(body.output) as T;
  } catch {
    throw new Error(`Script "${name}" produced non-JSON output`);
  }
}

// ── Tier breakdown ────────────────────────────────────────────────────────────

function renderTierBreakdown(moduleMap: ModuleMap): string {
  const tierKeys = Object.keys(moduleMap.tiers).map(Number).sort((a, b) => a - b);
  if (tierKeys.length === 0) return '';

  const sections = tierKeys.map(tier => {
    const paths = moduleMap.tiers[tier] || [];
    const items = paths.map(p => {
      const info = moduleMap.modules[p];
      const loc = info ? info.loc : 0;
      return `
        <div style="padding:3px 0; font-size:12px; font-family:var(--font-mono); display:flex; justify-content:space-between;">
          <span style="color:var(--text-dim);">${escapeHtml(p)}</span>
          <span style="color:var(--accent); margin-left:16px; white-space:nowrap;">${loc} LOC</span>
        </div>
      `;
    }).join('');

    return `
      <details style="margin-bottom:8px;">
        <summary style="cursor:pointer; font-size:13px; font-weight:600; padding:4px 0;">
          Tier ${tier}
          <span style="color:var(--text-dim); font-weight:400; margin-left:8px;">${paths.length} modules</span>
        </summary>
        <div style="padding:8px 0 0 16px;">
          ${items || '<span style="color:var(--text-dim); font-size:12px;">No modules</span>'}
        </div>
      </details>
    `;
  }).join('');

  return `
    <div style="margin-top:24px;">
      <h4>Module Tiers</h3>
      ${sections}
    </div>
  `;
}

// ── Refresh button ───────────────────────────────────────────────────────────

function attachRefresh(container: HTMLElement): void {
  setTimeout(() => {
    document.getElementById('health-refresh-btn')?.addEventListener('click', () => {
      void renderHealth(container);
    });
  }, 0);
}

// ── Section entry point ──────────────────────────────────────────────────────

/** Render the Health section into container. Fetches CLI script data. */
export async function renderHealth(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <h2>Project Health</h2>
    <p style="color:var(--text-dim);">Loading...</p>
  `;

  let digest: ActivityDigest;
  let testHealth: TestHealth;
  let moduleMap: ModuleMap | null = null;

  try {
    digest = await runScript<ActivityDigest>('activity-digest');
  } catch (err) {
    container.innerHTML = `
      <h2>Project Health</h2>
      <p style="color:var(--red);">Failed to load activity digest: ${escapeHtml((err as Error).message)}</p>
      <button id="health-refresh-btn" class="refresh-btn">Retry</button>
    `;
    attachRefresh(container);
    return;
  }

  try {
    testHealth = await runScript<TestHealth>('test-health');
  } catch (err) {
    container.innerHTML = `
      <h2>Project Health</h2>
      <p style="color:var(--red);">Failed to load test health: ${escapeHtml((err as Error).message)}</p>
      <button id="health-refresh-btn" class="refresh-btn">Retry</button>
    `;
    attachRefresh(container);
    return;
  }

  try {
    moduleMap = await runScript<ModuleMap>('module-map');
  } catch {
    // module-map failure is non-fatal; tier breakdown will be omitted
  }

  const tierHtml = moduleMap ? renderTierBreakdown(moduleMap) : '';

  container.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h2 style="margin:0;">Project Health</h2>
      <button id="health-refresh-btn" class="refresh-btn">Refresh</button>
    </div>

    ${renderStatCards(digest, testHealth)}

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
      <div>
        <h4>Hot Modules (30d)</h3>
        ${renderHotModules(digest.hotModules)}
      </div>
      <div>
        <h4>Worktrees</h3>
        ${renderWorktrees(digest.worktrees)}
      </div>
    </div>

    <div style="margin-top:20px;">
      <h4>Test Coverage Heatmap</h3>
      ${renderCoverageHeatmap(testHealth, moduleMap)}
    </div>

    ${tierHtml}

    <div style="margin-top:24px;">
      <h4 style="font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text-heading);margin:0 0 12px;">NETWORK HEALTH</h4>
      <div id="health-network-panel"></div>
    </div>
  `;

  attachRefresh(container);
  void renderNetworkHealth('health-network-panel');
}

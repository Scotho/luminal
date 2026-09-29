// admin/src/ui/poolDashboard.ts
import { getAgentPools, getAllPoolHealth } from './agentPools';
import type { AgentPool, PoolHealth } from './agentPools';
import { sessionManager } from './ccSessionManager';

function formatDurationShort(ms: number): string {
  if (ms === 0) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function healthColor(pool: AgentPool, health: PoolHealth): string {
  if (!pool.available) return 'var(--text-quiet)';
  if (health.activeCount > 0) return 'var(--green)';
  return 'var(--text-dim)';
}

export function renderPoolDashboard(container: HTMLElement): { update(): void; destroy(): void } {
  const el = document.createElement('div');
  el.className = 'pool-dashboard';
  container.appendChild(el);

  let _unsub: (() => void) | null = null;

  function render(): void {
    const pools = getAgentPools();
    const health = getAllPoolHealth();
    const runningSessions = sessionManager.running();

    // Update active counts from running sessions
    for (const pool of pools) {
      const active = runningSessions.filter(s => s.backend === pool.id || (pool.id === 'claude' && s.backend === 'cc')).length;
      if (health[pool.id]) health[pool.id].activeCount = active;
    }

    el.innerHTML =
      '<div class="pool-dashboard-title">Agent Pools</div>' +
      pools.map(p => {
        const h = health[p.id] ?? { activeCount: 0, queueDepth: 0, totalDispatched: 0, avgDurationMs: 0 };
        const color = healthColor(p, h);
        const status = !p.available ? 'offline' : h.activeCount > 0 ? `${h.activeCount} active` : 'idle';
        return (
          '<div class="pool-row">' +
            `<span class="pool-dot" style="background:${color}"></span>` +
            `<span class="pool-name">${p.label}</span>` +
            `<span class="pool-status" style="color:${color}">${status}</span>` +
            `<span class="pool-dispatched">${h.totalDispatched} runs</span>` +
            `<span class="pool-avg">${formatDurationShort(h.avgDurationMs)} avg</span>` +
          '</div>'
        );
      }).join('');
  }

  _unsub = sessionManager.onChange(render);
  render();

  return {
    update: render,
    destroy() {
      _unsub?.();
      el.remove();
    },
  };
}

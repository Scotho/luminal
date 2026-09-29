// ── Agent Pool Registry ─────────────────────────────────────────────────────
// Single source of truth for all agent backends the dashboard can dispatch to.

export interface AgentPool {
  id: string;
  label: string;
  type: 'cloud' | 'local';
  available: boolean;
  model?: string;
}

// ── Static pools ────────────────────────────────────────────────────────────

const CLAUDE_POOL: AgentPool = {
  id: 'claude',
  label: 'Claude',
  type: 'cloud',
  available: true,
};

// ── Dynamic local pool (populated from Ollama status) ───────────────────────

let _localPool: AgentPool = {
  id: 'local',
  label: 'Local Agent',
  type: 'local',
  available: false,
};

/** Update local agent availability from Ollama status check. */
export function setLocalPoolStatus(available: boolean, model?: string): void {
  _localPool = { ..._localPool, available, model };
}

/** All registered pools. */
export function getAgentPools(): AgentPool[] {
  return [CLAUDE_POOL, _localPool];
}

/** Get available pools only. */
export function getAvailablePools(): AgentPool[] {
  return getAgentPools().filter(p => p.available);
}

/** Find a pool by id. */
export function getPool(id: string): AgentPool | undefined {
  return getAgentPools().find(p => p.id === id);
}

// ── Pool Health ─────────────────────────────────────────────────────────────

export interface PoolHealth {
  activeCount: number;
  queueDepth: number;
  totalDispatched: number;
  avgDurationMs: number;
  lastErrorTs?: number;
}

const _poolHealth: Record<string, PoolHealth> = {
  claude: { activeCount: 0, queueDepth: 0, totalDispatched: 0, avgDurationMs: 0 },
  local: { activeCount: 0, queueDepth: 0, totalDispatched: 0, avgDurationMs: 0 },
};

export function updatePoolHealth(poolId: string, update: Partial<PoolHealth>): void {
  if (_poolHealth[poolId]) {
    Object.assign(_poolHealth[poolId], update);
  } else {
    _poolHealth[poolId] = { activeCount: 0, queueDepth: 0, totalDispatched: 0, avgDurationMs: 0, ...update };
  }
}

export function getPoolHealth(poolId: string): PoolHealth {
  return _poolHealth[poolId] ?? { activeCount: 0, queueDepth: 0, totalDispatched: 0, avgDurationMs: 0 };
}

export function getAllPoolHealth(): Record<string, PoolHealth> {
  return { ..._poolHealth };
}

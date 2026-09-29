export const DOMAIN_IDS = [
  'bugs', 'tests', 'server-health', 'perf',
  'player-activity', 'deploy', 'stale-tasks',
] as const;

export type DomainId = typeof DOMAIN_IDS[number];
export type OverseerMode = 'watch' | 'advise' | 'act';

export interface DomainConfig {
  mode: OverseerMode;
  pollIntervalMs: number;
  enabled: boolean;
}

export interface StandingOrder {
  id: string;
  text: string;
  createdAt: number;
  domains: DomainId[] | 'all';
}

export interface OverseerConfig {
  enabled: boolean;
  domains: Record<DomainId, DomainConfig>;
  standingOrders: StandingOrder[];
  claude: {
    maxDispatchesPerHour: number;
    maxDispatchesPerDay: number;
    requireApproval: boolean;
  };
  discord: {
    enabled: boolean;
    cooldownMinutes: number;
  };
  heartbeatIntervalMs: number;
}

export interface OverseerState {
  running: boolean;
  startedAt: number;
  lastTick: Partial<Record<DomainId, number>>;
  claudeDispatches: { ts: number; domain: DomainId; incidentId: string }[];
  heartbeatTs: number;
}

export type OverseerLogAction =
  | 'detected' | 'incident-created' | 'discord-sent'
  | 'claude-dispatched' | 'claude-completed' | 'auto-fixed'
  | 'escalated' | 'order-applied';

export interface OverseerLogEntry {
  id: string;
  ts: number;
  domain: DomainId;
  action: OverseerLogAction;
  summary: string;
  ref?: string;
  incidentId?: string;
  agentId?: string;
  model?: string;
}

export interface QwenFinding {
  title: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  incidentType: 'outage' | 'deploy' | 'config-change' | 'hotfix' | 'rollback';
  suggestedAction: string | null;
  confidenceLevel: 'high' | 'medium' | 'low';
  relatedRef: string | null;
}

export interface QwenAnalysis {
  status: 'ok' | 'warning' | 'critical';
  findings: QwenFinding[];
}

export interface DomainSnapshot {
  domain: DomainId;
  ts: number;
  data: Record<string, unknown>;
  metrics: Record<string, number>;
}

export interface OverseerAlert {
  title: string;
  description: string;
  color: number;
  domain: DomainId;
  mode: OverseerMode;
  severity: 'critical' | 'major' | 'minor';
  fields: { name: string; value: string; inline?: boolean }[];
  ref?: string;
  incidentId?: string;
}

const VALID_MODES = new Set<string>(['watch', 'advise', 'act']);
const VALID_DOMAIN_IDS = new Set<string>(DOMAIN_IDS);

export function isValidMode(value: string): value is OverseerMode {
  return VALID_MODES.has(value);
}

export function isValidDomainId(value: string): value is DomainId {
  return VALID_DOMAIN_IDS.has(value);
}

export const DEFAULT_OVERSEER_CONFIG: OverseerConfig = {
  enabled: false,
  domains: {
    'bugs':            { mode: 'watch', pollIntervalMs: 120_000,  enabled: true },
    'tests':           { mode: 'watch', pollIntervalMs: 300_000,  enabled: true },
    'server-health':   { mode: 'watch', pollIntervalMs: 120_000,  enabled: true },
    'perf':            { mode: 'watch', pollIntervalMs: 300_000,  enabled: true },
    'player-activity': { mode: 'watch', pollIntervalMs: 180_000,  enabled: true },
    'deploy':          { mode: 'watch', pollIntervalMs: 300_000,  enabled: true },
    'stale-tasks':     { mode: 'watch', pollIntervalMs: 600_000,  enabled: true },
  },
  standingOrders: [],
  claude: {
    maxDispatchesPerHour: 5,
    maxDispatchesPerDay: 20,
    requireApproval: true,
  },
  discord: {
    enabled: true,
    cooldownMinutes: 15,
  },
  heartbeatIntervalMs: 60_000,
};

export const EMPTY_STATE: OverseerState = {
  running: false,
  startedAt: 0,
  lastTick: {},
  claudeDispatches: [],
  heartbeatTs: 0,
};

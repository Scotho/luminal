// admin/src/middleware/overseer/daemon.ts
import cron from 'node-cron';
import type {
  OverseerConfig, OverseerState, OverseerLogEntry, DomainId, DomainSnapshot,
  QwenFinding,
} from './types';
import { DOMAIN_IDS, DEFAULT_OVERSEER_CONFIG, EMPTY_STATE } from './types';
import { readJsonFile, writeJsonFile } from '../processPlugin';
import { COLLECTORS, type CollectorContext } from './collectors';
import { buildPrompt, parseQwenResponse, analyzeWithQwen } from './analyzer';
import { canDispatchClaude, buildClaudePrompt, buildAiderPrompt, dispatchClaude, dispatchAider } from './dispatcher';
import { sendDiscordAlert, ALERT_COLORS } from './notifier';
import { writeHeartbeat } from './heartbeat';

const ADMIN_BASE = 'http://localhost:5175';

let _task: cron.ScheduledTask | null = null;
let _running = false;
let _previousSnapshots: Partial<Record<DomainId, DomainSnapshot>> = {};

// ── Public API ────────────────────────────────────────────────────────────────

export function isOverseerRunning(): boolean {
  return _running;
}

export function isDomainDue(
  lastTick: Partial<Record<DomainId, number>>,
  domain: DomainId,
  intervalMs: number,
): boolean {
  const last = lastTick[domain];
  if (last === undefined) return true;
  return Date.now() - last >= intervalMs;
}

export function startOverseer(config: OverseerConfig): void {
  if (_running) return;

  _running = true;
  _previousSnapshots = {};

  const initialState: OverseerState = {
    ...EMPTY_STATE,
    running: true,
    startedAt: Date.now(),
  };
  writeJsonFile('overseer-state.json', initialState);

  _task = cron.schedule('*/30 * * * * *', () => {
    void tick();
  });

  appendLog({
    domain: 'server-health',
    action: 'detected',
    summary: 'OVERSEER started',
  });

  void tick(config);
}

export function stopOverseer(): void {
  if (!_running) return;

  if (_task) {
    _task.stop();
    _task = null;
  }
  _running = false;
  _previousSnapshots = {};

  const state = readJsonFile<OverseerState>('overseer-state.json', EMPTY_STATE);
  writeJsonFile('overseer-state.json', { ...state, running: false });

  appendLog({
    domain: 'server-health',
    action: 'detected',
    summary: 'OVERSEER stopped',
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface OllamaConfigFile {
  roles?: Record<string, string>;
  defaultModel?: string;
}

function resolveModel(): string | null {
  const cfg = readJsonFile<OllamaConfigFile>('ollama-config.json', {});
  const roles = cfg.roles ?? {};

  // Find first model with role 'fast'
  for (const [model, role] of Object.entries(roles)) {
    if (role === 'fast') return model;
  }

  // Fall back to defaultModel
  if (cfg.defaultModel) return cfg.defaultModel;

  return null;
}

interface IncidentEntry {
  id: string;
  ts: number;
  domain: DomainId;
  title: string;
  description: string;
  severity: QwenFinding['severity'];
  incidentType: QwenFinding['incidentType'];
  confidenceLevel: QwenFinding['confidenceLevel'];
  suggestedAction: string | null;
  relatedRef: string | null;
  source: string;
}

function appendLog(
  partial: Omit<OverseerLogEntry, 'id' | 'ts'> & Partial<Pick<OverseerLogEntry, 'id' | 'ts'>>,
): void {
  const entries = readJsonFile<OverseerLogEntry[]>('overseer-log.json', []);
  const ts = partial.ts ?? Date.now();
  const entry: OverseerLogEntry = {
    id: `log_${ts}_${Math.random().toString(36).slice(2, 7)}`,
    ts,
    domain: partial.domain,
    action: partial.action,
    summary: partial.summary,
    ...(partial.ref !== undefined ? { ref: partial.ref } : {}),
    ...(partial.incidentId !== undefined ? { incidentId: partial.incidentId } : {}),
    ...(partial.agentId !== undefined ? { agentId: partial.agentId } : {}),
    ...(partial.model !== undefined ? { model: partial.model } : {}),
  };

  entries.push(entry);
  const trimmed = entries.length > 500 ? entries.slice(entries.length - 500) : entries;
  writeJsonFile('overseer-log.json', trimmed);
}

async function processFinding(
  finding: QwenFinding,
  domain: DomainId,
  mode: OverseerConfig['domains'][DomainId]['mode'],
  config: OverseerConfig,
  state: OverseerState,
): Promise<void> {
  const ts = Date.now();
  const incidentId = `inc_${ts}_${Math.random().toString(36).slice(2, 7)}`;

  // Build description — include suggestedAction in Advise/Act modes
  let description = finding.description;
  if ((mode === 'advise' || mode === 'act') && finding.suggestedAction) {
    description = `${finding.description}\n\nSuggested action: ${finding.suggestedAction}`;
  }

  const incident: IncidentEntry = {
    id: incidentId,
    ts,
    domain,
    title: finding.title,
    description,
    severity: finding.severity,
    incidentType: finding.incidentType,
    confidenceLevel: finding.confidenceLevel,
    suggestedAction: finding.suggestedAction,
    relatedRef: finding.relatedRef,
    source: 'overseer',
  };

  const incidents = readJsonFile<IncidentEntry[]>('incidents.json', []);
  incidents.push(incident);
  writeJsonFile('incidents.json', incidents);

  appendLog({
    domain,
    action: 'incident-created',
    summary: `[${finding.severity}] ${finding.title}`,
    incidentId,
    ...(finding.relatedRef ? { ref: finding.relatedRef } : {}),
  });

  // Discord alert for major/critical findings
  if (config.discord.enabled && (finding.severity === 'critical' || finding.severity === 'major')) {
    const color = finding.severity === 'critical' ? ALERT_COLORS.CRITICAL : ALERT_COLORS.WARNING;
    await sendDiscordAlert(
      {
        title: finding.title,
        description: finding.description,
        color,
        domain,
        mode,
        severity: finding.severity,
        fields: [
          { name: 'Confidence', value: finding.confidenceLevel, inline: true },
          { name: 'Type', value: finding.incidentType, inline: true },
        ],
        ...(finding.relatedRef ? { ref: finding.relatedRef } : {}),
        incidentId,
      },
      config.discord.cooldownMinutes,
    );
    appendLog({ domain, action: 'discord-sent', summary: finding.title, incidentId });
  }

  // Act mode: try to auto-dispatch if confidence is high
  if (mode === 'act' && finding.confidenceLevel === 'high') {
    if (canDispatchClaude(config.claude, state.claudeDispatches)) {
      const prompt = buildClaudePrompt(finding, domain, config.standingOrders);
      const agentId = await dispatchClaude(ADMIN_BASE, prompt, `[overseer] ${finding.title}`);
      if (agentId) {
        state.claudeDispatches.push({ ts: Date.now(), domain, incidentId });
        appendLog({
          domain,
          action: 'claude-dispatched',
          summary: finding.title,
          incidentId,
          agentId,
        });
        return;
      }
    }

    // Fallback to Aider
    const aiderPrompt = buildAiderPrompt(finding, domain, incidentId);
    const agentId = await dispatchAider(ADMIN_BASE, aiderPrompt, `[overseer] ${finding.title}`);
    if (agentId) {
      appendLog({
        domain,
        action: 'claude-dispatched',
        summary: `Aider: ${finding.title}`,
        incidentId,
        agentId,
      });
      return;
    }

    // Log as queued — couldn't dispatch
    appendLog({
      domain,
      action: 'escalated',
      summary: `Queued (no dispatch available): ${finding.title}`,
      incidentId,
    });
  }
}

async function tick(overrideConfig?: OverseerConfig): Promise<void> {
  if (!_running) return;

  // Hot-reload config (or use override from startOverseer initial call)
  const config = overrideConfig
    ?? readJsonFile<OverseerConfig>('overseer-config.json', DEFAULT_OVERSEER_CONFIG);

  if (!config.enabled) {
    stopOverseer();
    return;
  }

  const state = readJsonFile<OverseerState>('overseer-state.json', EMPTY_STATE);
  const model = resolveModel();
  const ctx: CollectorContext = { adminBase: ADMIN_BASE };
  const activeDomains: DomainId[] = [];

  for (const domain of DOMAIN_IDS) {
    const domainCfg = config.domains[domain];
    if (!domainCfg.enabled) continue;

    activeDomains.push(domain);

    if (!isDomainDue(state.lastTick, domain, domainCfg.pollIntervalMs)) continue;

    // Run collector
    let snapshot: DomainSnapshot;
    try {
      snapshot = await COLLECTORS[domain](ctx);
    } catch {
      continue;
    }

    // Filter standing orders for this domain
    const orders = config.standingOrders.filter(
      (o) => o.domains === 'all' || o.domains.includes(domain),
    );

    // Analyze with Qwen if model available
    if (model) {
      const previous = _previousSnapshots[domain] ?? null;
      const prompt = buildPrompt(domain, domainCfg.mode, snapshot, previous, orders);
      const raw = await analyzeWithQwen(ADMIN_BASE, prompt, model);
      const analysis = parseQwenResponse(raw);

      for (const finding of analysis.findings) {
        await processFinding(finding, domain, domainCfg.mode, config, state);
      }
    }

    // Store snapshot as previous and update lastTick
    _previousSnapshots[domain] = snapshot;
    state.lastTick[domain] = Date.now();
  }

  // Write heartbeat if interval elapsed
  if (Date.now() - state.heartbeatTs >= config.heartbeatIntervalMs) {
    await writeHeartbeat(activeDomains);
    state.heartbeatTs = Date.now();
  }

  // Prune claudeDispatches older than 24h
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  state.claudeDispatches = state.claudeDispatches.filter((d) => d.ts >= cutoff24h);

  // Write updated state
  writeJsonFile('overseer-state.json', { ...state, running: _running });
}

import type { IncomingMessage, ServerResponse } from 'http';
import { parseBody, readJsonFile, writeJsonFile } from '../processPlugin';
import { json } from './routeUtils';
import {
  type OverseerConfig,
  type OverseerState,
  type OverseerLogEntry,
  type StandingOrder,
  type DomainId,
  DEFAULT_OVERSEER_CONFIG,
  EMPTY_STATE,
  isValidDomainId,
} from '../overseer/types';
import { startOverseer, stopOverseer, isOverseerRunning } from '../overseer/daemon';

// ── Helpers ────────────────────────────────────────────────

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const tVal = target[key];
    const sVal = source[key];
    if (
      tVal && sVal &&
      typeof tVal === 'object' && typeof sVal === 'object' &&
      !Array.isArray(sVal)
    ) {
      result[key] = deepMerge(
        tVal as Record<string, unknown>,
        sVal as Record<string, unknown>,
      );
    } else {
      result[key] = sVal;
    }
  }
  return result;
}

const ORDER_ID_PATTERN = /^\/__(admin_overseer)\/orders\/order_\d+$/;

// ── Route handler ──────────────────────────────────────────

export async function overseerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const { method, url } = req;
  if (!url || !url.startsWith('/__admin_overseer')) return false;

  // ── GET /__admin_overseer/config ──────────────────────────
  if (method === 'GET' && url === '/__admin_overseer/config') {
    const config = readJsonFile<OverseerConfig>('overseer-config.json', DEFAULT_OVERSEER_CONFIG);
    json(res, 200, config);
    return true;
  }

  // ── PATCH /__admin_overseer/config ────────────────────────
  if (method === 'PATCH' && url === '/__admin_overseer/config') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }
    const existing = readJsonFile<OverseerConfig>('overseer-config.json', DEFAULT_OVERSEER_CONFIG);
    const merged = deepMerge(
      existing as unknown as Record<string, unknown>,
      body,
    ) as unknown as OverseerConfig;
    writeJsonFile('overseer-config.json', merged);
    json(res, 200, { ok: true, config: merged });
    return true;
  }

  // ── GET /__admin_overseer/state ───────────────────────────
  if (method === 'GET' && url === '/__admin_overseer/state') {
    const state = readJsonFile<OverseerState>('overseer-state.json', EMPTY_STATE);
    json(res, 200, { ...state, running: isOverseerRunning() });
    return true;
  }

  // ── POST /__admin_overseer/start ──────────────────────────
  if (method === 'POST' && url === '/__admin_overseer/start') {
    if (isOverseerRunning()) {
      json(res, 200, { ok: true, alreadyRunning: true });
      return true;
    }
    const config = readJsonFile<OverseerConfig>('overseer-config.json', DEFAULT_OVERSEER_CONFIG);
    startOverseer(config);
    const state = readJsonFile<OverseerState>('overseer-state.json', EMPTY_STATE);
    const updated: OverseerState = { ...state, running: true, startedAt: Date.now() };
    writeJsonFile('overseer-state.json', updated);
    json(res, 200, { ok: true, started: true });
    return true;
  }

  // ── POST /__admin_overseer/stop ───────────────────────────
  if (method === 'POST' && url === '/__admin_overseer/stop') {
    if (!isOverseerRunning()) {
      json(res, 200, { ok: true, alreadyStopped: true });
      return true;
    }
    stopOverseer();
    const state = readJsonFile<OverseerState>('overseer-state.json', EMPTY_STATE);
    const updated: OverseerState = { ...state, running: false };
    writeJsonFile('overseer-state.json', updated);
    json(res, 200, { ok: true, stopped: true });
    return true;
  }

  // ── GET /__admin_overseer/log ─────────────────────────────
  if (method === 'GET' && url.startsWith('/__admin_overseer/log')) {
    const rawUrl = new URL(url, 'http://localhost');
    const domainParam = rawUrl.searchParams.get('domain');
    const limitParam = rawUrl.searchParams.get('limit');
    const sinceParam = rawUrl.searchParams.get('since');

    let entries = readJsonFile<OverseerLogEntry[]>('overseer-log.json', []);

    if (domainParam && isValidDomainId(domainParam)) {
      entries = entries.filter(e => e.domain === domainParam);
    }

    if (sinceParam) {
      const sinceTs = Number(sinceParam);
      if (!isNaN(sinceTs)) {
        entries = entries.filter(e => e.ts > sinceTs);
      }
    }

    if (limitParam) {
      const limit = Number(limitParam);
      if (!isNaN(limit) && limit > 0) {
        entries = entries.slice(-limit);
      }
    }

    json(res, 200, entries);
    return true;
  }

  // ── POST /__admin_overseer/log ────────────────────────────
  if (method === 'POST' && url === '/__admin_overseer/log') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }

    const domain = body['domain'];
    const action = body['action'];
    const summary = body['summary'];

    if (typeof domain !== 'string' || !isValidDomainId(domain)) {
      json(res, 400, { error: 'Invalid or missing domain' });
      return true;
    }
    if (typeof action !== 'string' || !action) {
      json(res, 400, { error: 'action is required' });
      return true;
    }
    if (typeof summary !== 'string' || !summary) {
      json(res, 400, { error: 'summary is required' });
      return true;
    }

    const ts = Date.now();
    const entry: OverseerLogEntry = {
      id: `log_${ts}_${Math.random().toString(36).slice(2, 7)}`,
      ts,
      domain: domain as DomainId,
      action: action as OverseerLogEntry['action'],
      summary,
      ...(typeof body['ref'] === 'string' ? { ref: body['ref'] } : {}),
      ...(typeof body['incidentId'] === 'string' ? { incidentId: body['incidentId'] } : {}),
      ...(typeof body['agentId'] === 'string' ? { agentId: body['agentId'] } : {}),
      ...(typeof body['model'] === 'string' ? { model: body['model'] } : {}),
    };

    const entries = readJsonFile<OverseerLogEntry[]>('overseer-log.json', []);
    entries.push(entry);

    // Trim to 500 max
    const trimmed = entries.length > 500 ? entries.slice(entries.length - 500) : entries;
    writeJsonFile('overseer-log.json', trimmed);

    json(res, 200, { ok: true, entry });
    return true;
  }

  // ── POST /__admin_overseer/orders ─────────────────────────
  if (method === 'POST' && url === '/__admin_overseer/orders') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }

    const text = body['text'];
    if (typeof text !== 'string' || !text.trim()) {
      json(res, 400, { error: 'text is required' });
      return true;
    }

    const domainsRaw = body['domains'];
    const domains: StandingOrder['domains'] =
      domainsRaw === 'all'
        ? 'all'
        : Array.isArray(domainsRaw) && domainsRaw.every(d => typeof d === 'string' && isValidDomainId(d))
        ? (domainsRaw as DomainId[])
        : 'all';

    const order: StandingOrder = {
      id: `order_${Date.now()}`,
      text: text.trim(),
      createdAt: Date.now(),
      domains,
    };

    const config = readJsonFile<OverseerConfig>('overseer-config.json', DEFAULT_OVERSEER_CONFIG);
    config.standingOrders.push(order);
    writeJsonFile('overseer-config.json', config);

    json(res, 200, { ok: true, order });
    return true;
  }

  // ── PATCH /__admin_overseer/orders/:id ────────────────────
  if ((method === 'PATCH' || method === 'DELETE') && ORDER_ID_PATTERN.test(url)) {
    const orderId = url.split('/').pop() ?? '';

    if (method === 'PATCH') {
      let body: Record<string, unknown>;
      try {
        body = await parseBody(req);
      } catch {
        json(res, 400, { error: 'Invalid JSON body' });
        return true;
      }

      const config = readJsonFile<OverseerConfig>('overseer-config.json', DEFAULT_OVERSEER_CONFIG);
      const idx = config.standingOrders.findIndex(o => o.id === orderId);
      if (idx === -1) {
        json(res, 404, { error: 'Order not found' });
        return true;
      }

      const existing = config.standingOrders[idx];
      const updated: StandingOrder = {
        ...existing,
        ...(typeof body['text'] === 'string' ? { text: body['text'].trim() } : {}),
      };

      if (body['domains'] !== undefined) {
        const domainsRaw = body['domains'];
        updated.domains =
          domainsRaw === 'all'
            ? 'all'
            : Array.isArray(domainsRaw) && domainsRaw.every(d => typeof d === 'string' && isValidDomainId(d))
            ? (domainsRaw as DomainId[])
            : existing.domains;
      }

      config.standingOrders[idx] = updated;
      writeJsonFile('overseer-config.json', config);
      json(res, 200, { ok: true, order: updated });
      return true;
    }

    // DELETE
    const config = readJsonFile<OverseerConfig>('overseer-config.json', DEFAULT_OVERSEER_CONFIG);
    const before = config.standingOrders.length;
    config.standingOrders = config.standingOrders.filter(o => o.id !== orderId);
    if (config.standingOrders.length === before) {
      json(res, 404, { error: 'Order not found' });
      return true;
    }
    writeJsonFile('overseer-config.json', config);
    json(res, 200, { ok: true, deleted: orderId });
    return true;
  }

  return false;
}

// admin/src/middleware/routes/perfRoutes.ts — Performance Benchmark Tracker API
//
// Stores per-version/per-commit performance samples to admin/data/perf-history.json.
// Endpoints:
//   GET    /__admin_perf/list     — return samples sorted newest-first
//   POST   /__admin_perf/sample   — ingest a new sample (id+timestamp auto-assigned)
//   DELETE /__admin_perf/sample?id=X — remove a sample

import type { IncomingMessage, ServerResponse } from 'http';
import { parseBody, readJsonFile, writeJsonFile } from '../processPlugin';
import { json, safeError, param } from './routeUtils';

export interface PerfSampleMetrics {
  avgFrameTime?: number;   // ms
  p95FrameTime?: number;   // ms
  loadTimeMs?: number;
  bundleSizeKb?: number;
}

export interface PerfSample {
  id: string;
  version: string;
  commit: string;
  timestamp: number;
  metrics: PerfSampleMetrics;
  source?: string;         // 'manual' | 'ci' | 'e2e' | 'budget-ingest'
  notes?: string;
}

const DATA_FILE = 'perf-history.json';

function loadSamples(): PerfSample[] {
  return readJsonFile<PerfSample[]>(DATA_FILE, []);
}

function saveSamples(samples: PerfSample[]): void {
  writeJsonFile(DATA_FILE, samples);
}

/** Normalize arbitrary unknown metric value into a positive finite number, else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (!Number.isFinite(v)) return undefined;
  if (v < 0) return undefined;
  return v;
}

/** Build a PerfSample from a request body — strips unknown fields, validates shape. */
export function buildSampleFromBody(body: Record<string, unknown>): PerfSample | { error: string } {
  const version = String(body['version'] ?? '').trim();
  const commit = String(body['commit'] ?? '').trim();
  if (!version) return { error: 'Missing version' };
  if (!commit) return { error: 'Missing commit' };

  const rawMetrics = (body['metrics'] ?? {}) as Record<string, unknown>;
  const metrics: PerfSampleMetrics = {
    avgFrameTime: num(rawMetrics['avgFrameTime']),
    p95FrameTime: num(rawMetrics['p95FrameTime']),
    loadTimeMs: num(rawMetrics['loadTimeMs']),
    bundleSizeKb: num(rawMetrics['bundleSizeKb']),
  };

  // Strip undefined keys so stored JSON is clean
  for (const key of Object.keys(metrics) as (keyof PerfSampleMetrics)[]) {
    if (metrics[key] === undefined) delete metrics[key];
  }

  const source = typeof body['source'] === 'string' ? String(body['source']) : 'manual';
  const notes = typeof body['notes'] === 'string' ? String(body['notes']) : undefined;

  const sample: PerfSample = {
    id: `perf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version,
    commit,
    timestamp: Date.now(),
    metrics,
    source,
  };
  if (notes) sample.notes = notes;
  return sample;
}

/** Sort samples newest first. */
function sortNewestFirst(samples: PerfSample[]): PerfSample[] {
  return [...samples].sort((a, b) => b.timestamp - a.timestamp);
}

export async function perfRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url?.startsWith('/__admin_perf')) return false;

  // GET /__admin_perf/list — return sorted history
  if (method === 'GET' && (url === '/__admin_perf/list' || url.startsWith('/__admin_perf/list?'))) {
    const samples = sortNewestFirst(loadSamples());
    json(res, 200, samples);
    return true;
  }

  // POST /__admin_perf/sample — ingest a new sample
  if (method === 'POST' && url === '/__admin_perf/sample') {
    try {
      const body = await parseBody(req);
      const result = buildSampleFromBody(body);
      if ('error' in result) {
        json(res, 400, { error: result.error });
        return true;
      }
      const samples = loadSamples();
      samples.push(result);
      saveSamples(samples);
      json(res, 200, { ok: true, sample: result });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // DELETE /__admin_perf/sample?id=X — remove a sample
  if (method === 'DELETE' && url.startsWith('/__admin_perf/sample')) {
    const id = param(url, 'id');
    if (!id) {
      json(res, 400, { error: 'Missing id' });
      return true;
    }
    const samples = loadSamples();
    const next = samples.filter(s => s.id !== id);
    if (next.length === samples.length) {
      json(res, 404, { error: 'Sample not found' });
      return true;
    }
    saveSamples(next);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

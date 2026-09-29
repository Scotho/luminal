import type { IncomingMessage, ServerResponse } from 'http';
import type { TestFlakinessRecord, TestFlakinessHistoryEntry } from '../../types';
import { parseBody, readJsonFile, writeJsonFile } from '../processPlugin';
import { safeError } from './routeUtils';

const DATA_FILE = 'test-flakiness.json';
const HISTORY_CAP = 20;
const SCORE_WINDOW = 10;

/** Incoming result row from an ingest call. */
interface IngestResult {
  testName: string;
  file: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs?: number;
}

/**
 * Compute the flakiness score for a list of recent history entries.
 * Score = (# transitions in the last 10 runs) / 9, rounded to 2 dp.
 * - All passes or all fails in a row → 0.
 * - Strictly alternating pass/fail → ~1.0.
 * - Skips do not contribute to transitions and are ignored for scoring.
 */
export function computeFlakinessScore(history: readonly TestFlakinessHistoryEntry[]): number {
  const relevant = history
    .filter(h => h.status === 'pass' || h.status === 'fail')
    .slice(-SCORE_WINDOW);
  if (relevant.length < 2) return 0;
  let transitions = 0;
  for (let i = 1; i < relevant.length; i++) {
    if (relevant[i].status !== relevant[i - 1].status) transitions++;
  }
  const score = transitions / (SCORE_WINDOW - 1);
  return Math.round(score * 100) / 100;
}

/**
 * Upsert a single ingest result into the provided records array (in-place).
 * Returns the record that was created or updated.
 */
export function upsertFlakinessRecord(
  records: TestFlakinessRecord[],
  result: IngestResult,
  now: number,
): TestFlakinessRecord {
  const key = result.testName;
  let record = records.find(r => r.testName === key);
  if (!record) {
    record = {
      testName: key,
      file: result.file,
      runs: 0,
      passes: 0,
      fails: 0,
      lastRunAt: now,
      lastStatus: result.status,
      recentHistory: [],
      flakinessScore: 0,
      quarantined: false,
    };
    records.push(record);
  }

  record.file = result.file || record.file;
  record.runs += 1;
  if (result.status === 'pass') record.passes += 1;
  else if (result.status === 'fail') record.fails += 1;
  record.lastRunAt = now;
  record.lastStatus = result.status;

  const entry: TestFlakinessHistoryEntry = { ts: now, status: result.status };
  if (typeof result.durationMs === 'number') entry.durationMs = result.durationMs;
  record.recentHistory.push(entry);
  if (record.recentHistory.length > HISTORY_CAP) {
    record.recentHistory.splice(0, record.recentHistory.length - HISTORY_CAP);
  }

  record.flakinessScore = computeFlakinessScore(record.recentHistory);
  return record;
}

function sortByScore(records: readonly TestFlakinessRecord[]): TestFlakinessRecord[] {
  return [...records].sort((a, b) => {
    if (b.flakinessScore !== a.flakinessScore) return b.flakinessScore - a.flakinessScore;
    return b.lastRunAt - a.lastRunAt;
  });
}

function isValidStatus(s: unknown): s is 'pass' | 'fail' | 'skip' {
  return s === 'pass' || s === 'fail' || s === 'skip';
}

export async function flakinessRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;
  const pathname = new URL(url, 'http://localhost').pathname;

  // ── GET /__admin_flakiness/list ───────────────────
  if (method === 'GET' && pathname === '/__admin_flakiness/list') {
    try {
      const records = await readJsonFile<TestFlakinessRecord[]>(DATA_FILE, []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sortByScore(records)));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_flakiness/ingest ────────────────
  if (method === 'POST' && pathname === '/__admin_flakiness/ingest') {
    try {
      const body = await parseBody(req);
      const rawResults = body['results'];
      if (!Array.isArray(rawResults)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'results array required' }));
        return true;
      }
      const records = await readJsonFile<TestFlakinessRecord[]>(DATA_FILE, []);
      const now = Date.now();
      let ingested = 0;
      for (const raw of rawResults as Array<Record<string, unknown>>) {
        const testName = typeof raw['testName'] === 'string' ? raw['testName'] : '';
        const file = typeof raw['file'] === 'string' ? raw['file'] : '';
        const status = raw['status'];
        if (!testName || !isValidStatus(status)) continue;
        const result: IngestResult = { testName, file, status };
        if (typeof raw['durationMs'] === 'number') result.durationMs = raw['durationMs'];
        upsertFlakinessRecord(records, result, now);
        ingested += 1;
      }
      await writeJsonFile(DATA_FILE, records);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ingested, total: records.length }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_flakiness/quarantine ────────────
  if (method === 'POST' && pathname === '/__admin_flakiness/quarantine') {
    try {
      const body = await parseBody(req);
      const testName = typeof body['testName'] === 'string' ? body['testName'] : '';
      if (!testName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'testName required' }));
        return true;
      }
      const records = await readJsonFile<TestFlakinessRecord[]>(DATA_FILE, []);
      const record = records.find(r => r.testName === testName);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Record not found' }));
        return true;
      }
      record.quarantined = Boolean(body['quarantined']);
      if (record.quarantined) {
        if (typeof body['reason'] === 'string' && body['reason']) {
          record.quarantineReason = body['reason'];
        }
      } else {
        delete record.quarantineReason;
      }
      await writeJsonFile(DATA_FILE, records);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, record }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── DELETE /__admin_flakiness/record?testName=X ───
  if (method === 'DELETE' && pathname === '/__admin_flakiness/record') {
    try {
      const testName = new URL(url, 'http://localhost').searchParams.get('testName') ?? '';
      if (!testName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'testName required' }));
        return true;
      }
      const records = await readJsonFile<TestFlakinessRecord[]>(DATA_FILE, []);
      const idx = records.findIndex(r => r.testName === testName);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Record not found' }));
        return true;
      }
      records.splice(idx, 1);
      await writeJsonFile(DATA_FILE, records);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, remaining: records.length }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_flakiness/clear ─────────────────
  // Requires header x-admin-confirm: yes to prevent accidental wipes.
  if (method === 'POST' && pathname === '/__admin_flakiness/clear') {
    try {
      const confirm = req.headers['x-admin-confirm'];
      if (confirm !== 'yes') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing x-admin-confirm: yes header' }));
        return true;
      }
      await writeJsonFile(DATA_FILE, []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  return false;
}

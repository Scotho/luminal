/**
 * prune-sessions.ts
 *
 * Prunes stale sessions from admin/data/sessions.json.
 * Rules:
 *   1. Remove all `done` sessions older than 2 days
 *   2. Remove all `done-followup` sessions older than 7 days
 *   3. Collapse duplicate E2E sessions — keep only the latest per unique summary
 *   4. Never remove `active`, `blocked`, or `todo` sessions
 *
 * Usage:
 *   npx tsx admin/scripts/prune-sessions.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const SESSIONS_PATH = resolve(DATA_DIR, 'sessions.json');

interface Session {
  id: string;
  summary: string;
  status: string;
  created: string;
  completed?: string;
  [key: string]: unknown;
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function run(): void {
  const dryRun = process.argv.includes('--dry-run');
  const now = Date.now();

  if (!existsSync(SESSIONS_PATH)) {
    console.log(JSON.stringify({ pruned: 0, remaining: 0, reason: 'no sessions file' }));
    return;
  }

  const raw = readFileSync(SESSIONS_PATH, 'utf-8');
  const sessions: Session[] = JSON.parse(raw);
  const original = sessions.length;

  // Phase 1: Age-based pruning
  const afterAge = sessions.filter(s => {
    const age = now - new Date(s.created).getTime();
    if (s.status === 'done' && age > TWO_DAYS_MS) return false;
    if (s.status === 'done-followup' && age > SEVEN_DAYS_MS) return false;
    return true;
  });

  // Phase 2: E2E dedup — for sessions starting with "E2E:", keep only the newest per summary
  const e2eSeen = new Map<string, Session>();
  const nonE2E: Session[] = [];

  // Process in order (newest first by created date)
  const sorted = [...afterAge].sort((a, b) =>
    new Date(b.created).getTime() - new Date(a.created).getTime()
  );

  for (const s of sorted) {
    const isE2E = s.summary.startsWith('E2E:');
    const isCompleted = s.status === 'done' || s.status === 'done-followup';
    if (isE2E && isCompleted) {
      const key = s.summary.trim();
      if (!e2eSeen.has(key)) {
        e2eSeen.set(key, s);
      }
      // Skip duplicates
    } else {
      nonE2E.push(s);
    }
  }

  const kept = [...nonE2E, ...e2eSeen.values()];
  // Restore original ordering
  const keptIds = new Set(kept.map(s => s.id));
  const final = sessions.filter(s => keptIds.has(s.id));

  const pruned = original - final.length;

  if (!dryRun && pruned > 0) {
    writeFileSync(SESSIONS_PATH, JSON.stringify(final, null, 2), 'utf-8');
  }

  console.log(JSON.stringify({
    pruned,
    remaining: final.length,
    original,
    dryRun,
    breakdown: {
      agePruned: original - afterAge.length,
      e2eDeduped: afterAge.length - kept.length,
    },
  }));
}

run();

#!/usr/bin/env node
// ── Record Coverage History ─────────────────────────────────
// Reads the Vitest V8 coverage summary and appends an entry
// to admin/data/coverage-history.json for trend tracking.
//
// Automatically chained after `npm run test:coverage`.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HISTORY_PATH = resolve(ROOT, 'admin/data/coverage-history.json');
const COVERAGE_PATH = resolve(ROOT, 'coverage/coverage-summary.json');

if (!existsSync(COVERAGE_PATH)) {
  console.log('  ⚠ No coverage summary found — skipping history recording.');
  process.exit(0);
}

const summary = JSON.parse(readFileSync(COVERAGE_PATH, 'utf-8'));
const total = summary.total;

const entry = {
  timestamp: new Date().toISOString(),
  commit: execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim(),
  branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim(),
  coverage: Math.round(total.lines.pct * 10) / 10,
  testCount: null,
  passed: null,
  failed: null,
  duration: null,
};

let history = [];
try {
  if (existsSync(HISTORY_PATH)) {
    history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
  }
} catch { /* start fresh */ }

history.push(entry);
if (history.length > 100) history.splice(0, history.length - 100);
writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
console.log(`  ✓ Coverage recorded: ${entry.coverage}% on ${entry.branch}@${entry.commit}`);

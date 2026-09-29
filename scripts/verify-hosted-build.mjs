#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, extname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST_DIR = resolve(ROOT, 'dist');
const target = process.argv[2] ?? 'hosted';

const forbiddenDirNames = new Set([
  'coverage',
  'playwright-report',
  'screenshots',
  'test-results',
  'testbed',
  'testhub',
  'testinghub',
]);

const forbiddenContentMarkers = [
  '__luminalTestHook_',
  '__luminalGetGrindState',
  '__luminalGetNetcodeStats',
  '__luminalGetPerfTelemetry',
  'DEBUG DASHBOARD',
];

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt']);
const failures = [];

if (!existsSync(DIST_DIR)) {
  console.error('Hosted build verification failed: dist/ does not exist.');
  process.exit(1);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const relPath = relative(ROOT, fullPath).replace(/\\/g, '/');
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (forbiddenDirNames.has(entry)) {
        failures.push(`Forbidden directory in hosted build: ${relPath}`);
        continue;
      }
      walk(fullPath);
      continue;
    }

    const ext = extname(entry);
    if (!textExtensions.has(ext)) {
      continue;
    }

    const text = readFileSync(fullPath, 'utf8');
    for (const marker of forbiddenContentMarkers) {
      if (text.includes(marker)) {
        failures.push(`Forbidden hosted marker "${marker}" found in ${relPath}`);
      }
    }
  }
}

walk(DIST_DIR);

if (failures.length > 0) {
  console.error(`Hosted build verification failed for "${target}":`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Hosted build verification passed for "${target}".`);

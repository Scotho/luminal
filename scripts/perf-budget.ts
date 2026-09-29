// scripts/perf-budget.ts
// Collects performance budget metrics and appends to admin/data/perf-budget.json history.
//
// Usage:
//   npx tsx scripts/perf-budget.ts
//
// Metrics collected:
//   - Bundle size: measured from dist/ after running `vite build`
//   - Load time estimate: heuristic from gzipped bundle size over 10 Mbps connection
//   - Lighthouse score: optional (requires `lighthouse` CLI), falls back to null
//   - FPS: reads from last history entry or defaults to null (runtime-only metric)

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';

// ── Colored log helpers ──────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function info(msg: string): void {
  console.log(`${c.cyan}[perf-budget]${c.reset} ${msg}`);
}

function warn(msg: string): void {
  console.log(`${c.yellow}[perf-budget]${c.reset} ${msg}`);
}

function success(msg: string): void {
  console.log(`${c.green}[perf-budget]${c.reset} ${msg}`);
}

function fail(msg: string): void {
  console.log(`${c.red}[perf-budget]${c.reset} ${msg}`);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  timestamp: string;
  bundleSize: number;
  bundleGzip: number;
  lighthouse: number | null;
  fps: number | null;
  loadTime: number;
}

interface PerfBudgetData {
  bundleSize: string;
  lighthouse: number | null;
  fps: number | null;
  loadTime: string;
  history: HistoryEntry[];
}

// ── Thresholds from root perf-budget.json ────────────────────────────────────

interface BudgetThresholds {
  maxBundleKB?: number;
  maxLoadTimeMs?: number;
  minLighthouse?: number;
  minFps?: number;
}

function loadThresholds(projectRoot: string): BudgetThresholds {
  // No root-level thresholds file used for this project; the thresholds
  // in .worktrees/perf-testing-framework/perf-budget.json are for netcode.
  // We define sensible defaults here.
  void projectRoot;
  return {
    maxBundleKB: 2048,     // 2 MB raw bundle
    maxLoadTimeMs: 3000,   // 3 seconds on 10 Mbps
    minLighthouse: 70,
    minFps: 55,
  };
}

// ── Measure dist/ folder ─────────────────────────────────────────────────────

function measureDir(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += measureDir(full);
    } else {
      total += statSync(full).size;
    }
  }
  return total;
}

/** Parse Vite build output to extract gzip sizes from asset lines. */
function parseGzipFromBuildOutput(output: string): number {
  let totalGzip = 0;
  // Vite output lines like: dist/assets/main-BJnVk14Z.js  1,576.95 kB │ gzip: 422.59 kB
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/gzip:\s+([\d,.]+)\s+kB/);
    if (match) {
      const kb = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(kb)) totalGzip += kb * 1024;
    }
  }
  return Math.round(totalGzip);
}

// ── Lighthouse (optional) ────────────────────────────────────────────────────

function tryLighthouse(): number | null {
  // Only run if lighthouse is explicitly installed (not via npx auto-download)
  try {
    execSync('lighthouse --version', { stdio: 'pipe', timeout: 10_000 });
  } catch {
    warn('Lighthouse CLI not installed, skipping score (install with: npm i -g lighthouse)');
    return null;
  }

  try {
    info('Running Lighthouse audit (this may take a moment)...');
    const result = execSync(
      'lighthouse http://localhost:5173 --output=json --chrome-flags="--headless --no-sandbox" --only-categories=performance --quiet',
      { stdio: 'pipe', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
    );
    const report: { categories?: { performance?: { score?: number } } } =
      JSON.parse(result.toString());
    const score = report.categories?.performance?.score;
    if (typeof score === 'number') {
      return Math.round(score * 100);
    }
  } catch (err) {
    warn(`Lighthouse audit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

// ── Load time heuristic ──────────────────────────────────────────────────────

/** Estimate load time in ms from gzip bytes over a 10 Mbps connection. */
function estimateLoadTime(gzipBytes: number): number {
  const bitsPerSecond = 10 * 1_000_000; // 10 Mbps
  const bytesPerSecond = bitsPerSecond / 8;
  // Add 200ms for DNS + TLS + server response overhead
  return Math.round((gzipBytes / bytesPerSecond) * 1000) + 200;
}

// ── Format helpers ───────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const projectRoot = path.resolve(import.meta.dirname ?? '.', '..');
  const distDir = path.join(projectRoot, 'dist');
  const dataFile = path.join(projectRoot, 'admin', 'data', 'perf-budget.json');
  const thresholds = loadThresholds(projectRoot);

  // Step 1: Build
  info('Running vite build...');
  let buildOutput = '';
  try {
    buildOutput = execSync('npx vite build', {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 120_000,
    }).toString();
    success('Build completed');
  } catch (err) {
    fail('Build failed — aborting');
    if (err instanceof Error && 'stdout' in err) {
      console.error((err as Error & { stdout: Buffer }).stdout.toString());
    }
    process.exit(1);
  }

  // Step 2: Measure bundle size
  const rawSize = measureDir(path.join(distDir, 'assets'));
  const gzipSize = parseGzipFromBuildOutput(buildOutput);
  info(`Bundle: ${formatBytes(rawSize)} raw, ${formatBytes(gzipSize)} gzipped`);

  // Step 3: Lighthouse (optional)
  const lighthouse = tryLighthouse();
  if (lighthouse !== null) {
    info(`Lighthouse performance: ${lighthouse}`);
  }

  // Step 4: FPS — carry forward from last history entry (runtime-only metric)
  let fps: number | null = null;
  let existing: Partial<PerfBudgetData> = {};
  try {
    if (existsSync(dataFile)) {
      const raw = readFileSync(dataFile, 'utf-8').trim();
      if (raw && raw !== '{}') {
        existing = JSON.parse(raw) as Partial<PerfBudgetData>;
      }
    }
  } catch {
    warn('Could not parse existing perf-budget.json, starting fresh');
  }

  const history: HistoryEntry[] = Array.isArray(existing.history) ? existing.history : [];
  if (history.length > 0) {
    const last = history[history.length - 1];
    fps = last.fps;
  }

  // Step 5: Load time estimate
  const loadTimeMs = estimateLoadTime(gzipSize);
  info(`Estimated load time: ${formatMs(loadTimeMs)} (10 Mbps heuristic)`);

  // Step 6: Build history entry
  const entry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    bundleSize: rawSize,
    bundleGzip: gzipSize,
    lighthouse,
    fps,
    loadTime: loadTimeMs,
  };
  history.push(entry);

  // Keep last 50 entries
  const MAX_HISTORY = 50;
  const trimmedHistory = history.slice(-MAX_HISTORY);

  // Step 7: Write output
  const output: PerfBudgetData = {
    bundleSize: formatBytes(rawSize),
    lighthouse,
    fps,
    loadTime: formatMs(loadTimeMs),
    history: trimmedHistory,
  };

  writeFileSync(dataFile, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  success(`Wrote ${dataFile}`);

  // Step 8: Threshold checks
  let warnings = 0;
  if (thresholds.maxBundleKB && rawSize > thresholds.maxBundleKB * 1024) {
    warn(`Bundle size ${formatBytes(rawSize)} exceeds budget of ${formatBytes(thresholds.maxBundleKB * 1024)}`);
    warnings++;
  }
  if (thresholds.maxLoadTimeMs && loadTimeMs > thresholds.maxLoadTimeMs) {
    warn(`Load time ${formatMs(loadTimeMs)} exceeds budget of ${formatMs(thresholds.maxLoadTimeMs)}`);
    warnings++;
  }
  if (thresholds.minLighthouse && lighthouse !== null && lighthouse < thresholds.minLighthouse) {
    warn(`Lighthouse ${lighthouse} below minimum of ${thresholds.minLighthouse}`);
    warnings++;
  }
  if (thresholds.minFps && fps !== null && fps < thresholds.minFps) {
    warn(`FPS ${fps} below minimum of ${thresholds.minFps}`);
    warnings++;
  }

  if (warnings === 0) {
    success('All metrics within budget');
  } else {
    warn(`${warnings} metric(s) exceeded budget thresholds`);
  }

  // Summary
  console.log('');
  console.log(`${c.bold}Performance Budget Summary${c.reset}`);
  console.log(`  Bundle Size:  ${formatBytes(rawSize)} (${formatBytes(gzipSize)} gzip)`);
  console.log(`  Lighthouse:   ${lighthouse ?? 'n/a'}`);
  console.log(`  Avg FPS:      ${fps ?? 'n/a (runtime only)'}`);
  console.log(`  Load Time:    ${formatMs(loadTimeMs)}`);
  console.log(`  History:      ${trimmedHistory.length} entries`);
}

main();

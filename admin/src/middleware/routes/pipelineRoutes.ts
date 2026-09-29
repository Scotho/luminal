import type { IncomingMessage, ServerResponse } from 'http';
import type { DeployEntry, CoverageEntry } from '../../types';
import { readJsonFile, writeJsonFile, parseBody } from '../processPlugin';
import { safeError } from './routeUtils';
import { ghFetchJSON } from './githubHelper';

/** Parse a numeric query param, returning a default if invalid. */
function intParam(url: string, name: string, fallback: number): number {
  const parsedUrl = new URL(url, 'http://localhost');
  const val = parseInt(parsedUrl.searchParams.get(name) ?? '', 10);
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

export async function pipelineRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;

  // ── GET /__admin_pipeline/deploys ──────────────────
  if (method === 'GET' && url.startsWith('/__admin_pipeline/deploys')) {
    const limit = intParam(url, 'limit', 20);
    const deploys = readJsonFile<DeployEntry[]>('deploy-history.json', []);
    // Return newest first, limited
    const sorted = [...deploys].reverse().slice(0, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sorted));
    return true;
  }

  // ── GET /__admin_pipeline/coverage ─────────────────
  if (method === 'GET' && url.startsWith('/__admin_pipeline/coverage')) {
    const limit = intParam(url, 'limit', 20);
    const entries = readJsonFile<CoverageEntry[]>('coverage-history.json', []);
    const sliced = entries.slice(-limit); // newest at end, keep last N
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sliced));
    return true;
  }

  // ── GET /__admin_pipeline/status ───────────────────
  if (method === 'GET' && url === '/__admin_pipeline/status') {
    // Fetch in parallel: latest CI run, open PRs
    const [runsData, pullsData] = await Promise.all([
      ghFetchJSON('actions/runs?per_page=1', 120),
      ghFetchJSON('pulls?state=open&per_page=100', 120),
    ]);

    // Build status
    let build: Record<string, unknown> | null = null;
    if (runsData && typeof runsData === 'object' && 'workflow_runs' in runsData) {
      const runs = (runsData as { workflow_runs: Array<Record<string, unknown>> }).workflow_runs;
      if (runs.length > 0) {
        const r = runs[0];
        build = {
          status: r.status,
          conclusion: r.conclusion ?? null,
          runNumber: r.run_number,
          branch: r.head_branch,
          sha: String(r.head_sha ?? '').slice(0, 7),
          updatedAt: r.updated_at,
          url: r.html_url,
        };
      }
    }

    // Latest deploy
    const deploys = readJsonFile<DeployEntry[]>('deploy-history.json', []);
    const deploy = deploys.length > 0 ? deploys[deploys.length - 1] : null;

    // Coverage with delta
    const coverageEntries = readJsonFile<CoverageEntry[]>('coverage-history.json', []);
    let coverage: { percent: number; testCount: number | null; delta: number } | null = null;
    if (coverageEntries.length > 0) {
      const latest = coverageEntries[coverageEntries.length - 1];
      const prev = coverageEntries.length > 1 ? coverageEntries[coverageEntries.length - 2] : null;
      coverage = {
        percent: latest.coverage,
        testCount: latest.testCount,
        delta: prev ? Math.round((latest.coverage - prev.coverage) * 10) / 10 : 0,
      };
    }

    // PR count
    const openPRs = Array.isArray(pullsData) ? pullsData.length : 0;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ build, deploy, coverage, prs: { open: openPRs, unaddressedAIComments: 0 } }));
    return true;
  }

  // ── POST /__admin_pipeline/rollback ────────────────
  if (method === 'POST' && url === '/__admin_pipeline/rollback') {
    try {
      const body = await parseBody(req);
      const version = String(body['version'] ?? '');
      const commit = String(body['commit'] ?? '');
      const site = String(body['site'] ?? 'luminal-game');
      const confirm = body['confirm'] === true;

      if (!confirm) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Must pass confirm: true to rollback' }));
        return true;
      }

      if (!commit || commit.length < 4) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Valid commit hash required for rollback' }));
        return true;
      }

      // Verify commit exists locally
      const { execSync } = await import('child_process');
      try {
        execSync(`git cat-file -t ${commit}`, { encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Commit not found locally',
          fallback: `https://console.firebase.google.com/project/${site}/hosting/sites`,
        }));
        return true;
      }

      // Execute rollback: stash, checkout, build, deploy, restore
      try {
        execSync('git stash', { cwd: process.cwd(), stdio: 'pipe' });
        try {
          execSync(`git checkout ${commit}`, { cwd: process.cwd(), stdio: 'pipe' });
          execSync('npm run build', { cwd: process.cwd(), stdio: 'pipe', timeout: 60000 });
          execSync(`firebase deploy --only hosting --project ${site}`, { cwd: process.cwd(), stdio: 'pipe', timeout: 60000 });
        } finally {
          try { execSync('git checkout -', { cwd: process.cwd(), stdio: 'pipe' }); } catch { /* best effort */ }
          try { execSync('git stash pop', { cwd: process.cwd(), stdio: 'pipe' }); } catch { /* may be empty */ }
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Rollback failed: ${safeError(err)}` }));
        return true;
      }

      // Log the rollback to deploy history
      const deploys = readJsonFile<DeployEntry[]>('deploy-history.json', []);
      deploys.push({
        version,
        timestamp: new Date().toISOString(),
        target: 'rollback',
        commit,
        branch: 'rollback',
        notes: [`Rolled back to ${version}`],
        duration: 0,
      });
      writeJsonFile('deploy-history.json', deploys);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rolledBackTo: version }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  return false;
}

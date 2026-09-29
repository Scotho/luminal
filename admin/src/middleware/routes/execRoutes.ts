import { spawn } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';
import { resolveCommand, formatSSE, ROOT, TIMEOUT_TEST, TIMEOUT_CLAUDE, TIMEOUT_SCRIPT, TIMEOUT_AIDER } from '../processPlugin';
import {
  agents,
  activeTestProcess,
  setActiveTestProcess,
  spawnLongRunning,
  killProcess,
  pauseProcess,
  resumeProcess,
} from '../processManager';
import { parseBody, readJsonFile } from '../processPlugin';
import { safeError } from './routeUtils';

interface OllamaConfig {
  defaultModel?: string;
  roles?: Record<string, string>;
}

function resolveAiderModel(bodyModel: unknown, config: OllamaConfig): string {
  if (typeof bodyModel === 'string' && bodyModel) return bodyModel;
  if (config.roles) {
    for (const [model, role] of Object.entries(config.roles)) {
      if (role === 'primary') return model;
    }
  }
  return config.defaultModel ?? 'qwen3-coder:latest';
}

export async function execRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;

  // ── POST /__admin_exec/test ──────────────────────
  if (method === 'POST' && url?.startsWith('/__admin_exec/test')) {
    if (activeTestProcess && !activeTestProcess.done) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'A test process is already running' }));
      return true;
    }
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const config = parsedUrl.searchParams.get('config') ?? '';
      const command = resolveCommand('test', { config });
      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid config' }));
        return true;
      }
      const state = spawnLongRunning('test', command, TIMEOUT_TEST, ROOT, { label: `test:${config}` });
      setActiveTestProcess(state);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agentId: state.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_exec/claude ────────────────────
  if (method === 'POST' && url === '/__admin_exec/claude') {
    try {
      const body = await parseBody(req);
      const prompt = String(body['prompt'] ?? '');
      const label = String(body['label'] ?? 'Claude');
      const resumeAgentId = body['resumeAgentId'] as string | undefined;
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or empty prompt' }));
        return true;
      }
      const args = ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions'];
      // Resume previous conversation if resumeAgentId is specified
      if (resumeAgentId) {
        const prev = agents.get(resumeAgentId);
        if (prev?.claudeSessionId) {
          args.push('--resume', prev.claudeSessionId);
        }
      }
      const effort = body['effort'] as string | undefined;
      const validEfforts = ['low', 'medium', 'high', 'max'];
      if (effort && validEfforts.includes(effort)) {
        args.push('--effort', effort);
      }
      args.push(prompt);
      const state = spawnLongRunning(
        'claude',
        'claude',
        TIMEOUT_CLAUDE,
        ROOT,
        { shell: false, args, label },
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agentId: state.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_exec/aider ────────────────────
  if (method === 'POST' && url === '/__admin_exec/aider') {
    try {
      const body = await parseBody(req);
      const prompt = String(body['prompt'] ?? '');
      const mode = body['mode'] === 'auto' ? 'auto' : 'suggest';
      const label = String(body['label'] ?? 'Aider');
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or empty prompt' }));
        return true;
      }

      const config = readJsonFile<OllamaConfig>('ollama-config.json', {});
      const model = resolveAiderModel(body['model'], config);

      const args = [
        '--message', prompt,
        '--model', `ollama_chat/${model}`,
        '--no-pretty',
        '--yes-always',
        '--no-show-model-warnings',
        '--edit-format', 'diff',
        '--encoding', 'utf-8',
      ];

      // Mode-specific flags
      if (mode === 'suggest') {
        args.push('--dry-run', '--no-auto-commits');
      } else {
        args.push('--auto-commits');
      }

      // Context injection — read-only project files
      const { existsSync } = await import('fs');
      const { resolve } = await import('path');
      const contextFiles = ['CLAUDE.md', '.claude/skills/_conventions/ref-system.md'];
      for (const f of contextFiles) {
        const fullPath = resolve(ROOT, f);
        if (existsSync(fullPath)) {
          args.push('--read', fullPath);
        }
      }

      // Additional files from request
      const files = Array.isArray(body['files']) ? body['files'] as string[] : [];
      for (const f of files) {
        args.push('--file', String(f));
      }
      const readFiles = Array.isArray(body['readFiles']) ? body['readFiles'] as string[] : [];
      for (const f of readFiles) {
        args.push('--read', String(f));
      }

      // If no explicit files were provided, use subtree-only so Aider can
      // discover and edit files from the repo rather than refusing to work.
      if (files.length === 0) {
        args.push('--subtree-only');
      }

      const state = spawnLongRunning(
        'aider',
        'aider',
        TIMEOUT_AIDER,
        ROOT,
        { shell: false, args, label },
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agentId: state.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_exec/script ────────────────────
  if (method === 'POST' && url?.startsWith('/__admin_exec/script')) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const name = parsedUrl.searchParams.get('name') ?? '';
      const command = resolveCommand('script', { name });
      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid script name' }));
        return true;
      }
      // Scripts are short-running — collect all output and return synchronously
      const proc = spawn(command, [], {
        shell: true,
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      const chunks: string[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()); });
      const killTimer = setTimeout(() => proc.kill('SIGTERM'), TIMEOUT_SCRIPT);
      proc.on('close', () => {
        clearTimeout(killTimer);
        const output = chunks.join('');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, output }));
      });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_exec/run ───────────────────────
  // Generic command runner for the scheduler. Only allows allowlisted scripts.
  if (method === 'POST' && url === '/__admin_exec/run') {
    try {
      const body = await parseBody(req);
      const command = String(body['command'] ?? '');
      // Validate: only allow `npx tsx admin/scripts/<name>.ts` pattern (no trailing args)
      const match = command.match(/^npx tsx admin\/scripts\/([a-z0-9-]+)\.ts$/);
      if (!match) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only admin scripts are allowed' }));
        return true;
      }
      const scriptName = match[1];
      const scriptCommand = resolveCommand('script', { name: scriptName });
      if (!scriptCommand) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Script "${scriptName}" not in allowlist` }));
        return true;
      }
      const proc = spawn(scriptCommand, [], {
        shell: true,
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      const chunks: string[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()); });
      proc.stderr?.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()); });
      const killTimer = setTimeout(() => proc.kill('SIGTERM'), 30_000);
      proc.on('close', (code) => {
        clearTimeout(killTimer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: code === 0, output: chunks.join('') }));
      });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_exec/stream?agent=ID ─────────────
  if (method === 'GET' && url?.startsWith('/__admin_exec/stream')) {
    const parsedUrl = new URL(url, 'http://localhost');
    const agentId = parsedUrl.searchParams.get('agent') ?? '';
    const state = agents.get(agentId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (!state) {
      res.write(formatSSE('status', { message: 'Agent not found' }));
      res.end();
      return true;
    }

    // Replay buffered output
    for (const chunk of state.output) {
      res.write(chunk);
    }

    if (state.done) {
      res.end();
      return true;
    }

    state.sseClients.add(res);
    req.on('close', () => { state.sseClients.delete(res); });
    return true;
  }

  // ── POST /__admin_exec/cancel?agent=ID ──────────
  if (method === 'POST' && url?.startsWith('/__admin_exec/cancel')) {
    const parsedUrl = new URL(url, 'http://localhost');
    const agentId = parsedUrl.searchParams.get('agent') ?? '';
    const state = agents.get(agentId);
    if (!state || state.done) {
      // Already done or never existed — treat as successful no-op
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, alreadyDone: true }));
      return true;
    }
    killProcess(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── POST /__admin_exec/pause?agent=ID ─────────────────────
  if (method === 'POST' && url?.startsWith('/__admin_exec/pause')) {
    const parsedUrl = new URL(url, 'http://localhost');
    const agentId = parsedUrl.searchParams.get('agent') ?? '';
    const state = agents.get(agentId);
    if (!state || state.done) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found or already done' }));
      return true;
    }
    const ok = pauseProcess(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok }));
    return true;
  }

  // ── POST /__admin_exec/resume?agent=ID ────────────────────
  if (method === 'POST' && url?.startsWith('/__admin_exec/resume')) {
    const parsedUrl = new URL(url, 'http://localhost');
    const agentId = parsedUrl.searchParams.get('agent') ?? '';
    const state = agents.get(agentId);
    if (!state || state.done) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found or already done' }));
      return true;
    }
    const ok = resumeProcess(state, TIMEOUT_CLAUDE);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok }));
    return true;
  }

  // ── POST /__admin_exec/redirect?agent=ID ─────────────────
  if (method === 'POST' && url?.startsWith('/__admin_exec/redirect')) {
    const parsedUrl = new URL(url, 'http://localhost');
    const agentId = parsedUrl.searchParams.get('agent') ?? '';
    const state = agents.get(agentId);
    if (!state) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return true;
    }
    try {
      const body = await parseBody(req);
      const message = String(body['message'] ?? '');
      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing redirect message' }));
        return true;
      }
      // Kill current agent, start new one with claudeSessionId + redirect message
      const claudeSessionId = state.claudeSessionId;
      if (!state.done) killProcess(state);

      const args = ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions'];
      if (claudeSessionId) args.push('--resume', claudeSessionId);
      args.push(message);
      const newState = spawnLongRunning('claude', 'claude', TIMEOUT_CLAUDE, ROOT, { shell: false, args, label: `Redirect: ${state.label}` });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, newAgentId: newState.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_exec/agents ─────────────────────
  if (method === 'GET' && url === '/__admin_exec/agents') {
    const list = Array.from(agents.values()).map(s => ({
      id: s.id,
      label: s.label,
      type: s.type,
      status: s.done ? (s.exitCode === 0 ? 'done' : 'error') : 'running',
      startedAt: s.startedAt,
      duration: s.duration,
      exitCode: s.exitCode,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return true;
  }

  // ── GET /__admin_exec/status ─────────────────────
  if (method === 'GET' && url === '/__admin_exec/status') {
    const all = Array.from(agents.values());
    const runningAgents = all.filter(a => !a.done);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      admin: true,                          // dashboard is up (this response proves it)
      agentsRunning: runningAgents.length > 0,
      running: runningAgents.length > 0,    // keep for backwards compat
      agents: all.map(a => ({
        id: a.id, label: a.label, type: a.type,
        done: a.done, exitCode: a.exitCode,
      })),
    }));
    return true;
  }

  // ── GET /__admin_exec/diff ──────────────────────
  if (method === 'GET' && url === '/__admin_exec/diff') {
    try {
      const proc = spawn('git', ['diff', '--stat', '--patch', '--no-color'], {
        cwd: ROOT,
        env: { ...process.env },
      });
      const chunks: string[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()); });
      proc.stderr?.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()); });
      const killTimer = setTimeout(() => proc.kill('SIGTERM'), 10_000);
      proc.on('close', () => {
        clearTimeout(killTimer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, diff: chunks.join('') }));
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_exec/claude-usage ─────────────
  // Reads live rate_limits from statusline wrapper output
  if (method === 'GET' && url === '/__admin_exec/claude-usage') {
    try {
      // Git Bash /tmp maps to $TEMP (AppData/Local/Temp), not C:/tmp
      const usagePath = process.platform === 'win32'
        ? `${process.env.TEMP || process.env.TMP || 'C:/tmp'}/claude-usage.json`
        : '/tmp/claude-usage.json';
      const { readFileSync, existsSync } = await import('fs');
      if (!existsSync(usagePath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available: false }));
        return true;
      }
      const raw = readFileSync(usagePath, 'utf-8');
      const data = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=5' });
      res.end(JSON.stringify({ available: true, ...data }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false }));
    }
    return true;
  }

  // ── GET /__admin_exec/version ───────────────────
  if (method === 'GET' && url === '/__admin_exec/version') {
    try {
      const { readFileSync } = await import('fs');
      const { resolve } = await import('path');
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as { version?: string };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: pkg.version ?? null }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: null }));
    }
    return true;
  }

  // ── GET /__admin_exec/read-file?path=... ───────────
  // Reads a project file for aider context injection. Path must be within ROOT.
  if (method === 'GET' && url?.startsWith('/__admin_exec/read-file')) {
    try {
      const { resolve } = await import('path');
      const { readFileSync, existsSync, statSync } = await import('fs');
      const parsedUrl = new URL(url, 'http://localhost');
      const rawPath = parsedUrl.searchParams.get('path') ?? '';
      if (!rawPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing path' }));
        return true;
      }
      const safePath = resolve(ROOT, rawPath.replace(/\\/g, '/'));
      if (!safePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path outside project root' }));
        return true;
      }
      if (!existsSync(safePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return true;
      }
      const content = readFileSync(safePath, 'utf-8');
      const mtime = statSync(safePath).mtimeMs;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content, mtime }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  return false;
}

import type { IncomingMessage, ServerResponse } from 'http';
import type { TaskEntry, CounterState, RefType } from '../../types';
import { parseBody, readJsonFile, writeJsonFile } from '../processPlugin';
import { COMMANDS, getDiscordCommands, formatCommandList } from '../../commandRegistry';
import { safeError } from './routeUtils';
import { sessionRoutes } from './sessionRoutes';
import { matrixRoutes } from './matrixRoutes';

export async function dataRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (await sessionRoutes(req, res)) return true;
  if (await matrixRoutes(req, res)) return true;

  const { method, url } = req;
  if (!url) return false;

  // ── GET /__admin_commands ───────────────────────
  if (method === 'GET' && url.startsWith('/__admin_commands')) {
    const params = new URL(url, 'http://localhost').searchParams;
    const format = params.get('format');       // 'text' | 'json' (default)
    const discord = params.get('discord');      // 'true' = only discord-triggerable
    const commands = discord === 'true' ? getDiscordCommands() : COMMANDS;
    if (format === 'text') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(formatCommandList(commands));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ commands }));
    }
    return true;
  }

  // ── POST /__admin_ref/next ──────────────────────
  if (method === 'POST' && url === '/__admin_ref/next') {
    try {
      const body = await parseBody(req);
      const VALID_TYPES = new Set<RefType>(['TASK', 'BUG', 'QA', 'SPEC']);
      const type = String(body['type'] ?? '') as RefType;
      if (!VALID_TYPES.has(type)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid type (TASK | BUG | QA | SPEC)' }));
        return true;
      }
      const counters = await readJsonFile<CounterState>('counters.json', { TASK: 1, BUG: 1, QA: 1, SPEC: 1 });
      const counter = counters[type];
      const ref = `${type}-${counter}`;
      counters[type] = counter + 1;
      await writeJsonFile('counters.json', counters);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ref, counter }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_task ───────────────────────────
  if (method === 'POST' && url === '/__admin_task') {
    try {
      const body = await parseBody(req);
      const tasks = await readJsonFile<TaskEntry[]>('tasks.json', []);
      const rawPri = Number(body['priority']);
      const priority = (rawPri >= 1 && rawPri <= 5) ? rawPri : 3;

      // Auto-assign ref if not provided
      let ref = body['ref'] as string | undefined;
      if (!ref) {
        const refType: RefType = body['tag'] === 'test-coverage' ? 'QA' : 'TASK';
        const counters = await readJsonFile<CounterState>('counters.json', { TASK: 1, BUG: 1, QA: 1, SPEC: 1 });
        ref = `${refType}-${counters[refType]}`;
        counters[refType] = counters[refType] + 1;
        await writeJsonFile('counters.json', counters);
      }

      const entry: TaskEntry = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ref,
        tag: String(body['tag'] ?? ''),
        prompt: String(body['prompt'] ?? ''),
        source: String(body['source'] ?? ''),
        status: 'pending',
        priority,
        created: new Date().toISOString(),
      };
      tasks.push(entry);
      await writeJsonFile('tasks.json', tasks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: entry.id, ref: entry.ref }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── PATCH /__admin_task ──────────────────────────
  if (method === 'PATCH' && url === '/__admin_task') {
    try {
      const body = await parseBody(req);
      const id = String(body['id'] ?? '');
      const tasks = await readJsonFile<TaskEntry[]>('tasks.json', []);
      const task = tasks.find(t => t.id === id);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return true;
      }
      if (body['status'] != null) {
        const newStatus = String(body['status']);
        if (newStatus !== 'pending' && newStatus !== 'done') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid status (pending | done)' }));
          return true;
        }
        task.status = newStatus;
        if (newStatus === 'done') {
          task.completed = new Date().toISOString();
        } else {
          delete task.completed;
        }
      }
      if (body['priority'] != null) {
        const p = Number(body['priority']);
        if (p >= 1 && p <= 5) task.priority = p;
      }
      if (body['tag'] != null) task.tag = String(body['tag']);
      task.modified = new Date().toISOString();
      await writeJsonFile('tasks.json', tasks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── PATCH /__admin_task/bulk ─────────────────────
  // Mark multiple tasks done/pending in one call
  if (method === 'PATCH' && url === '/__admin_task/bulk') {
    try {
      const body = await parseBody(req);
      const ids = body['ids'] as string[];
      const newStatus = String(body['status'] ?? 'done');
      if (newStatus !== 'pending' && newStatus !== 'done') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid status (pending | done)' }));
        return true;
      }
      const tasks = await readJsonFile<TaskEntry[]>('tasks.json', []);
      const now = new Date().toISOString();
      let updated = 0;
      for (const task of tasks) {
        if (ids.includes(task.id)) {
          task.status = newStatus as 'pending' | 'done';
          task.modified = now;
          if (newStatus === 'done') task.completed = now;
          else delete task.completed;
          updated++;
        }
      }
      await writeJsonFile('tasks.json', tasks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, updated }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_reminder ───────────────────────
  if (method === 'POST' && url === '/__admin_reminder') {
    try {
      const body = await parseBody(req);
      const reminders = await readJsonFile<unknown[]>('reminders.json', []);
      const entry = {
        id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: body['text'] ?? '',
        createdAt: new Date().toISOString(),
      };
      reminders.push(entry);
      await writeJsonFile('reminders.json', reminders);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: entry.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_audit ──────────────────────────
  if (method === 'POST' && url === '/__admin_audit') {
    try {
      const body = await parseBody(req);
      const name = String(body['name'] ?? '');
      const action = String(body['action'] ?? '');
      if (!name || action !== 'reset') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and action="reset" required' }));
        return true;
      }
      const audits = await readJsonFile<Record<string, unknown>>('audits.json', {});
      audits[name] = { ...((audits[name] as Record<string, unknown>) ?? {}), lastRun: new Date().toISOString() };
      await writeJsonFile('audits.json', audits);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_agent_history ──────────────────────
  if (method === 'GET' && new URL(url, 'http://localhost').pathname === '/__admin_agent_history') {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const limit = Number(parsedUrl.searchParams.get('limit') ?? '50');
      const entries = await readJsonFile<unknown[]>('agent-history.json', []);
      // Return newest first, capped at limit
      const sliced = entries.slice(-limit).reverse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entries: sliced, total: entries.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_agent_history ─────────────────────
  if (method === 'POST' && url === '/__admin_agent_history') {
    try {
      const body = await parseBody(req);
      const entries = await readJsonFile<unknown[]>('agent-history.json', []);
      entries.push(body);
      // Cap at 200 entries to prevent unbounded growth
      if (entries.length > 200) entries.splice(0, entries.length - 200);
      await writeJsonFile('agent-history.json', entries);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, total: entries.length }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── DELETE /__admin_agent_history ────────────────────
  if (method === 'DELETE' && url === '/__admin_agent_history') {
    try {
      await writeJsonFile('agent-history.json', []);
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

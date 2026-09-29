import type { IncomingMessage, ServerResponse } from 'http';
import type { Session, SessionPhase, AgentTask, TaskEntry, TestGateState, TestGateAttempt, Incident } from '../../types';
import { parseBody, readJsonFile, writeJsonFile } from '../processPlugin';
import { safeError } from './routeUtils';

/** Convert string phases to {label, done} objects. Passes objects through unchanged. */
function normalizePhases(raw: unknown): SessionPhase[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => {
    if (typeof p === 'string') return { label: p, done: false };
    if (p && typeof p === 'object' && 'label' in p) return p as SessionPhase;
    return { label: String(p), done: false };
  });
}

export async function sessionRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;

  // ── POST /__admin_session (create) ────────────────
  if (method === 'POST' && url === '/__admin_session') {
    try {
      const body = await parseBody(req);
      const sessions = await readJsonFile<Session[]>('sessions.json', []);
      const entry: Session = {
        id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        summary: String(body['summary'] ?? ''),
        type: (body['type'] ?? 'feature') as Session['type'],
        status: (body['status'] ?? 'todo') as Session['status'],
        section: (body['section'] ?? 'backlog') as Session['section'],
        phases: normalizePhases(body['phases'] ?? []),
        plan: String(body['plan'] ?? ''),
        ...(body['specPath'] != null ? { specPath: String(body['specPath']) } : {}),
        ...(body['branch'] != null ? { branch: String(body['branch']) } : {}),
        ...(Array.isArray(body['refs']) ? { refs: body['refs'] as string[] } : {}),
        source: 'admin' as const,
        notes: [],
        created: new Date().toISOString(),
      };
      sessions.push(entry);
      await writeJsonFile('sessions.json', sessions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: entry.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_session?id=X ───────────────────
  if (method === 'GET' && new URL(url, 'http://localhost').pathname === '/__admin_session') {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const id = parsedUrl.searchParams.get('id') ?? '';
      const sessions = await readJsonFile<Session[]>('sessions.json', []);
      const session = sessions.find(s => s.id === id);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── PATCH /__admin_session/phase ────────────────
  if (method === 'PATCH' && url === '/__admin_session/phase') {
    try {
      const body = await parseBody(req);
      const sessions = await readJsonFile<Session[]>('sessions.json', []);
      const session = sessions.find(s => s.id === body['id']);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return true;
      }
      const phases = session.phases;
      const index = Number(body['index']);
      if (!Number.isInteger(index) || index < 0 || index >= phases.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid phase index' }));
        return true;
      }
      phases[index].done = body['done'] as boolean;
      await writeJsonFile('sessions.json', sessions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── PATCH /__admin_session/status ───────────────
  if (method === 'PATCH' && url === '/__admin_session/status') {
    try {
      const body = await parseBody(req);
      const VALID_SESSION_STATUSES = new Set(['todo', 'active', 'blocked', 'done', 'done-followup', 'needs-attention']);
      const newStatus = String(body['status'] ?? '');
      if (!VALID_SESSION_STATUSES.has(newStatus)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid session status' }));
        return true;
      }
      const sessions = await readJsonFile<Session[]>('sessions.json', []);
      const session = sessions.find(s => s.id === body['id']);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return true;
      }
      session.status = newStatus as Session['status'];
      if (newStatus === 'done' || newStatus === 'done-followup') {
        session.completed = new Date().toISOString();
        // Cascade: mark linked tasks as done (resolve refs to task records)
        if (session.refs && session.refs.length > 0) {
          const taskRefs = session.refs.filter(r => r.startsWith('TASK-') || r.startsWith('QA-') || r.startsWith('BUG-'));
          if (taskRefs.length > 0) {
            const tasks = await readJsonFile<TaskEntry[]>('tasks.json', []);
            const now = new Date().toISOString();
            let changed = false;
            for (const task of tasks) {
              if (task.ref && taskRefs.includes(task.ref) && task.status !== 'done') {
                task.status = 'done';
                task.completed = now;
                task.modified = now;
                changed = true;
              }
            }
            if (changed) await writeJsonFile('tasks.json', tasks);
          }
        }
      } else {
        delete session.completed;
      }
      await writeJsonFile('sessions.json', sessions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_session/note ──────────────────
  if (method === 'POST' && url === '/__admin_session/note') {
    try {
      const body = await parseBody(req);
      const sessions = await readJsonFile<Session[]>('sessions.json', []);
      const session = sessions.find(s => s.id === body['id']);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return true;
      }
      session.notes.push({ ts: new Date().toISOString(), text: String(body['text'] ?? '') });
      await writeJsonFile('sessions.json', sessions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_session/agent-task (create) ───
  if (method === 'POST' && url === '/__admin_session/agent-task') {
    try {
      const body = await parseBody(req);
      const tasks = await readJsonFile<AgentTask[]>('agent-tasks.json', []);
      const entry: AgentTask = {
        id: `atask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: String(body['sessionId'] ?? ''),
        prompt: String(body['prompt'] ?? ''),
        agentStatus: 'pending',
      };
      tasks.push(entry);
      await writeJsonFile('agent-tasks.json', tasks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: entry.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── PATCH /__admin_session/agent-task (update) ──
  if (method === 'PATCH' && url === '/__admin_session/agent-task') {
    try {
      const body = await parseBody(req);
      const VALID_AGENT_STATUSES = new Set(['pending', 'running', 'done', 'error']);
      const newStatus = String(body['agentStatus'] ?? '');
      if (!VALID_AGENT_STATUSES.has(newStatus)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid agentStatus' }));
        return true;
      }
      const tasks = await readJsonFile<AgentTask[]>('agent-tasks.json', []);
      const task = tasks.find(t => t.id === body['id']);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent task not found' }));
        return true;
      }
      task.agentStatus = newStatus as AgentTask['agentStatus'];
      if (body['output'] != null) {
        task.output = String(body['output']);
      }
      await writeJsonFile('agent-tasks.json', tasks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_session/agent-task?id=X ────────
  if (method === 'GET' && url?.startsWith('/__admin_session/agent-task')) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const id = parsedUrl.searchParams.get('id') ?? '';
      const tasks = await readJsonFile<AgentTask[]>('agent-tasks.json', []);
      const task = tasks.find(t => t.id === id);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent task not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── PATCH /__admin_session/reorder ──────────────
  if (method === 'PATCH' && url === '/__admin_session/reorder') {
    try {
      const body = await parseBody(req);
      const ids = body['ids'] as string[];
      const reason = String(body['reason'] ?? '');
      const sessions = await readJsonFile<Session[]>('sessions.json', []);
      const previousOrder = sessions
        .filter(s => s.section === 'current-stack')
        .map(s => s.id);
      const reorderLog = await readJsonFile<unknown[]>('reorder-log.json', []);
      reorderLog.push({
        ts: new Date().toISOString(),
        previousOrder,
        newOrder: ids,
        reason,
      });
      await writeJsonFile('reorder-log.json', reorderLog);
      // Reorder: pull current-stack sessions out, sort by ids[], put back
      const stackSessions = sessions.filter(s => s.section === 'current-stack');
      const otherSessions = sessions.filter(s => s.section !== 'current-stack');
      const stackMap = new Map(stackSessions.map(s => [s.id, s]));
      const reordered = ids
        .filter(id => stackMap.has(id))
        .map(id => stackMap.get(id)!);
      // Append any current-stack sessions not in ids[] at the end
      for (const s of stackSessions) {
        if (!ids.includes(s.id)) reordered.push(s);
      }
      const finalSessions = [...reordered, ...otherSessions];
      await writeJsonFile('sessions.json', finalSessions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_session/test-gate (record attempt) ─
  if (method === 'POST' && url === '/__admin_session/test-gate') {
    try {
      const body = await parseBody(req);
      const sessionId = String(body['sessionId'] ?? '');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sessionId required' }));
        return true;
      }
      const gates = await readJsonFile<TestGateState[]>('test-gates.json', []);
      let gate = gates.find(g => g.sessionId === sessionId);
      if (!gate) {
        // First attempt — initialize gate state with baseline hashes
        gate = {
          sessionId,
          specHashAtPlan: String(body['specHash'] ?? ''),
          testFileHashesAtPlan: (body['testFileHashes'] ?? {}) as Record<string, string>,
          attempts: [],
          relaxed: false,
        };
        gates.push(gate);
      }

      const rawResults = (body['results'] ?? {}) as Record<string, unknown>;
      const attempt: TestGateAttempt = {
        ts: new Date().toISOString(),
        passed: Boolean(body['passed']),
        results: {
          unit: Boolean(rawResults['unit']),
          build: Boolean(rawResults['build']),
          lint: Boolean(rawResults['lint']),
          browser: Boolean(rawResults['browser']),
        },
        specHash: String(body['specHash'] ?? ''),
        testFileHashes: (body['testFileHashes'] ?? {}) as Record<string, string>,
      };
      if (body['notes']) attempt.notes = String(body['notes']);

      // Anti-gaming: detect spec or test parameter modifications
      const specTampered = gate.specHashAtPlan && attempt.specHash !== gate.specHashAtPlan;
      const testsTampered = Object.entries(gate.testFileHashesAtPlan).some(
        ([path, hash]) => attempt.testFileHashes[path] !== undefined && attempt.testFileHashes[path] !== hash
      );

      if (specTampered || testsTampered) {
        const tamperDetails = [
          specTampered ? 'spec file modified' : '',
          testsTampered ? 'test files modified' : '',
        ].filter(Boolean).join(', ');
        attempt.notes = `[ANTI-GAMING] Validation rejected: ${tamperDetails}. ${attempt.notes ?? ''}`.trim();
        attempt.passed = false;
      }

      gate.attempts.push(attempt);
      await writeJsonFile('test-gates.json', gates);

      const failCount = gate.attempts.filter(a => !a.passed).length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        passed: attempt.passed,
        tampered: specTampered || testsTampered,
        failCount,
        relaxed: gate.relaxed,
        canRelax: failCount >= 10 && !gate.relaxed,
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_session/test-gate?sessionId=X ─────
  if (method === 'GET' && url?.startsWith('/__admin_session/test-gate')) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const sessionId = parsedUrl.searchParams.get('sessionId') ?? '';
      const gates = await readJsonFile<TestGateState[]>('test-gates.json', []);
      const gate = gates.find(g => g.sessionId === sessionId);
      if (!gate) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No test gate found for this session' }));
        return true;
      }
      const failCount = gate.attempts.filter(a => !a.passed).length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...gate, failCount, canRelax: failCount >= 10 && !gate.relaxed }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_session/test-gate/relax ──────────
  // Requires 10+ failures. Auto-creates a validation-relaxation incident.
  if (method === 'POST' && url === '/__admin_session/test-gate/relax') {
    try {
      const body = await parseBody(req);
      const sessionId = String(body['sessionId'] ?? '');
      const reason = String(body['reason'] ?? '');
      if (!sessionId || !reason) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sessionId and reason required' }));
        return true;
      }

      const gates = await readJsonFile<TestGateState[]>('test-gates.json', []);
      const gate = gates.find(g => g.sessionId === sessionId);
      if (!gate) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No test gate found for this session' }));
        return true;
      }

      if (gate.relaxed) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Validation already relaxed for this session' }));
        return true;
      }

      const failCount = gate.attempts.filter(a => !a.passed).length;
      if (failCount < 10) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Minimum 10 failures required before relaxation. Current: ${failCount}`,
          failCount,
          remaining: 10 - failCount,
        }));
        return true;
      }

      // Look up session summary for incident title
      const sessions = await readJsonFile<Session[]>('sessions.json', []);
      const session = sessions.find(s => s.id === sessionId);
      const sessionLabel = session?.summary ?? sessionId;

      // Create audit incident
      const incidentId = `inc_${Date.now()}`;
      const incident: Incident = {
        id: incidentId,
        ts: Date.now(),
        type: 'validation-relaxation',
        title: `Test gate relaxed: ${sessionLabel}`,
        description: `Validation requirements relaxed after ${failCount} failures. Reason: ${reason}`,
        severity: 'major',
        resolved: false,
        source: 'test-gate',
        sessionRef: sessionId,
        failureCount: failCount,
      };

      const incidents = await readJsonFile<Incident[]>('incidents.json', []);
      incidents.push(incident);
      await writeJsonFile('incidents.json', incidents);

      // Mark gate as relaxed
      gate.relaxed = true;
      gate.relaxedAt = new Date().toISOString();
      gate.relaxedReason = reason;
      gate.incidentId = incidentId;
      await writeJsonFile('test-gates.json', gates);

      // Add note to session
      if (session) {
        session.notes.push({
          ts: new Date().toISOString(),
          text: `[Test Gate] Validation relaxed after ${failCount} failures. Reason: ${reason}. Incident: ${incidentId}`,
        });
        await writeJsonFile('sessions.json', sessions);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, incidentId, failCount }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  return false;
}

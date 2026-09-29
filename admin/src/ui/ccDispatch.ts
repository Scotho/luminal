import type { CCCard, CCSession } from '../types';
import { sessionManager, makeCard } from './ccSessionManager';

// ── Aider file-request detection ────────────────────────

const FILE_REQUEST_RE = /please add (?:these )?files? to (?:the )?chat/i;
const FILE_PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_/\\. -]*\.(ts|tsx|js|jsx|json|md|html|css|txt)$/;

function detectAiderFileRequests(cards: CCCard[]): string[] {
  const paths: string[] = [];
  for (const card of cards) {
    if (!FILE_REQUEST_RE.test(card.body)) continue;
    for (const line of card.body.split('\n')) {
      const trimmed = line.trim();
      if (FILE_PATH_RE.test(trimmed)) {
        paths.push(trimmed.replace(/\\/g, '/'));
      }
    }
  }
  return [...new Set(paths)];
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return h >>> 0;
}

async function fetchFileContent(path: string): Promise<{ content: string; hash: number } | null> {
  try {
    const res = await fetch(`/__admin_exec/read-file?path=${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    const data = await res.json() as { content: string };
    return { content: data.content, hash: simpleHash(data.content) };
  } catch {
    return null;
  }
}

/**
 * Detect aider file requests, fetch file contents (with staleness check),
 * and return an enriched prompt with file contents prepended.
 * Also adds/updates a file-context card on the session for UI feedback.
 */
async function injectAiderFileContext(
  sessionId: string,
  session: CCSession,
  prompt: string,
): Promise<string> {
  const requestedPaths = detectAiderFileRequests(session.cards);
  if (requestedPaths.length === 0) return prompt;

  const basenames = requestedPaths.map(p => p.split('/').pop() ?? p);

  // Add loading card
  const loadingCard: CCCard = {
    id: `fc-${Date.now()}`,
    type: 'file-context',
    title: 'Injecting context',
    preview: basenames.join(', '),
    body: '',
    ts: Date.now(),
    role: 'system',
    fileContextPaths: requestedPaths,
    fileContextLoading: true,
  };
  sessionManager.addCard(sessionId, loadingCard);

  // Fetch files, checking staleness against cached versions
  const contexts = session.aiderFileContexts ?? {};
  const fetched: Record<string, string> = {};
  let anyUpdated = false;

  for (const path of requestedPaths) {
    const cached = contexts[path];
    const fresh = await fetchFileContent(path);
    if (!fresh) continue;

    if (!cached || cached.hash !== fresh.hash) {
      contexts[path] = fresh;
      anyUpdated = true;
    }
    fetched[path] = contexts[path]?.content ?? fresh.content;
  }

  if (anyUpdated) {
    session.aiderFileContexts = contexts;
  }

  // Build enriched prompt
  const fileBlock = requestedPaths
    .filter(p => fetched[p])
    .map(p => `=== ${p} ===\n${fetched[p]}`)
    .join('\n\n');

  const enrichedPrompt = fileBlock
    ? `[File context — do not request these files again]\n\n${fileBlock}\n\n---\n${prompt}`
    : prompt;

  // Resolve the loading card
  const bodyLines = requestedPaths
    .filter(p => fetched[p])
    .map(p => `${p}\n${fetched[p]}`);
  sessionManager.updateCard(sessionId, loadingCard.id, {
    fileContextLoading: false,
    body: bodyLines.join('\n\n---\n\n'),
    preview: basenames.join(', '),
  });

  return enrichedPrompt;
}

// ── Task-result listener registry ───────────────────────

type ResultCallback = (sessionId: string, label: string, result: string) => void;
const _resultListeners: Set<ResultCallback> = new Set();

/** Register a callback that fires when a CC instance emits a task result. */
export function onTaskResult(cb: ResultCallback): () => void {
  _resultListeners.add(cb);
  return () => { _resultListeners.delete(cb); };
}

// ── Public dispatch helper ──────────────────────────────

/** Wire SSE listeners for a session's agent stream. */
export function wireAgentStream(session: CCSession, agentId: string): void {
  const es = new EventSource(`/__admin_exec/stream?agent=${encodeURIComponent(agentId)}`);
  sessionManager._registerStream(session.id, es);

  es.addEventListener('stdout', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse((ev as MessageEvent<string>).data) as { line: string };
      sessionManager.processLine(session.id, payload.line);
    } catch {
      sessionManager.processLine(session.id, (ev as MessageEvent<string>).data);
    }
  });

  es.addEventListener('stderr', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse((ev as MessageEvent<string>).data) as { line: string };
      sessionManager.processLine(session.id, payload.line, true);
    } catch {
      sessionManager.processLine(session.id, (ev as MessageEvent<string>).data, true);
    }
  });

  es.addEventListener('task-result', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse((ev as MessageEvent<string>).data) as {
        result: string;
        session_id: string | null;
        usage: unknown;
      };
      _resultListeners.forEach(cb => cb(session.id, session.label, payload.result));
    } catch (err) {
      console.warn('[ccDispatch] Failed to parse SSE result event:', err);
    }
  });

  let completed = false;
  const complete = (code: number): void => {
    if (completed) return;
    completed = true;
    es.close();
    clearInterval(livenessCheck);
    sessionManager.completeSession(session.id, code);
  };

  es.addEventListener('exit', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse((ev as MessageEvent<string>).data) as { code: number };
      complete(payload.code ?? 1);
    } catch {
      complete(1);
    }
  });

  // Retry up to 3 times before declaring connection lost — Aider model loading
  // can cause brief idle periods that trigger EventSource reconnects
  let retries = 0;
  const MAX_RETRIES = 3;
  es.onerror = () => {
    const s = sessionManager.all().find(s => s.id === session.id);
    if (!s || s.status !== 'running') { complete(1); return; }

    retries++;
    if (retries > MAX_RETRIES) {
      sessionManager.processLine(session.id, 'Stream connection lost.', true);
      complete(1);
    }
    // Let EventSource auto-reconnect (built-in browser behavior)
  };

  // Liveness check — poll backend every 30s to detect agents that exited
  // without the exit SSE event being received (race condition / network drop)
  const livenessCheck = setInterval(async () => {
    if (completed) { clearInterval(livenessCheck); return; }
    const s = sessionManager.all().find(s => s.id === session.id);
    if (!s || s.status !== 'running') { clearInterval(livenessCheck); return; }
    try {
      const res = await fetch(`/__admin_exec/status`);
      const data = await res.json() as { agents: Array<{ id: string; done: boolean; exitCode: number | null }> };
      const agent = data.agents?.find(a => a.id === agentId);
      if (agent?.done) {
        complete(agent.exitCode ?? 0);
      } else if (!agent) {
        // Agent no longer tracked by backend — it exited and was cleaned up
        complete(0);
      }
    } catch { /* status endpoint unavailable — skip this check */ }
  }, 30_000);
}

export async function dispatchCC(label: string, prompt: string, opts?: { effort?: string }): Promise<string> {
  document.getElementById('cc-flyout')?.classList.remove('collapsed');

  let agentId: string;
  try {
    const res = await fetch('/__admin_exec/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, label, effort: opts?.effort }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
      const session = sessionManager.createSession(label);
      sessionManager.processLine(session.id, `Failed to start: ${data.error}`, true);
      sessionManager.completeSession(session.id, 1);
      return session.id;
    }
    const body = await res.json() as { agentId: string };
    agentId = body.agentId;
  } catch (e) {
    const session = sessionManager.createSession(label);
    sessionManager.processLine(session.id, `Failed to start: ${String(e)}`, true);
    sessionManager.completeSession(session.id, 1);
    return session.id;
  }

  const session = sessionManager.createSession(label, agentId);
  session.prompt = prompt;
  wireAgentStream(session, agentId);
  return session.id;
}

/** Send a follow-up message that resumes a previous agent's conversation. */
export async function dispatchCCResume(prompt: string, resumeAgentId?: string): Promise<string> {
  document.getElementById('cc-flyout')?.classList.remove('collapsed');

  let agentId: string;
  try {
    const res = await fetch('/__admin_exec/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, label: 'Follow-up', resumeAgentId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
      const session = sessionManager.createSession('Follow-up');
      sessionManager.processLine(session.id, `Failed to resume: ${data.error}`, true);
      sessionManager.completeSession(session.id, 1);
      return session.id;
    }
    const body = await res.json() as { agentId: string };
    agentId = body.agentId;
  } catch (e) {
    const session = sessionManager.createSession('Follow-up');
    sessionManager.processLine(session.id, `Failed to resume: ${String(e)}`, true);
    sessionManager.completeSession(session.id, 1);
    return session.id;
  }

  const session = sessionManager.createSession('Follow-up', agentId);
  session.prompt = prompt;
  wireAgentStream(session, agentId);
  return session.id;
}

/**
 * Continue an existing conversation session with a follow-up message.
 * Instead of creating a new session/tab, appends to the existing conversation thread.
 */
export async function continueConversation(
  sessionId: string,
  prompt: string,
  backend: 'cc' | 'ollama' | 'aider' = 'cc',
  model?: string,
): Promise<string> {
  document.getElementById('cc-flyout')?.classList.remove('collapsed');

  // Add user message to the existing conversation thread
  sessionManager.addUserMessage(sessionId, prompt);

  const existingSession = sessionManager.all().find(s => s.id === sessionId);
  if (!existingSession) {
    // Fallback: create new session if original not found
    return backend === 'ollama'
      ? dispatchOllama('Chat', prompt, model)
      : dispatchCC('Agent', prompt);
  }

  if (backend === 'ollama') {
    // Ollama continuation — reuse session
    const s = sessionManager.continueSession(sessionId, '');
    if (!s) return sessionId;

    try {
      const res = await fetch('/__admin_exec/ollama-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
        sessionManager.processLine(sessionId, `Failed: ${data.error}`, true);
        sessionManager.completeSession(sessionId, 1);
        return sessionId;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const pump = async (): Promise<void> => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';
          for (const evt of events) {
            const lines = evt.split('\n');
            const eventLine = lines.find(l => l.startsWith('event:'));
            const dataLine = lines.find(l => l.startsWith('data:'));
            if (!eventLine || !dataLine) continue;
            const eventType = eventLine.slice(6).trim();
            try {
              const payload = JSON.parse(dataLine.slice(5));
              if (eventType === 'stdout') {
                sessionManager.processLine(sessionId, payload.line ?? '');
              } else if (eventType === 'stderr') {
                sessionManager.processLine(sessionId, payload.line ?? '', true);
              } else if (eventType === 'exit') {
                sessionManager.completeSession(sessionId, payload.code ?? 0);
              }
            } catch {
              sessionManager.processLine(sessionId, dataLine.slice(5));
            }
          }
        }
        const current = sessionManager.all().find(s => s.id === sessionId);
        if (current?.status === 'running') {
          sessionManager.completeSession(sessionId, 0);
        }
      };

      pump().catch(() => {
        sessionManager.processLine(sessionId, 'Stream connection lost.', true);
        sessionManager.completeSession(sessionId, 1);
      });
    } catch (e) {
      sessionManager.processLine(sessionId, `Failed: ${String(e)}`, true);
      sessionManager.completeSession(sessionId, 1);
    }

    return sessionId;
  }

  if (backend === 'aider') {
    // Aider continuation — inject any pending file context, then spawn
    const enrichedPrompt = await injectAiderFileContext(sessionId, existingSession, prompt);
    const continued = sessionManager.continueSession(sessionId, '');
    if (!continued) return sessionId;

    let agentId: string;
    try {
      const mode = existingSession.aiderMode ?? 'suggest';
      const res = await fetch('/__admin_exec/aider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enrichedPrompt, mode, model, label: existingSession.label }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
        sessionManager.processLine(sessionId, `Failed to continue: ${data.error}`, true);
        sessionManager.completeSession(sessionId, 1);
        return sessionId;
      }
      const body = await res.json() as { agentId: string };
      agentId = body.agentId;
    } catch (e) {
      sessionManager.processLine(sessionId, `Failed to continue: ${String(e)}`, true);
      sessionManager.completeSession(sessionId, 1);
      return sessionId;
    }

    continued.agentIds.push(agentId);
    continued.lastAgentId = agentId;
    wireAgentStream(continued, agentId);
    return sessionId;
  }

  // CC continuation — transition session to running state first, then fetch
  const resumeAgentId = existingSession.lastAgentId;
  const continued = sessionManager.continueSession(sessionId, '');
  if (!continued) return sessionId;

  let agentId: string;
  try {
    const res = await fetch('/__admin_exec/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, label: existingSession.label, resumeAgentId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
      sessionManager.processLine(sessionId, `Failed to continue: ${data.error}`, true);
      sessionManager.completeSession(sessionId, 1);
      return sessionId;
    }
    const body = await res.json() as { agentId: string };
    agentId = body.agentId;
  } catch (e) {
    sessionManager.processLine(sessionId, `Failed to continue: ${String(e)}`, true);
    sessionManager.completeSession(sessionId, 1);
    return sessionId;
  }

  // Update the session with the real agent ID and wire the stream
  continued.agentIds.push(agentId);
  continued.lastAgentId = agentId;
  wireAgentStream(continued, agentId);
  return sessionId;
}

/** Dispatch a prompt to Ollama via the admin middleware. */
export async function dispatchOllama(label: string, prompt: string, model?: string): Promise<string> {
  document.getElementById('cc-flyout')?.classList.remove('collapsed');

  const session = sessionManager.createSession(label, undefined, 'ollama');
  session.prompt = prompt;

  try {
    const res = await fetch('/__admin_exec/ollama-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model }),
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
      sessionManager.processLine(session.id, `Failed to start: ${data.error}`, true);
      sessionManager.completeSession(session.id, 1);
      return session.id;
    }

    // Read SSE stream from the middleware
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const pump = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const evt of events) {
          const lines = evt.split('\n');
          const eventLine = lines.find(l => l.startsWith('event:'));
          const dataLine = lines.find(l => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;
          const eventType = eventLine.slice(6).trim();
          try {
            const payload = JSON.parse(dataLine.slice(5));
            if (eventType === 'stdout') {
              sessionManager.processLine(session.id, payload.line ?? '');
            } else if (eventType === 'stderr') {
              sessionManager.processLine(session.id, payload.line ?? '', true);
            } else if (eventType === 'exit') {
              sessionManager.completeSession(session.id, payload.code ?? 0);
            }
          } catch {
            sessionManager.processLine(session.id, dataLine.slice(5));
          }
        }
      }
      // If stream ends without exit event, complete
      const s = sessionManager.all().find(s => s.id === session.id);
      if (s?.status === 'running') {
        sessionManager.completeSession(session.id, 0);
      }
    };

    pump().catch(() => {
      sessionManager.processLine(session.id, 'Stream connection lost.', true);
      sessionManager.completeSession(session.id, 1);
    });
  } catch (e) {
    sessionManager.processLine(session.id, `Failed to start: ${String(e)}`, true);
    sessionManager.completeSession(session.id, 1);
  }

  return session.id;
}

/**
 * Send an image + prompt to a vision-capable Ollama model (e.g. qwen2.5-vl:7b).
 * `image` must be a raw base64-encoded string (no data URI prefix).
 * Returns the concatenated text response.
 */
export async function dispatchVision(
  image: string,
  prompt: string,
  model?: string,
): Promise<string> {
  const resp = await fetch('/__admin_exec/ollama-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, prompt, model: model ?? 'qwen2.5-vl:7b' }),
  });

  if (!resp.ok) throw new Error(`Vision request failed: ${resp.status}`);

  // Read SSE stream, accumulate NDJSON responses
  const text = await resp.text();
  const lines = text.split('\n').filter(l => l.startsWith('data: '));
  let result = '';
  for (const line of lines) {
    try {
      const data = JSON.parse(line.slice(6)) as { response?: string };
      if (data.response) result += data.response;
    } catch { /* skip malformed lines */ }
  }
  return result;
}

/** Dispatch a prompt to Aider via the admin middleware. */
export async function dispatchAider(
  label: string,
  prompt: string,
  mode: 'suggest' | 'auto' = 'suggest',
  model?: string,
): Promise<string> {
  document.getElementById('cc-flyout')?.classList.remove('collapsed');

  let agentId: string;
  try {
    const res = await fetch('/__admin_exec/aider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode, model, label }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
      const session = sessionManager.createSession(label, undefined, 'aider');
      sessionManager.processLine(session.id, `Failed to start: ${data.error}`, true);
      sessionManager.completeSession(session.id, 1);
      return session.id;
    }
    const body = await res.json() as { agentId: string };
    agentId = body.agentId;
  } catch (e) {
    const session = sessionManager.createSession(label, undefined, 'aider');
    sessionManager.processLine(session.id, `Failed to start: ${String(e)}`, true);
    sessionManager.completeSession(session.id, 1);
    return session.id;
  }

  const session = sessionManager.createSession(label, agentId, 'aider');
  session.prompt = prompt;
  session.aiderMode = mode;
  wireAgentStream(session, agentId);
  return session.id;
}

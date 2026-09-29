import type { CCSession, CCCard, CCCardType, CCCardRole, CCUsage, CCUsageRecord } from '../types';
import { escapeHtml } from './render';
import { bus } from './eventBus';
import { persistOllamaUsage } from './ccUsage';
import { updatePoolHealth, getPoolHealth } from './agentPools';
import {
  bufferIfGating,
  onToolUseStart,
  onToolInputDelta,
  onToolUseStop,
  willGate,
} from './permissionGatewayBridge';

// ── Stream-JSON event parsing ───────────────────────────

export interface StreamEvent {
  type: string;
  subtype?: string;
  event?: {
    delta?: { type: string; text?: string; partial_json?: string };
    type?: string;
  };
  tool_name?: string;
  tool_input?: unknown;
  tool_result?: unknown;
  result?: string;
  session_id?: string;
  [key: string]: unknown;
}

export function tryParseStreamJson(line: string): StreamEvent | null {
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return null;
  }
}

// ── Card builder ────────────────────────────────────────

let _cardSeq = 0;

export function makeCard(
  type: CCCardType,
  title: string,
  preview: string,
  body: string,
  opts?: { role?: CCCardRole; depth?: number; agentLabel?: string; toolStatus?: 'running' | 'done' | 'error' },
): CCCard {
  return {
    id: `card-${Date.now()}-${_cardSeq++}`,
    type,
    title,
    preview: preview.slice(0, 300),
    body,
    ts: Date.now(),
    role: opts?.role,
    depth: opts?.depth,
    agentLabel: opts?.agentLabel,
    toolStatus: opts?.toolStatus,
  };
}

export function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') + '\n...';
}

// ── Output line classification (kept for fallback) ──────

export function classifyOutputLine(line: string): CCCardType {
  if (/✓|PASS|Found \d|Fixed /i.test(line)) return 'text';
  if (/✗|FAIL|Error:|error:/i.test(line)) return 'error';
  if (/Warning:|warning:/i.test(line)) return 'system';
  return 'text';
}

// ── SessionManager ──────────────────────────────────────

const MAX_HISTORY = 10;
const TAB_STORAGE_KEY = 'luminal-agent-tabs';

// Forward declaration — resolved at runtime via setter to avoid circular imports
let _dispatchCC: (label: string, prompt: string) => Promise<string>;
let _persistUsage: (session: CCSession) => Promise<void>;

export function _setDispatchCC(fn: (label: string, prompt: string) => Promise<string>): void {
  _dispatchCC = fn;
}

export function _setPersistUsage(fn: (session: CCSession) => Promise<void>): void {
  _persistUsage = fn;
}

export class SessionManager {
  private _sessions: CCSession[] = [];
  private _listeners: Set<() => void> = new Set();
  private _textAccum: Map<string, string> = new Map();
  private _textDebounce: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _streams: Map<string, EventSource> = new Map();
  private _selectedId: string | null = null;
  private _pinned: Set<string> = new Set();
  private _queue: { label: string; prompt: string }[] = [];
  private _maxConcurrent = 3;
  /** Track agent nesting depth per session for subagent visual nesting. */
  private _agentDepth: Map<string, number> = new Map();

  togglePin(sessionId: string): void {
    if (this._pinned.has(sessionId)) {
      this._pinned.delete(sessionId);
    } else {
      this._pinned.add(sessionId);
    }
    this._notify();
  }

  isPinned(sessionId: string): boolean {
    return this._pinned.has(sessionId);
  }

  createSession(label: string, agentId?: string, backend: 'cc' | 'ollama' | 'aider' = 'cc'): CCSession {
    const id = agentId ?? `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: CCSession = {
      id,
      label,
      status: 'running',
      startedAt: Date.now(),
      duration: null,
      cards: [],
      result: null,
      usage: null,
      exitCode: null,
      prompt: null,
      backend,
      agentIds: agentId ? [agentId] : [],
      lastAgentId: agentId ?? null,
      lastActivityTs: Date.now(),
    };
    this._sessions.unshift(session);
    if (this._sessions.length > MAX_HISTORY) {
      this._sessions = this._sessions.filter((s, i) => i < MAX_HISTORY || this._pinned.has(s.id));
    }
    this._textAccum.set(session.id, '');
    this._agentDepth.set(session.id, 0);
    this._selectedId = session.id;
    // Track pool health: increment dispatched count + active count
    const poolIdCreate = backend === 'cc' ? 'claude' : 'local';
    const prevHealth = getPoolHealth(poolIdCreate);
    const activeCreate = this._sessions.filter(s => s.status === 'running' && (s.backend === 'cc' ? 'claude' : 'local') === poolIdCreate).length;
    updatePoolHealth(poolIdCreate, {
      totalDispatched: prevHealth.totalDispatched + 1,
      activeCount: activeCreate,
    });
    this._notify();
    return session;
  }

  /** Add an arbitrary card to an existing session and notify. */
  addCard(sessionId: string, card: CCCard): void {
    const s = this._sessions.find(s => s.id === sessionId);
    if (!s) return;
    s.cards.push(card);
    this._notify();
  }

  /** Update fields on an existing card by id and notify. */
  updateCard(sessionId: string, cardId: string, updates: Partial<CCCard>): void {
    const s = this._sessions.find(s => s.id === sessionId);
    if (!s) return;
    const card = s.cards.find(c => c.id === cardId);
    if (!card) return;
    Object.assign(card, updates);
    this._notify();
  }

  /** Add a user message card to an existing session (for follow-ups in conversation thread). */
  addUserMessage(sessionId: string, text: string): void {
    const s = this._sessions.find(s => s.id === sessionId);
    if (!s) return;
    s.cards.push(makeCard('text', 'You', text, text, { role: 'user' }));
    this._notify();
  }

  /** Attach a new agent stream to an existing session for conversation continuity.
   *  Returns the session so the caller can wire up the new stream. */
  continueSession(sessionId: string, agentId: string): CCSession | null {
    const s = this._sessions.find(s => s.id === sessionId);
    if (!s) return null;
    if (agentId) {
      s.agentIds.push(agentId);
      s.lastAgentId = agentId;
    }
    s.status = 'running';
    s.exitCode = null;
    this._textAccum.set(sessionId, '');
    this._agentDepth.set(sessionId, 0);
    this._selectedId = sessionId;
    this._notify();
    return s;
  }

  get selectedId(): string | null { return this._selectedId; }
  set selectedId(id: string | null) {
    if (this._selectedId !== id) {
      this._selectedId = id;
      this._notify();
    }
  }

  selected(): CCSession | null {
    if (!this._selectedId) return null;
    return this._sessions.find(s => s.id === this._selectedId) ?? null;
  }

  /** All sessions that are currently running. */
  running(): CCSession[] {
    return this._sessions.filter(s => s.status === 'running');
  }

  /** Process a raw stdout/stderr line from the CC stream. */
  processLine(sessionId: string, line: string, isStderr = false): void {
    // Permission gateway: buffer lines while a gate check is in progress
    if (bufferIfGating(sessionId, line, isStderr)) return;

    const s = this._sessions.find(s => s.id === sessionId);
    if (!s) return;
    s.lastActivityTs = Date.now();
    if (s._stallNotified) s._stallNotified = false;
    const depth = this._agentDepth.get(sessionId) ?? 0;

    if (isStderr) {
      // stderr lines become error/system cards
      const type = /error/i.test(line) ? 'error' : 'system';
      const title = type === 'error' ? 'Error' : 'System';
      s.cards.push(makeCard(type, title, truncateLines(line, 3), line, { role: 'system', depth }));
      this._notify();
      return;
    }

    const event = tryParseStreamJson(line);
    if (!event) {
      // Plain text fallback
      this._appendText(sessionId, line);
      return;
    }

    // Handle different stream-json event types
    if (event.type === 'stream_event') {
      const delta = event.event?.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        s.progressText = undefined;
        this._appendText(sessionId, delta.text);
        return;
      }
      // Tool use events
      if (delta?.type === 'input_json_delta') {
        // Forward partial JSON to permission gateway bridge for arg accumulation
        const partialJson = typeof delta.partial_json === 'string'
          ? delta.partial_json
          : typeof delta.text === 'string' ? delta.text : '';
        if (partialJson) onToolInputDelta(partialJson);
        return;
      }
    }

    if (event.type === 'content_block_start') {
      // Clear transient progress text when a real block starts
      s.progressText = undefined;
      // Flush any pending text before a new block
      this._flushText(sessionId, s);

      const contentBlock = event.content_block as { type?: string; name?: string } | undefined;
      if (contentBlock?.type === 'tool_use') {
        const toolName = contentBlock.name ?? 'unknown';
        // Notify permission gateway bridge of tool use start
        onToolUseStart(sessionId, toolName, s.cards.length);
        const isAgent = toolName === 'Agent';
        if (isAgent) {
          // Agent dispatch — increase nesting depth
          const agentCard = makeCard('tool', `Agent`, 'Dispatching subagent...', '', {
            role: 'agent',
            depth,
            agentLabel: 'Subagent',
            toolStatus: 'running',
          });
          agentCard.toolStartTs = Date.now();
          s.cards.push(agentCard);
          this._agentDepth.set(sessionId, depth + 1);
        } else {
          const toolCard = makeCard('tool', toolName, `Calling ${toolName}...`, '', {
            role: 'tool',
            depth,
            toolStatus: 'running',
          });
          toolCard.toolStartTs = Date.now();
          s.cards.push(toolCard);
        }
        this._notify();
      }
      return;
    }

    if (event.type === 'content_block_stop') {
      this._flushText(sessionId, s);
      // Permission gateway: await the gate check — if denied, mark card as
      // error and cancel the session instead of proceeding normally.
      this._handleContentBlockStop(sessionId, s);
      return;
    }

    if (event.type === 'message_start' || event.type === 'message_delta' || event.type === 'message_stop') {
      // Lifecycle events — flush text on stop
      if (event.type === 'message_stop') {
        this._flushText(sessionId, s);
      }
      // Accumulate token usage from usage fields in lifecycle events
      if (event.usage) {
        const usage = event.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
        if (usage.input_tokens != null) {
          if (!s.tokenCount) s.tokenCount = { input: 0, output: 0, cacheRead: 0 };
          s.tokenCount.input = usage.input_tokens;
          s.tokenCount.output = usage.output_tokens ?? s.tokenCount.output;
          s.tokenCount.cacheRead = usage.cache_read_input_tokens ?? s.tokenCount.cacheRead;
        }
      }
      return;
    }

    if (event.type === 'system') {
      const subtype = event.subtype ?? '';
      const detail = this._formatSystemEvent(event, subtype);
      if (detail === null) return; // silently swallowed (e.g. redundant lifecycle noise)
      // Consolidate hook pairs: update existing hook_started card when hook_response arrives
      if (subtype === 'hook_response') {
        const hookId = event.hook_id as string | undefined;
        if (hookId) {
          const existing = [...s.cards].reverse().find(c =>
            c._systemSubtype === 'hook_started' && c._hookId === hookId,
          );
          if (existing) {
            const outcome = (event.outcome as string) ?? 'done';
            const icon = outcome === 'success' ? '\u2713' : '\u2717';
            existing.preview = `${existing.preview.replace(/\u2026$/, '')} ${icon}`;
            existing._systemSubtype = 'hook_response';
            existing.body = JSON.stringify(event, null, 2);
            this._notify();
            return;
          }
        }
      }
      // Consolidate task lifecycle: task_started → task_progress → task_notification
      if (subtype === 'task_progress' || subtype === 'task_notification') {
        const taskId = event.task_id as string | undefined;
        if (taskId) {
          const existing = [...s.cards].reverse().find(c =>
            (c._systemSubtype === 'task_started' || c._systemSubtype === 'task_progress')
            && c._taskId === taskId,
          );
          if (existing) {
            existing.preview = detail;
            existing._systemSubtype = subtype;
            existing.body = JSON.stringify(event, null, 2);
            if (subtype === 'task_notification') {
              const status = (event.status as string) ?? 'done';
              existing.preview = detail + (status === 'completed' ? ' \u2713' : ` (${status})`);
            }
            this._notify();
            return;
          }
        }
      }
      const card = makeCard('system', 'System', detail, JSON.stringify(event, null, 2), { role: 'system', depth });
      card._systemSubtype = subtype;
      if (subtype === 'hook_started') card._hookId = (event.hook_id as string) ?? undefined;
      if (subtype === 'task_started') card._taskId = (event.task_id as string) ?? undefined;
      s.cards.push(card);
      this._notify();
      return;
    }

    // rate_limit_event is a top-level type, not a system subtype
    if (event.type === 'rate_limit_event') {
      const info = event.rate_limit_info as { status?: string; rateLimitType?: string; resetsAt?: number } | undefined;
      if (info?.status === 'allowed') return; // don't clutter with "allowed" events
      const status = info?.status ?? 'unknown';
      const limitType = info?.rateLimitType ?? '';
      const detail = `Rate limit: ${status}${limitType ? ` (${limitType})` : ''}`;
      s.cards.push(makeCard('system', 'System', detail, JSON.stringify(event, null, 2), { role: 'system', depth }));
      this._notify();
      return;
    }

    // tool_progress — elapsed time updates for running tools (update existing tool card)
    if (event.type === 'tool_progress') {
      const elapsed = event.elapsed_time_seconds as number | undefined;
      const toolName = event.tool_name as string | undefined;
      if (elapsed != null && toolName) {
        const lastTool = [...s.cards].reverse().find(c => c.role === 'tool' && c.toolStatus === 'running');
        if (lastTool) {
          lastTool.toolDuration = Math.round(elapsed * 1000);
        }
      }
      // Don't create a card — this updates existing tool cards
      return;
    }

    if (event.type === 'task_progress') {
      // Transient progress text — update the session's progress indicator
      const msg = typeof event.message === 'string'
        ? event.message
        : typeof (event.task as Record<string, unknown>)?.message === 'string'
          ? (event.task as Record<string, unknown>).message as string
          : typeof event.content === 'string'
            ? event.content
            : '';
      if (msg) {
        s.progressText = msg;
        this._notify();
      }
      return;
    }

    if (event.type === 'assistant') {
      // Assistant message — complete turn with text + tool_use content blocks.
      // Unlike stream_event/text_delta (live), these represent finished text.
      const msg = event.message as { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }> } | undefined;
      if (msg?.content) {
        this._flushText(sessionId, s);
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            // Create a finalized text card directly (not via _appendText which is for streaming)
            s.cards.push(makeCard('text', 'Response', truncateLines(block.text, 4), block.text, { role: 'assistant', depth, toolStatus: 'done' }));
          }
          if (block.type === 'tool_use' && block.name) {
            const toolName = block.name;
            const isAgent = toolName === 'Agent';
            // Build a preview from the input
            let preview = `${toolName}`;
            if (block.input && typeof block.input === 'object') {
              const inp = block.input as Record<string, unknown>;
              if (inp.file_path) preview = `${toolName} ${inp.file_path}`;
              else if (inp.command) preview = `${toolName}: ${truncateLines(String(inp.command), 1)}`;
              else if (inp.pattern) preview = `${toolName}: ${inp.pattern}`;
              else if (inp.prompt) preview = `${toolName}: ${truncateLines(String(inp.prompt), 1)}`;
              else if (inp.description) preview = `${toolName}: ${truncateLines(String(inp.description), 1)}`;
            }
            const body = block.input ? JSON.stringify(block.input, null, 2) : '';
            s.cards.push(makeCard('tool', preview, truncateLines(body, 3), body, {
              role: isAgent ? 'agent' : 'tool',
              depth,
              toolStatus: 'done',
            }));
          }
        }
        this._notify();
      }
      return;
    }

    if (event.type === 'user') {
      // Tool result flowing back to Claude — attach result to the matching tool card
      const msg = event.message as { content?: Array<{ type?: string; content?: string; tool_use_id?: string; is_error?: boolean }> } | undefined;
      if (msg?.content) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && typeof block.content === 'string') {
            const resultText = block.content;
            // Find the last completed tool card (prefer matching by tool_use_id, fall back to most recent)
            const lastTool = [...s.cards].reverse().find(c =>
              (c.role === 'tool' || c.role === 'agent') && c.toolStatus === 'done',
            );
            if (lastTool) {
              // Append result to body, keeping input if present
              const inputSection = lastTool.body ? lastTool.body : '';
              const separator = inputSection ? '\n\n--- Result ---\n' : '';
              lastTool.body = inputSection + separator + truncateLines(resultText, 20);
              lastTool.toolResult = truncateLines(resultText, 6);
              if (block.is_error) {
                lastTool.toolStatus = 'error';
              }
              this._notify();
            }
          }
        }
      }
      return;
    }

    if (event.type === 'result') {
      s.progressText = undefined;
      this._flushText(sessionId, s);
      const resultText = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '', null, 2);
      s.result = resultText;
      // Capture usage
      const rawUsage = event.usage as Record<string, number> | undefined;
      if (rawUsage) {
        s.usage = {
          inputTokens: rawUsage.input_tokens ?? 0,
          outputTokens: rawUsage.output_tokens ?? 0,
          cacheRead: rawUsage.cache_read_input_tokens,
          cacheCreation: rawUsage.cache_creation_input_tokens,
        };
      }
      s.cards.push(makeCard('result', 'Result', truncateLines(resultText, 4), resultText, { role: 'assistant', depth }));
      this._notify();
      return;
    }

    // Unknown event — show as system card
    s.cards.push(makeCard('system', 'Event', truncateLines(line, 3), line, { role: 'system', depth }));
    this._notify();
  }

  /**
   * Format a system event into a human-readable one-liner.
   * Returns null if the event should be silently swallowed.
   */
  private _formatSystemEvent(event: StreamEvent, subtype: string): string | null {
    switch (subtype) {
      case 'init': {
        const model = (event.model as string) ?? 'unknown';
        const version = (event.claude_code_version as string) ?? '';
        return `Session init \u2014 ${model}${version ? ` (v${version})` : ''}`;
      }
      case 'hook_started': {
        const name = (event.hook_name as string) ?? 'hook';
        return `Hook: ${name}\u2026`;
      }
      case 'hook_response': {
        const name = (event.hook_name as string) ?? 'hook';
        const outcome = (event.outcome as string) ?? 'done';
        const icon = outcome === 'success' ? '\u2713' : '\u2717';
        return `Hook: ${name} ${icon}`;
      }
      case 'hook_progress': {
        const name = (event.hook_name as string) ?? 'hook';
        return `Hook: ${name} (running)`;
      }
      case 'api_retry':
        return `API retry (attempt ${event.attempt ?? '?'}/${event.max_retries ?? '?'})`;
      case 'task_started': {
        const desc = (event.description as string) ?? 'background task';
        const taskType = (event.task_type as string) ?? '';
        return taskType === 'local_agent'
          ? `Subagent: ${desc}`
          : `Task: ${desc}`;
      }
      case 'task_progress': {
        const desc = (event.description as string) ?? '';
        const usage = event.usage as { tool_uses?: number; duration_ms?: number } | undefined;
        const tools = usage?.tool_uses ?? 0;
        const dur = usage?.duration_ms;
        const durStr = dur != null ? ` (${(dur / 1000).toFixed(1)}s)` : '';
        return `${desc || 'Working'}${tools ? ` \u2014 ${tools} tool calls` : ''}${durStr}`;
      }
      case 'task_notification': {
        const desc = (event.summary as string) ?? (event.description as string) ?? 'task';
        const status = (event.status as string) ?? 'done';
        return `${desc} \u2014 ${status}`;
      }
      case 'compact_boundary':
        return 'Context compacted';
      case 'status':
        return null; // permission mode updates — not useful in UI
      case 'session_state_changed':
        return null; // internal state machine — not useful in UI
      case 'post_turn_summary':
        return null; // internal summary — not useful in UI
      case 'files_persisted':
        return null; // file I/O complete — not useful in UI
      default:
        return subtype || 'system event';
    }
  }

  private _appendText(sessionId: string, text: string): void {
    const current = this._textAccum.get(sessionId) ?? '';
    this._textAccum.set(sessionId, current + text);
    // Debounce card creation + notify to avoid per-character DOM thrashing
    const existing = this._textDebounce.get(sessionId);
    if (existing) clearTimeout(existing);
    this._textDebounce.set(sessionId, setTimeout(() => {
      this._textDebounce.delete(sessionId);
      this._updateLiveTextCard(sessionId);
    }, 80));
  }

  private _updateLiveTextCard(sessionId: string): void {
    const s = this._sessions.find(s => s.id === sessionId);
    if (!s) return;
    const text = this._textAccum.get(sessionId) ?? '';
    if (!text.trim()) return;
    const depth = this._agentDepth.get(sessionId) ?? 0;

    // Find or create the trailing assistant text card
    const lastCard = s.cards[s.cards.length - 1];
    if (lastCard && lastCard.type === 'text' && lastCard.role === 'assistant') {
      lastCard.body = text;
      lastCard.preview = truncateLines(text, 4);
    } else {
      s.cards.push(makeCard('text', 'Response', truncateLines(text, 4), text, { role: 'assistant', depth }));
    }
    this._notify();
  }

  private _flushText(sessionId: string, s: CCSession): void {
    const text = this._textAccum.get(sessionId) ?? '';
    const depth = this._agentDepth.get(sessionId) ?? 0;
    if (text.trim()) {
      // Ensure the last text card is finalized
      const lastCard = s.cards[s.cards.length - 1];
      if (lastCard && lastCard.type === 'text' && lastCard.role === 'assistant') {
        lastCard.body = text;
        lastCard.preview = truncateLines(text, 4);
      } else {
        s.cards.push(makeCard('text', 'Response', truncateLines(text, 4), text, { role: 'assistant', depth }));
      }
    }
    this._textAccum.set(sessionId, '');
  }

  /**
   * Handle content_block_stop: check permission gateway, then mark the tool
   * card as done (approved) or error + cancel (denied).
   *
   * When the gateway is disabled or the tool is auto-approved, this runs
   * synchronously so callers can assert card state immediately. Only when a
   * modal must be shown does it defer via the async onToolUseStop path.
   */
  private _handleContentBlockStop(sessionId: string, s: CCSession): void {
    if (!willGate()) {
      // Fast path — no modal needed; fire onToolUseStop (returns immediately)
      // and mark the card synchronously.
      onToolUseStop(sessionId).catch(() => { /* gate check failed */ });
      this._markLastCardDone(sessionId, s);
      return;
    }

    // Slow path — modal will be shown. Defer card-marking until resolved.
    onToolUseStop(sessionId)
      .then((denied) => {
        if (denied) {
          this._markLastCardError(sessionId, s);
          this.cancelSession(sessionId);
          return;
        }
        this._markLastCardDone(sessionId, s);
      })
      .catch(() => {
        this._markLastCardDone(sessionId, s);
      });
  }

  /** Mark the last running tool/agent card as done and adjust depth. */
  private _markLastCardDone(sessionId: string, s: CCSession): void {
    const lastRunning = [...s.cards].reverse().find(c =>
      (c.role === 'tool' || c.role === 'agent') && c.toolStatus === 'running'
    );
    if (lastRunning) {
      lastRunning.toolStatus = 'done';
      if (lastRunning.toolStartTs != null) {
        lastRunning.toolDuration = Date.now() - lastRunning.toolStartTs;
      }
      if (lastRunning.role === 'agent') {
        const d = this._agentDepth.get(sessionId) ?? 1;
        this._agentDepth.set(sessionId, Math.max(0, d - 1));
      }
    }
    this._notify();
  }

  /** Mark the last running tool/agent card as error. */
  private _markLastCardError(_sessionId: string, s: CCSession): void {
    const lastRunning = [...s.cards].reverse().find(c =>
      (c.role === 'tool' || c.role === 'agent') && c.toolStatus === 'running'
    );
    if (lastRunning) {
      lastRunning.toolStatus = 'error';
      if (lastRunning.toolStartTs != null) {
        lastRunning.toolDuration = Date.now() - lastRunning.toolStartTs;
      }
    }
  }

  /** Store an EventSource for later cleanup. */
  _registerStream(sessionId: string, es: EventSource): void {
    this._streams.set(sessionId, es);
  }

  completeSession(sessionId: string, exitCode: number): void {
    const s = this._sessions.find(s => s.id === sessionId);
    if (s) {
      this._flushText(sessionId, s);
      s.status = exitCode === 0 ? 'done' : 'error';
      s.exitCode = exitCode;
      s.duration = Date.now() - s.startedAt;
      // Generate summary — append at end (not unshift) to preserve conversation order.
      // For multi-turn conversations, only add if no summary exists for this round.
      const summaryText = this._generateSummary(s);
      if (summaryText) {
        s.cards.push(makeCard('result', 'Summary', summaryText, summaryText, { role: 'system' }));
      }
      // Extract suggested tasks from result
      const suggestions = this._extractTaskSuggestions(s);
      if (suggestions.length > 0) {
        const suggestCard = makeCard(
          'system',
          `${suggestions.length} Suggested Tasks`,
          suggestions.map(sg => `\u2022 ${sg.slice(0, 60)}`).join('\n'),
          suggestions.map((sg, i) => `${i + 1}. ${sg}`).join('\n'),
        );
        s.cards.push(suggestCard);
      }
      this._textAccum.delete(sessionId);
      this._agentDepth.delete(sessionId);
      const pendingDebounce = this._textDebounce.get(sessionId);
      if (pendingDebounce) { clearTimeout(pendingDebounce); this._textDebounce.delete(sessionId); }
      const es = this._streams.get(sessionId);
      if (es) { es.close(); this._streams.delete(sessionId); }
      // Persist usage
      if (s.usage) {
        _persistUsage(s);
      }
      // Persist Ollama/Aider usage (estimated from text content)
      if (s.backend === 'ollama' || s.backend === 'aider') {
        persistOllamaUsage(s);
      }
      // Update pool health on completion: recalculate active count + rolling avg duration
      const poolIdComplete = s.backend === 'cc' ? 'claude' : 'local';
      const activeComplete = this._sessions.filter(
        sess => sess.status === 'running' && (sess.backend === 'cc' ? 'claude' : 'local') === poolIdComplete
      ).length;
      const prevHealthComplete = getPoolHealth(poolIdComplete);
      const dispatched = prevHealthComplete.totalDispatched;
      const completedSoFar = dispatched > 0 ? dispatched - 1 : 0;
      const newAvg = s.duration != null && dispatched > 0
        ? Math.round((prevHealthComplete.avgDurationMs * completedSoFar + s.duration) / dispatched)
        : prevHealthComplete.avgDurationMs;
      updatePoolHealth(poolIdComplete, { activeCount: activeComplete, avgDurationMs: newAvg });
      // Auto-link to active dashboard session
      this._tryLinkToSession(s);
      bus.emit('cc:done', { label: s.label, exitCode });
      this._notify();
      this._drainQueue();
    }
  }

  cancelSession(sessionId: string): void {
    const s = this._sessions.find(s => s.id === sessionId);
    if (s) {
      this._flushText(sessionId, s);
      s.status = 'cancelled';
      s.duration = Date.now() - s.startedAt;
      this._textAccum.delete(sessionId);
      this._agentDepth.delete(sessionId);
      const pendingDebounce2 = this._textDebounce.get(sessionId);
      if (pendingDebounce2) { clearTimeout(pendingDebounce2); this._textDebounce.delete(sessionId); }
      const es = this._streams.get(sessionId);
      if (es) { es.close(); this._streams.delete(sessionId); }
      // Update pool health on cancel
      const poolIdCancel = s.backend === 'cc' ? 'claude' : 'local';
      const activeCancel = this._sessions.filter(
        sess => sess.status === 'running' && (sess.backend === 'cc' ? 'claude' : 'local') === poolIdCancel
      ).length;
      updatePoolHealth(poolIdCancel, { activeCount: activeCancel });
      this._notify();
      this._drainQueue();
    }
  }

  closeSession(sessionId: string): void {
    const closing = this._sessions.find(s => s.id === sessionId);
    if (closing) this._archiveSession(closing);
    this._sessions = this._sessions.filter(s => s.id !== sessionId);
    this._pinned.delete(sessionId);
    if (this._selectedId === sessionId) {
      this._selectedId = this._sessions[0]?.id ?? null;
    }
    this.persistOpenTabs();
    this._notify();
  }

  closeAllDone(): void {
    for (const s of this._sessions) {
      if (s.status !== 'running') this._archiveSession(s);
    }
    this._sessions = this._sessions.filter(s => s.status === 'running');
    for (const id of [...this._pinned]) {
      if (!this._sessions.some(s => s.id === id)) this._pinned.delete(id);
    }
    if (!this._sessions.some(s => s.id === this._selectedId)) {
      this._selectedId = this._sessions[0]?.id ?? null;
    }
    this.persistOpenTabs();
    this._notify();
  }

  getAllSessions(): CCSession[] {
    return [...this._sessions];
  }

  persistOpenTabs(): void {
    const ids = this._sessions.map(s => s.id);
    localStorage.setItem('luminal-open-tabs', JSON.stringify(ids));
  }

  _resetForTesting(): void {
    this._sessions = [];
    this._selectedId = null;
    this._pinned.clear();
    this._queue = [];
    this._textAccum.clear();
    this._agentDepth.clear();
    this._textDebounce.clear();
  }

  /** Serialize tab state to sessionStorage so it survives HMR/reload. */
  private _persist(): void {
    try {
      const state = {
        sessions: this._sessions,
        selectedId: this._selectedId,
        pinned: [...this._pinned],
      };
      sessionStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(state));
    } catch { /* sessionStorage full or unavailable — ignore */ }
  }

  /** Restore tab state from sessionStorage (called on init / HMR). */
  _restoreFromStorage(): void {
    try {
      const raw = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as {
        sessions: CCSession[];
        selectedId: string | null;
        pinned: string[];
      };
      if (!Array.isArray(state.sessions)) return;
      this._sessions = state.sessions;
      this._selectedId = state.selectedId;
      this._pinned = new Set(state.pinned ?? []);
      this._notify();
    } catch { /* corrupt data — start fresh */ }
  }

  /** Archive a session's full log to the server before destroying it. */
  private _archiveSession(session: CCSession): void {
    const entry = {
      id: session.id,
      label: session.label,
      backend: session.backend,
      status: session.status,
      startedAt: session.startedAt,
      closedAt: new Date().toISOString(),
      duration: session.duration,
      usage: session.usage,
      exitCode: session.exitCode,
      prompt: session.prompt,
      cards: session.cards,
    };
    // Fire-and-forget POST
    fetch('/__admin_agent_history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => { /* best-effort — don't block UI */ });
  }

  /** Remove a session tab entirely (cancel first if still running). */
  removeSession(sessionId: string): void {
    const s = this._sessions.find(s => s.id === sessionId);
    if (!s) return;
    this._archiveSession(s);
    // Close stream if still open
    const es = this._streams.get(sessionId);
    if (es) { es.close(); this._streams.delete(sessionId); }
    this._textAccum.delete(sessionId);
    this._agentDepth.delete(sessionId);
    const pendingDebounce3 = this._textDebounce.get(sessionId);
    if (pendingDebounce3) { clearTimeout(pendingDebounce3); this._textDebounce.delete(sessionId); }
    this._pinned.delete(sessionId);
    this._sessions = this._sessions.filter(s => s.id !== sessionId);
    if (this._selectedId === sessionId) {
      this._selectedId = this._sessions[0]?.id ?? null;
    }
    this._notify();
  }

  private _extractTaskSuggestions(session: CCSession): string[] {
    const suggestions: string[] = [];
    const resultCard = session.cards.find(c => c.type === 'result' && c.title === 'Result');
    if (!resultCard) return suggestions;

    const lines = resultCard.body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // TODO/FIX/BUG patterns
      if (/^(TODO|FIXME|FIX|BUG|HACK):/i.test(trimmed)) {
        suggestions.push(trimmed);
      }
      // Checkbox items
      if (/^-\s*\[\s*\]/.test(trimmed)) {
        suggestions.push(trimmed.replace(/^-\s*\[\s*\]\s*/, ''));
      }
      // Numbered action items starting with action verbs
      if (/^\d+\.\s*(Add|Fix|Update|Create|Remove|Refactor|Implement|Write|Test|Check)\b/i.test(trimmed)) {
        suggestions.push(trimmed.replace(/^\d+\.\s*/, ''));
      }
    }

    return suggestions.slice(0, 10); // cap at 10
  }

  private _generateSummary(session: CCSession): string {
    const lines: string[] = [];

    // Count card types
    const toolCards = session.cards.filter(c => c.type === 'tool');
    const errorCards = session.cards.filter(c => c.type === 'error');
    const resultCard = session.cards.find(c => c.type === 'result');

    // Status line
    const status = session.exitCode === 0 ? 'Completed successfully' : `Failed (exit ${session.exitCode})`;
    const dur = session.duration ? `${Math.round(session.duration / 1000)}s` : '?';
    lines.push(`${status} in ${dur}`);

    // Tool usage
    if (toolCards.length > 0) {
      const toolNames = [...new Set(toolCards.map(c => c.title.replace('Tool: ', '')))];
      lines.push(`Tools used: ${toolNames.join(', ')}`);
    }

    // Errors
    if (errorCards.length > 0) {
      lines.push(`${errorCards.length} error(s) encountered`);
    }

    // Result preview (first 100 chars of result)
    if (resultCard && resultCard.body) {
      const preview = resultCard.body.split('\n')[0].slice(0, 100);
      if (preview) lines.push(preview);
    }

    // Token usage
    if (session.usage) {
      const total = session.usage.inputTokens + session.usage.outputTokens;
      const fmt = total >= 1000 ? `${(total / 1000).toFixed(1)}K` : String(total);
      lines.push(`Tokens: ${fmt}`);
    }

    return lines.join('\n');
  }

  /** Enqueue a prompt. Dispatches immediately if under concurrency limit. */
  enqueue(label: string, prompt: string): void {
    if (this.running().length < this._maxConcurrent) {
      // Dispatch immediately — don't await, fire and forget
      _dispatchCC(label, prompt);
    } else {
      this._queue.push({ label, prompt });
      this._notify();
    }
  }

  /** Check queue and dispatch next if under limit. Called on session complete. */
  private _drainQueue(): void {
    while (this._queue.length > 0 && this.running().length < this._maxConcurrent) {
      const next = this._queue.shift()!;
      _dispatchCC(next.label, next.prompt);
    }
    if (this._queue.length > 0 || this.running().length > 0) {
      this._notify();
    }
  }

  queueLength(): number { return this._queue.length; }
  getQueue(): { label: string; prompt: string }[] { return [...this._queue]; }
  removeFromQueue(index: number): void {
    this._queue.splice(index, 1);
    this._notify();
  }

  active(): CCSession | null {
    return this._sessions.find(s => s.status === 'running') ?? null;
  }

  all(): CCSession[] {
    return [...this._sessions];
  }

  onChange(cb: () => void): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  private _notify(): void {
    for (const cb of this._listeners) cb();
    this._persist();
  }

  private async _tryLinkToSession(session: CCSession): Promise<void> {
    try {
      const res = await fetch('/data/sessions.json');
      if (!res.ok) return;
      const sessions = await res.json() as { id: string; status: string }[];
      if (!Array.isArray(sessions)) return;
      const active = sessions.find(s => s.status === 'active');
      if (!active) return;

      // Post a note to the active session with agent result summary
      const summary = session.cards.find(c => c.type === 'result')?.preview ?? session.label;
      await fetch('/__admin_session/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: active.id,
          text: `[Agent: ${session.label}] ${session.exitCode === 0 ? 'Completed' : 'Failed'} — ${summary.slice(0, 150)}`,
        }),
      });
    } catch { /* best-effort */ }
  }
}

// ── Singleton ───────────────────────────────────────────

export const sessionManager = new SessionManager();

// Restore persisted tabs on module load (survives Vite HMR)
sessionManager._restoreFromStorage();

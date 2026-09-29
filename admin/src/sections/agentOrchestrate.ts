// admin/src/sections/agentOrchestrate.ts — Multi-agent orchestration UI

import { icon } from '../ui/icons';
import { dispatchCC } from '../ui/ccDispatch';
import { sessionManager } from '../ui/ccSessionManager';
import { escapeHtml } from '../ui/render';

export type OrchTaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface OrchTask {
  id: string;
  prompt: string;
  priority: number;           // 1 (critical) – 5 (low)
  status: OrchTaskStatus;
  sessionId: string | null;
  startedAt: number | null;
  duration: number | null;
}

let _tasks: OrchTask[] = [];
let _dispatching = false;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _unsub: (() => void) | null = null;
const STORAGE_KEY = 'luminal-orch-tasks';

export function getTasks(): OrchTask[] {
  return [..._tasks];
}

export function addTask(prompt: string, priority = 3): OrchTask {
  const task: OrchTask = {
    id: `orch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    prompt,
    priority: Math.max(1, Math.min(5, priority)),
    status: 'pending',
    sessionId: null,
    startedAt: null,
    duration: null,
  };
  _tasks.push(task);
  _saveTasks();
  return task;
}

export function removeTask(taskId: string): boolean {
  const idx = _tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;
  if (_tasks[idx].status !== 'pending') return false;
  _tasks.splice(idx, 1);
  _saveTasks();
  return true;
}

export function clearDone(): void {
  _tasks = _tasks.filter(t => t.status !== 'done' && t.status !== 'failed');
  _saveTasks();
}

export function importFromPlan(text: string): OrchTask[] {
  const added: OrchTask[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Match numbered items, bullet items, or checkbox items
    const match = trimmed.match(/^(?:\d+[.)]\s*|\*\s+|-\s+(?:\[[ x]\]\s*)?)(.*)/i);
    if (match && match[1].trim().length > 5) {
      added.push(addTask(match[1].trim()));
    }
  }
  return added;
}

export async function dispatchAll(): Promise<void> {
  if (_dispatching) return;
  _dispatching = true;

  const pending = _tasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => a.priority - b.priority);

  for (const task of pending) {
    task.status = 'running';
    task.startedAt = Date.now();
    try {
      const sessionId = await dispatchCC(`Orch: ${task.prompt.slice(0, 40)}`, task.prompt);
      task.sessionId = sessionId;
    } catch {
      task.status = 'failed';
      task.duration = Date.now() - (task.startedAt ?? Date.now());
    }
  }

  _dispatching = false;
  _saveTasks();
  _render();
}

export function getProgress(): { total: number; done: number; failed: number; running: number; pending: number } {
  const total = _tasks.length;
  const done = _tasks.filter(t => t.status === 'done').length;
  const failed = _tasks.filter(t => t.status === 'failed').length;
  const running = _tasks.filter(t => t.status === 'running').length;
  const pending = _tasks.filter(t => t.status === 'pending').length;
  return { total, done, failed, running, pending };
}

export function _resetForTesting(): void {
  _tasks = [];
  _dispatching = false;
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_unsub) { _unsub(); _unsub = null; }
}

function _saveTasks(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_tasks));
  } catch { /* quota exceeded — ignore */ }
}

function _loadTasks(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OrchTask[];
      if (Array.isArray(parsed)) _tasks = parsed;
    }
  } catch { /* corrupt — start fresh */ }
}

function _syncStatuses(): void {
  const sessions = sessionManager.getAllSessions();
  let changed = false;

  for (const task of _tasks) {
    if (task.status !== 'running' || !task.sessionId) continue;
    const session = sessions.find(s => s.id === task.sessionId);
    if (!session) continue;

    if (session.status === 'done') {
      task.status = 'done';
      task.duration = session.duration ?? (Date.now() - (task.startedAt ?? Date.now()));
      changed = true;
    } else if (session.status === 'error' || session.status === 'cancelled') {
      task.status = 'failed';
      task.duration = session.duration ?? (Date.now() - (task.startedAt ?? Date.now()));
      changed = true;
    }
  }

  if (changed) {
    _saveTasks();
    _render();
  }
}

function _statusBadge(status: OrchTaskStatus): string {
  const colors: Record<OrchTaskStatus, string> = {
    pending: 'var(--text-dim)',
    running: '#60a5fa',
    done: '#34d399',
    failed: '#f87171',
  };
  const pulse = status === 'running' ? 'animation:pulse 1.5s ease-in-out infinite;' : '';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:${colors[status]};border:1px solid ${colors[status]};${pulse}">${status}</span>`;
}

function _prioritySelector(task: OrchTask): string {
  const opts = [1, 2, 3, 4, 5]
    .map(n => `<option value="${n}" ${task.priority === n ? 'selected' : ''}>P${n}</option>`)
    .join('');
  return `<select data-task-priority="${task.id}" style="background:var(--surface);color:var(--text-dim);border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:11px;font-family:var(--font-mono);" ${task.status !== 'pending' ? 'disabled' : ''}>${opts}</select>`;
}

function _formatDuration(ms: number | null, startedAt: number | null): string {
  if (ms != null) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (startedAt != null) {
    return `${((Date.now() - startedAt) / 1000).toFixed(0)}s...`;
  }
  return '--';
}

function _render(): void {
  const mount = document.getElementById('section-agent-orchestrate');
  if (!mount) return;

  const progress = getProgress();
  const pct = progress.total > 0 ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 0;
  const hasPending = _tasks.some(t => t.status === 'pending');
  const hasDone = _tasks.some(t => t.status === 'done' || t.status === 'failed');

  mount.innerHTML = `
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .orch-task-row:hover { background: rgba(255,255,255,0.03); }
      .orch-btn { background:var(--surface);color:var(--text-dim);border:1px solid var(--border);border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:var(--font-body);transition:all 0.15s; }
      .orch-btn:hover { color:var(--accent);border-color:var(--accent); }
      .orch-btn-primary { background:var(--accent);color:#000;border-color:var(--accent);font-weight:600; }
      .orch-btn-primary:hover { opacity:0.85; }
      .orch-btn-primary:disabled { opacity:0.4;cursor:not-allowed; }
      .orch-textarea { width:100%;min-height:60px;background:var(--surface);color:#e5e5e5;border:1px solid var(--border);border-radius:4px;padding:8px;font-size:12px;font-family:var(--font-mono);resize:vertical; }
      .orch-textarea:focus { border-color:var(--accent);outline:none; }
    </style>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <span style="font-size:14px;font-weight:600;color:var(--accent);">${icon('sparkles', 16)} Orchestrate</span>
      <button class="orch-btn" id="orch-add-btn">${icon('list-checks', 14)} Add Task</button>
      <button class="orch-btn" id="orch-import-btn">${icon('clipboard-check', 14)} Import from Plan</button>
      <button class="orch-btn orch-btn-primary" id="orch-dispatch-btn" ${!hasPending ? 'disabled' : ''}>${icon('play', 14)} Dispatch All</button>
      ${hasDone ? `<button class="orch-btn" id="orch-clear-btn">${icon('trash-2', 14)} Clear Done</button>` : ''}
    </div>

    <div id="orch-task-list">
      ${_tasks.length === 0
        ? `<div style="color:var(--text-dim);font-size:12px;padding:20px 0;text-align:center;">No tasks yet. Add tasks or import from a plan document.</div>`
        : _tasks.map((task, i) => `
          <div class="orch-task-row" data-task-idx="${i}" style="display:flex;align-items:flex-start;gap:10px;padding:8px;border-bottom:1px solid var(--border);">
            <span style="color:var(--text-dim);font-size:11px;font-family:var(--font-mono);min-width:24px;padding-top:4px;">#${i + 1}</span>
            ${_prioritySelector(task)}
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;color:#e5e5e5;word-break:break-word;white-space:pre-wrap;">${escapeHtml(task.prompt.length > 200 ? task.prompt.slice(0, 200) + '...' : task.prompt)}</div>
              ${task.sessionId ? `<div style="margin-top:2px;font-size:10px;"><a href="#" data-session-link="${task.sessionId}" style="color:var(--accent);text-decoration:none;">agent: ${escapeHtml(task.sessionId.slice(0, 12))}</a></div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);min-width:50px;text-align:right;">${_formatDuration(task.duration, task.startedAt)}</span>
              ${_statusBadge(task.status)}
              ${task.status === 'pending' ? `<button class="orch-btn" data-remove-task="${task.id}" style="padding:3px 6px;" title="Remove">${icon('x', 12)}</button>` : ''}
            </div>
          </div>
        `).join('')}
    </div>

    ${progress.total > 0 ? `
      <div style="margin-top:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="flex:1;height:6px;background:var(--surface);border-radius:3px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${progress.failed > 0 ? '#f87171' : 'var(--accent)'};transition:width 0.3s;border-radius:3px;"></div>
          </div>
          <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">${progress.done + progress.failed}/${progress.total} (${pct}%)</span>
        </div>
        <div style="display:flex;gap:14px;font-size:11px;color:var(--text-dim);">
          <span>${icon('clock', 12)} Pending: ${progress.pending}</span>
          <span style="color:#60a5fa;">${icon('activity', 12)} Running: ${progress.running}</span>
          <span style="color:#34d399;">${icon('list-checks', 12)} Done: ${progress.done}</span>
          ${progress.failed > 0 ? `<span style="color:#f87171;">${icon('alert-triangle', 12)} Failed: ${progress.failed}</span>` : ''}
        </div>
      </div>
    ` : ''}

    <div id="orch-import-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:none;align-items:center;justify-content:center;">
      <div style="background:#1a1a1a;border:1px solid var(--border);border-radius:8px;padding:20px;width:500px;max-width:90vw;">
        <div style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:10px;">Import Tasks from Plan</div>
        <textarea id="orch-import-text" class="orch-textarea" style="min-height:160px;" placeholder="Paste a plan document here. Numbered lists, bullet points, and checkboxes will be extracted as tasks."></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">
          <button class="orch-btn" id="orch-import-cancel">Cancel</button>
          <button class="orch-btn orch-btn-primary" id="orch-import-confirm">Import</button>
        </div>
      </div>
    </div>

    <div id="orch-add-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:none;align-items:center;justify-content:center;">
      <div style="background:#1a1a1a;border:1px solid var(--border);border-radius:8px;padding:20px;width:500px;max-width:90vw;">
        <div style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:10px;">Add Task</div>
        <textarea id="orch-add-text" class="orch-textarea" placeholder="Enter the agent prompt for this task..."></textarea>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;">
          <label style="font-size:11px;color:var(--text-dim);">Priority:</label>
          <select id="orch-add-priority" style="background:var(--surface);color:var(--text-dim);border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;font-family:var(--font-mono);">
            <option value="1">P1 - Critical</option>
            <option value="2">P2 - High</option>
            <option value="3" selected>P3 - Normal</option>
            <option value="4">P4 - Low</option>
            <option value="5">P5 - Minimal</option>
          </select>
          <div style="flex:1;"></div>
          <button class="orch-btn" id="orch-add-cancel">Cancel</button>
          <button class="orch-btn orch-btn-primary" id="orch-add-confirm">Add</button>
        </div>
      </div>
    </div>
  `;

  _wireEvents();
}

function _wireEvents(): void {
  // Add task button
  document.getElementById('orch-add-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('orch-add-modal');
    if (modal) modal.style.display = 'flex';
  });

  document.getElementById('orch-add-cancel')?.addEventListener('click', () => {
    const modal = document.getElementById('orch-add-modal');
    if (modal) modal.style.display = 'none';
  });

  document.getElementById('orch-add-confirm')?.addEventListener('click', () => {
    const textarea = document.getElementById('orch-add-text') as HTMLTextAreaElement | null;
    const select = document.getElementById('orch-add-priority') as HTMLSelectElement | null;
    const prompt = textarea?.value.trim();
    if (!prompt) return;
    const priority = parseInt(select?.value ?? '3', 10);
    addTask(prompt, priority);
    const modal = document.getElementById('orch-add-modal');
    if (modal) modal.style.display = 'none';
    _render();
  });

  // Import button
  document.getElementById('orch-import-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('orch-import-modal');
    if (modal) modal.style.display = 'flex';
  });

  document.getElementById('orch-import-cancel')?.addEventListener('click', () => {
    const modal = document.getElementById('orch-import-modal');
    if (modal) modal.style.display = 'none';
  });

  document.getElementById('orch-import-confirm')?.addEventListener('click', () => {
    const textarea = document.getElementById('orch-import-text') as HTMLTextAreaElement | null;
    const text = textarea?.value.trim();
    if (!text) return;
    importFromPlan(text);
    const modal = document.getElementById('orch-import-modal');
    if (modal) modal.style.display = 'none';
    _render();
  });

  // Dispatch all
  document.getElementById('orch-dispatch-btn')?.addEventListener('click', () => {
    dispatchAll().then(() => _render()).catch(() => _render());
  });

  // Clear done
  document.getElementById('orch-clear-btn')?.addEventListener('click', () => {
    clearDone();
    _render();
  });

  // Remove task buttons
  document.querySelectorAll<HTMLElement>('[data-remove-task]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.removeTask;
      if (id) {
        removeTask(id);
        _render();
      }
    });
  });

  // Priority selectors
  document.querySelectorAll<HTMLSelectElement>('[data-task-priority]').forEach(sel => {
    sel.addEventListener('change', () => {
      const id = sel.dataset.taskPriority;
      const task = _tasks.find(t => t.id === id);
      if (task && task.status === 'pending') {
        task.priority = parseInt(sel.value, 10);
        _saveTasks();
      }
    });
  });

  // Session links
  document.querySelectorAll<HTMLElement>('[data-session-link]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sid = (link as HTMLElement).dataset.sessionLink;
      if (sid) sessionManager.selectedId = sid;
    });
  });
}

export function initAgentOrchestrate(): void {
  _loadTasks();
  _render();

  // Subscribe to session changes for live status updates
  if (_unsub) _unsub();
  _unsub = sessionManager.onChange(() => {
    _syncStatuses();
  });

  // Poll running task durations for timer display
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(() => {
    if (_tasks.some(t => t.status === 'running')) _render();
  }, 2000);
}

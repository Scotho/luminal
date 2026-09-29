import { escapeHtml } from '../ui/render';
import type { TaskEntry, TaskGroupSuggestion } from '../types';
import { dispatchCC, sessionManager } from '../ui/ccPanel';
import { bus } from '../ui/eventBus';
import { icon } from '../ui/icons';

// ── Re-exports from sub-modules (preserve existing public API) ──────────────
export { shortDateLabel, renderTaskCard, renderFilterBar, getUniqueTags, TAG_COLORS } from './tasks/taskRenderer';
export { buildAuditPrompt, buildStandupSummary, buildPrioritizePrompt, buildGroupingPrompt } from './tasks/taskPrompts';

// ── Internal imports from sub-modules ───────────────────────────────────────
import { shortDateLabel, renderTaskCard, renderFilterBar, getUniqueTags, renderGroupingPanel, TAG_COLORS, priorityDropdown } from './tasks/taskRenderer';
import { buildAuditPrompt, buildStandupSummary, buildPrioritizePrompt, buildGroupingPrompt } from './tasks/taskPrompts';
import { updateBulkBar, wireBulkEvents } from './tasks/taskBulkOps';

// ── Sort helper ─────────────────────────────────────────────────────────────

/** Sort tasks: priority asc (1 first), then created desc (newest first). */
export function sortTasks(tasks: TaskEntry[]): TaskEntry[] {
  return [...tasks].sort((a, b) => {
    const pa = a.priority ?? 3;
    const pb = b.priority ?? 3;
    if (pa !== pb) return pa - pb;
    return b.created.localeCompare(a.created);
  });
}

// ── Persistence helpers ───────────────────────────────────────────────────────

async function loadTasks(): Promise<TaskEntry[]> {
  try {
    const res = await fetch('/data/tasks.json');
    if (!res.ok) return [];
    const tasks = await res.json() as TaskEntry[];
    return tasks.map(t => ({ ...t, priority: t.priority ?? 3 }));
  } catch {
    return [];
  }
}

async function saveTasks(tasks: TaskEntry[]): Promise<void> {
  try {
    const res = await fetch('/__admin_save?file=tasks.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tasks, null, 2),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  } catch (e) {
    console.warn('Failed to save tasks:', e);
  }
}

async function loadGroupings(): Promise<TaskGroupSuggestion[]> {
  try {
    const res = await fetch('/data/groupings.json');
    if (!res.ok) return [];
    return await res.json() as TaskGroupSuggestion[];
  } catch {
    return [];
  }
}

async function saveGroupings(groups: TaskGroupSuggestion[]): Promise<void> {
  try {
    await fetch('/__admin_save?file=groupings.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(groups, null, 2),
    });
  } catch (e) {
    console.warn('Failed to save groupings:', e);
  }
}

async function pollCCStatus(): Promise<boolean> {
  try {
    const res = await fetch('/__admin_exec/status');
    const data = await res.json() as { running: boolean };
    return data.running;
  } catch {
    return false;
  }
}

// ── Section entry point ───────────────────────────────────────────────────────

/** Render the Tasks section into container. */
export async function renderTasks(container: HTMLElement): Promise<void> {
  let tasks = await loadTasks();
  let groupings = await loadGroupings();
  let activeFilter = localStorage.getItem('luminal-tasks-filter') || 'all';
  let showCompleted = false;
  let ccRunning = false;
  let ccAction: 'prioritize' | 'group' | null = null;
  const selected = new Set<string>();

  function getVisible(): TaskEntry[] {
    let visible = activeFilter === 'all' ? tasks : tasks.filter(t => t.tag === activeFilter);
    if (!showCompleted) visible = visible.filter(t => t.status !== 'done');
    return sortTasks(visible);
  }

  function render(): void {
    const visible = getVisible();
    const allFiltered = activeFilter === 'all' ? tasks : tasks.filter(t => t.tag === activeFilter);
    const pendingCount = allFiltered.filter(t => t.status === 'pending').length;
    const completedCount = allFiltered.filter(t => t.status === 'done').length;
    const tags = getUniqueTags(tasks);

    const ccStatusHtml = ccRunning
      ? `<span id="cc-status" style="color:var(--yellow); font-size:12px; font-weight:600; animation:pulse 1.5s infinite;">CC ${ccAction === 'prioritize' ? 'prioritizing' : 'grouping'}...</span>`
      : '';

    container.innerHTML = `
      <style>
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      </style>
      <h2>${icon('list-checks', 18)} Tasks <span style="color:var(--text-dim); font-size:14px; font-weight:400;">(${pendingCount} pending${completedCount ? `, ${completedCount} done` : ''})</span></h2>

      <div class="task-toolbar">
        <button id="tasks-add-btn" class="admin-btn admin-btn--accent" style="font-size:10px; padding:6px 14px;">+ Add Task</button>

        <span class="task-toolbar__sep"></span>

        <button id="tasks-prioritize-btn" class="refresh-btn" ${ccRunning ? 'disabled style="opacity:0.4"' : ''} title="Run CC to auto-assign priorities based on module blast radius">Auto-Prioritize</button>
        <button id="tasks-group-btn" class="refresh-btn" ${ccRunning ? 'disabled style="opacity:0.4"' : ''} title="Run CC to suggest logical task groupings">Suggest Groupings</button>
        ${ccStatusHtml}

        <span class="task-toolbar__sep"></span>

        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-dim); cursor:pointer; margin:0;">
          <input type="checkbox" id="tasks-show-completed" ${showCompleted ? 'checked' : ''} style="cursor:pointer; accent-color:var(--accent);" />
          Show completed (${completedCount})
        </label>
        ${completedCount > 0 ? `
          <button id="tasks-copy-audit-btn" class="refresh-btn" title="Copy audit prompt for completed tasks to clipboard">Copy Audit</button>
          <button id="tasks-run-audit-btn" class="refresh-btn" title="Dispatch code review to CC for completed tasks">Run Audit</button>
        ` : ''}

        <span style="flex:1;"></span>

        <button id="tasks-standup-btn" class="refresh-btn" title="Copy daily standup summary to clipboard">Daily Standup</button>
      </div>

      <div id="tasks-add-form" style="display:none; border:1px solid var(--border); border-radius:6px; padding:14px; margin-bottom:16px; background:var(--surface, rgba(255,255,255,0.04));">
        <div style="display:grid; grid-template-columns:1fr 1fr 80px; gap:10px; margin-bottom:10px;">
          <div>
            <label style="display:block; font-size:12px; color:var(--text-dim); margin-bottom:4px;">Tag</label>
            <input id="tasks-input-tag" type="text" placeholder="e.g. code-hygiene" list="tasks-tag-list"
              style="width:100%; box-sizing:border-box; background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:6px 8px; color:inherit; font-size:13px;" />
            <datalist id="tasks-tag-list">
              ${Object.keys(TAG_COLORS).map(t => `<option value="${escapeHtml(t)}">`).join('')}
            </datalist>
          </div>
          <div>
            <label style="display:block; font-size:12px; color:var(--text-dim); margin-bottom:4px;">Source</label>
            <input id="tasks-input-source" type="text" placeholder="e.g. code-review, spec"
              style="width:100%; box-sizing:border-box; background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:6px 8px; color:inherit; font-size:13px;" />
          </div>
          <div>
            <label style="display:block; font-size:12px; color:var(--text-dim); margin-bottom:4px;">Priority</label>
            <select id="tasks-input-priority"
              style="width:100%; box-sizing:border-box; background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:6px 8px; color:inherit; font-size:13px;">
              <option value="1">P1</option>
              <option value="2">P2</option>
              <option value="3" selected>P3</option>
              <option value="4">P4</option>
              <option value="5">P5</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block; font-size:12px; color:var(--text-dim); margin-bottom:4px;">Prompt</label>
          <textarea id="tasks-input-prompt" rows="3" placeholder="Describe the task or paste the prompt..."
            style="width:100%; box-sizing:border-box; background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:6px 8px; color:inherit; font-size:13px; resize:vertical;"></textarea>
        </div>
        <div style="display:flex; gap:8px;">
          <button id="tasks-submit-btn" class="refresh-btn">Add Task</button>
          <button id="tasks-cancel-btn" class="refresh-btn" style="background:transparent; border-color:var(--border);">Cancel</button>
        </div>
      </div>

      ${renderFilterBar(tags, activeFilter, tasks)}

      <div id="tasks-bulk-bar" style="display:none; padding:8px 14px; background:var(--bg-panel); border:1px solid var(--accent); border-radius:var(--r-lg); margin-bottom:12px; align-items:center; gap:8px; font-size:12px; box-shadow:0 0 12px rgba(110,224,240,0.06);">
        <span id="tasks-bulk-count" style="color:var(--accent); font-weight:700; font-size:12px;">0 selected</span>
        <span class="task-toolbar__sep"></span>
        <button class="refresh-btn" id="tasks-bulk-priority">Set Priority</button>
        <button class="refresh-btn" id="tasks-bulk-run" style="border-color:var(--accent-dim); color:var(--accent);">Run All in CC</button>
        <button class="refresh-btn" id="tasks-bulk-done" style="border-color:rgba(56,199,106,0.4); color:var(--green);">Mark Done</button>
        <button class="refresh-btn" id="tasks-bulk-delete" style="border-color:var(--red,#b02d1c); color:var(--red-bright,#d45234);">Delete</button>
        <span style="flex:1;"></span>
        <button class="refresh-btn" id="tasks-bulk-clear">Clear</button>
      </div>

      <div id="grouping-container">${renderGroupingPanel(groupings, tasks)}</div>

      <div id="tasks-list">
        ${visible.length > 0
          ? visible.map(t => renderTaskCard(t, tasks)).join('')
          : `<p style="color:var(--text-dim); font-size:13px;">No ${showCompleted ? '' : 'open '}tasks.</p>`}
      </div>
    `;

    wireEvents();
  }

  // ── CC polling ─────────────────────────────────────────────

  async function startPolling(): Promise<void> {
    const poll = setInterval(async () => {
      const running = await pollCCStatus();
      if (!running) {
        clearInterval(poll);
        ccRunning = false;
        // Reload data after CC finishes
        tasks = await loadTasks();
        groupings = await loadGroupings();
        ccAction = null;
        render();
      }
    }, 3000);
  }

  // ── Event wiring ───────────────────────────────────────────

  function wireEvents(): void {
    // Toggle add-task form
    const addBtn = document.getElementById('tasks-add-btn');
    const form = document.getElementById('tasks-add-form');
    addBtn?.addEventListener('click', () => {
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    // Cancel button hides form
    document.getElementById('tasks-cancel-btn')?.addEventListener('click', () => {
      if (form) form.style.display = 'none';
    });

    // Submit new task
    document.getElementById('tasks-submit-btn')?.addEventListener('click', async () => {
      const tagInput = (document.getElementById('tasks-input-tag') as HTMLInputElement)?.value.trim();
      const promptInput = (document.getElementById('tasks-input-prompt') as HTMLTextAreaElement)?.value.trim();
      const sourceInput = (document.getElementById('tasks-input-source') as HTMLInputElement)?.value.trim();
      const priorityInput = Number((document.getElementById('tasks-input-priority') as HTMLSelectElement)?.value) || 3;

      if (!tagInput || !promptInput) return;

      const newTask: TaskEntry = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ref: '',
        tag: tagInput,
        prompt: promptInput,
        source: sourceInput,
        status: 'pending',
        priority: priorityInput,
        created: new Date().toISOString(),
      };

      tasks.unshift(newTask);
      await saveTasks(tasks);
      render();
    });

    // Auto-Prioritize button
    document.getElementById('tasks-prioritize-btn')?.addEventListener('click', async () => {
      if (ccRunning) return;
      const prompt = buildPrioritizePrompt(tasks);
      await dispatchCC('Auto-Prioritize', prompt);
      ccRunning = true;
      ccAction = 'prioritize';
      render();
      startPolling();
    });

    // Suggest Groupings button
    document.getElementById('tasks-group-btn')?.addEventListener('click', async () => {
      if (ccRunning) return;
      const prompt = buildGroupingPrompt(tasks);
      await dispatchCC('Suggest Groupings', prompt);
      ccRunning = true;
      ccAction = 'group';
      render();
      startPolling();
    });

    // Daily Standup button
    document.getElementById('tasks-standup-btn')?.addEventListener('click', async () => {
      const summary = buildStandupSummary(tasks);
      try {
        await navigator.clipboard.writeText(summary);
      } catch { /* clipboard may not be available */ }
      const btn = document.getElementById('tasks-standup-btn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Copied';
        btn.style.borderColor = 'var(--green)';
        btn.style.color = 'var(--green)';
        setTimeout(() => { btn.textContent = orig; btn.style.borderColor = ''; btn.style.color = ''; }, 1200);
      }
    });

    // Show completed toggle
    document.getElementById('tasks-show-completed')?.addEventListener('change', (e) => {
      showCompleted = (e.target as HTMLInputElement).checked;
      render();
    });

    // Copy Audit Prompt
    document.getElementById('tasks-copy-audit-btn')?.addEventListener('click', async () => {
      const prompt = buildAuditPrompt(tasks);
      if (!prompt) return;
      try {
        await navigator.clipboard.writeText(prompt);
      } catch { /* clipboard may not be available */ }
      const btn = document.getElementById('tasks-copy-audit-btn');
      if (btn) {
        btn.textContent = '✓ Copied';
        btn.style.borderColor = 'var(--green)';
        setTimeout(() => { btn.textContent = 'Copy Audit Prompt'; btn.style.borderColor = ''; }, 1200);
      }
    });

    // Run Audit via CC
    document.getElementById('tasks-run-audit-btn')?.addEventListener('click', async () => {
      if (ccRunning) return;
      const prompt = buildAuditPrompt(tasks);
      if (!prompt) return;
      await dispatchCC('Audit Completed Tasks', prompt);
      ccRunning = true;
      ccAction = 'prioritize';
      render();
      startPolling();
    });

    // Filter bar
    container.querySelectorAll<HTMLButtonElement>('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter ?? 'all';
        localStorage.setItem('luminal-tasks-filter', activeFilter);
        render();
      });
    });

    // Priority dropdown changes
    container.querySelectorAll<HTMLSelectElement>('.task-priority-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.taskId;
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        task.priority = Number(sel.value) || 3;
        task.modified = new Date().toISOString();
        await saveTasks(tasks);
        render();
      });
    });

    // Copy Prompt buttons
    container.querySelectorAll<HTMLButtonElement>('.task-copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.taskId;
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        try {
          await navigator.clipboard.writeText(task.prompt);
        } catch {
          // clipboard may not be available in all environments
        }
        const card = btn.closest<HTMLElement>('.task-card');
        if (card) {
          card.style.borderColor = 'var(--green)';
          setTimeout(() => { card.style.borderColor = ''; }, 600);
        }
      });
    });

    // Run in CC buttons
    container.querySelectorAll<HTMLButtonElement>('.task-run-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.taskId;
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        await dispatchCC(task.tag || 'Task', task.prompt);
        const card = btn.closest<HTMLElement>('.task-card');
        if (card) {
          card.style.borderColor = 'var(--accent)';
          setTimeout(() => { card.style.borderColor = ''; }, 600);
        }
      });
    });

    // Done buttons
    container.querySelectorAll<HTMLButtonElement>('.task-done-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.taskId;
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        task.status = 'done';
        task.modified = new Date().toISOString();
        task.completed = new Date().toISOString();
        await saveTasks(tasks);
        bus.emit('task:done', { id: task.id, tag: task.tag, prompt: task.prompt });
        render();
      });
    });

    // Delete buttons
    container.querySelectorAll<HTMLButtonElement>('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.taskId;
        tasks = tasks.filter(t => t.id !== id);
        await saveTasks(tasks);
        render();
      });
    });

    // ── Grouping panel events ─────────────────────────────────

    // Accept group -> create master task
    container.querySelectorAll<HTMLButtonElement>('.grouping-accept-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.groupIndex);
        const group = groupings[idx];
        if (!group) return;

        // Create master task combining the group
        const childTasks = group.taskIds.map(id => tasks.find(t => t.id === id)).filter(Boolean) as TaskEntry[];
        const combinedPrompt = `[Master] ${group.name}\n\n${group.rationale}\n\nSub-tasks:\n${childTasks.map(t => `- ${t.prompt}`).join('\n')}`;

        const masterTask: TaskEntry = {
          id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ref: '',
          tag: childTasks[0]?.tag ?? 'grouped',
          prompt: combinedPrompt,
          source: 'grouping',
          status: 'pending',
          priority: Math.min(...childTasks.map(t => t.priority ?? 3)),
          created: new Date().toISOString(),
          children: group.taskIds,
        };

        // Mark children with parentId
        for (const ct of childTasks) {
          ct.parentId = masterTask.id;
        }

        tasks.unshift(masterTask);

        // Remove accepted group from suggestions
        groupings.splice(idx, 1);
        await saveTasks(tasks);
        await saveGroupings(groupings);
        render();
      });
    });

    // Dismiss individual group
    container.querySelectorAll<HTMLButtonElement>('.grouping-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.groupIndex);
        groupings.splice(idx, 1);
        await saveGroupings(groupings);
        render();
      });
    });

    // Dismiss all groupings
    document.getElementById('grouping-dismiss-all')?.addEventListener('click', async () => {
      groupings = [];
      await saveGroupings(groupings);
      render();
    });

    // ── Bulk operations ───────────────────────────────────────
    wireBulkEvents(
      container,
      selected,
      () => tasks,
      (newTasks) => { tasks = newTasks; },
      saveTasks,
      render,
    );
  }

  render();
}

// admin/src/sections/scheduler.ts — Scheduled task runner
import { escapeHtml, ago } from '../ui/render';
import { icon } from '../ui/icons';

interface ScheduledTask {
  id: string;
  name: string;
  schedule: string; // cron expression or "daily", "weekly", "hourly"
  command: string;
  enabled: boolean;
  lastRun?: number;
  lastResult?: 'success' | 'error';
  nextRun?: number;
}

const SCHEDULE_PRESETS: Record<string, string> = {
  'hourly': '0 * * * *',
  'daily': '0 0 * * *',
  'weekly': '0 0 * * 0',
  'every-6h': '0 */6 * * *',
};

export async function renderScheduler(container: HTMLElement): Promise<void> {
  let tasks: ScheduledTask[] = [];
  try {
    const res = await fetch('/data/scheduled-tasks.json');
    if (res.ok) tasks = await res.json();
  } catch (err) {
    console.warn('[scheduler] Failed to load scheduled-tasks.json:', err);
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('zap', 18)} Scheduler</h2>
      <button id="sched-add" class="admin-btn admin-btn--small">+ New Task</button>
    </div>
    <p style="color:var(--text-dim);font-size:11px;margin-bottom:16px;">
      Schedule recurring admin tasks. Tasks run via the admin middleware process manager.
    </p>
    <div id="sched-list">
      ${tasks.length > 0 ? tasks.map(renderTaskRow).join('') : '<p style="color:var(--text-dim);">No scheduled tasks. Click + to create one.</p>'}
    </div>
  `;

  container.querySelector('#sched-add')?.addEventListener('click', async () => {
    const name = window.prompt('Task name:');
    if (!name?.trim()) return;
    const schedule = window.prompt('Schedule (hourly/daily/weekly/cron):') ?? 'daily';
    const command = window.prompt('Command to run:') ?? '';

    tasks.push({
      id: `sched_${Date.now()}`,
      name: name.trim(),
      schedule: SCHEDULE_PRESETS[schedule] ?? schedule,
      command,
      enabled: true,
    });

    await saveTasks(tasks);
    renderScheduler(container);
  });

  // Wire toggle and delete buttons
  container.querySelectorAll<HTMLElement>('.sched-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = tasks.find(t => t.id === id);
      if (task) {
        task.enabled = !task.enabled;
        await saveTasks(tasks);
        renderScheduler(container);
      }
    });
  });

  container.querySelectorAll<HTMLElement>('.sched-run').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      btn.textContent = 'Running...';
      try {
        const res = await fetch('/__admin_exec/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: task.command }),
        });
        task.lastRun = Date.now();
        task.lastResult = res.ok ? 'success' : 'error';
        await saveTasks(tasks);
        renderScheduler(container);
      } catch (err) {
        console.warn('[scheduler] Run task failed:', err);
        task.lastRun = Date.now();
        task.lastResult = 'error';
        await saveTasks(tasks);
        renderScheduler(container);
      }
    });
  });

  container.querySelectorAll<HTMLElement>('.sched-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      tasks = tasks.filter(t => t.id !== id);
      await saveTasks(tasks);
      renderScheduler(container);
    });
  });
}

function renderTaskRow(task: ScheduledTask): string {
  const statusColor = task.enabled ? 'var(--green)' : 'var(--text-quiet)';
  const lastRunText = task.lastRun ? ago(task.lastRun) : 'never';
  const resultColor = task.lastResult === 'success' ? 'var(--green)' : task.lastResult === 'error' ? 'var(--red-bright)' : 'var(--text-dim)';

  return `
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;">${escapeHtml(task.name)}</div>
        <div style="font-size:10px;color:var(--text-dim);font-family:var(--font-mono);">${escapeHtml(task.schedule)} · ${escapeHtml(task.command.slice(0, 50))}</div>
        <div style="font-size:10px;color:${resultColor};">Last: ${lastRunText}</div>
      </div>
      <button class="admin-btn admin-btn--small sched-toggle" data-id="${task.id}">${task.enabled ? 'Disable' : 'Enable'}</button>
      <button class="admin-btn admin-btn--small sched-run" data-id="${task.id}">Run Now</button>
      <button class="admin-btn admin-btn--small admin-btn--danger sched-delete" data-id="${task.id}">&times;</button>
    </div>
  `;
}

async function saveTasks(tasks: ScheduledTask[]): Promise<void> {
  await fetch('/__admin_save?file=scheduled-tasks.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tasks, null, 2),
  });
}

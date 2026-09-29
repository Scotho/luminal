import type { TaskEntry } from '../../types';
import { sessionManager } from '../../ui/ccPanel';
import { bus } from '../../ui/eventBus';

// ── Bulk operations ─────────────────────────────────────────────────────────

export function updateBulkBar(selected: Set<string>): void {
  const bar = document.getElementById('tasks-bulk-bar');
  const count = document.getElementById('tasks-bulk-count');
  if (bar) bar.style.display = selected.size > 0 ? 'flex' : 'none';
  if (count) count.textContent = `${selected.size} selected`;
}

export function wireBulkEvents(
  container: HTMLElement,
  selected: Set<string>,
  getTasks: () => TaskEntry[],
  setTasks: (tasks: TaskEntry[]) => void,
  saveTasks: (tasks: TaskEntry[]) => Promise<void>,
  render: () => void,
): void {
  // Restore checkbox state after re-render
  container.querySelectorAll<HTMLInputElement>('.task-select').forEach(cb => {
    if (selected.has(cb.dataset.taskId!)) cb.checked = true;
  });
  updateBulkBar(selected);

  // Checkbox change handler
  container.querySelectorAll<HTMLInputElement>('.task-select').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.taskId!;
      if (cb.checked) selected.add(id); else selected.delete(id);
      updateBulkBar(selected);
    });
  });

  // Bulk Set Priority
  document.getElementById('tasks-bulk-priority')?.addEventListener('click', async () => {
    const input = window.prompt('Priority (1-5):');
    if (!input) return;
    const p = Number(input);
    if (p < 1 || p > 5 || !Number.isInteger(p)) return;
    const now = new Date().toISOString();
    const tasks = getTasks();
    for (const id of selected) {
      const task = tasks.find(t => t.id === id);
      if (task) { task.priority = p; task.modified = now; }
    }
    await saveTasks(tasks);
    render();
  });

  // Bulk Run All in CC
  document.getElementById('tasks-bulk-run')?.addEventListener('click', () => {
    const tasks = getTasks();
    for (const id of selected) {
      const task = tasks.find(t => t.id === id);
      if (task) sessionManager.enqueue(task.tag || 'Task', task.prompt);
    }
    selected.clear();
    updateBulkBar(selected);
  });

  // Bulk Mark Done
  document.getElementById('tasks-bulk-done')?.addEventListener('click', async () => {
    const now = new Date().toISOString();
    const tasks = getTasks();
    for (const id of selected) {
      const task = tasks.find(t => t.id === id);
      if (task && task.status === 'pending') {
        task.status = 'done';
        task.modified = now;
        task.completed = now;
        bus.emit('task:done', { id: task.id, tag: task.tag, prompt: task.prompt });
      }
    }
    selected.clear();
    await saveTasks(tasks);
    render();
  });

  // Bulk Delete
  document.getElementById('tasks-bulk-delete')?.addEventListener('click', async () => {
    if (!window.confirm(`Delete ${selected.size} task(s)?`)) return;
    const tasks = getTasks().filter(t => !selected.has(t.id));
    setTasks(tasks);
    selected.clear();
    await saveTasks(tasks);
    render();
  });

  // Bulk Clear Selection
  document.getElementById('tasks-bulk-clear')?.addEventListener('click', () => {
    selected.clear();
    container.querySelectorAll<HTMLInputElement>('.task-select').forEach(cb => { cb.checked = false; });
    updateBulkBar(selected);
  });
}

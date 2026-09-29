import type { TaskEntry } from '../../types';

// ── CC prompt builders ───────────────────────────────────────────────────────

export function buildPrioritizePrompt(tasks: TaskEntry[]): string {
  const pending = tasks.filter(t => t.status === 'pending');
  const taskList = pending.map(t =>
    `- id: ${t.id} | tag: ${t.tag} | priority: ${t.priority} | prompt: ${t.prompt.slice(0, 120)}`
  ).join('\n');

  return `You are a task prioritization assistant for the Luminal game project.

Read the module dependency graph:
  node admin/scripts/module-map.ts

Then review these pending tasks and assign priorities 1-5:
  1 = Critical (high blast radius, blocks other work, security/correctness)
  2 = High (important modules, many dependents)
  3 = Normal (standard work)
  4 = Low (nice-to-have, isolated modules)
  5 = Minimal (cosmetic, very low impact)

Current tasks:
${taskList}

Use blast radius from the module map and your judgment about risk and dependency depth.

After deciding priorities, read admin/data/tasks.json, update each task's "priority" field,
and write the updated JSON back to admin/data/tasks.json using the Write tool.
Do NOT change any other fields. Do NOT add or remove tasks.`;
}

export function buildGroupingPrompt(tasks: TaskEntry[]): string {
  const pending = tasks.filter(t => t.status === 'pending');
  const taskList = pending.map(t =>
    `- id: ${t.id} | tag: ${t.tag} | P${t.priority} | prompt: ${t.prompt.slice(0, 120)}`
  ).join('\n');

  return `You are a task grouping assistant for the Luminal game project.

Read the module dependency graph:
  node admin/scripts/module-map.ts

Then analyze these pending tasks for logical groupings — tasks that share modules,
test infrastructure, or logical domains and should be coordinated by a single agent:

${taskList}

Output your analysis as a JSON array of grouping suggestions and write it to
admin/data/groupings.json using the Write tool. Format:

[
  {
    "name": "Group name (short)",
    "taskIds": ["task_id_1", "task_id_2"],
    "rationale": "Why these belong together (1-2 sentences)"
  }
]

Rules:
- Only group tasks that genuinely benefit from coordination (shared mocks, related modules, etc.)
- A task can appear in at most one group
- Leave ungroupable tasks out — not everything needs a group
- Aim for 2-5 tasks per group
- Do NOT modify tasks.json`;
}

// ── Audit prompt builder ─────────────────────────────────────────────────────

export function buildAuditPrompt(tasks: TaskEntry[]): string {
  const done = tasks.filter(t => t.status === 'done');
  if (done.length === 0) return '';

  const taskList = done.map(t => {
    const completed = t.completed ? ` | completed: ${t.completed}` : '';
    return `- tag: ${t.tag} | P${t.priority ?? 3}${completed}\n  ${t.prompt.slice(0, 200)}`;
  }).join('\n');

  return `You are a code review / audit assistant for the Luminal game project.

The following ${done.length} task(s) have been marked as completed. Please audit the work:

${taskList}

For each completed task:
1. Verify the work was actually done — check the relevant files, look for the changes described.
2. Check code quality — look for regressions, missing edge cases, incomplete implementations.
3. Identify any follow-up work needed.

Output a summary with:
- PASS / NEEDS ATTENTION / FAIL for each task
- Brief explanation of findings
- Any new tasks that should be created as follow-ups

Read the relevant source files to verify. Do NOT just trust the task description — confirm the work in the code.`;
}

// ── Standup summary builder ──────────────────────────────────────────────────

export function buildStandupSummary(tasks: TaskEntry[]): string {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const completed = tasks.filter(t =>
    t.status === 'done' && t.completed && new Date(t.completed).getTime() > dayAgo
  );
  const active = tasks.filter(t => t.status === 'pending')
    .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))
    .slice(0, 5);

  const lines: string[] = [];
  lines.push('## Daily Standup — ' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));
  lines.push('');

  lines.push('### Done (last 24h)');
  if (completed.length === 0) {
    lines.push('- (none)');
  } else {
    for (const t of completed) {
      lines.push(`- [${t.tag}] ${t.prompt.slice(0, 80)}`);
    }
  }
  lines.push('');

  lines.push('### Up Next');
  if (active.length === 0) {
    lines.push('- (none)');
  } else {
    for (const t of active) {
      const pri = ['', 'P1-CRITICAL', 'P2-HIGH', 'P3-MED', 'P4-LOW', 'P5-BACKLOG'][t.priority ?? 3] || 'P3';
      lines.push(`- [${pri}] [${t.tag}] ${t.prompt.slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}

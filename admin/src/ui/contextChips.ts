// admin/src/ui/contextChips.ts

export interface ContextChip {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  fetch: () => Promise<string>;
  tokenEstimate?: number;
}

const CHIP_DEFS: Omit<ContextChip, 'enabled' | 'tokenEstimate'>[] = [
  {
    id: 'git-diff',
    label: 'Git Diff',
    icon: '±',
    async fetch() {
      const res = await fetch('/__admin_exec/diff');
      const data = await res.json() as { diff: string };
      return data.diff ? `\n\n<context name="git-diff">\n${data.diff}\n</context>` : '';
    },
  },
  {
    id: 'test-results',
    label: 'Recent Tests',
    icon: '✓',
    async fetch() {
      try {
        const res = await fetch('/data/test-log.json');
        if (!res.ok) return '';
        const runs = await res.json() as Array<{ config: string; passed: number; failed: number; failures: Array<{ test: string; error: string }> }>;
        const last = runs[runs.length - 1];
        if (!last || last.failures.length === 0) return '';
        const failText = last.failures.map(f => `- ${f.test}: ${f.error.slice(0, 200)}`).join('\n');
        return `\n\n<context name="recent-test-failures">\n${failText}\n</context>`;
      } catch { return ''; }
    },
  },
  {
    id: 'session-notes',
    label: 'Session Notes',
    icon: '📋',
    async fetch() {
      try {
        const res = await fetch('/__admin_session?id=all');
        if (!res.ok) return '';
        const data = await res.json();
        const sessions = Array.isArray(data) ? data as Array<{ status: string; summary: string; notes: Array<{ text: string }> }> : [];
        const active = sessions.filter(s => s.status === 'active');
        if (active.length === 0) return '';
        const notes = active.map(s => `## ${s.summary}\n${s.notes.map(n => n.text).join('\n')}`).join('\n\n');
        return `\n\n<context name="active-session-notes">\n${notes}\n</context>`;
      } catch { return ''; }
    },
  },
  {
    id: 'task-backlog',
    label: 'Tasks',
    icon: '☐',
    async fetch() {
      try {
        const res = await fetch('/data/tasks.json');
        if (!res.ok) return '';
        const tasks = await res.json() as Array<{ ref: string; prompt: string; status: string; priority: number }>;
        const pending = tasks.filter(t => t.status === 'pending').sort((a, b) => a.priority - b.priority).slice(0, 10);
        if (pending.length === 0) return '';
        const text = pending.map(t => `- [${t.ref}] (P${t.priority}) ${t.prompt.slice(0, 120)}`).join('\n');
        return `\n\n<context name="pending-tasks">\n${text}\n</context>`;
      } catch { return ''; }
    },
  },
];

export function createContextChips(container: HTMLElement): {
  getEnabledContent(): Promise<string>;
  destroy(): void;
} {
  const chips: ContextChip[] = CHIP_DEFS.map(d => ({ ...d, enabled: false }));

  const wrap = document.createElement('div');
  wrap.className = 'context-chips';

  function render(): void {
    wrap.innerHTML = chips.map(c =>
      `<button class="context-chip ${c.enabled ? 'active' : ''}" data-id="${c.id}" title="${c.label}">` +
      `<span class="context-chip-icon">${c.icon}</span> ${c.label}` +
      `${c.tokenEstimate ? `<span class="context-chip-tokens">~${Math.round(c.tokenEstimate / 1000)}K</span>` : ''}` +
      `</button>`
    ).join('');
  }

  wrap.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.context-chip') as HTMLElement | null;
    if (!btn) return;
    const chip = chips.find(c => c.id === btn.dataset.id);
    if (!chip) return;
    chip.enabled = !chip.enabled;
    if (chip.enabled) {
      const content = await chip.fetch();
      chip.tokenEstimate = Math.round(content.length / 4);
    } else {
      chip.tokenEstimate = undefined;
    }
    render();
  });

  render();
  container.appendChild(wrap);

  return {
    async getEnabledContent(): Promise<string> {
      const enabled = chips.filter(c => c.enabled);
      const results = await Promise.all(enabled.map(c => c.fetch()));
      return results.join('');
    },
    destroy() { wrap.remove(); },
  };
}

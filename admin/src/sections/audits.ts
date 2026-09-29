import { escapeHtml } from '../ui/render';
import type { AuditEntry } from '../types';
import { dispatchCC } from '../ui/ccPanel';
import { icon } from '../ui/icons';

// ── Default audits ────────────────────────────────────────────────────────────

export const DEFAULT_AUDITS: AuditEntry[] = [
  {
    name: 'code-hygiene',
    label: 'Code Hygiene',
    description: 'empty catches, as-any, unused imports, file sizes >500 LOC',
    prompt: `Audit the Luminal codebase for code hygiene issues. Check for:
1. Empty catch blocks (last known count: 10)
2. \`as any\` casts (last known count: 36)
3. Unused imports and dead exports
4. Source files exceeding 500 LOC (flag >800 LOC as critical)
5. Functions exceeding 80 lines

Fix what you can within this session. For anything remaining,
POST each item to http://localhost:5175/__admin_task with tag
"code-hygiene" and a specific prompt describing the fix needed.
Then POST to http://localhost:5175/__admin_audit with
{ "name": "code-hygiene", "action": "reset" }.`,
    intervalDays: 7,
    lastRun: null,
    builtin: true,
  },
  {
    name: 'test-coverage',
    label: 'Test Coverage',
    description: 'run all configs, flag new untested modules, check flaky tests',
    prompt: `Audit test coverage for Luminal. Run the test-health CLI script:
  node admin/scripts/test-health.js

Review the output, then:
1. Identify source files with no corresponding .test.ts
2. Check for flaky tests (passed AND failed in recent runs)
3. Run each vitest config and report pass/fail counts
4. Prioritize untested files by blast radius:
     node admin/scripts/module-map.js

Fix flaky tests if root cause is obvious. For new test files needed,
POST each to http://localhost:5175/__admin_task with tag
"test-coverage" and a prompt scoped to writing tests for that module.
Then POST to http://localhost:5175/__admin_audit with
{ "name": "test-coverage", "action": "reset" }.`,
    intervalDays: 7,
    lastRun: null,
    builtin: true,
  },
  {
    name: 'mobile-gamepad',
    label: 'Mobile & Gamepad',
    description: 'responsive breakpoints, touch targets, gamepad nav on all screens',
    prompt: `Audit Luminal's mobile and gamepad support. Use the inspect-ui skill
to capture screenshots at these viewports:
- 375x667 (iPhone SE)
- 390x844 (iPhone 14)
- 768x1024 (iPad)

Check every screen: auth, main menu, lobby, character select, settings,
match HUD, results, profile, friends, chat, leaderboard, music player.

Flag: overflow, truncated text, touch targets <44px, unreachable
elements, missing gamepad navigation (all focusable elements should
be reachable via d-pad).

Fix critical layout breaks in this session. POST remaining items to
http://localhost:5175/__admin_task with tag "mobile-ui" or "gamepad".
Then POST to http://localhost:5175/__admin_audit with
{ "name": "mobile-gamepad", "action": "reset" }.`,
    intervalDays: 14,
    lastRun: null,
    builtin: true,
  },
  {
    name: 'arch-docs',
    label: 'Arch Docs',
    description: 'PROJECT.md accuracy, roadmap sync, future-work.md pruning',
    prompt: `Audit Luminal's architecture documentation for accuracy.
1. Read PROJECT.md — verify dependency tiers match actual imports
   (run: node admin/scripts/module-map.js). Flag tier violations.
2. Read docs/roadmap.md — compare against recent commits and current
   state. Mark completed items, flag stale descriptions.
3. Read docs/future-work.md — remove implemented items. Add any new
   deferred items from recent code reviews.
4. Verify docs/netcode.md matches the current lockstep implementation
   in src/core/lockstepManager.ts and src/core/simulation.ts.

Make corrections directly. POST items needing deeper investigation to
http://localhost:5175/__admin_task with tag "docs".
Then POST to http://localhost:5175/__admin_audit with
{ "name": "arch-docs", "action": "reset" }.`,
    intervalDays: 14,
    lastRun: null,
    builtin: true,
  },
];

// ── Status logic ──────────────────────────────────────────────────────────────

/** Compute a display label, color, and sort urgency for an audit. */
export function getAuditStatus(audit: AuditEntry): { label: string; color: string; urgency: number } {
  if (audit.lastRun === null) {
    return { label: 'OVERDUE', color: 'var(--red)', urgency: 999 };
  }

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const daysSince = (Date.now() - new Date(audit.lastRun).getTime()) / MS_PER_DAY;
  const daysUntilDue = audit.intervalDays - daysSince;

  if (daysUntilDue < 0) {
    const overdueDays = Math.round(Math.abs(daysUntilDue));
    return { label: `OVERDUE ${overdueDays}d`, color: 'var(--red)', urgency: Math.abs(daysUntilDue) };
  }

  if (daysUntilDue <= audit.intervalDays * 0.5) {
    const daysLeft = Math.round(daysUntilDue);
    return { label: `due in ${daysLeft}d`, color: 'var(--yellow)', urgency: -daysUntilDue };
  }

  const doneDaysAgo = Math.round(daysSince);
  return { label: `done ${doneDaysAgo}d ago`, color: 'var(--green)', urgency: -audit.intervalDays };
}

// ── Card render ───────────────────────────────────────────────────────────────

/** Render a single audit card as an HTML string. */
export function renderAuditCard(audit: AuditEntry): string {
  const { label, color } = getAuditStatus(audit);
  const resetLabel = `Reset (${audit.intervalDays}d)`;

  return `
    <div class="audit-card" data-audit-name="${escapeHtml(audit.name)}"
      style="border:1px solid ${color}; background:color-mix(in srgb, ${color} 8%, transparent); border-radius:6px; padding:14px 16px; margin-bottom:12px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <span style="font-weight:600; font-size:14px;">${escapeHtml(audit.label)}</span>
          <span class="audit-status-label" style="margin-left:10px; font-size:12px; font-weight:600; color:${color}; text-transform:uppercase; letter-spacing:0.05em;">${escapeHtml(label)}</span>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="audit-btn audit-copy-btn" data-audit-name="${escapeHtml(audit.name)}" title="Copy audit prompt">Copy Audit Prompt</button>
          <button class="audit-btn audit-run-btn" data-audit-name="${escapeHtml(audit.name)}" title="Run in Claude Code">Run in CC</button>
          <button class="audit-btn audit-reset-btn" data-audit-name="${escapeHtml(audit.name)}" title="Mark as done now">${escapeHtml(resetLabel)}</button>
        </div>
      </div>
      <div class="audit-description" style="font-size:13px; color:var(--text-dim); line-height:1.5;">${escapeHtml(audit.description)}</div>
    </div>
  `;
}

// ── Add Audit form ───────────────────────────────────────────────────────────

/** Render the inline "Add Audit" form HTML. */
export function renderAddAuditForm(): string {
  return `
    <div id="add-audit-form" style="border:1px solid var(--border); border-radius:6px; padding:14px 16px; margin-bottom:16px; display:none;">
      <div style="display:flex; flex-direction:column; gap:10px;">
        <input name="audit-name" placeholder="Audit name (e.g. perf-check)" style="padding:6px 10px; background:var(--bg); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:13px;" />
        <input name="audit-description" placeholder="Short description" style="padding:6px 10px; background:var(--bg); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:13px;" />
        <textarea name="audit-prompt" placeholder="Full audit prompt..." rows="4" style="padding:6px 10px; background:var(--bg); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:13px; resize:vertical;"></textarea>
        <div style="display:flex; gap:10px; align-items:center;">
          <label style="font-size:12px; color:var(--text-dim);">Interval (days):</label>
          <input name="audit-interval" type="number" value="7" min="1" max="90" style="width:60px; padding:6px 10px; background:var(--bg); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:13px;" />
        </div>
        <div style="display:flex; gap:8px;">
          <button class="audit-btn" id="add-audit-submit">Add Audit</button>
          <button class="audit-btn" id="add-audit-cancel" style="opacity:0.6;">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

async function loadAudits(): Promise<AuditEntry[]> {
  try {
    const res = await fetch('/data/audits.json');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data as AuditEntry[] : [];
  } catch {
    return [];
  }
}

async function saveAudits(audits: AuditEntry[]): Promise<void> {
  try {
    const res = await fetch('/__admin_save?file=audits.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(audits, null, 2),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  } catch (e) {
    console.warn('Failed to save audits:', e);
  }
}

/** Merge saved audits with DEFAULT_AUDITS.
 *  - Keeps saved lastRun for builtin entries that already exist.
 *  - Adds any missing builtin entries.
 *  - Preserves any non-builtin (custom) entries from saved state. */
function mergeAudits(saved: AuditEntry[]): AuditEntry[] {
  const merged: AuditEntry[] = [...saved];

  for (const def of DEFAULT_AUDITS) {
    const existing = merged.find(a => a.name === def.name);
    if (!existing) {
      merged.push({ ...def });
    }
  }

  return merged;
}

// ── Section entry point ───────────────────────────────────────────────────────

/** Render the Audits section into container. */
export async function renderAudits(container: HTMLElement): Promise<void> {
  let audits = mergeAudits(await loadAudits());

  function getByName(name: string): AuditEntry | undefined {
    return audits.find(a => a.name === name);
  }

  function render(): void {
    const sorted = [...audits].sort((a, b) => {
      const ua = getAuditStatus(a).urgency;
      const ub = getAuditStatus(b).urgency;
      return ub - ua;
    });

    container.innerHTML = `
      <h2>${icon('clipboard-check', 18)} Audits <span style="color:var(--text-dim); font-size:14px; font-weight:400;">(${audits.length} checks)</span>
        <button class="refresh-btn" id="add-audit-toggle" style="margin-left:auto; font-size:11px; padding:4px 12px;">+ Add Audit</button>
      </h2>
      ${renderAddAuditForm()}
      <div id="audit-cards-list">
        ${sorted.map(a => renderAuditCard(a)).join('')}
      </div>
    `;

    wireEvents();
  }

  function wireEvents(): void {
    // Copy Audit Prompt buttons
    container.querySelectorAll<HTMLButtonElement>('.audit-copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.auditName;
        const audit = name ? getByName(name) : undefined;
        if (!audit) return;
        try {
          await navigator.clipboard.writeText(audit.prompt);
        } catch {
          // clipboard may not be available in all environments
        }
        const card = btn.closest<HTMLElement>('.audit-card');
        if (card) {
          card.style.borderColor = 'var(--green)';
          setTimeout(() => {
            const { color } = getAuditStatus(audit);
            card.style.borderColor = color;
          }, 600);
        }
      });
    });

    // Run in CC buttons
    container.querySelectorAll<HTMLButtonElement>('.audit-run-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.auditName;
        const audit = name ? getByName(name) : undefined;
        if (!audit) return;
        await dispatchCC(audit.label, audit.prompt);
      });
    });

    // Reset buttons
    container.querySelectorAll<HTMLButtonElement>('.audit-reset-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.auditName;
        const audit = name ? getByName(name) : undefined;
        if (!audit) return;
        audit.lastRun = new Date().toISOString();
        await saveAudits(audits);
        render();
      });
    });

    // Add Audit toggle
    document.getElementById('add-audit-toggle')?.addEventListener('click', () => {
      const form = container.querySelector<HTMLElement>('#add-audit-form');
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    // Add Audit cancel
    document.getElementById('add-audit-cancel')?.addEventListener('click', () => {
      const form = container.querySelector<HTMLElement>('#add-audit-form');
      if (form) form.style.display = 'none';
    });

    // Add Audit submit
    document.getElementById('add-audit-submit')?.addEventListener('click', async () => {
      const nameInput = container.querySelector<HTMLInputElement>('[name="audit-name"]');
      const descInput = container.querySelector<HTMLInputElement>('[name="audit-description"]');
      const promptInput = container.querySelector<HTMLTextAreaElement>('[name="audit-prompt"]');
      const intervalInput = container.querySelector<HTMLInputElement>('[name="audit-interval"]');

      const name = nameInput?.value.trim() ?? '';
      const description = descInput?.value.trim() ?? '';
      const prompt = promptInput?.value.trim() ?? '';
      const intervalDays = parseInt(intervalInput?.value ?? '7', 10) || 7;

      if (!name || !prompt) return;

      audits.push({
        name,
        label: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description,
        prompt,
        intervalDays,
        lastRun: null,
        builtin: false,
      });

      await saveAudits(audits);
      render();
    });
  }

  render();
}

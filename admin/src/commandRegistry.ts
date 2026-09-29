// ── Centralized Command Registry ─────────────────────────────
// Single source of truth for all slash commands / skills.
// Consumed by: help.ts (admin UI), /__admin_commands (API), discord-notify.js

export interface Command {
  name: string;       // e.g. "/status"
  category: Category;
  description: string; // one-line, no HTML
  discord: boolean;    // can be triggered from Discord
}

export type Category = 'report' | 'deploy' | 'dev' | 'workflow' | 'test';

export const COMMANDS: Command[] = [
  // ── Reports ───────────────────────────────────────────────
  { name: '/status',          category: 'report',   description: 'System snapshot — CC usage, admin health, version, git state, open matches, sessions', discord: true },
  { name: '/test-health',     category: 'report',   description: 'Test & task report — unit test counts, tsc/lint status, e2e matrix, open sessions, code smells', discord: true },
  { name: '/activity',        category: 'report',   description: 'Recent activity digest — git log, branch status, hot modules, worktrees, CI runs', discord: true },
  { name: '/codebase-health', category: 'report',   description: 'Code quality audit — as-any casts, empty catches, large files, lint warnings, dependency freshness', discord: true },

  // ── Deploy ────────────────────────────────────────────────
  { name: '/deploy v1.x.x "note"', category: 'deploy', description: 'Versioned release — bumps version, tests, builds, deploys, commits', discord: false },
  { name: '/deploy live',          category: 'deploy', description: 'Hotfix — deploy current build to production only', discord: false },
  { name: '/deploy test',          category: 'deploy', description: 'Deploy to test environment only', discord: false },
  { name: '/deploy rules',         category: 'deploy', description: 'Deploy Firestore + RTDB rules only', discord: false },
  { name: '/deploy functions',     category: 'deploy', description: 'Deploy Cloud Functions only', discord: false },
  { name: '/deploy check',         category: 'deploy', description: 'Dry run — validate without deploying', discord: false },

  // ── Dev ───────────────────────────────────────────────────
  { name: '/admin',       category: 'dev', description: 'Start admin dashboard on localhost:5175', discord: false },
  { name: '/dev-server',  category: 'dev', description: 'Start Vite HMR (5173) + static preview (5174) dev servers', discord: false },
  { name: '/inspect-ui',  category: 'dev', description: 'Playwright screenshots, DOM dumps, computed styles from any game screen', discord: false },

  // ── Workflow ──────────────────────────────────────────────
  { name: '/orchestrate',       category: 'workflow', description: 'Start structured dev session — classify, plan, implement, verify, finish', discord: true },
  { name: '/docs-maintenance',  category: 'workflow', description: 'Audit and consolidate documentation for accuracy', discord: false },
  { name: '/simplify',          category: 'workflow', description: 'Review changed code for reuse, quality, and efficiency', discord: false },

  // ── Test ──────────────────────────────────────────────────
  { name: '/run-e2e',           category: 'test', description: 'Run and triage e2e tests via admin dashboard', discord: true },
  { name: '/e2e-audit',         category: 'test', description: 'Audit e2e coverage matrix — gaps, stale tests, missing scenarios', discord: true },
  { name: '/write-online-test', category: 'test', description: 'Write Playwright online multiplayer tests with MatchFlow helpers', discord: false },
  { name: '/aider-e2e',         category: 'test', description: 'Run Aider E2E tests with specified task', discord: false },
];

/** Get commands filtered by category */
export function getCommandsByCategory(cat?: Category): Command[] {
  return cat ? COMMANDS.filter(c => c.category === cat) : COMMANDS;
}

/** Get only Discord-triggerable commands */
export function getDiscordCommands(): Command[] {
  return COMMANDS.filter(c => c.discord);
}

/** Format commands as a plain-text block (for Discord embeds / CLI) */
export function formatCommandList(commands: Command[] = COMMANDS): string {
  const grouped = new Map<Category, Command[]>();
  for (const cmd of commands) {
    const arr = grouped.get(cmd.category) || [];
    arr.push(cmd);
    grouped.set(cmd.category, arr);
  }

  const labels: Record<Category, string> = {
    report: 'Reports', deploy: 'Deploy', dev: 'Dev Tools', workflow: 'Workflow', test: 'Testing',
  };

  const lines: string[] = [];
  for (const [cat, cmds] of grouped) {
    lines.push(`── ${labels[cat]} ${'─'.repeat(36 - labels[cat].length)}`);
    for (const c of cmds) {
      const pad = ' '.repeat(Math.max(1, 24 - c.name.length));
      lines.push(`  ${c.name}${pad}${c.description}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

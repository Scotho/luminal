import { escapeHtml } from '../ui/render';
import { COMMANDS, type Category } from '../commandRegistry';
import { icon } from '../ui/icons';

function commandTable(category: Category): string {
  return COMMANDS
    .filter(c => c.category === category)
    .map(c => `<tr><td style="font-family:var(--font-mono); font-size:11px; padding-right:16px; white-space:nowrap; color:var(--accent);">${escapeHtml(c.name)}</td><td>${escapeHtml(c.description)}</td></tr>`)
    .join('\n          ');
}

export function renderHelp(container: HTMLElement): void {
  container.innerHTML = `
    <h2>${icon('circle-help', 18)} Help &amp; Reference</h2>

    <div style="max-width:760px;">

      ${section('Chat Mode', `
        <p>Start an interactive Claude Code session from the admin dashboard.</p>
        <ol>
          <li>Click <strong>Agents Idle</strong> (top-right) to open the agent flyout</li>
          <li>Click <strong>+ NEW</strong> &rarr; <strong>Chat</strong></li>
          <li>Claude starts with full codebase access &mdash; the reply input appears immediately</li>
          <li>Type follow-up messages anytime; each reply continues the same conversation</li>
          <li>Sessions persist for <strong>30 minutes</strong> of inactivity</li>
          <li><strong>Toast notifications are suppressed</strong> while a Chat session is running</li>
          <li>Click <strong>Cancel</strong> to end early, or let the timeout close it</li>
        </ol>
        <p>All usage is tracked in the CC usage panel in the status banner.</p>
      `)}

      ${section('Pipeline Dashboard', `
        <p>Unified CI/CD overview &mdash; build status, deploys, coverage, and AI reviews in one place.</p>
        <table>
          <tr><td style="font-weight:700; padding-right:16px;">Status Strip</td><td>Build pass/fail, live version, coverage %, open PR count</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Deploy History</td><td>Every deploy logged with version, target, commit SHA, duration. <strong>Rollback</strong> button rebuilds from the stored commit and redeploys.</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Coverage Trend</td><td>Sparkline of coverage % and test count over last 20 runs. Data recorded automatically by <code>npm run test:coverage</code>.</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">AI Review Summary</td><td>Aggregates Codex/bot review comments across open PRs. &ldquo;Address All in CC&rdquo; dispatches Claude to handle them.</td></tr>
        </table>
      `)}

      ${section('Agent Templates', `
        <p>Click <strong>+ NEW</strong> in the CC flyout to dispatch pre-built agents:</p>
        <table>
          ${templateRow('Chat', 'Interactive persistent session with reply input')}
          ${templateRow('Code Review', 'Review recent branch changes for bugs, security, quality')}
          ${templateRow('Write Tests', 'Find untested modules and write unit tests')}
          ${templateRow('Fix Failing Tests', 'Run tests, diagnose failures, fix them')}
          ${templateRow('Refactor', 'Identify code smells and implement targeted improvements')}
          ${templateRow('Investigate Bug', 'Trace a bug to root cause and propose a fix')}
          ${templateRow('Update Docs', 'Audit and update documentation for accuracy')}
          ${templateRow('Performance Audit', 'Profile hot paths and suggest optimizations')}
          ${templateRow('Security Scan', 'Scan for XSS, injection, exposed secrets')}
          ${templateRow('Custom', 'Enter any prompt for a new agent')}
        </table>
      `)}

      ${section('CI / GitHub Actions', `
        <p>The <strong>CI / Actions</strong> section shows GitHub Actions workflow runs. Click a run to expand its jobs with pass/fail status and duration.</p>
        <p><strong>Preview Deploys:</strong> Every PR automatically gets a Firebase preview URL (requires <code>FIREBASE_SERVICE_ACCOUNT</code> secret in GitHub). Preview URLs expire after 7 days.</p>
      `)}

      ${section('PR Reviews &amp; Codex Integration', `
        <p>The <strong>PR Reviews</strong> section shows all pull requests with a unified comment timeline.</p>
        <ul>
          <li>AI reviewer comments (Codex, Copilot, bots) are highlighted in orange and grouped separately</li>
          <li><strong>Copy</strong> &mdash; copy a comment to clipboard</li>
          <li><strong>Address in CC</strong> &mdash; dispatch Claude to read the file, understand the suggestion, and implement the fix</li>
          <li><strong>Address All in CC</strong> &mdash; batch all AI comments into a single Claude session</li>
        </ul>
      `)}

      ${section('Deploy Workflow', `
        <p>Use the <code>/deploy</code> command in Claude Code:</p>
        <table>
          ${commandTable('deploy')}
        </table>
        <p>Each deploy is logged to the Pipeline dashboard with rollback capability.</p>
      `)}

      ${section('Orchestrated Sessions', `
        <p>The <strong>Sessions</strong> section tracks structured development work. Start with <code>/orchestrate</code> in Claude Code.</p>
        <ul>
          <li>Sessions are classified by type: feature, bugfix, polish, tuning, chore</li>
          <li>Each session has phases (brainstorm, plan, implement, verify, finish) with checkboxes</li>
          <li>Agent completions are auto-linked to the active session as notes</li>
          <li>Sessions can be reordered, blocked, or marked done with follow-up</li>
        </ul>
      `)}

      ${section('Project Health', `
        <p>Health data is displayed below the live status panel in <strong>Live &amp; Health</strong>:</p>
        <ul>
          <li><strong>Hot Modules</strong> &mdash; most-changed files in the last 30 days (high churn = risk)</li>
          <li><strong>Coverage Heatmap</strong> &mdash; every source module colored by test status and blast radius</li>
          <li><strong>Module Tiers</strong> &mdash; dependency-ordered tiers from leaf modules to core</li>
          <li><strong>Worktrees</strong> &mdash; active git worktrees with behind-origin status</li>
        </ul>
      `)}

      ${section('Test Center &amp; E2E Matrix', `
        <p><strong>Test Center</strong> &mdash; run any test config (unit, e2e, browser, online, smoke) from the dashboard with live streaming output.</p>
        <p><strong>E2E Matrix</strong> &mdash; coverage matrix for online multiplayer tests. Tracks test status (planned, implemented, passing, failing) across lobby, match, disconnect, and auth flows.</p>
      `)}

      ${section('Report Skills (slash commands)', `
        <p>Terse textual reports you can run from Claude Code or trigger via Discord. Each outputs a compact status block and optionally sends it to a Discord webhook.</p>
        <table>
          ${commandTable('report')}
        </table>
        <p style="margin-top:8px;"><strong>Discord:</strong> Add <code>--discord</code> or confirm when prompted to send the report to your configured webhook. Reports use the <code>webhooks.reports</code> key in <code>admin/data/alerts.json</code> (falls back to <code>commitHistory</code>).</p>
        <p><strong>Trigger from Discord:</strong> Send a message to your bot (e.g. <code>!status</code>) that calls <code>POST /__admin_exec/claude</code> with the prompt <code>/status --discord</code>. The agent runs the skill and posts results back to the channel.</p>
      `)}

      ${section('Keyboard Shortcuts', `
        <p><strong>Global</strong></p>
        <table>
          ${shortcutRow('Ctrl/Cmd + K', 'Open Command Bar &mdash; fuzzy-search sections, agent templates, and actions')}
          ${shortcutRow('Esc', 'Close CC flyout / Command Bar / modals')}
        </table>
        <p style="margin-top:12px;"><strong>Sidebar</strong></p>
        <table>
          ${shortcutRow('Arrow Up/Down', 'Navigate sidebar sections')}
          ${shortcutRow('Enter', 'Select focused sidebar item')}
          ${shortcutRow('Drag &amp; Drop', 'Reorder sidebar sections (persisted to localStorage)')}
          ${shortcutRow('Click ☆', 'Favorite a section &mdash; pins it to the top of the sidebar')}
        </table>
        <p style="margin-top:12px;"><strong>Notes (outliner)</strong></p>
        <table>
          ${shortcutRow('Tab', 'Indent &mdash; become child of previous sibling')}
          ${shortcutRow('Shift + Tab', 'Outdent &mdash; move up to parent\'s level')}
          ${shortcutRow('Enter', 'Create new sibling below current node')}
          ${shortcutRow('Backspace (empty)', 'Delete node and promote its children to parent level')}
          ${shortcutRow('Arrow Up/Down', 'Move focus to previous/next visible node')}
        </table>
        <p style="margin-top:12px;"><strong>Command Bar</strong></p>
        <table>
          ${shortcutRow('Arrow Up/Down', 'Navigate results')}
          ${shortcutRow('Enter', 'Execute highlighted command')}
          ${shortcutRow('Esc', 'Close command bar')}
        </table>
        <p style="margin-top:12px;"><strong>Reminders</strong></p>
        <table>
          ${shortcutRow('Enter', 'Add new reminder from input field')}
        </table>
      `)}

      ${section('Command Bar (Ctrl/Cmd + K)', `
        <p>Fuzzy-searchable command palette with three categories:</p>
        <ul>
          <li><strong>Navigate</strong> &mdash; jump to any of the 26 sections instantly</li>
          <li><strong>Agent</strong> &mdash; launch any agent template (Chat, Code Review, Write Tests, etc.)</li>
          <li><strong>Action</strong> &mdash; Toggle CC Panel, New Custom Agent, Refresh Usage</li>
        </ul>
        <p>Type to filter. Arrow keys to navigate. Enter to execute.</p>
      `)}

      ${section('Task AI Features', `
        <p>The Tasks section has built-in AI-powered operations:</p>
        <table>
          <tr><td style="font-weight:700; padding-right:16px;">Auto-Prioritize</td><td>Dispatches Claude to assign P1&ndash;P5 priorities based on module blast radius</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Suggest Groupings</td><td>Claude analyzes related tasks and proposes logical groupings (saved to <code>groupings.json</code>)</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Daily Standup</td><td>Generates a standup summary prompt from pending tasks</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Run Audit</td><td>On completed tasks &mdash; generates a code-review audit prompt</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Bulk Select</td><td>Checkbox per task &rarr; multi-select toolbar for batch priority/status changes or delete</td></tr>
        </table>
      `)}

      ${section('Bug Report Burst Detection', `
        <p>The Bug Reports section automatically detects error spikes:</p>
        <ul>
          <li>Reports are bucketed into <strong>5-minute time windows</strong></li>
          <li>A window with <strong>3+ reports</strong> triggers a burst alert panel</li>
          <li>Errors within each burst are <strong>clustered by message similarity</strong> &mdash; top 3 shown</li>
          <li>Severity coloring: <span style="color:var(--accent);">elevated</span> (3&ndash;4), <span style="color:var(--orange,#f0a030);">warning</span> (5&ndash;9), <span style="color:var(--red);">critical</span> (10+)</li>
          <li>Cloud Function also fires a <strong>Discord DM</strong> if 3+ reports land in 10 minutes (15-min cooldown)</li>
        </ul>
        <p>Firebase SDK noise is automatically filtered out of bug reports on localhost.</p>
      `)}

      ${section('Settings &amp; Preferences', `
        <p>All settings are persisted in localStorage and take effect immediately.</p>
        <table>
          <tr><td style="font-weight:700; padding-right:16px;">Auto-Refresh</td><td>Toggle + interval (1/2/5/10 min). Applies to local-JSON sections: Sessions, Tasks, E2E Matrix, Notes, Reminders, Audits, Links, Notifications. Firebase/GitHub sections are manual-refresh only.</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Agent Timeout</td><td>Claude session max lifetime &mdash; 10, 30, or 60 minutes</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Max Concurrent Agents</td><td>1&ndash;5 simultaneous Claude sessions</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Toast Duration</td><td>Notification popup lifetime &mdash; 2, 4, or 8 seconds</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Suppress During Chat</td><td>Hide toast notifications while a Chat session is active</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Default Section</td><td>Which section loads on dashboard open (Live &amp; Health, Sessions, Tasks, Pipeline)</td></tr>
          <tr><td style="font-weight:700; padding-right:16px;">Theme Toggle</td><td>Click ☾/☼ in the header to switch light/dark mode (persisted)</td></tr>
        </table>
      `)}

      ${section('3D Vehicle Viewer', `
        <p>The <strong>Viewer</strong> section renders game vehicles in a 3D preview:</p>
        <ul>
          <li>Vehicle tabs: <strong>Bike</strong>, <strong>Car</strong>, <strong>Hoverboard</strong></li>
          <li>GFX preset dropdown matches in-game quality levels</li>
          <li>Color picker to preview paint jobs</li>
          <li>Hoverboard has <strong>11 animation states</strong> (idle, lean, turn, boost, drift, grind, airborne, etc.)</li>
          <li>Animation parameter slider (-1 to +1) and loop toggle</li>
          <li>Mouse drag to orbit camera &mdash; scroll to zoom</li>
        </ul>
      `)}

      ${section('Hidden Features &amp; Tips', `
        <ul>
          <li><strong>Confirm-to-act</strong> &mdash; destructive buttons (Purge, Delete) require a <em>second click within 3 seconds</em> to execute</li>
          <li><strong>Session stale detection</strong> &mdash; active sessions with no notes for 24h get a stale indicator</li>
          <li><strong>Session auto-archive</strong> &mdash; done sessions older than 7 days move to archive</li>
          <li><strong>E2E Matrix scan</strong> &mdash; auto-detects test implementations and updates status from planned &rarr; implemented</li>
          <li><strong>CC session resume</strong> &mdash; if a Claude session was interrupted, dispatch with the same agent ID to resume</li>
          <li><strong>CC retry</strong> &mdash; re-run the last agent session with one click</li>
          <li><strong>Diff modal</strong> &mdash; after a CC agent finishes, view code changes side-by-side</li>
          <li><strong>Investigate in CC</strong> &mdash; appears on bug reports, test failures, and audit items &mdash; dispatches Claude with full context</li>
          <li><strong>Mobile hamburger</strong> &mdash; tap ☰ to toggle sidebar on narrow viewports</li>
          <li><strong>Max 3 toasts</strong> &mdash; oldest are evicted when a 4th arrives</li>
        </ul>
      `)}

      ${section('Environments', `
        <table>
          <tr><td style="font-weight:700; padding-right:16px; white-space:nowrap;">Live</td><td><a href="https://luminal-game.web.app" target="_blank" style="color:var(--accent);">luminal-game.web.app</a></td></tr>
          <tr><td style="font-weight:700; padding-right:16px; white-space:nowrap;">Test</td><td><a href="https://luminal-test.web.app" target="_blank" style="color:var(--accent);">luminal-test.web.app</a></td></tr>
          <tr><td style="font-weight:700; padding-right:16px; white-space:nowrap;">Admin</td><td><a href="http://localhost:5175" target="_blank" style="color:var(--accent);">localhost:5175</a></td></tr>
          <tr><td style="font-weight:700; padding-right:16px; white-space:nowrap;">Dev Server</td><td><a href="http://localhost:5173" target="_blank" style="color:var(--accent);">localhost:5173</a></td></tr>
        </table>
      `)}
    </div>
  `;
}

// ── Helpers ──────────────────────────────────────────────

function section(title: string, body: string): string {
  return `
    <details style="margin-bottom:16px; border:1px solid var(--border); border-radius:4px;" open>
      <summary style="cursor:pointer; padding:10px 14px; font-weight:700; font-size:14px; color:var(--text-heading); user-select:none;">${escapeHtml(title)}</summary>
      <div style="padding:8px 14px 14px; font-size:12px; line-height:1.7; color:var(--text);">
        ${body}
      </div>
    </details>
  `;
}

function templateRow(name: string, desc: string): string {
  return `<tr><td style="font-weight:700; padding-right:16px; white-space:nowrap; color:var(--accent);">${escapeHtml(name)}</td><td>${escapeHtml(desc)}</td></tr>`;
}

function deployRow(cmd: string, desc: string): string {
  return `<tr><td style="font-family:var(--font-mono); font-size:11px; padding-right:16px; white-space:nowrap; color:var(--accent);">${escapeHtml(cmd)}</td><td>${desc}</td></tr>`;
}

function shortcutRow(key: string, desc: string): string {
  return `<tr><td><kbd style="background:var(--bg-hover); border:1px solid var(--border); border-radius:2px; padding:1px 6px; font-family:var(--font-mono); font-size:11px;">${escapeHtml(key)}</kbd></td><td style="padding-left:12px;">${escapeHtml(desc)}</td></tr>`;
}

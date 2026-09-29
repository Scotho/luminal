#!/usr/bin/env node
// ── Discord Notification Utility ─────────────────────────────
// Usage:
//   node scripts/discord-notify.js commit          — send latest commit info
//   node scripts/discord-notify.js release <ver>    — send release notes from changelog
//
// Reads webhook URLs from admin/data/alerts.json (gitignored).
// Fails silently so it never blocks git or deploy workflows.

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ALERTS_PATH = resolve(ROOT, 'admin/data/alerts.json');

function loadConfig() {
  if (!existsSync(ALERTS_PATH)) return null;
  try { return JSON.parse(readFileSync(ALERTS_PATH, 'utf8')); }
  catch { return null; }
}

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}

async function sendWebhook(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`  ⚠ Discord webhook failed (${res.status}): ${text}`);
  }
}

// ── Commit Notification ──────────────────────────────────────
async function notifyCommit(config) {
  const url = config.webhooks.commitHistory;
  if (!url) return;

  const hash = git('rev-parse --short HEAD');
  const fullHash = git('rev-parse HEAD');
  const message = git('log -1 --pretty=%s');
  const body = git('log -1 --pretty=%b');
  const author = git('log -1 --pretty=%an');
  const branch = git('rev-parse --abbrev-ref HEAD');
  const filesChanged = git('diff-tree --no-commit-id --name-only -r HEAD').split('\n').filter(Boolean);

  const description = body ? `${message}\n\n${body}`.slice(0, 2048) : message;
  const fileList = filesChanged.length <= 8
    ? filesChanged.map(f => `\`${f}\``).join('\n')
    : filesChanged.slice(0, 7).map(f => `\`${f}\``).join('\n') + `\n+${filesChanged.length - 7} more`;

  const embed = {
    title: message.slice(0, 256),
    description: body ? body.slice(0, 2048) : undefined,
    color: 0x49A2B2,  // teal — matches Luminal palette
    fields: [
      { name: 'Branch', value: `\`${branch}\``, inline: true },
      { name: 'Commit', value: `\`${hash}\``, inline: true },
      { name: 'Author', value: author, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'Luminal — Commit History · Dashboard: http://admin:8080' },
  };

  if (filesChanged.length > 0) {
    embed.fields.push({ name: `Files (${filesChanged.length})`, value: fileList });
  }

  await sendWebhook(url, { embeds: [embed] });
}

// ── Release Notification ─────────────────────────────────────
async function notifyRelease(config, version) {
  const url = config.webhooks.releaseNotes;
  if (!url) return;

  // Parse changelog.html for this version's notes
  const changelogPath = resolve(ROOT, 'changelog.html');
  const changelog = readFileSync(changelogPath, 'utf8');

  // Extract notes for this version from the HTML
  const versionEsc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<div class="cl-version">${versionEsc}.*?</div>\\s*<ul>([\\s\\S]*?)</ul>`
  );
  const match = changelog.match(pattern);

  let notes = [];
  if (match) {
    const liPattern = /<li>(.*?)<\/li>/gs;
    let liMatch;
    while ((liMatch = liPattern.exec(match[1])) !== null) {
      // Strip HTML entities back to readable text
      notes.push(liMatch[1]
        .replace(/&mdash;/g, '—')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, '')
      );
    }
  }

  if (notes.length === 0) {
    // Fallback: use CLI args if changelog parsing failed
    notes = process.argv.slice(4);
  }

  // Build a short summary (first sentence of first 2-3 notes)
  const summaryItems = notes.slice(0, 3).map(n => {
    const firstSentence = n.split(/[.!—]/)[0].trim();
    return firstSentence.length > 80 ? firstSentence.slice(0, 77) + '...' : firstSentence;
  });
  const summary = summaryItems.map(s => `• ${s}`).join('\n');

  // Build full notes list
  const fullNotes = notes.map(n => {
    const truncated = n.length > 200 ? n.slice(0, 197) + '...' : n;
    return `• ${truncated}`;
  }).join('\n');

  const branch = git('rev-parse --abbrev-ref HEAD');
  const hash = git('rev-parse --short HEAD');

  const embed = {
    title: `Luminal ${version} Released`,
    color: 0xFAC322,  // gold — matches Luminal accent
    fields: [
      { name: 'TL;DR', value: summary },
      { name: 'Full Changelog', value: fullNotes.slice(0, 1024) },
      { name: 'Links', value: '[Play Now](https://luminal-game.web.app) · [Test Build](https://luminal-test.web.app)', inline: true },
      { name: 'Build', value: `\`${branch}\` @ \`${hash}\``, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'Luminal — Release Notes · Dashboard: http://admin:8080' },
  };

  await sendWebhook(url, { embeds: [embed] });
}

// ── Report Notification ──────────────────────────────────────
async function notifyReport(config, title, body) {
  const url = config.webhooks.reports || config.webhooks.commitHistory;
  if (!url) return;

  const branch = git('rev-parse --abbrev-ref HEAD');
  const hash = git('rev-parse --short HEAD');

  // Discord embed description max is 4096 chars
  const description = body.length > 4000 ? body.slice(0, 3997) + '...' : body;

  const colorMap = {
    'Status': 0x49A2B2,           // teal
    'Test Health': 0x22CC66,      // green
    'Activity': 0xFAC322,         // gold
    'Codebase Health': 0xFF8800,  // orange
  };

  const embed = {
    title: `${title}`,
    description: `\`\`\`\n${description}\n\`\`\``,
    color: colorMap[title] || 0x49A2B2,
    fields: [
      { name: 'Branch', value: `\`${branch}\``, inline: true },
      { name: 'Commit', value: `\`${hash}\``, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'Luminal — Agent Report' },
  };

  await sendWebhook(url, { embeds: [embed] });
}

// ── Commands List ────────────────────────────────────────────
async function notifyCommands(config) {
  const url = config.webhooks.reports || config.webhooks.commitHistory;
  if (!url) return;

  // Try fetching from admin dashboard first (canonical source)
  let commandText;
  try {
    const res = await fetch('http://localhost:5175/__admin_commands?format=text');
    if (res.ok) commandText = await res.text();
  } catch { /* dashboard not running */ }

  // Fallback: hardcoded summary
  if (!commandText) {
    commandText = [
      '── Reports ────────────────────────',
      '  /status              System snapshot',
      '  /test-health         Test & task report',
      '  /activity            Recent activity digest',
      '  /codebase-health     Code quality audit',
      '',
      '── Deploy ─────────────────────────',
      '  /deploy v1.x.x      Versioned release',
      '  /deploy live         Hotfix to production',
      '  /deploy test         Deploy to test env',
      '  /deploy rules        Deploy rules only',
      '  /deploy functions    Deploy functions only',
      '  /deploy check        Dry run',
      '',
      '── Workflow ────────────────────────',
      '  /orchestrate         Structured dev session',
      '',
      '── Testing ────────────────────────',
      '  /run-e2e             Run & triage e2e tests',
      '  /e2e-audit           Audit e2e coverage matrix',
    ].join('\n');
  }

  const embed = {
    title: 'Luminal Commands',
    description: `\`\`\`\n${commandText}\n\`\`\``,
    color: 0x49A2B2,
    fields: [
      { name: 'Trigger', value: 'Type `!<command>` to run any Discord-enabled command via Claude agent', inline: false },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'Luminal — Command Reference' },
  };

  await sendWebhook(url, { embeds: [embed] });
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  if (!config) {
    console.error('  ⚠ No alerts.json found — skipping Discord notification');
    return;
  }

  const mode = process.argv[2];

  if (mode === 'commit') {
    await notifyCommit(config);
  } else if (mode === 'release') {
    const version = process.argv[3];
    if (!version) { console.error('Usage: discord-notify.js release <version>'); process.exit(1); }
    await notifyRelease(config, version);
  } else if (mode === 'report') {
    const title = process.argv[3];
    const body = process.argv[4];
    if (!title || !body) { console.error('Usage: discord-notify.js report "<title>" "<body>"'); process.exit(1); }
    await notifyReport(config, title, body);
  } else if (mode === 'commands') {
    await notifyCommands(config);
  } else {
    console.error('Usage: discord-notify.js [commit|release|report|commands] [args]');
    process.exit(1);
  }
}

main().catch(err => {
  // Never let Discord failures break workflows
  console.error(`  ⚠ Discord notification failed: ${err.message}`);
});

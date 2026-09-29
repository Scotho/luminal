#!/usr/bin/env node
/**
 * agent-scope.mjs — Multi-agent scope registration and coordination.
 *
 * Usage:
 *   echo '<hook-stdin>' | node admin/scripts/agent-scope.mjs --read
 *   echo '<hook-stdin>' | node admin/scripts/agent-scope.mjs --write
 *   echo '<hook-stdin>' | node admin/scripts/agent-scope.mjs --claim
 *
 * --read  (SessionStart): Reads scopes and outputs other agents' context
 *         as additionalContext for the hook response.
 * --write (Stop): Parses the transcript to extract the initial prompt,
 *         modified files, and commit messages, then registers this session.
 * --claim (PreToolUse or manual): Registers files this agent intends to
 *         modify, so other agents see hard boundaries.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { execSync } from 'child_process';

const CWD = process.cwd();
const SCOPE_FILE = resolve(CWD, 'admin/data/agent-scopes.json');
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours — prune entries older than this

// ── Helpers ────────────────────────────────────────────

function loadScopes() {
  if (!existsSync(SCOPE_FILE)) return [];
  try { return JSON.parse(readFileSync(SCOPE_FILE, 'utf8')); }
  catch { return []; }
}

function saveScopes(scopes) {
  writeFileSync(SCOPE_FILE, JSON.stringify(scopes, null, 2) + '\n');
}

function pruneStale(scopes) {
  const now = Date.now();
  return scopes.filter(s => now - s.lastActivity < STALE_MS);
}

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); }
  catch { return {}; }
}

/** Extract the first real user prompt from the transcript JSONL. */
function extractPrompt(transcriptPath) {
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== 'user') continue;
      const msg = obj.message ?? obj;
      const content = msg.content ?? '';
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        const block = content.find(b => b.type === 'text');
        text = block?.text ?? '';
      }
      // Skip system injections, commands, and empty lines
      if (!text || text.startsWith('<') || text.trim().length < 10) continue;
      // Take first meaningful line, cap at 150 chars
      const firstLine = text.split('\n').find(l => l.trim().length > 5) ?? text;
      return firstLine.trim().slice(0, 150);
    }
  } catch { /* transcript unreadable */ }
  return null;
}

/** Extract unique files modified (Edit/Write tool calls) from the transcript. */
function extractModifiedFiles(transcriptPath) {
  const files = new Set();
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== 'assistant') continue;
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'Edit' || block.name === 'Write') {
          const fp = block.input?.file_path;
          if (fp) {
            try { files.add(relative(CWD, fp).replace(/\\/g, '/')); }
            catch { files.add(fp); }
          }
        }
      }
    }
  } catch { /* transcript unreadable */ }
  return [...files].slice(0, 15);
}

/** Extract recent commit messages made during this session. */
function extractRecentCommits(startedAt) {
  try {
    // Get commits made after session start
    const since = new Date(startedAt).toISOString();
    const raw = execSync(
      `git log --oneline --since="${since}" --no-merges 2>/dev/null`,
      { cwd: CWD, encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (!raw) return [];
    return raw.split('\n').slice(0, 5).map(l => l.trim());
  } catch { return []; }
}

// ── Context Formatting ────────────────────────────────

function formatAgentContext(others) {
  const sections = others.map(s => {
    const files = s.files?.length ? s.files.slice(0, 5) : [];
    const claimed = s.claimedFiles?.length ? s.claimedFiles : [];
    const commits = s.commits?.length ? s.commits.slice(0, 3) : [];
    const age = Math.round((Date.now() - s.lastActivity) / 60000);

    let entry = `- ${s.scope} (${age}m ago)`;

    if (claimed.length > 0) {
      entry += `\n  CLAIMED (do not modify): ${claimed.join(', ')}`;
    }
    if (files.length > 0) {
      entry += `\n  Modified: ${files.join(', ')}`;
    }
    if (commits.length > 0) {
      entry += `\n  Commits: ${commits.join('; ')}`;
    }

    return entry;
  });

  // Build the warning with appropriate severity
  const hasClaimed = others.some(s => s.claimedFiles?.length > 0);
  const allModifiedFiles = new Set(others.flatMap(s => [
    ...(s.files ?? []),
    ...(s.claimedFiles ?? []),
  ]));

  let warning = 'Active agents in this project:\n' + sections.join('\n');

  if (hasClaimed) {
    warning += '\n\nFiles marked CLAIMED are owned by another agent — do NOT modify them. If your task requires changes to a claimed file, report the conflict instead of proceeding.';
  }

  warning += '\n\nAvoid modifying files that other agents are working on. If you need to touch a shared file, note the potential conflict.';

  if (allModifiedFiles.size > 0) {
    warning += `\n\nAll files touched by other agents: ${[...allModifiedFiles].slice(0, 20).join(', ')}`;
  }

  return warning;
}

// ── Main ───────────────────────────────────────────────

const mode = process.argv[2];
const input = readStdin();

if (mode === '--read') {
  // SessionStart: show what other agents are doing
  let scopes = pruneStale(loadScopes());
  saveScopes(scopes);

  const others = scopes.filter(s => s.sessionId !== input.session_id);
  if (others.length === 0) {
    process.stdout.write(JSON.stringify({ suppressOutput: true }));
  } else {
    const ctx = formatAgentContext(others);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: ctx,
      },
    }));
  }
} else if (mode === '--write') {
  // Stop: register/update this session's scope
  let scopes = pruneStale(loadScopes());

  const sessionId = input.session_id ?? 'unknown';
  const transcriptPath = input.transcript_path;

  // Extract scope and files from transcript
  const prompt = transcriptPath ? extractPrompt(transcriptPath) : null;
  const files = transcriptPath ? extractModifiedFiles(transcriptPath) : [];

  const idx = scopes.findIndex(s => s.sessionId === sessionId);
  if (idx >= 0) {
    // Update existing entry
    scopes[idx].lastActivity = Date.now();
    if (files.length > 0) {
      const merged = new Set([...(scopes[idx].files ?? []), ...files]);
      scopes[idx].files = [...merged].slice(0, 20);
    }
    // Extract commits made during this session
    const commits = extractRecentCommits(scopes[idx].startedAt);
    if (commits.length > 0) {
      scopes[idx].commits = commits;
    }
    // Update scope if we got a better one and current is placeholder
    if (prompt && scopes[idx].scope === 'new session') {
      scopes[idx].scope = prompt;
    }
  } else {
    // New entry
    scopes.push({
      sessionId,
      scope: prompt ?? 'new session',
      files,
      claimedFiles: [],
      commits: [],
      startedAt: Date.now(),
      lastActivity: Date.now(),
    });
  }

  saveScopes(scopes);
  process.stdout.write(JSON.stringify({ suppressOutput: true }));
} else if (mode === '--claim') {
  // Claim files upfront — called by controller before dispatching agent
  // Input: { session_id, claimed_files: ["path1", "path2"] }
  let scopes = pruneStale(loadScopes());

  const sessionId = input.session_id ?? 'unknown';
  const claimedFiles = input.claimed_files ?? [];

  const idx = scopes.findIndex(s => s.sessionId === sessionId);
  if (idx >= 0) {
    const merged = new Set([...(scopes[idx].claimedFiles ?? []), ...claimedFiles]);
    scopes[idx].claimedFiles = [...merged].slice(0, 20);
    scopes[idx].lastActivity = Date.now();
  } else {
    scopes.push({
      sessionId,
      scope: 'new session',
      files: [],
      claimedFiles: claimedFiles.slice(0, 20),
      commits: [],
      startedAt: Date.now(),
      lastActivity: Date.now(),
    });
  }

  saveScopes(scopes);
  process.stdout.write(JSON.stringify({ suppressOutput: true }));
} else {
  process.stderr.write('Usage: agent-scope.mjs --read | --write | --claim\n');
  process.exit(1);
}

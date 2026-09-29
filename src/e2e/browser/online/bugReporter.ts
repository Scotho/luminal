// src/e2e/browser/online/bugReporter.ts
// Auto-report E2E test failures to the admin dashboard and Firebase RTDB.
// Creates a session per test run, posts notes for each failure with full diagnostics.

import type { NetcodeDiagnostics, ConsoleEntry } from './matchFlow';

const ADMIN_BASE = 'http://localhost:5175';
const FIREBASE_DB_URL = 'https://luminal-game-default-rtdb.firebaseio.com';

let _sessionId: string | null = null;

/** Create an E2E test session in the admin dashboard. */
export async function startTestSession(suiteName: string): Promise<string | null> {
  try {
    const res = await fetch(`${ADMIN_BASE}/__admin_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: `E2E: ${suiteName}`,
        type: 'chore',
        status: 'active',
        section: 'current-stack',
        phases: ['run', 'report'],
        plan: `Automated E2E test run: ${suiteName}`,
      }),
    });
    const data = await res.json();
    _sessionId = data.id ?? null;
    return _sessionId;
  } catch {
    // Admin dashboard not running — continue without session tracking
    return null;
  }
}

/** Mark the test session as done or done-followup. */
export async function endTestSession(hasFailures: boolean): Promise<void> {
  if (!_sessionId) return;
  try {
    await fetch(`${ADMIN_BASE}/__admin_session/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: _sessionId,
        status: hasFailures ? 'done-followup' : 'done',
      }),
    });
  } catch { /* admin not running */ }
}

export interface BugReport {
  testName: string;
  error: string;
  expected: string;
  actual: string;
  diagnostics?: NetcodeDiagnostics;
  consoleLogs?: ConsoleEntry[];
  screenshotPaths?: string[];
}

/** Report a test failure to both admin dashboard (note) and Firebase RTDB (debugReports). */
export async function reportBug(report: BugReport): Promise<void> {
  const timestamp = new Date().toISOString();

  // ── Format the bug note ──
  const lines = [
    `🔴 E2E FAILURE: ${report.testName}`,
    `Time: ${timestamp}`,
    `Error: ${report.error}`,
    '',
    `Expected: ${report.expected}`,
    `Actual: ${report.actual}`,
  ];

  if (report.diagnostics) {
    const d = report.diagnostics;
    lines.push('', '── Netcode Diagnostics ──');
    lines.push(`Winners agree: ${d.winnersAgree}`);
    if (d.roundResults.length > 0) {
      lines.push(`Round results: ${JSON.stringify(d.roundResults)}`);
    }
    if (d.hasDesync) {
      lines.push(`Desync lines: ${d.desyncLines.join(' | ')}`);
    }
    if (d.hasIntegrityWarning) {
      lines.push(`Integrity warnings: ${d.integrityLines.join(' | ')}`);
    }
    if (d.hashMismatchLines.length > 0) {
      lines.push(`Hash mismatches: ${d.hashMismatchLines.join(' | ')}`);
    }
    lines.push(`Phases — host: [${d.phaseReport.host.join(', ')}] guest: [${d.phaseReport.guest.join(', ')}]`);
  }

  if (report.screenshotPaths?.length) {
    lines.push('', `Screenshots: ${report.screenshotPaths.join(', ')}`);
  }

  const noteText = lines.join('\n');

  // ── Post to admin dashboard session ──
  if (_sessionId) {
    try {
      await fetch(`${ADMIN_BASE}/__admin_session/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: _sessionId, text: noteText }),
      });
    } catch { /* admin not running */ }
  }

  // ── Post to Firebase RTDB debugReports ──
  try {
    await fetch(`${FIREBASE_DB_URL}/debugReports.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'E2E-Bot',
        uid: 'e2e-automated',
        gameMode: 'e2e-test',
        error: `[E2E] ${report.testName}: ${report.error}`,
        stack: [
          `Expected: ${report.expected}`,
          `Actual: ${report.actual}`,
          report.diagnostics ? `Winners agree: ${report.diagnostics.winnersAgree}` : '',
          report.diagnostics?.desyncLines.join('\n') ?? '',
        ].filter(Boolean).join('\n'),
        url: `e2e://${report.testName}`,
        userAgent: 'Playwright E2E Runner',
        ts: Date.now(),
      }),
    });
  } catch { /* Firebase unavailable */ }

  // Log to console for CI visibility
  console.error(noteText);
}

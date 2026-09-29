// ── Shared helpers for test runner and test center ───────────────────────────
// Extracted from testRunner.ts so testCenter.ts can reuse them.

import { escapeHtml } from '../ui/render';

export const CONFIGS = ['unit', 'e2e', 'browser', 'online', 'smoke', 'admin', 'relay'] as const;

export const CONFIG_LABELS: Record<string, string> = {
  unit: 'Unit',
  e2e: 'E2E',
  browser: 'Browser',
  online: 'Online',
  smoke: 'Smoke',
  admin: 'Admin',
  relay: 'Relay',
};

// ── Test Catalog ──────────────────────────────────────────────────────────────

export interface TestSuite {
  id: string;
  config: string;         // vitest config to use
  name: string;           // human name
  description: string;    // 1-line blurb
  file: string;           // path on disk
  group: string;          // category group
}

export const TEST_CATALOG: TestSuite[] = [
  // ── Unit Tests ──
  { id: 'unit-core', config: 'unit', name: 'Core Simulation', description: 'Deterministic sim, collision, PRNG, lockstep', file: 'src/core/*.test.ts', group: 'Unit Tests' },
  { id: 'unit-net', config: 'unit', name: 'Networking', description: 'Protocol, transport, negotiation, disconnect', file: 'src/net/*.test.ts', group: 'Unit Tests' },
  { id: 'unit-audio', config: 'unit', name: 'Audio & SFX', description: 'Music, spatial audio, vehicle audio, SFX', file: 'src/audio*.test.ts, src/sfx*.test.ts', group: 'Unit Tests' },
  { id: 'unit-ui', config: 'unit', name: 'UI Components', description: 'Navigation, menus, settings, overlays', file: 'src/ui/__tests__/*.test.ts', group: 'Unit Tests' },
  { id: 'unit-game', config: 'unit', name: 'Game Systems', description: 'Online match, lobby, matchmaking, replay, profile', file: 'src/*.test.ts (game systems)', group: 'Unit Tests' },
  { id: 'unit-all', config: 'unit', name: 'All Unit Tests', description: 'Full unit test suite', file: 'vitest.config.ts', group: 'Unit Tests' },

  // ── Integration ──
  { id: 'e2e-headless', config: 'e2e', name: 'Headless E2E', description: 'Bot-driven scenarios, loopback transport, state recorder', file: 'src/e2e/__tests__/*.test.ts', group: 'Integration' },
  { id: 'e2e-infra', config: 'e2e', name: 'E2E Infrastructure', description: 'Headless client, loopback transport, input drivers, state recorder', file: 'src/e2e/*.test.ts, src/e2e/inputDrivers/*.test.ts', group: 'Integration' },

  // ── Browser Tests ──
  { id: 'browser-overlay', config: 'browser', name: 'Overlay Containment', description: 'UI overflow and layout validation across viewports', file: 'src/e2e/browser/overlay-containment.test.ts', group: 'Browser Tests' },

  // ── Online Multiplayer ──
  { id: 'online-lobby', config: 'online', name: 'Lobby Match', description: 'Two-browser lobby create/join/play/result flow', file: 'src/e2e/browser/online-emulator/lobby-match.test.ts', group: 'Online Multiplayer' },
  { id: 'online-disconnect', config: 'online', name: 'Disconnect', description: 'Mid-match disconnect detection and forfeit', file: 'src/e2e/browser/online-emulator/disconnect.test.ts', group: 'Online Multiplayer' },
  { id: 'online-vehicle-map', config: 'online', name: 'Vehicle & Map Selection', description: 'Vehicle and map selection in online lobby', file: 'src/e2e/browser/online-emulator/vehicle-map-selection.test.ts', group: 'Online Multiplayer' },

  // ── Smoke Tests ──
  { id: 'smoke-critical', config: 'smoke', name: 'Critical Path', description: 'Two-player lobby match with winner validation', file: 'src/e2e/browser/online-smoke/critical-path.test.ts', group: 'Smoke Tests' },
  { id: 'smoke-wall-death', config: 'smoke', name: 'Wall Death', description: 'Host turns 180\u00b0 into wall \u2014 guest wins validation', file: 'src/e2e/browser/online-smoke/wall-death.test.ts', group: 'Smoke Tests' },
  { id: 'smoke-ai-victory', config: 'smoke', name: 'AI Victory', description: 'Player suicides vs AI \u2014 defeat screen validation', file: 'src/e2e/browser/online-smoke/ai-victory.test.ts', group: 'Smoke Tests' },
  { id: 'smoke-friend-invite', config: 'smoke', name: 'Friend Invite', description: 'Invite via friend list, play match, validate winner', file: 'src/e2e/browser/online-smoke/friend-invite.test.ts', group: 'Smoke Tests' },
  { id: 'smoke-friend-lifecycle', config: 'smoke', name: 'Friend Lifecycle', description: 'Add/accept-toast/remove/re-add/accept-social cycle', file: 'src/e2e/browser/online-smoke/friend-lifecycle.test.ts', group: 'Smoke Tests' },

  // ── Cloud Functions ──
  { id: 'functions', config: 'unit', name: 'Cloud Functions', description: 'Arbitration, forfeit, cleanup, username claiming', file: 'functions/src/__tests__/*.test.ts', group: 'Cloud Functions' },

  // ── Admin Panel ──
  { id: 'admin-all', config: 'admin', name: 'Admin Tests', description: 'Dashboard sections, middleware, UI components, API routes', file: 'admin/src/__tests__/*.test.ts, admin/src/ui/__tests__/*.test.ts', group: 'Admin Panel' },
  { id: 'admin-scripts', config: 'admin', name: 'Admin Scripts', description: 'Activity digest, module map, test health scripts', file: 'admin/scripts/__tests__/*.test.ts', group: 'Admin Panel' },

  // ── Relay Server ──
  { id: 'relay-all', config: 'relay', name: 'Relay Server', description: 'Auth, rate limiting, room management', file: 'relay/src/*.test.ts', group: 'Relay Server' },
];

// ── Test Presets (quick-queue groupings) ─────────────────────────────────────
// Human-facing groupings for the Test Center "one-click" queue loading.

export interface TestPreset {
  id: string;
  name: string;
  description: string;
  suiteIds: string[];   // references TEST_CATALOG[].id
}

export const TEST_PRESETS: TestPreset[] = [
  {
    id: 'preset-loads',
    name: 'Loads',
    description: 'Game loads past click-to-start — browser overlay + smoke critical path',
    suiteIds: ['browser-overlay', 'smoke-critical'],
  },
  {
    id: 'preset-local',
    name: 'Local Match',
    description: 'Core sim, game systems, headless E2E — everything that runs without Firebase',
    suiteIds: ['unit-core', 'unit-game', 'e2e-headless'],
  },
  {
    id: 'preset-online-set',
    name: 'Online Set Finishes',
    description: 'Full online match lifecycle — lobby create/join, play rounds, result screen',
    suiteIds: ['online-lobby', 'online-disconnect', 'online-vehicle-map', 'smoke-wall-death', 'smoke-ai-victory'],
  },
  {
    id: 'preset-multiplayer',
    name: 'Full Multiplayer',
    description: 'All online + smoke + friends — complete multiplayer regression',
    suiteIds: ['online-lobby', 'online-disconnect', 'online-vehicle-map', 'smoke-critical', 'smoke-wall-death', 'smoke-ai-victory', 'smoke-friend-invite', 'smoke-friend-lifecycle'],
  },
  {
    id: 'preset-infra',
    name: 'Infrastructure',
    description: 'Admin panel, relay server, cloud functions, E2E infra',
    suiteIds: ['admin-all', 'admin-scripts', 'relay-all', 'functions', 'e2e-infra'],
  },
  {
    id: 'preset-full',
    name: 'Full Suite',
    description: 'Everything — unit, integration, browser, online, smoke, functions',
    suiteIds: TEST_CATALOG.map(s => s.id),
  },
];

/** Render a row of config buttons. Active config gets `active` class. Disabled when busy. */
export function renderConfigButtons(
  configs: readonly string[],
  activeConfig: string | null,
  busy: boolean,
): string {
  const buttons = configs.map(cfg => {
    const label = CONFIG_LABELS[cfg] ?? cfg;
    const isActive = cfg === activeConfig ? ' active' : '';
    const disabledAttr = busy ? ' disabled' : '';
    return `<button class="config-btn${isActive}" data-config="${escapeHtml(cfg)}"${disabledAttr} style="font-size:10px; padding:4px 10px;">${escapeHtml(label)}</button>`;
  });
  return `<div class="config-btn-row" style="display:flex; gap:6px; flex-wrap:wrap;">${buttons.join('')}</div>`;
}

/** Parse a line of vitest stdout to categorise it. */
export function parseOutputLine(line: string): { type: 'pass' | 'fail' | 'info'; text: string } {
  const text = line.trim();
  if (text.includes('\u2713') || text.includes('PASS')) {
    return { type: 'pass', text };
  }
  if (text.includes('\u2717') || text.includes('FAIL') || text.includes('failed')) {
    return { type: 'fail', text };
  }
  return { type: 'info', text };
}

/** Extract test name from a vitest verbose/default reporter output line. */
export function parseTestName(line: string): string | null {
  const trimmed = line.trim();
  // Match vitest verbose output: ✓/✗/× followed by test description
  const match = trimmed.match(/^[\u2713\u2717\u00d7\u2714\u2718]\s+(.+?)(?:\s+\d+\s*m?s)?$/);
  if (match) return match[1].trim();
  return null;
}

/** Build an "Investigate in CC" prompt for a failing test. */
export function buildInvestigatePrompt(
  file: string,
  testName: string,
  error: string,
  config: string,
): string {
  return `Investigate why this test is failing in Luminal:
File: ${file}
Test: ${testName}
Error: ${error}
Config: ${config}

Read the test file and the source it tests. Diagnose the root cause.
If the fix is straightforward, apply it. If it requires broader changes,
POST a task to http://localhost:5175/__admin_task with tag "test-fix"
describing what needs to happen.`;
}

/** Try to parse vitest JSON reporter output. Returns structured data or null. */
export function parseVitestJson(raw: string): {
  total: number; passed: number; failed: number; skipped: number;
  failures: Array<{ file: string; test: string; error: string }>;
} | null {
  // Try direct parse first, then scan for JSON in mixed reporter output
  const attempts = [raw];
  let scanPos = raw.length;
  while (scanPos > 0) {
    scanPos = raw.lastIndexOf('{"num', scanPos - 1);
    if (scanPos === -1) break;
    if (scanPos > 0) attempts.push(raw.slice(scanPos));
  }

  for (const attempt of attempts) {
    try {
      const data = JSON.parse(attempt) as Record<string, unknown>;
      if (typeof data['numTotalTests'] !== 'number' || typeof data['numPassedTests'] !== 'number') continue;
      const total = data['numTotalTests'] as number;
      const passed = data['numPassedTests'] as number;
      const failed = (data['numFailedTests'] as number) ?? 0;
      const skipped = (data['numPendingTests'] as number) ?? 0;

      const failures: Array<{ file: string; test: string; error: string }> = [];
      const testResults = data['testResults'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(testResults)) {
        for (const file of testResults) {
          const fileName = String(file['name'] ?? '');
          const assertions = file['assertionResults'] as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(assertions)) continue;
          for (const a of assertions) {
            if (a['status'] === 'failed') {
              const messages = a['failureMessages'] as string[] | undefined;
              failures.push({
                file: fileName,
                test: String(a['fullName'] ?? ''),
                error: messages?.[0] ?? 'Unknown error',
              });
            }
          }
        }
      }

      return { total, passed, failed, skipped, failures };
    } catch { continue; }
  }
  return null;
}

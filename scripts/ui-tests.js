// scripts/ui-tests.js — UI test manifest with flow support
// Run all:       node scripts/ui-tests.js
// Run one:       node scripts/ui-tests.js menu-desktop
// Run group:     node scripts/ui-tests.js --group social
// List:          node scripts/ui-tests.js --list

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  createSession,
  navigateToScreen,
  switchGraphicsPreset,
  clickSocialTab,
  goBack,
  captureScreenshot,
  buildOutputPath,
  VIEWPORTS,
} from './inspect.js';
import {
  createRunDir,
  writeTestResult,
  writeRunSummary,
  updateIndex,
  getGitInfo,
  slugify,
} from './test-results.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Test Definitions ─────────────────────────────────────────
// Two types:
//
// 1. Simple test — single screen capture (uses imported functions)
//    { id, group, screen, viewport, description, preset?, tab? }
//
// 2. Flow test — multi-step in one browser session (uses imports)
//    { id, group, description, viewport, flow: [ ...steps ] }
//
//    Flow step types:
//      { action: 'navigate', screen }           — navigate to a screen
//      { action: 'back' }                       — Escape back to menu
//      { action: 'preset', preset }             — switch graphics preset
//      { action: 'tab', tab }                   — switch social tab
//      { action: 'capture', name }              — take a screenshot
//      { action: 'wait', ms }                   — wait N ms

const tests = [
  // ── Menu ──
  { id: 'menu-desktop',    group: 'menu', screen: 'menu', viewport: 'desktop',   description: 'Main menu at desktop' },
  { id: 'menu-phone',      group: 'menu', screen: 'menu', viewport: 'phone',     description: 'Main menu at phone' },
  { id: 'menu-tablet',     group: 'menu', screen: 'menu', viewport: 'tablet',    description: 'Main menu at tablet' },
  { id: 'menu-landscape',  group: 'menu', screen: 'menu', viewport: 'landscape', description: 'Main menu at landscape' },

  // ── Settings ──
  { id: 'settings-desktop',    group: 'settings', screen: 'settings', viewport: 'desktop', description: 'Settings default' },
  { id: 'settings-phone',      group: 'settings', screen: 'settings', viewport: 'phone',   description: 'Settings at phone' },

  // Settings preset flow — cycles through presets in one session
  { id: 'settings-presets', group: 'settings', description: 'Settings preset sweep', viewport: 'desktop', flow: [
    { action: 'navigate', screen: 'settings' },
    { action: 'capture',  name: 'settings-default' },
    { action: 'preset',   preset: 'low' },
    { action: 'capture',  name: 'settings-low' },
    { action: 'preset',   preset: 'medium' },
    { action: 'capture',  name: 'settings-medium' },
    { action: 'preset',   preset: 'high' },
    { action: 'capture',  name: 'settings-high' },
    { action: 'preset',   preset: 'ultra' },
    { action: 'capture',  name: 'settings-ultra' },
  ]},

  // ── Social ──
  { id: 'social-phone', group: 'social', screen: 'social', viewport: 'phone', description: 'Social at phone' },

  // Social tab flow — cycles all tabs in one session
  { id: 'social-tabs', group: 'social', description: 'Social tab sweep', viewport: 'desktop', flow: [
    { action: 'navigate', screen: 'social' },
    { action: 'capture',  name: 'social-party' },
    { action: 'tab',      tab: 'friends' },
    { action: 'capture',  name: 'social-friends' },
    { action: 'tab',      tab: 'notifs' },
    { action: 'capture',  name: 'social-notifs' },
    { action: 'tab',      tab: 'chat' },
    { action: 'capture',  name: 'social-chat' },
  ]},

  // ── Stats ──
  { id: 'stats-desktop', group: 'stats', screen: 'stats', viewport: 'desktop', description: 'Stats — My Stats' },
  { id: 'stats-phone',   group: 'stats', screen: 'stats', viewport: 'phone',   description: 'Stats at phone' },

  // ── Leaderboard ──
  { id: 'leaderboard-desktop', group: 'leaderboard', screen: 'leaderboard', viewport: 'desktop', description: 'Leaderboard tab' },

  // ── Music ──
  { id: 'music-desktop', group: 'music', screen: 'music', viewport: 'desktop', description: 'Music overlay' },
  { id: 'music-phone',   group: 'music', screen: 'music', viewport: 'phone',   description: 'Music at phone' },

  // ── Auth ──
  { id: 'auth-desktop', group: 'auth', screen: 'auth', viewport: 'desktop', description: 'Login overlay' },
  { id: 'auth-phone',   group: 'auth', screen: 'auth', viewport: 'phone',   description: 'Login at phone' },

  // ── Cross-screen flows ──
  { id: 'menu-to-settings-back', group: 'flows', description: 'Menu → Settings → back to menu', viewport: 'desktop', flow: [
    { action: 'capture',  name: 'flow-menu-start' },
    { action: 'navigate', screen: 'settings' },
    { action: 'capture',  name: 'flow-settings' },
    { action: 'back' },
    { action: 'capture',  name: 'flow-menu-return' },
  ]},
];

// ── Simple test runner (uses imported functions) ──────────────

async function runSimpleTest(test, testDir) {
  let session;
  try {
    session = await createSession(test.viewport);

    await navigateToScreen(session.page, test.screen);

    if (test.preset && test.screen === 'settings') {
      await switchGraphicsPreset(session.page, test.preset);
    }
    if (test.tab && test.screen === 'social') {
      await clickSocialTab(session.page, test.tab);
    }

    await session.page.waitForTimeout(500);

    // Write to structured test dir
    const structuredPath = path.join(testDir, `${test.screen}.png`);
    await captureScreenshot(session.page, structuredPath, session.consoleLogs);

    // Also write to legacy screenshots/ dir
    const legacyPath = buildOutputPath(test.screen, test.viewport, '.png');
    await captureScreenshot(session.page, legacyPath, session.consoleLogs);

    const screenshots = [`${test.screen}.png`];
    const hasLog = session.consoleLogs.length > 0;
    return { id: test.id, status: 'PASS', screenshots, hasLog };
  } catch (err) {
    const msg = [err.message, err.stack].filter(Boolean).join('\n');
    return { id: test.id, status: 'FAIL', error: msg || String(err), screenshots: [], hasLog: false };
  } finally {
    if (session) await session.close();
  }
}

// ── Flow runner (imports, single session) ────────────────────

async function runFlowTest(test, testDir) {
  let session;
  try {
    session = await createSession(test.viewport);
    const screenshots = [];

    for (const step of test.flow) {
      switch (step.action) {
        case 'navigate':
          await navigateToScreen(session.page, step.screen);
          break;
        case 'back':
          await goBack(session.page);
          break;
        case 'preset':
          await switchGraphicsPreset(session.page, step.preset);
          break;
        case 'tab':
          await clickSocialTab(session.page, step.tab);
          break;
        case 'capture': {
          await session.page.waitForTimeout(500);
          const outPath = path.join(testDir, `${step.name}.png`);
          await captureScreenshot(session.page, outPath, session.consoleLogs);
          screenshots.push(`${step.name}.png`);
          break;
        }
        case 'wait':
          await session.page.waitForTimeout(step.ms || 1000);
          break;
        default:
          throw new Error(`Unknown flow action: ${step.action}`);
      }
    }

    const hasLog = session.consoleLogs.length > 0;
    return { id: test.id, status: 'PASS', screenshots, hasLog };
  } catch (err) {
    const msg = [err.message, err.stack].filter(Boolean).join('\n');
    return { id: test.id, status: 'FAIL', error: msg || String(err), screenshots: [], hasLog: false };
  } finally {
    if (session) await session.close();
  }
}

// ── CLI ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--list')) {
  const groups = {};
  for (const t of tests) {
    (groups[t.group] ??= []).push(t);
  }
  for (const [group, items] of Object.entries(groups)) {
    console.log(`\n${group.toUpperCase()}`);
    for (const t of items) {
      const type = t.flow ? `flow(${t.flow.filter(s => s.action === 'capture').length} captures)` : t.viewport;
      const extras = [t.preset && `preset:${t.preset}`, t.tab && `tab:${t.tab}`].filter(Boolean).join(' ');
      console.log(`  ${t.id.padEnd(28)} ${type.padEnd(18)} ${extras ? `(${extras}) ` : ''}${t.description}`);
    }
  }
  console.log(`\n${tests.length} tests total`);
  process.exit(0);
}

// Filter tests
let selected = tests;
const groupFlag = args.indexOf('--group');
if (groupFlag !== -1 && args[groupFlag + 1]) {
  const group = args[groupFlag + 1];
  selected = tests.filter(t => t.group === group);
  if (!selected.length) {
    console.error(`No tests in group "${group}". Groups: ${[...new Set(tests.map(t => t.group))].join(', ')}`);
    process.exit(1);
  }
} else if (args.length && !args[0].startsWith('--')) {
  const ids = args.filter(a => !a.startsWith('--'));
  selected = tests.filter(t => ids.includes(t.id));
  if (!selected.length) {
    console.error(`No tests matching: ${ids.join(', ')}. Use --list to see available tests.`);
    process.exit(1);
  }
}

const runStart = Date.now();
const { runId, runDir } = createRunDir('ui');
const gitInfo = getGitInfo();

console.log(`Running ${selected.length} UI test(s)...\n`);

const results = [];
const testDetails = [];
for (const test of selected) {
  const label = test.flow
    ? `${test.id} (flow, ${test.flow.filter(s => s.action === 'capture').length} captures)`
    : test.id;
  process.stdout.write(`  ${label} ... `);

  const testStart = Date.now();
  const testDir = path.join(runDir, test.id);
  fs.mkdirSync(testDir, { recursive: true });

  const result = test.flow
    ? await runFlowTest(test, testDir)
    : await runSimpleTest(test, testDir);

  const durationMs = Date.now() - testStart;
  results.push(result);

  if (result.status === 'PASS') {
    console.log('PASS');
  } else {
    console.log('FAIL');
    const errLines = result.error.split('\n');
    console.log(`    ${errLines.slice(-2).join('\n    ')}`);
  }

  const testResultData = {
    id: test.id,
    name: test.description,
    status: result.status === 'PASS' ? 'pass' : 'fail',
    durationMs,
    group: test.group,
    type: test.flow ? 'flow' : 'simple',
    viewport: test.viewport,
    screenshots: result.screenshots ?? [],
    consoleLog: result.hasLog ? 'console.log' : null,
    error: result.error || null,
  };

  writeTestResult(runDir, test.id, testResultData);
  testDetails.push(testResultData);
}

// Summary
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log(`\n${passed}/${results.length} passed${failed ? `, ${failed} failed` : ''}`);

if (failed) {
  console.log('\nFailed:');
  for (const r of results.filter(r => r.status === 'FAIL')) {
    console.log(`  ${r.id}: ${r.error.split('\n').slice(-1)}`);
  }
}

const runDurationMs = Date.now() - runStart;
const timestamp = new Date().toISOString();

const runData = {
  id: runId,
  type: 'ui',
  timestamp,
  durationMs: runDurationMs,
  platform: process.platform,
  gitBranch: gitInfo.branch,
  gitCommit: gitInfo.commit,
  tests: testDetails,
  summary: { total: results.length, passed, failed, skipped: 0 },
};

writeRunSummary(runDir, runData);
updateIndex('ui', {
  id: runId,
  type: 'ui',
  timestamp,
  durationMs: runDurationMs,
  total: results.length,
  passed,
  failed,
  skipped: 0,
});

console.log(`\nResults saved to: test-results/ui/${runId}/`);

if (failed) {
  process.exit(1);
}

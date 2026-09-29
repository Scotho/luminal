#!/usr/bin/env node
// scripts/inspect.js — Playwright-based UI inspection tool
// Usage: node scripts/inspect.js <mode> <screen> [selector] [options]
//   Modes: screenshot, styles, dom
//   Screens: menu, settings, social, stats, leaderboard, music, auth
//   Options:
//     --viewport <preset|WxH>  Viewport size (default: desktop)
//     --preset <low|medium|high|ultra>  Graphics preset (settings screen)
//     --tab <name>  Tab to click (social: party|friends|notifs|chat)
//     --out <path>  Custom output path

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'screenshots');
const DEV_SERVER_URL = 'http://localhost:5173';
const DEV_SERVER_TIMEOUT = 15_000;
const NAV_TIMEOUT = 5_000;

export const VIEWPORTS = {
  desktop:   { width: 1920, height: 1080 },
  phone:     { width: 390,  height: 844 },
  tablet:    { width: 768,  height: 1024 },
  landscape: { width: 844,  height: 390 },
};

const VALID_MODES = ['screenshot', 'styles', 'dom'];
const VALID_SCREENS = ['menu', 'settings', 'social', 'stats', 'leaderboard', 'music', 'auth'];
const VALID_PRESETS = ['low', 'medium', 'high', 'ultra'];
const VALID_TABS = ['party', 'friends', 'notifs', 'chat'];

// ---------------------------------------------------------------------------
// Arg parsing (CLI only)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = { mode: null, screen: null, selector: null, viewport: 'desktop', preset: null, tab: null, out: null };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--viewport' && i + 1 < args.length) {
      parsed.viewport = args[++i];
    } else if (args[i] === '--preset' && i + 1 < args.length) {
      parsed.preset = args[++i];
    } else if (args[i] === '--tab' && i + 1 < args.length) {
      parsed.tab = args[++i];
    } else if (args[i] === '--out' && i + 1 < args.length) {
      parsed.out = args[++i];
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  parsed.mode = positional[0] || null;
  parsed.screen = positional[1] || null;
  parsed.selector = positional[2] || null;

  return parsed;
}

function validate(parsed) {
  const errors = [];

  if (!parsed.mode) {
    errors.push('Mode is required. Valid modes: ' + VALID_MODES.join(', '));
  } else if (!VALID_MODES.includes(parsed.mode)) {
    errors.push(`Invalid mode "${parsed.mode}". Valid modes: ${VALID_MODES.join(', ')}`);
  }

  if (!parsed.screen) {
    errors.push('Screen is required. Valid screens: ' + VALID_SCREENS.join(', '));
  } else if (!VALID_SCREENS.includes(parsed.screen)) {
    errors.push(`Invalid screen "${parsed.screen}". Valid screens: ${VALID_SCREENS.join(', ')}`);
  }

  if ((parsed.mode === 'styles' || parsed.mode === 'dom') && !parsed.selector) {
    errors.push(`Selector is required for "${parsed.mode}" mode.`);
  }

  if (!VIEWPORTS[parsed.viewport] && !/^\d+x\d+$/.test(parsed.viewport)) {
    errors.push(`Invalid viewport "${parsed.viewport}". Use: ${Object.keys(VIEWPORTS).join(', ')}, or WxH (e.g. 1440x900)`);
  }

  if (parsed.preset && parsed.screen !== 'settings') {
    errors.push('--preset is only valid for the "settings" screen.');
  }
  if (parsed.preset && !VALID_PRESETS.includes(parsed.preset)) {
    errors.push(`Invalid preset "${parsed.preset}". Valid presets: ${VALID_PRESETS.join(', ')}`);
  }

  if (parsed.tab && parsed.screen !== 'social') {
    errors.push('--tab is only valid for the "social" screen.');
  }
  if (parsed.tab && !VALID_TABS.includes(parsed.tab)) {
    errors.push(`Invalid tab "${parsed.tab}". Valid tabs: ${VALID_TABS.join(', ')}`);
  }

  if (errors.length) {
    console.error('Usage: node scripts/inspect.js <mode> <screen> [selector] [--viewport preset] [--preset low|medium|high|ultra] [--tab party|friends|notifs|chat] [--out path]\n');
    errors.forEach(e => console.error('  Error: ' + e));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Dev server detection / auto-launch
// ---------------------------------------------------------------------------
export function checkServer(url, timeout = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    http.get(url, (res) => {
      clearTimeout(timer);
      res.resume();
      resolve(true);
    }).on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export function startDevServer() {
  return new Promise((resolve, reject) => {
    console.log('Dev server not detected, starting Vite...');
    const child = spawn('npx', ['vite'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Dev server did not start within ${DEV_SERVER_TIMEOUT}ms`));
      }
    }, DEV_SERVER_TIMEOUT);

    const onData = (data) => {
      const text = data.toString();
      if (!resolved && (text.includes('Local:') || text.includes('localhost:5173'))) {
        resolved = true;
        clearTimeout(timer);
        resolve(child);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Loading screen dismissal
// ---------------------------------------------------------------------------
export async function dismissLoading(page) {
  console.log('Waiting for loading screen...');
  await page.waitForSelector('#click-prompt.click-prompt--visible', { timeout: 20_000 });
  await page.locator('#loading-screen').click({ force: true });
  await page.waitForTimeout(500);
  await page.waitForSelector('#loading-screen.loading-screen--fade-out, #loading-screen[style*="display: none"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 10_000 });
  console.log('✓ Loading screen dismissed');
}

// ---------------------------------------------------------------------------
// Screen navigation
// ---------------------------------------------------------------------------
async function clickLeaderboardTab(page) {
  await page.click('.stats-view-tab[data-view="leaderboard"]');
  await page.waitForSelector('#stats-panel-leaderboard', { state: 'visible', timeout: NAV_TIMEOUT });
}

const SCREEN_NAV = {
  menu:        { selector: null,              waitFor: '#menu-buttons' },
  settings:    { selector: '#btn-settings',   waitFor: '#settings-overlay:not(.hidden)' },
  social:      { selector: '#btn-social',     waitFor: '#social-overlay:not(.hidden)' },
  stats:       { selector: '#btn-stats',      waitFor: '#stats-overlay:not(.hidden)' },
  leaderboard: { selector: '#btn-stats',      waitFor: '#stats-overlay:not(.hidden)', postNav: clickLeaderboardTab },
  music:       { selector: '#btn-music',      waitFor: '#music-overlay:not(.hidden)' },
  auth:        { selector: '#btn-login',      waitFor: '#login-overlay:not(.hidden)' },
};

export async function navigateToScreen(page, screen) {
  const nav = SCREEN_NAV[screen];
  if (!nav) throw new Error(`Unknown screen: ${screen}`);

  if (nav.selector) {
    await page.click(nav.selector);
  }

  await page.waitForSelector(nav.waitFor, { state: 'visible', timeout: NAV_TIMEOUT });

  if (nav.postNav) {
    await nav.postNav(page);
  }
}

// ---------------------------------------------------------------------------
// Screen interactions
// ---------------------------------------------------------------------------
export async function switchGraphicsPreset(page, preset) {
  const sel = `#gfx-preset-toggle [data-val="${preset}"]`;
  const el = page.locator(sel);
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.waitForFunction(
    (p) => document.querySelector(`#gfx-preset-toggle [data-val="${p}"]`)?.classList.contains('control-toggle__option--active'),
    preset,
    { timeout: NAV_TIMEOUT }
  );
}

export async function clickSocialTab(page, tab) {
  await page.click(`#social-tab-${tab}`);
  await page.waitForSelector(`#social-tab-${tab}.social-tab--active`, { timeout: NAV_TIMEOUT });
}

export async function goBack(page) {
  // Try the dynamic back button first, fall back to clicking overlay backdrop
  const dynBack = page.locator('#dyn-back');
  if (await dynBack.isVisible()) {
    await dynBack.click();
  } else {
    // Use the game's navigateBack via evaluate
    await page.evaluate(() => {
      document.querySelectorAll('.overlay-screen:not(.hidden)').forEach(el => el.classList.add('hidden'));
    });
  }
  await page.waitForSelector('#menu-buttons', { state: 'visible', timeout: NAV_TIMEOUT });
}

// ---------------------------------------------------------------------------
// Capture functions
// ---------------------------------------------------------------------------
export function buildOutputPath(name, viewport, ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(SCREENSHOTS_DIR, `${name}-${viewport}-${ts}${ext}`);
}

export async function captureScreenshot(page, outPath, consoleLogs) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, fullPage: false });

  const logPath = outPath.replace(/\.png$/, '.log');
  const logContent = consoleLogs.length
    ? consoleLogs.map(l => `[${l.type}] ${l.text}`).join('\n')
    : '(no console messages)';
  fs.writeFileSync(logPath, logContent, 'utf-8');

  return outPath;
}

export async function captureStyles(page, selector, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const styles = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `ERROR: No element found for selector "${sel}"`;

    const computed = getComputedStyle(el);
    const temp = document.createElement(el.tagName);
    document.body.appendChild(temp);
    const defaults = getComputedStyle(temp);

    const lines = [];
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      const val = computed.getPropertyValue(prop);
      const def = defaults.getPropertyValue(prop);
      if (val !== def) lines.push(`${prop}: ${val}`);
    }

    document.body.removeChild(temp);
    return lines.length ? lines.join('\n') : '(no non-default styles)';
  }, selector);

  fs.writeFileSync(outPath, styles, 'utf-8');
  return outPath;
}

export async function captureDOM(page, selector, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const html = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `<!-- ERROR: No element found for selector "${sel}" -->`;
    return el.outerHTML;
  }, selector);

  fs.writeFileSync(outPath, html, 'utf-8');
  return outPath;
}

// ---------------------------------------------------------------------------
// Session helper — shared browser/page setup for importers
// ---------------------------------------------------------------------------
export async function createSession(viewportName = 'desktop') {
  let viewport = VIEWPORTS[viewportName];
  if (!viewport) {
    const [w, h] = viewportName.split('x').map(Number);
    viewport = { width: w, height: h };
  }

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  let devServerChild = null;
  const serverUp = await checkServer(DEV_SERVER_URL);
  if (!serverUp) {
    devServerChild = await startDevServer();
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  await page.goto(DEV_SERVER_URL, { waitUntil: 'commit', timeout: 30_000 });
  await dismissLoading(page);

  return {
    browser,
    page,
    consoleLogs,
    viewportName,
    async close() {
      await browser.close();
      if (devServerChild) devServerChild.kill('SIGTERM');
    },
  };
}

// ---------------------------------------------------------------------------
// CLI main (only runs when invoked directly)
// ---------------------------------------------------------------------------
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const parsed = parseArgs(process.argv);
  validate(parsed);

  (async () => {
    const session = await createSession(parsed.viewport);
    try {
      await navigateToScreen(session.page, parsed.screen);

      if (parsed.preset && parsed.screen === 'settings') {
        await switchGraphicsPreset(session.page, parsed.preset);
      }
      if (parsed.tab && parsed.screen === 'social') {
        await clickSocialTab(session.page, parsed.tab);
      }

      await session.page.waitForTimeout(500);

      const base = parsed.out
        ? path.resolve(parsed.out)
        : buildOutputPath(parsed.screen, parsed.viewport, '');

      let outPath;
      if (parsed.mode === 'screenshot') {
        outPath = await captureScreenshot(session.page, base + '.png', session.consoleLogs);
        console.log(`✓ Screenshot: ${outPath}`);
      } else if (parsed.mode === 'styles') {
        outPath = await captureStyles(session.page, parsed.selector, base + '-styles.txt');
        console.log(`✓ Styles: ${outPath}`);
      } else if (parsed.mode === 'dom') {
        outPath = await captureDOM(session.page, parsed.selector, base + '-dom.html');
        console.log(`✓ DOM: ${outPath}`);
      }
    } finally {
      await session.close();
    }
  })().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}

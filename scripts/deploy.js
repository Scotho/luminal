#!/usr/bin/env node
// ── Luminal Deploy Script ──────────────────────────────────
// Usage: node scripts/deploy.js <version> "<changelog line 1>" "<line 2>" ...
//
// Steps:
//   1. Bump version in index.html (3 locations), package.json, DEPLOY.md
//   2. Prepend new changelog entry to the in-game popover
//   3. Add version to DEPLOY.md history
//   4. Pre-deploy checks (vitest + eslint)
//   5. Build hosted test bundle
//   6. Deploy Firebase test hosting
//   7. Build hosted live bundle
//   8. Deploy Firebase live hosting
//   9. Git commit the release
//
// Note: Hosted builds run through scripts/build.mjs so typecheck, asset copy,
// and hosted-bundle verification stay identical for every deploy target.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse args ──────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║              LUMINAL DEPLOY PROCEDURE                   ║
  ╠══════════════════════════════════════════════════════════╣
  ║                                                          ║
  ║  Usage:                                                  ║
  ║    node scripts/deploy.js <version> "<note>" "<note>"... ║
  ║                                                          ║
  ║  Example:                                                ║
  ║    node scripts/deploy.js v0.2.0 \\                       ║
  ║      "New arena map with neon bridges" \\                  ║
  ║      "Fixed trail collision near walls" \\                 ║
  ║      "Controller rumble on death"                        ║
  ║                                                          ║
  ║  What it does:                                           ║
  ║    1. Bumps version across all files                     ║
  ║    2. Updates in-game changelog popover                  ║
  ║    3. Updates DEPLOY.md version history                  ║
  ║    4. Runs tests + lint (hard gate)                      ║
  ║    5. Builds hosted test + live bundles separately       ║
  ║    6. Deploys test first, then live Firebase hosting     ║
  ║    7. Git commits the release                            ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

const newVersion = args[0].startsWith('v') ? args[0] : `v${args[0]}`;
const notes = args.slice(1);

// ── Helpers ─────────────────────────────────────────────────
function read(file) { return readFileSync(resolve(ROOT, file), 'utf8'); }
function write(file, content) { writeFileSync(resolve(ROOT, file), content, 'utf8'); }
function run(cmd, label) {
  console.log(`  → ${label || cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function formatDate() {
  const d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const date = formatDate();
const versionNum = newVersion.replace(/^v/, '');

console.log(`\n  ▸ LUMINAL DEPLOY — ${newVersion}\n`);
const startTime = Date.now();

// ── Step 1: Read current version ────────────────────────────
// Version lives in partials (footer.html + loading.html), included into index.html at build time
const footerHtml = read('src/partials/footer.html');
const oldVersionMatch = footerHtml.match(/id="version"[^>]*>v([\d.]+)</);
if (!oldVersionMatch) { console.error('ERROR: Could not find current version in src/partials/footer.html'); process.exit(1); }
const oldVersion = `v${oldVersionMatch[1]}`;
console.log(`  ▸ Bumping ${oldVersion} → ${newVersion}`);

// ── Step 2: Bump version in HTML partials ───────────────────
const escOld = oldVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1. #version span in footer.html (bottom bar)
let updatedFooter = footerHtml.replace(
  new RegExp(`(<span id="version"[^>]*>)${escOld}(</span>)`),
  `$1${newVersion}$2`
);
write('src/partials/footer.html', updatedFooter);
console.log('  ✓ footer.html updated (version)');

// 2. #version-loading span in loading.html (loading screen)
let loadingHtml = read('src/partials/loading.html');
loadingHtml = loadingHtml.replace(
  new RegExp(`(<span id="version-loading"[^>]*>)${escOld}(</span>)`),
  `$1${newVersion}$2`
);
write('src/partials/loading.html', loadingHtml);
console.log('  ✓ loading.html updated (version)');

// ── Step 3: Add changelog entry to changelog.html ───────────
const changelogHtml = read('changelog.html');
const changelogItems = notes.map(n => `      <li>${n.replace(/&(?![\w#]+;)/g, '&amp;')}</li>`).join('\n');
const newEntry = `    <div class="cl-version">${newVersion} <span class="cl-date">&mdash; ${date}</span></div>\n    <ul>\n${changelogItems}\n    </ul>\n`;

const updatedChangelog = changelogHtml.replace(
  /(<div id="changelog-body">)\r?\n/,
  `$1\n${newEntry}`
);

write('changelog.html', updatedChangelog);
console.log('  ✓ changelog.html updated');

// ── Step 4: Bump package.json ───────────────────────────────
const pkg = read('package.json');
write('package.json', pkg.replace(/"version":\s*"[\d.]+"/, `"version": "${versionNum}"`));
console.log('  ✓ package.json updated');

// ── Step 5: Update DEPLOY.md ────────────────────────────────
let deploy = read('DEPLOY.md');
deploy = deploy.replace(/## Current Version\nv[\d.]+/, `## Current Version\n${newVersion}`);

const historyLine = `- ${newVersion} (${date}) — ${notes.join(', ')}`;
deploy = deploy.replace(
  /(## Version History\n)/,
  `$1${historyLine}\n`
);
write('DEPLOY.md', deploy);
console.log('  ✓ DEPLOY.md updated');

// ── Step 6: Pre-deploy checks ──────────────────────────────
console.log('\n  ▸ Running pre-deploy checks...');
run('npx vitest run', 'tests');
console.log('  ✓ All tests pass');
run('npx eslint src/ --max-warnings 400', 'lint (warning budget: 400)');
console.log('  ✓ Lint OK');

// ── Step 7: Build ───────────────────────────────────────────
console.log('\n  ▸ Building hosted test bundle...');
run('npm run build:test', 'build:test');
console.log('  ✓ Test build complete');

// ── Step 8: Deploy to Firebase ──────────────────────────────
console.log('\n  ▸ Deploying test hosting...');
run('firebase deploy --only hosting:luminal-test --project luminal-game', 'firebase deploy test');
console.log('  ✓ Test site deployed');

console.log('\n  ▸ Building hosted live bundle...');
run('npm run build:live', 'build:live');
console.log('  ✓ Live build complete');

console.log('\n  ▸ Deploying live hosting...');
run('firebase deploy --only hosting:luminal-game --project luminal-game', 'firebase deploy live');
console.log('  ✓ Live site deployed');

// ── Step 9: Write server version to RTDB ────────────────────
console.log('\n  ▸ Writing server version to RTDB...');
{
  const versionData = JSON.stringify({ version: newVersion, deployedAt: Date.now() });
  const tmpFile = resolve(ROOT, '.sv-temp.json');
  write('.sv-temp.json', versionData);
  try {
    // Use forward slashes for the temp file path — PowerShell and bash both accept them,
    // and backslashes break inside PowerShell double-quoted strings.
    const safePath = tmpFile.replace(/\\/g, '/');
    const cmd = process.platform === 'win32'
      ? `powershell -Command "firebase database:set /meta/serverVersion '${safePath}' -f --project luminal-game"`
      : `firebase database:set /meta/serverVersion ${tmpFile} -f --project luminal-game`;
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    console.log('  ✓ Server version updated');
  } catch {
    console.log('  ⚠ Could not write server version — update manually via Firebase console');
  }

  // Also write test server version
  const testCmd = process.platform === 'win32'
    ? `powershell -Command "firebase database:set /meta/testServerVersion '${safePath}' -f --project luminal-game"`
    : `firebase database:set /meta/testServerVersion ${tmpFile} -f --project luminal-game`;
  try {
    execSync(testCmd, { cwd: ROOT, stdio: 'inherit' });
    console.log('  ✓ Test server version updated');
  } catch {
    console.log('  ⚠ Could not write test server version');
  }

  try { const { unlinkSync } = await import('fs'); unlinkSync(tmpFile); } catch {}
}

// ── Step 9b: Record deploy history ─────────────────────
console.log('\n  ▸ Recording deploy history...');
{
  const deployEntry = {
    version: newVersion,
    timestamp: new Date().toISOString(),
    target: 'test+live (separate builds)',
    commit: execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim(),
    branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim(),
    notes,
    duration: (Date.now() - startTime) / 1000,
  };

  const historyPath = resolve(ROOT, 'admin/data/deploy-history.json');
  let history = [];
  try {
    if (existsSync(historyPath)) {
      history = JSON.parse(readFileSync(historyPath, 'utf8'));
    }
  } catch { /* start fresh */ }
  history.push(deployEntry);
  if (history.length > 100) history.splice(0, history.length - 100);
  writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  console.log('  ✓ Deploy history recorded');
}

// ── Step 10: Git commit ─────────────────────────────────────
console.log('\n  ▸ Committing...');
run(`git add index.html changelog.html package.json DEPLOY.md src/`, 'stage files');
const commitMsg = `Luminal ${newVersion} — ${notes[0]}${notes.length > 1 ? ` (+${notes.length - 1} more)` : ''}`;
run(`git commit -m "${commitMsg}"`, 'git commit');
console.log('  ✓ Committed');

// ── Step 11: Discord release notification ───────────────────
console.log('\n  ▸ Sending release notes to Discord...');
try {
  execSync(`node scripts/discord-notify.js release ${newVersion}`, { cwd: ROOT, stdio: 'inherit' });
  console.log('  ✓ Release notes sent to Discord');
} catch {
  console.log('  ⚠ Discord notification failed — deploy still succeeded');
}

console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║  ✓  DEPLOY COMPLETE — ${newVersion.padEnd(36)}║
  ║                                                          ║
  ║  Live: https://luminal-game.web.app                      ║
  ║  Test: https://luminal-test.web.app                      ║
  ╚══════════════════════════════════════════════════════════╝
`);

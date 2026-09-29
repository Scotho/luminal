// scripts/reset.ts
// CLI tool to wipe all Firebase emulator data and re-seed to a clean base state.
//
// Usage:
//   npx tsx scripts/reset.ts [--keep-auth] [--seed-set base|stress]

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'luminal-game';
const AUTH_URL = 'http://localhost:9099';
const FIRESTORE_URL = 'http://localhost:8080';
const RTDB_URL = 'http://localhost:9000';

// ---------------------------------------------------------------------------
// Colored log helpers
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function info(msg: string): void  { console.log(`${c.cyan}[reset]${c.reset} ${msg}`); }
function ok(msg: string): void    { console.log(`${c.green}[reset]${c.reset} ${c.green}✓${c.reset} ${msg}`); }
function fail(msg: string): void  { console.error(`${c.red}[reset]${c.reset} ${c.red}✗${c.reset} ${msg}`); }
function dim(msg: string): string { return `${c.gray}${msg}${c.reset}`; }

// ---------------------------------------------------------------------------
// Emulator health check
// ---------------------------------------------------------------------------

async function checkEmulators(): Promise<void> {
  info('Checking emulators are running...');
  try {
    const res = await fetch(`${AUTH_URL}/`, { signal: AbortSignal.timeout(2000) });
    const text = await res.text();
    if (!text.includes('authEmulator')) {
      throw new Error('Auth emulator response did not contain expected marker');
    }
    ok('Auth emulator is up');
  } catch (err) {
    fail(`Auth emulator not reachable at ${AUTH_URL}`);
    fail(String(err));
    fail('Start emulators first: firebase emulators:start --only auth,database,firestore');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Wipe functions
// ---------------------------------------------------------------------------

async function wipeAuth(): Promise<void> {
  info('Wiping Auth emulator...');
  const url = `${AUTH_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    fail(`Auth wipe failed (${res.status}): ${text}`);
    process.exit(1);
  }
  ok(`Auth ${dim('accounts')} wiped`);
}

async function wipeFirestore(): Promise<void> {
  info('Wiping Firestore emulator...');
  const url = `${FIRESTORE_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    fail(`Firestore wipe failed (${res.status}): ${text}`);
    process.exit(1);
  }
  ok(`Firestore ${dim('(default)')} wiped`);
}

async function wipeRtdb(): Promise<void> {
  info('Wiping RTDB emulator...');
  const url = `${RTDB_URL}/.json?ns=${PROJECT_ID}-default-rtdb`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    fail(`RTDB wipe failed (${res.status}): ${text}`);
    process.exit(1);
  }
  ok(`RTDB ${dim(`${PROJECT_ID}-default-rtdb`)} wiped`);
}

// ---------------------------------------------------------------------------
// Re-seed
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function reseed(seedSet: string): void {
  info(`Re-seeding with set: ${c.cyan}${seedSet}${c.reset}...`);
  const seedScript = path.join(PROJECT_ROOT, 'scripts', 'seed.ts');
  execSync(`npx tsx "${seedScript}" --set ${seedSet}`, { stdio: 'inherit' });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keepAuth = args.includes('--keep-auth');
  const seedSetIdx = args.indexOf('--seed-set');
  const seedSet = seedSetIdx !== -1 ? (args[seedSetIdx + 1] ?? 'base') : 'base';

  if (seedSet !== 'base' && seedSet !== 'stress') {
    fail(`Unknown seed set "${seedSet}". Valid values: base, stress`);
    process.exit(1);
  }

  console.log(`\n${c.bold}Firebase Emulator Reset${c.reset} — seed-set: ${c.cyan}${seedSet}${c.reset}${keepAuth ? `  ${c.yellow}(keeping auth)${c.reset}` : ''}\n`);

  // 1. Verify emulators are running
  await checkEmulators();

  // 2. Wipe emulators (in parallel where possible)
  const wipes: Promise<void>[] = [];
  if (!keepAuth) wipes.push(wipeAuth());
  wipes.push(wipeFirestore(), wipeRtdb());
  await Promise.all(wipes);

  // 3. Re-seed
  reseed(seedSet);

  console.log(`\n${c.green}${c.bold}Reset complete.${c.reset}\n`);
}

main().catch((err: unknown) => {
  fail(String(err));
  process.exit(1);
});

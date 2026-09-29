// scripts/local-stack.ts
// Unified local-stack launcher: Firebase emulators + relay + Vite dev server.
//
// Usage:
//   npx tsx scripts/local-stack.ts [--no-seed] [--no-relay] [--no-vite]

import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RELAY_ENTRY = path.join(PROJECT_ROOT, 'relay', 'dist', 'index.js');

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  magenta: '\x1b[35m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  gray:    '\x1b[90m',
};

function tag(color: string, label: string): string {
  return `${color}[${label}]${C.reset}`;
}

const T = {
  emulators: tag(C.magenta, 'emulators'),
  relay:     tag(C.yellow,  'relay'),
  vite:      tag(C.blue,    'vite'),
  stack:     tag(C.cyan,    'stack'),
};

function log(prefix: string, msg: string): void {
  process.stdout.write(`${prefix} ${msg}\n`);
}

function err(prefix: string, msg: string): void {
  process.stderr.write(`${prefix} ${C.red}${msg}${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const noSeed  = argv.includes('--no-seed');
const noRelay = argv.includes('--no-relay');
const noVite  = argv.includes('--no-vite');

// ---------------------------------------------------------------------------
// Process registry
// ---------------------------------------------------------------------------

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  log(T.stack, `Shutting down (${reason})…`);

  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }

  const killTimer = setTimeout(() => {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    process.exit(0);
  }, 3000);

  // Allow the process to exit naturally once all children close
  killTimer.unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// waitForOutput — resolve once a pattern appears on stdout or stderr
// ---------------------------------------------------------------------------

function waitForOutput(
  child: ChildProcess,
  pattern: string | RegExp,
  timeoutMs: number,
  prefix: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${String(pattern)}" after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    function onData(data: Buffer | string): void {
      const text = data.toString();

      // Print lines as they arrive during the wait phase
      for (const line of text.split('\n')) {
        if (line.trim()) log(prefix, line);
      }

      // Check for the ready signal
      const matched = typeof pattern === 'string'
        ? text.includes(pattern)
        : pattern.test(text);
      if (matched) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        resolve();
      }
    }

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// Pipe remaining output after startup is confirmed
// ---------------------------------------------------------------------------

function pipeOutput(child: ChildProcess, prefix: string): void {
  child.stdout?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      if (line.trim()) log(prefix, line);
    }
  });
  child.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      if (line.trim()) log(prefix, line);
    }
  });
}

// ---------------------------------------------------------------------------
// Spawn helper — registers child, wires unexpected-exit warning
// ---------------------------------------------------------------------------

function spawnProc(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  prefix: string,
): ChildProcess {
  const child = spawn(cmd, args, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    cwd: PROJECT_ROOT,
  });

  children.push(child);

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(prefix, `${C.yellow}process exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'null'})${C.reset}`);
    }
  });

  return child;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n${C.bold}${C.cyan}Local Stack Launcher${C.reset}\n`);

  // ── Guard: relay binary ────────────────────────────────────────────────────
  if (!noRelay && !existsSync(RELAY_ENTRY)) {
    err(T.stack, `relay/dist/index.js not found — build it first: cd relay && npm run build`);
    process.exit(1);
  }

  // ── 1. Firebase emulators ──────────────────────────────────────────────────
  log(T.stack, 'Starting Firebase emulators…');

  const emuProc = spawnProc(
    'npx',
    ['firebase', 'emulators:start', '--only', 'auth,database,firestore', '--project', 'luminal-game'],
    {},
    T.emulators,
  );

  try {
    await waitForOutput(emuProc, 'All emulators ready', 30_000, T.emulators);
  } catch (e) {
    err(T.stack, `Emulators failed to start: ${String(e)}`);
    shutdown('emulator startup failure');
    process.exit(1);
  }

  log(T.stack, `${C.green}Emulators ready.${C.reset}`);

  // Pipe remaining emulator output
  pipeOutput(emuProc, T.emulators);

  // ── 2. Seed ────────────────────────────────────────────────────────────────
  if (!noSeed) {
    log(T.stack, 'Seeding emulators…');
    try {
      execSync('npx tsx scripts/seed.ts', {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      });
      log(T.stack, `${C.green}Seed complete.${C.reset}`);
    } catch (e) {
      err(T.stack, `Seed failed: ${String(e)}`);
      shutdown('seed failure');
      process.exit(1);
    }
  } else {
    log(T.stack, `${C.gray}Skipping seed (--no-seed).${C.reset}`);
  }

  // ── 3. Relay ───────────────────────────────────────────────────────────────
  if (!noRelay) {
    log(T.stack, 'Starting WebSocket relay…');

    const relayProc = spawnProc(
      'node',
      [RELAY_ENTRY],
      { PORT: '9876', AUTH_MODE: 'test' },
      T.relay,
    );

    pipeOutput(relayProc, T.relay);
    log(T.stack, `${C.green}Relay started.${C.reset}`);
  } else {
    log(T.stack, `${C.gray}Skipping relay (--no-relay).${C.reset}`);
  }

  // ── 4. Vite ────────────────────────────────────────────────────────────────
  if (!noVite) {
    log(T.stack, 'Starting Vite dev server…');

    const viteProc = spawnProc(
      'npx',
      ['vite', '--host'],
      {
        VITE_USE_FIREBASE_EMULATORS: 'true',
        VITE_RELAY_URL: 'ws://localhost:9876',
      },
      T.vite,
    );

    pipeOutput(viteProc, T.vite);
    log(T.stack, `${C.green}Vite started.${C.reset}`);
  } else {
    log(T.stack, `${C.gray}Skipping Vite (--no-vite).${C.reset}`);
  }

  // ── Startup banner ─────────────────────────────────────────────────────────
  console.log(`
${C.bold}${C.cyan}  Stack ready${C.reset}
  ${C.gray}Emulators:${C.reset}  http://localhost:9099 (auth), :9000 (rtdb), :8080 (firestore)
  ${C.gray}Relay:${C.reset}      ws://localhost:9876 (AUTH_MODE=test)
  ${C.gray}Game:${C.reset}       http://localhost:5173
`);
}

main().catch((e: unknown) => {
  err(T.stack, String(e));
  shutdown('unhandled error');
  process.exit(1);
});

#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { cpSync, existsSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const NPX = 'npx';
const NODE = 'node';

const TARGETS = {
  local: { mode: 'development', verifyHostedBuild: false },
  test: { mode: 'test', verifyHostedBuild: true },
  live: { mode: 'production', verifyHostedBuild: true },
};

const target = process.argv[2] ?? 'live';
const config = TARGETS[target];

if (!config) {
  console.error(`Unknown build target "${target}". Expected one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

function run(command, args, label) {
  console.log(`\n[build:${target}] ${label}`);
  const result = process.platform === 'win32'
    ? spawnSync(
      'cmd.exe',
      ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArg).join(' ')],
      {
        cwd: ROOT,
        stdio: 'inherit',
      },
    )
    : spawnSync(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function quoteWindowsArg(arg) {
  return /[\s"]/u.test(arg)
    ? `"${arg.replace(/"/g, '\\"')}"`
    : arg;
}

run(NPX, ['tsc', '--noEmit'], 'TypeScript check');
run(NPX, ['vite', 'build', '--mode', config.mode], `Vite build (${config.mode})`);

const musicSrc = resolve(ROOT, 'music');
const musicDest = resolve(ROOT, 'dist', 'music');
if (existsSync(musicSrc)) {
  rmSync(musicDest, { recursive: true, force: true });
  cpSync(musicSrc, musicDest, { recursive: true });
}

if (config.verifyHostedBuild) {
  run(NODE, ['scripts/verify-hosted-build.mjs', target], 'Hosted build verification');
}

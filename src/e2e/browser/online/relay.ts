// src/e2e/browser/online/relay.ts
// Start/stop the WebSocket relay server for online browser tests.

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { E2E_RELAY_PORT } from '../../e2eConfig';

const RELAY_DIR = path.resolve(__dirname, '../../../../relay');

let relayProcess: ChildProcess | null = null;

/** Start the relay server with AUTH_MODE=test. Resolves when listening. */
export async function startRelay(): Promise<void> {
  if (relayProcess) return;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Relay failed to start within 10s'));
    }, 10_000);

    relayProcess = spawn('node', ['dist/index.js'], {
      cwd: RELAY_DIR,
      env: {
        ...process.env,
        PORT: String(E2E_RELAY_PORT),
        AUTH_MODE: 'test',
        FIREBASE_DATABASE_URL: 'https://test.firebaseio.com',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    relayProcess.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      if (line.includes('relay-start') || line.includes('port')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    relayProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[relay stderr]', data.toString());
    });

    relayProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    relayProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Relay exited with code ${code}`));
      }
      relayProcess = null;
    });
  });
}

/** Stop the relay server. Idempotent. */
export async function stopRelay(): Promise<void> {
  if (!relayProcess) return;

  return new Promise((resolve) => {
    relayProcess!.on('exit', () => {
      relayProcess = null;
      resolve();
    });
    relayProcess!.kill('SIGTERM');

    setTimeout(() => {
      if (relayProcess) {
        relayProcess.kill('SIGKILL');
        relayProcess = null;
        resolve();
      }
    }, 5000);
  });
}

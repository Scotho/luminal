// src/e2e/browser/online/emulator.ts
// Start/stop/reset Firebase Emulators for online browser tests.

import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { RankedData, RankInfo } from '../../../ranked/types';

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const PROJECT_ID = 'luminal-game';

const EMULATOR_PORTS = {
  auth: 9099,
  database: 9000,
  firestore: 8080,
} as const;

let emulatorProcess: ChildProcess | null = null;

/** Check if emulators are already running on expected ports. */
async function emulatorsAlreadyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${EMULATOR_PORTS.auth}/`, { signal: AbortSignal.timeout(2000) });
    const text = await res.text();
    return text.includes('authEmulator');
  } catch {
    return false;
  }
}

/** Start Firebase Emulators. Resolves when all services are ready. */
export async function startEmulators(): Promise<void> {
  if (emulatorProcess) return;

  // If emulators are already running externally, reuse them
  if (await emulatorsAlreadyRunning()) {
    await seedTestAccounts();
    return;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Firebase Emulators did not start within 30s'));
    }, 30_000);

    emulatorProcess = spawn('npx', ['firebase', 'emulators:start', '--only', 'auth,database,firestore', '--project', PROJECT_ID], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    const onData = (data: Buffer) => {
      const line = data.toString();
      if (line.includes('All emulators ready') || line.includes('All emulators started')) {
        clearTimeout(timeout);
        seedTestAccounts().then(resolve, resolve); // seed accounts, resolve even if seeding fails
      }
    };

    emulatorProcess.stdout?.on('data', onData);
    emulatorProcess.stderr?.on('data', onData);

    emulatorProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    emulatorProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Firebase Emulators exited with code ${code}`));
      }
      emulatorProcess = null;
    });
  });
}

/**
 * Create test accounts in Auth Emulator AND seed their Firestore user/username docs.
 * This bypasses the `claimUsername` Cloud Function which doesn't run in emulator mode.
 */
async function seedTestAccounts(): Promise<void> {
  const authUrl = `http://localhost:${EMULATOR_PORTS.auth}`;
  const fsUrl = `http://localhost:${EMULATOR_PORTS.firestore}`;
  const fsBase = `${fsUrl}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const fsHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer owner' };

  // Load accounts from shared fixture
  const fixturePath = path.resolve(PROJECT_ROOT, 'data/seeds/base/auth-accounts.json');
  const allAccounts = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Array<{
    email: string; password: string; username: string; role: string;
  }>;

  // Only seed the test accounts (host, guest, spectator) for E2E
  const testAccounts = allAccounts.filter(a => ['host', 'guest', 'spectator'].includes(a.role));

  for (const { email, password, username } of testAccounts) {
    // 1. Create auth account, capture the localId (uid)
    const authRes = await fetch(
      `${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const authData = await authRes.json() as { localId?: string };
    const uid = authData.localId;
    if (!uid) continue;

    // 2. Create Firestore user doc: /users/{uid}
    // 'Bearer owner' bypasses Firestore security rules in the emulator
    await fetch(`${fsBase}/users?documentId=${uid}`, {
      method: 'POST',
      headers: fsHeaders,
      body: JSON.stringify({
        fields: {
          username: { stringValue: username },
          email: { stringValue: email },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      }),
    });

    // 3. Create username index doc: /usernames/{username}
    await fetch(`${fsBase}/usernames?documentId=${username}`, {
      method: 'POST',
      headers: fsHeaders,
      body: JSON.stringify({
        fields: { uid: { stringValue: uid } },
      }),
    });
  }
}

/** Clear all data in the emulators between tests. */
export async function resetEmulatorState(): Promise<void> {
  const fetches = [
    fetch(`http://localhost:${EMULATOR_PORTS.auth}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' }),
    fetch(`http://localhost:${EMULATOR_PORTS.firestore}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' }),
    fetch(`http://localhost:${EMULATOR_PORTS.database}/.json?ns=${PROJECT_ID}-default-rtdb`, { method: 'DELETE' }),
  ];
  await Promise.all(fetches);
  await seedTestAccounts();
}

/** Stop the emulators. Idempotent. Skips if we didn't start them (external). */
export async function stopEmulators(): Promise<void> {
  if (!emulatorProcess) return;

  return new Promise((resolve) => {
    emulatorProcess!.on('exit', () => {
      emulatorProcess = null;
      resolve();
    });
    emulatorProcess!.kill('SIGTERM');

    setTimeout(() => {
      if (emulatorProcess) {
        emulatorProcess.kill('SIGKILL');
        emulatorProcess = null;
        resolve();
      }
    }, 5000);
  });
}

/** Account descriptor for ranked E2E seeding. */
export interface RankedAccountSeed {
  uid: string;
  email: string;
  username: string;
  mmr: number;
  rank: RankInfo;
  placementComplete: boolean;
}

/**
 * Seed ranked data onto existing Firestore user documents.
 * PATCHes `/users/{uid}` with a full `RankedData` structure for each account.
 * Accounts must already exist in the Auth Emulator (call `seedTestAccounts` first).
 */
export async function seedRankedAccounts(
  accounts: RankedAccountSeed[],
): Promise<void> {
  const fsUrl = `http://localhost:${EMULATOR_PORTS.firestore}`;
  const fsBase = `${fsUrl}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const fsHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer owner' };

  for (const account of accounts) {
    const rankedData: RankedData = {
      mmr: account.mmr,
      rank: account.rank,
      placementGamesPlayed: account.placementComplete ? 5 : 0,
      placementComplete: account.placementComplete,
      rankedWins: 0,
      rankedLosses: 0,
      rankedGamesPlayed: 0,
      lastRankedMatch: 0,
      demotionShield: false,
      seasonId: 1,
    };

    // PATCH the existing user doc to add the ranked field.
    // updateMask ensures only the ranked field is modified.
    await fetch(
      `${fsBase}/users/${account.uid}?updateMask.fieldPaths=ranked`,
      {
        method: 'PATCH',
        headers: fsHeaders,
        body: JSON.stringify({
          fields: {
            ranked: {
              mapValue: {
                fields: _rankedDataToFirestoreFields(rankedData),
              },
            },
          },
        }),
      },
    );
  }
}

/** Convert a RankedData object to Firestore REST API field encoding. */
function _rankedDataToFirestoreFields(
  data: RankedData,
): Record<string, { stringValue?: string; integerValue?: string; booleanValue?: boolean; mapValue?: { fields: Record<string, unknown> } }> {
  return {
    mmr: { integerValue: String(data.mmr) },
    rank: {
      mapValue: {
        fields: {
          tier: { stringValue: data.rank.tier },
          division: { integerValue: String(data.rank.division) },
          lp: { integerValue: String(data.rank.lp) },
        },
      },
    },
    placementGamesPlayed: { integerValue: String(data.placementGamesPlayed) },
    placementComplete: { booleanValue: data.placementComplete },
    rankedWins: { integerValue: String(data.rankedWins) },
    rankedLosses: { integerValue: String(data.rankedLosses) },
    rankedGamesPlayed: { integerValue: String(data.rankedGamesPlayed) },
    lastRankedMatch: { integerValue: String(data.lastRankedMatch) },
    demotionShield: { booleanValue: data.demotionShield },
    seasonId: { integerValue: String(data.seasonId) },
  };
}

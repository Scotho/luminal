// Global setup for smoke tests — seeds emulator test accounts if emulators are running.

import { TEST_ACCOUNTS } from '../online/testAccounts';

const AUTH_PORT = 9099;
const FS_PORT = 8080;
const PROJECT_ID = 'luminal-game';


async function emulatorsRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${AUTH_PORT}/`, { signal: AbortSignal.timeout(2000) });
    const text = await res.text();
    return text.includes('authEmulator');
  } catch {
    return false;
  }
}

async function seedAccounts(): Promise<void> {
  const authUrl = `http://localhost:${AUTH_PORT}`;
  const fsBase = `http://localhost:${FS_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  for (const [, { email, password, username }] of Object.entries(TEST_ACCOUNTS)) {
    const authRes = await fetch(`${authUrl}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const authData = await authRes.json() as { localId?: string };
    const uid = authData.localId;
    if (!uid) continue;

    const fsHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer owner' };

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

    await fetch(`${fsBase}/usernames?documentId=${username}`, {
      method: 'POST',
      headers: fsHeaders,
      body: JSON.stringify({
        fields: { uid: { stringValue: uid } },
      }),
    });
  }
}

export async function setup() {
  if (await emulatorsRunning()) {
    await seedAccounts();
  }
}

export function teardown() {
  // no-op — emulators persist across smoke tests
}

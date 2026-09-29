// scripts/seed.ts
// CLI tool to seed Firebase emulators from fixture files in data/seeds/base/ or data/seeds/stress/.
//
// Usage:
//   npx tsx scripts/seed.ts [--set base|stress]

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'luminal-game';
const AUTH_URL = 'http://localhost:9099';
const RTDB_URL = 'http://localhost:9000';
const FS_URL = 'http://localhost:8080';
const FS_BASE = `${FS_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FS_HEADERS = { 'Content-Type': 'application/json', 'Authorization': 'Bearer owner' };

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

function info(msg: string): void  { console.log(`${c.cyan}[seed]${c.reset} ${msg}`); }
function ok(msg: string): void    { console.log(`${c.green}[seed]${c.reset} ${c.green}✓${c.reset} ${msg}`); }
function warn(msg: string): void  { console.log(`${c.yellow}[seed]${c.reset} ${c.yellow}!${c.reset} ${msg}`); }
function fail(msg: string): void  { console.error(`${c.red}[seed]${c.reset} ${c.red}✗${c.reset} ${msg}`); }
function dim(msg: string): string { return `${c.gray}${msg}${c.reset}`; }

// ---------------------------------------------------------------------------
// Fixture type definitions
// ---------------------------------------------------------------------------

interface AuthAccount {
  email: string;
  password: string;
  username: string;
  role: string;
}

interface FirestoreFieldValue {
  stringValue?: string;
  integerValue?: string | number;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  mapValue?: { fields: Record<string, FirestoreFieldValue> };
  arrayValue?: { values?: FirestoreFieldValue[] };
  nullValue?: null;
}

interface FirestoreDoc {
  _matchBy: string;
  _matchValue: string;
  fields: Record<string, unknown>;
}

interface FirestoreFixture {
  _collection: string;
  _indexCollection?: string;
  docs?: FirestoreDoc[];
  templates?: Array<{ count: number; fields: Record<string, unknown> }>;
}

interface RtdbFixture {
  _path: string;
  entries: Record<string, unknown> | unknown[];
  templates?: Array<{ count: number; status?: string; meta?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Convert a plain JS value into Firestore REST field format
// ---------------------------------------------------------------------------

function toFirestoreValue(v: unknown): FirestoreFieldValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === 'object') {
    const fields: Record<string, FirestoreFieldValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function toFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreFieldValue> {
  const out: Record<string, FirestoreFieldValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toFirestoreValue(v);
  }
  return out;
}

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
// Auth seeding
// ---------------------------------------------------------------------------

async function seedAuthAccounts(accounts: AuthAccount[]): Promise<Map<string, string>> {
  const emailToUid = new Map<string, string>();
  info(`Seeding ${accounts.length} auth account(s)...`);

  for (const account of accounts) {
    const res = await fetch(
      `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
      },
    );

    const data = await res.json() as { localId?: string; error?: { message?: string } };

    if (data.error) {
      // Account may already exist — attempt signIn to retrieve uid
      if (data.error.message?.includes('EMAIL_EXISTS')) {
        const signInRes = await fetch(
          `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
          },
        );
        const signInData = await signInRes.json() as { localId?: string };
        if (signInData.localId) {
          emailToUid.set(account.email, signInData.localId);
          warn(`Auth account already exists, reused ${dim(account.email)} → ${dim(signInData.localId)}`);
        } else {
          warn(`Could not retrieve uid for existing account ${account.email}, skipping`);
        }
      } else {
        warn(`Auth creation failed for ${account.email}: ${data.error.message ?? 'unknown error'}`);
      }
      continue;
    }

    if (!data.localId) {
      warn(`No localId returned for ${account.email}, skipping`);
      continue;
    }

    emailToUid.set(account.email, data.localId);
    ok(`Auth  ${dim(account.email)} → uid ${dim(data.localId)}`);
  }

  return emailToUid;
}

// ---------------------------------------------------------------------------
// Firestore seeding
// ---------------------------------------------------------------------------

async function seedFirestoreFile(fixture: FirestoreFixture, emailToUid: Map<string, string>): Promise<void> {
  const collection = fixture._collection;
  const indexCollection = fixture._indexCollection;

  // Standard docs array (base fixtures)
  if (fixture.docs && fixture.docs.length > 0) {
    info(`Seeding Firestore collection "${collection}" (${fixture.docs.length} doc(s))...`);

    for (const doc of fixture.docs) {
      // Resolve document ID from the email→uid map
      let docId: string | undefined;
      if (doc._matchBy === 'email') {
        docId = emailToUid.get(doc._matchValue);
        if (!docId) {
          warn(`No uid found for email ${doc._matchValue}, skipping Firestore doc`);
          continue;
        }
      } else {
        warn(`Unknown _matchBy "${doc._matchBy}" for doc in ${collection}, skipping`);
        continue;
      }

      const body = JSON.stringify({ fields: toFirestoreFields(doc.fields) });

      const res = await fetch(`${FS_BASE}/${collection}?documentId=${encodeURIComponent(docId)}`, {
        method: 'POST',
        headers: FS_HEADERS,
        body,
      });

      if (res.status === 409) {
        // Document already exists — use PATCH to update
        await fetch(`${FS_BASE}/${collection}/${encodeURIComponent(docId)}`, {
          method: 'PATCH',
          headers: FS_HEADERS,
          body,
        });
        warn(`Firestore doc already existed, patched ${dim(`${collection}/${docId}`)}`);
      } else if (!res.ok) {
        const errText = await res.text();
        warn(`Firestore write failed for ${collection}/${docId}: ${errText}`);
      } else {
        ok(`Firestore ${dim(`${collection}/${docId}`)}`);
      }

      // Seed username index if applicable
      if (indexCollection && doc.fields.username && typeof doc.fields.username === 'string') {
        const username = doc.fields.username;
        const idxBody = JSON.stringify({ fields: { uid: { stringValue: docId } } });
        const idxRes = await fetch(`${FS_BASE}/${indexCollection}?documentId=${encodeURIComponent(username)}`, {
          method: 'POST',
          headers: FS_HEADERS,
          body: idxBody,
        });
        if (idxRes.status === 409) {
          await fetch(`${FS_BASE}/${indexCollection}/${encodeURIComponent(username)}`, {
            method: 'PATCH',
            headers: FS_HEADERS,
            body: idxBody,
          });
          warn(`Username index already existed, patched ${dim(`${indexCollection}/${username}`)}`);
        } else if (idxRes.ok) {
          ok(`Firestore ${dim(`${indexCollection}/${username}`)}`);
        }
      }
    }
    return;
  }

  // Template-based docs (stress fixtures)
  if (fixture.templates && fixture.templates.length > 0) {
    const uids = [...emailToUid.values()];
    let total = 0;

    for (const tpl of fixture.templates) {
      for (let i = 0; i < tpl.count; i++) {
        const uid = uids[i % uids.length] ?? `stress-uid-${i}`;
        const docId = `${uid}-${i}`;
        const body = JSON.stringify({
          fields: toFirestoreFields({ uid, ...tpl.fields }),
        });

        const res = await fetch(`${FS_BASE}/${collection}?documentId=${encodeURIComponent(docId)}`, {
          method: 'POST',
          headers: FS_HEADERS,
          body,
        });
        if (!res.ok && res.status !== 409) {
          const errText = await res.text();
          warn(`Firestore template write failed for ${collection}/${docId}: ${errText}`);
        } else {
          total++;
        }
      }
    }
    ok(`Firestore ${dim(collection)} — ${total} template doc(s) written`);
    return;
  }

  info(`Firestore fixture for "${collection}" has no docs or templates, skipping`);
}

// ---------------------------------------------------------------------------
// RTDB seeding
// ---------------------------------------------------------------------------

async function seedRtdbFile(fixture: RtdbFixture, emailToUid: Map<string, string>): Promise<void> {
  const rtdbPath = fixture._path;
  const ns = `${PROJECT_ID}-default-rtdb`;
  const url = `${RTDB_URL}/${rtdbPath}.json?ns=${ns}`;

  // Standard entries object
  if (!fixture.templates) {
    const entries = fixture.entries;

    // Skip empty entries (no-op but still log)
    const isEmptyObj = typeof entries === 'object' && !Array.isArray(entries) && Object.keys(entries).length === 0;
    const isEmptyArr = Array.isArray(entries) && entries.length === 0;

    if (isEmptyObj || isEmptyArr) {
      info(`RTDB path "${rtdbPath}" has empty entries, writing null to clear`);
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      });
      ok(`RTDB ${dim(rtdbPath)} cleared (null)`);
      return;
    }

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    });

    if (!res.ok) {
      const errText = await res.text();
      warn(`RTDB write failed for ${rtdbPath}: ${errText}`);
    } else {
      const count = typeof entries === 'object' && !Array.isArray(entries)
        ? Object.keys(entries).length
        : (Array.isArray(entries) ? entries.length : 1);
      ok(`RTDB ${dim(rtdbPath)} — ${count} entr${count === 1 ? 'y' : 'ies'}`);
    }
    return;
  }

  // Template-based entries (stress fixtures)
  const uids = [...emailToUid.values()];
  const bulk: Record<string, unknown> = {};
  let total = 0;

  for (const tpl of fixture.templates) {
    for (let i = 0; i < tpl.count; i++) {
      const hostUid = uids[i % uids.length] ?? `stress-uid-${i}`;
      const guestUid = uids[(i + 1) % uids.length] ?? `stress-uid-${i + 1}`;
      const matchId = `stress-match-${Date.now()}-${i}`;

      bulk[matchId] = {
        status: tpl.status ?? 'active',
        host: hostUid,
        guest: guestUid,
        meta: tpl.meta ?? {},
        createdAt: new Date().toISOString(),
      };
      total++;
    }
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bulk),
  });

  if (!res.ok) {
    const errText = await res.text();
    warn(`RTDB template write failed for ${rtdbPath}: ${errText}`);
  } else {
    ok(`RTDB ${dim(rtdbPath)} — ${total} template entr${total === 1 ? 'y' : 'ies'}`);
  }
}

// ---------------------------------------------------------------------------
// File loader helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function seedDir(set: string): string {
  return path.join(PROJECT_ROOT, 'data', 'seeds', set);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

function listFiles(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Parse CLI args
  const args = process.argv.slice(2);
  const setIdx = args.indexOf('--set');
  const set = setIdx !== -1 ? (args[setIdx + 1] ?? 'base') : 'base';

  if (set !== 'base' && set !== 'stress') {
    fail(`Unknown seed set "${set}". Valid values: base, stress`);
    process.exit(1);
  }

  const dir = seedDir(set);
  console.log(`\n${c.bold}Firebase Emulator Seeder${c.reset} — set: ${c.cyan}${set}${c.reset}\n`);

  // 1. Health check
  await checkEmulators();

  // 2. Auth seeding
  const authFile = path.join(dir, 'auth-accounts.json');
  let emailToUid = new Map<string, string>();

  try {
    const accounts = readJson<AuthAccount[]>(authFile);
    emailToUid = await seedAuthAccounts(accounts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      warn(`No auth-accounts.json found in ${dir}, skipping auth seeding`);
    } else {
      fail(`Failed to seed auth accounts: ${String(err)}`);
      process.exit(1);
    }
  }

  // 3. Firestore seeding (all firestore-*.json files)
  const fsFiles = listFiles(dir, 'firestore-');
  if (fsFiles.length === 0) {
    warn(`No firestore-*.json files found in ${dir}`);
  }
  for (const fsFile of fsFiles) {
    info(`Loading ${path.basename(fsFile)}`);
    try {
      const fixture = readJson<FirestoreFixture>(fsFile);
      await seedFirestoreFile(fixture, emailToUid);
    } catch (err) {
      fail(`Firestore seeding failed for ${path.basename(fsFile)}: ${String(err)}`);
      process.exit(1);
    }
  }

  // 4. RTDB seeding (all rtdb-*.json files)
  const rtdbFiles = listFiles(dir, 'rtdb-');
  if (rtdbFiles.length === 0) {
    warn(`No rtdb-*.json files found in ${dir}`);
  }
  for (const rtdbFile of rtdbFiles) {
    info(`Loading ${path.basename(rtdbFile)}`);
    try {
      const fixture = readJson<RtdbFixture>(rtdbFile);
      await seedRtdbFile(fixture, emailToUid);
    } catch (err) {
      fail(`RTDB seeding failed for ${path.basename(rtdbFile)}: ${String(err)}`);
      process.exit(1);
    }
  }

  console.log(`\n${c.green}${c.bold}Seeding complete.${c.reset}\n`);
}

main().catch((err: unknown) => {
  fail(String(err));
  process.exit(1);
});

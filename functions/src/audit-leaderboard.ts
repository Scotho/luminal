/**
 * ── Leaderboard Audit Script ────────────────────────────────
 * Scans all leaderboard docs and identifies duplicates:
 * same (uid, series, matchType) across multiple doc IDs.
 *
 * USAGE:
 *   cd functions
 *   npx ts-node src/audit-leaderboard.ts
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.resolve(__dirname, '../../service-account.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require(credPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://luminal-game-default-rtdb.firebaseio.com',
});
const db = admin.firestore();

interface DocInfo {
  docId: string;
  uid: string;
  username: string;
  series: number;
  matchType: string;
  opponents?: number;
  wins: number;
  losses: number;
  draws: number;
  matchCount: number;
  bestStreak: number;
  currentStreak: number;
  fastestWin: number;
  lastUpdated: number;
}

async function audit(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('  LEADERBOARD AUDIT');
  console.log('='.repeat(60) + '\n');

  const allDocs = await db.collection('leaderboard').get();
  console.log(`Total documents: ${allDocs.size}\n`);

  // Collect all docs with their info
  const docs: DocInfo[] = [];
  let hasOpponents = 0;
  let missingMatchType = 0;
  let missingSeries = 0;

  allDocs.forEach(d => {
    const data = d.data();
    if (data.opponents !== undefined) hasOpponents++;
    if (!data.matchType) missingMatchType++;
    if (!data.series && data.series !== 0) missingSeries++;

    docs.push({
      docId: d.id,
      uid: data.uid || '',
      username: data.username || '',
      series: data.series ?? 0,
      matchType: data.matchType || '',
      opponents: data.opponents,
      wins: data.wins || 0,
      losses: data.losses || 0,
      draws: data.draws || 0,
      matchCount: data.matchCount || 0,
      bestStreak: data.bestStreak || 0,
      currentStreak: data.currentStreak || 0,
      fastestWin: data.fastestWin || 0,
      lastUpdated: data.lastUpdated || 0,
    });
  });

  console.log('── Field Health ──');
  console.log(`  Still has "opponents" field: ${hasOpponents}`);
  console.log(`  Missing matchType:          ${missingMatchType}`);
  console.log(`  Missing series:             ${missingSeries}`);

  // Group by (uid, series, matchType) using field values
  const groups = new Map<string, DocInfo[]>();
  for (const d of docs) {
    const key = `${d.uid}|${d.series}|${d.matchType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  // Find duplicates
  const dupes = Array.from(groups.entries()).filter(([, v]) => v.length > 1);
  console.log(`\n── Duplicate Analysis ──`);
  console.log(`  Unique (uid, series, matchType) groups: ${groups.size}`);
  console.log(`  Groups with duplicates:                 ${dupes.length}`);

  if (dupes.length > 0) {
    console.log(`\n── Duplicate Details ──\n`);
    for (const [key, entries] of dupes) {
      const [uid, series, matchType] = key.split('|');
      const canonicalId = `${uid}_${series}_${matchType}`;
      console.log(`  USER: ${entries[0].username} (${uid})`);
      console.log(`  Category: BO${series} ${matchType}`);
      console.log(`  Canonical doc ID would be: ${canonicalId}`);
      console.log(`  Found ${entries.length} docs:`);
      for (const e of entries) {
        const isCanonical = e.docId === canonicalId;
        const age = e.lastUpdated ? `${Math.round((Date.now() - e.lastUpdated) / 86400000)}d ago` : 'unknown';
        console.log(`    ${isCanonical ? '→' : '✗'} ${e.docId}`);
        console.log(`      W:${e.wins} L:${e.losses} D:${e.draws} M:${e.matchCount} Streak:${e.bestStreak} Fast:${e.fastestWin} Updated:${age}${e.opponents !== undefined ? ` opponents:${e.opponents}` : ''}`);
      }
      console.log('');
    }
  }

  // Also check for docs whose ID doesn't match the expected format
  console.log(`── Doc ID Format Check ──\n`);
  const expectedFormat = /^[^_]+_\d+_(ai|casual)$/;
  const badIds = docs.filter(d => !expectedFormat.test(d.docId));
  console.log(`  Docs with non-standard ID format: ${badIds.length}`);
  if (badIds.length > 0) {
    for (const d of badIds) {
      console.log(`    ${d.docId} (${d.username}, series:${d.series}, type:${d.matchType}${d.opponents !== undefined ? `, opponents:${d.opponents}` : ''})`);
    }
  }

  // Check for potential double-counted online matches (same uid, very high matchCount relative to wins+losses+draws)
  console.log(`\n── Potential Double-Count Check ──\n`);
  const doubleCount = docs.filter(d =>
    d.matchType === 'casual' && d.matchCount > (d.wins + d.losses + d.draws) * 1.5 && d.matchCount > 5,
  );
  if (doubleCount.length > 0) {
    console.log(`  Found ${doubleCount.length} casual entries with matchCount >> wins+losses+draws:`);
    for (const d of doubleCount) {
      const expected = d.wins + d.losses + d.draws;
      console.log(`    ${d.docId} (${d.username}): matchCount=${d.matchCount}, W+L+D=${expected}`);
    }
  } else {
    console.log('  No obvious double-counting detected.');
  }

  console.log('\n' + '='.repeat(60));
  console.log('  AUDIT COMPLETE');
  console.log('='.repeat(60) + '\n');
}

audit()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
  });

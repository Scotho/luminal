/**
 * ── Leaderboard Migration v2: Drop Opponents Dimension ──────
 * Merges leaderboard docs that differ only by opponent count.
 *
 * Old docs: ID = "uid_series_opponents_matchType"
 * New docs: ID = "uid_series_matchType"
 *
 * Merge logic:
 *   - Sum: wins, losses, draws, matchCount, totalTime
 *   - Max: bestStreak, currentStreak
 *   - Min (non-zero): fastestWin
 *   - Most recent: lastReplayId, lastUpdated, bestStreakReplayId, fastestWinReplayId
 *
 * USAGE:
 *   cd functions
 *   npx ts-node src/migrate-leaderboard-v2.ts --dry-run
 *   npx ts-node src/migrate-leaderboard-v2.ts
 */

import * as admin from 'firebase-admin';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serviceAccount = require('E:/ForClaude/luminal-game-firebase-adminsdk-fbsvc-079dcf1e78.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://luminal-game-default-rtdb.firebaseio.com',
});
const db = admin.firestore();

interface LeaderboardDoc {
  uid: string;
  username: string;
  color: number;
  icon?: string;
  series: number;
  opponents?: number;
  matchType: string;
  wins: number;
  losses: number;
  draws: number;
  totalTime: number;
  matchCount: number;
  bestStreak: number;
  currentStreak: number;
  fastestWin: number;
  winRate: number;
  lastUpdated: number;
  lastReplayId: string;
  bestStreakReplayId: string;
  fastestWinReplayId: string;
  [key: string]: unknown;
}

function newDocId(uid: string, series: number, matchType: string): string {
  return `${uid}_${series}_${matchType}`;
}

function mergeDocs(target: LeaderboardDoc, source: LeaderboardDoc): LeaderboardDoc {
  const merged = { ...target };

  // Sum
  merged.wins = (target.wins || 0) + (source.wins || 0);
  merged.losses = (target.losses || 0) + (source.losses || 0);
  merged.draws = (target.draws || 0) + (source.draws || 0);
  merged.matchCount = (target.matchCount || 0) + (source.matchCount || 0);
  merged.totalTime = (target.totalTime || 0) + (source.totalTime || 0);

  // Max
  if ((source.bestStreak || 0) > (merged.bestStreak || 0)) {
    merged.bestStreak = source.bestStreak;
    merged.bestStreakReplayId = source.bestStreakReplayId || merged.bestStreakReplayId;
  }
  if ((source.currentStreak || 0) > (merged.currentStreak || 0)) {
    merged.currentStreak = source.currentStreak;
  }

  // Min (non-zero) for fastestWin
  if (source.fastestWin > 0 && (source.fastestWin < (merged.fastestWin || 0) || (merged.fastestWin || 0) === 0)) {
    merged.fastestWin = source.fastestWin;
    merged.fastestWinReplayId = source.fastestWinReplayId || merged.fastestWinReplayId;
  }

  // Most recent
  if ((source.lastUpdated || 0) > (merged.lastUpdated || 0)) {
    merged.lastUpdated = source.lastUpdated;
    merged.lastReplayId = source.lastReplayId || merged.lastReplayId;
  }

  // Recalculate win rate
  merged.winRate = merged.matchCount > 0 ? Math.round((merged.wins / merged.matchCount) * 1000) / 10 : 0;

  // Remove opponents field
  delete merged.opponents;

  return merged;
}

async function migrate(dryRun: boolean): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  LEADERBOARD MIGRATION v2: DROP OPPONENTS ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Stage 1: Scan ──
  console.log('Stage 1: Scanning all leaderboard documents...\n');

  const allDocs = await db.collection('leaderboard').get();

  // Group by new doc ID (uid_series_matchType)
  const groups = new Map<string, { docId: string; data: LeaderboardDoc }[]>();
  let alreadyNew = 0;

  allDocs.forEach(doc => {
    const data = doc.data() as LeaderboardDoc;
    const targetId = newDocId(data.uid, data.series, data.matchType);

    if ((data.opponents === undefined || data.opponents === null) && doc.id === targetId) {
      alreadyNew++;
    }

    if (!groups.has(targetId)) groups.set(targetId, []);
    groups.get(targetId)!.push({ docId: doc.id, data });
  });

  const needsMerge = Array.from(groups.entries()).filter(([targetId, docs]) =>
    docs.length > 1 || docs[0].docId !== targetId
  );

  console.log(`  Total documents:     ${allDocs.size}`);
  console.log(`  Already new format:  ${alreadyNew}`);
  console.log(`  Groups needing work: ${needsMerge.length}`);

  if (needsMerge.length === 0) {
    console.log('\n  Nothing to migrate.\n');
    return;
  }

  // ── Stage 2: Preview ──
  console.log(`\nStage 2: Migration plan\n`);

  for (const [targetId, docs] of needsMerge) {
    const sourceIds = docs.map(d => d.docId).join(', ');
    const totalMatches = docs.reduce((sum, d) => sum + (d.data.matchCount || 0), 0);
    console.log(`  ${docs.length} docs → ${targetId} | ${totalMatches} total matches | from: ${sourceIds}`);
  }

  if (dryRun) {
    console.log(`\n  DRY RUN — no changes made.\n`);
    return;
  }

  // ── Stage 3: Apply ──
  console.log(`\nStage 3: Applying migration...\n`);

  let applied = 0;
  let errors = 0;

  for (const [targetId, docs] of needsMerge) {
    try {
      // Merge all docs into one
      let merged = { ...docs[0].data };
      delete merged.opponents;
      for (let i = 1; i < docs.length; i++) {
        merged = mergeDocs(merged, docs[i].data);
      }

      // Write merged doc
      await db.collection('leaderboard').doc(targetId).set(merged);

      // Delete old docs that aren't the target
      for (const d of docs) {
        if (d.docId !== targetId) {
          await db.collection('leaderboard').doc(d.docId).delete();
          console.log(`    Deleted old doc: ${d.docId}`);
        }
      }

      applied++;
      console.log(`  ✓ Merged ${docs.length} docs → ${targetId}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ FAILED ${targetId}: ${err}`);
    }
  }

  // ── Stage 4: Verify ──
  console.log(`\nStage 4: Verification\n`);

  const afterDocs = await db.collection('leaderboard').get();
  let hasOpponents = 0;
  afterDocs.forEach(doc => {
    const data = doc.data();
    if (data.opponents !== undefined) hasOpponents++;
  });

  console.log(`  Applied:      ${applied}`);
  console.log(`  Errors:       ${errors}`);
  console.log(`  Docs after:   ${afterDocs.size}`);
  console.log(`  Still old:    ${hasOpponents}`);

  if (hasOpponents === 0) {
    console.log(`\n  Migration complete. All opponents fields removed.\n`);
  } else {
    console.log(`\n  WARNING: ${hasOpponents} documents still have opponents field.\n`);
  }
}

const dryRun = process.argv.includes('--dry-run');
migrate(dryRun)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

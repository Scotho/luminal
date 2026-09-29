/**
 * ── Leaderboard Migration Script ─────────────────────────
 * Migrates old leaderboard docs (no matchType field) to the new format.
 *
 * Old docs: ID = "uid_series_opponents", no matchType field
 * New docs: ID = "uid_series_opponents_matchType", matchType = 'ai'
 *
 * All old data is classified as 'ai' (offline) since online casual
 * did not exist when these docs were created.
 *
 * PROCEDURE:
 *   1. Run with --dry-run first to preview changes
 *   2. Review the output carefully
 *   3. Run without --dry-run to apply
 *
 * USAGE:
 *   cd functions
 *   npx ts-node src/migrate-leaderboard.ts --dry-run
 *   npx ts-node src/migrate-leaderboard.ts
 *
 * REQUIRES: Firebase CLI logged in (`firebase login`) or
 *   GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key.
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
  opponents: number;
  matchType?: string;
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

async function migrate(dryRun: boolean): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  LEADERBOARD MIGRATION ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Stage 1: Scan ──────────────────────────────────────
  console.log('Stage 1: Scanning all leaderboard documents...\n');

  const allDocs = await db.collection('leaderboard').get();
  const oldDocs: { id: string; data: LeaderboardDoc }[] = [];
  let newDocs = 0;

  allDocs.forEach(doc => {
    const data = doc.data() as LeaderboardDoc;
    if (!data.matchType) {
      oldDocs.push({ id: doc.id, data });
    } else {
      newDocs++;
    }
  });

  console.log(`  Total documents:    ${allDocs.size}`);
  console.log(`  Already migrated:   ${newDocs}`);
  console.log(`  Need migration:     ${oldDocs.length}`);

  if (oldDocs.length === 0) {
    console.log('\n  Nothing to migrate. All documents already have matchType.\n');
    return;
  }

  // ── Stage 2: Preview ──────────────────────────────────
  console.log(`\nStage 2: Migration plan\n`);

  const operations: {
    oldId: string;
    newId: string;
    action: 'move' | 'merge';
    uid: string;
    username: string;
    matchCount: number;
  }[] = [];

  for (const old of oldDocs) {
    const newId = `${old.data.uid}_${old.data.series}_${old.data.opponents}_ai`;
    const existingNew = await db.collection('leaderboard').doc(newId).get();
    const action = existingNew.exists ? 'merge' : 'move';

    operations.push({
      oldId: old.id,
      newId,
      action,
      uid: old.data.uid,
      username: old.data.username,
      matchCount: old.data.matchCount || 0,
    });

    console.log(`  ${action.toUpperCase().padEnd(5)} | ${old.id} → ${newId} | ${old.data.username} (${old.data.matchCount} matches)`);
  }

  const totalMatches = oldDocs.reduce((sum, d) => sum + (d.data.matchCount || 0), 0);
  const mergeCount = operations.filter(o => o.action === 'merge').length;
  const moveCount = operations.filter(o => o.action === 'move').length;

  console.log(`\n  Summary:`);
  console.log(`    Move (new doc):     ${moveCount}`);
  console.log(`    Merge (into existing): ${mergeCount}`);
  console.log(`    Total matches affected: ${totalMatches}`);

  if (dryRun) {
    console.log(`\n  DRY RUN — no changes made.`);
    console.log(`  Run without --dry-run to apply.\n`);
    return;
  }

  // ── Stage 3: Confirm ──────────────────────────────────
  console.log(`\nStage 3: Applying migration...\n`);

  let applied = 0;
  let errors = 0;

  for (const op of operations) {
    const old = oldDocs.find(d => d.id === op.oldId)!;
    const newRef = db.collection('leaderboard').doc(op.newId);

    try {
      if (op.action === 'merge') {
        // Merge old stats into existing new-format doc
        const existingSnap = await newRef.get();
        const e = existingSnap.data() as LeaderboardDoc;

        const merged: Partial<LeaderboardDoc> = {
          wins: (e.wins || 0) + (old.data.wins || 0),
          losses: (e.losses || 0) + (old.data.losses || 0),
          draws: (e.draws || 0) + (old.data.draws || 0),
          totalTime: (e.totalTime || 0) + (old.data.totalTime || 0),
          matchCount: (e.matchCount || 0) + (old.data.matchCount || 0),
          lastUpdated: Date.now(),
        };

        // Keep the better bestStreak
        if ((old.data.bestStreak || 0) > (e.bestStreak || 0)) {
          merged.bestStreak = old.data.bestStreak;
          merged.bestStreakReplayId = old.data.bestStreakReplayId || e.bestStreakReplayId;
        }

        // Keep the better fastestWin
        if (old.data.fastestWin > 0 && (old.data.fastestWin < (e.fastestWin || 0) || (e.fastestWin || 0) === 0)) {
          merged.fastestWin = old.data.fastestWin;
          merged.fastestWinReplayId = old.data.fastestWinReplayId || e.fastestWinReplayId;
        }

        // Recalculate win rate
        const totalWins = merged.wins!;
        const totalMatches = merged.matchCount!;
        merged.winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 1000) / 10 : 0;

        await newRef.update(merged);
      } else {
        // Move: create new doc with matchType added
        await newRef.set({ ...old.data, matchType: 'ai' });
      }

      // Delete old doc
      await db.collection('leaderboard').doc(op.oldId).delete();
      applied++;
      console.log(`  ✓ ${op.action.toUpperCase()} ${op.oldId} → ${op.newId}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ FAILED ${op.oldId}: ${err}`);
    }
  }

  // ── Stage 4: Verify ──────────────────────────────────
  console.log(`\nStage 4: Verification\n`);

  const afterDocs = await db.collection('leaderboard').get();
  let afterOld = 0;
  let afterNew = 0;
  afterDocs.forEach(doc => {
    const data = doc.data();
    if (!data.matchType) afterOld++;
    else afterNew++;
  });

  console.log(`  Applied:     ${applied}`);
  console.log(`  Errors:      ${errors}`);
  console.log(`  Docs after:  ${afterDocs.size} total (${afterNew} migrated, ${afterOld} remaining old)`);

  if (afterOld === 0) {
    console.log(`\n  Migration complete. All documents now have matchType.\n`);
  } else {
    console.log(`\n  WARNING: ${afterOld} documents still missing matchType.\n`);
  }
}

// ── Entry point ──────────────────────────────────────────
const dryRun = process.argv.includes('--dry-run');
migrate(dryRun)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

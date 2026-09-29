/**
 * ── Leaderboard Migration v3: Merge Remaining Duplicates ────
 * Merges all docs sharing the same (uid, series, matchType) field values
 * into a single canonical doc with ID = uid_series_matchType.
 *
 * Root cause: v2 migration (drop opponents dimension) was never fully
 * applied, leaving old-format docs (uid_series_opponents_matchType)
 * alongside new canonical docs. Both appear in leaderboard queries
 * because queries filter by field values, not doc IDs.
 *
 * Merge logic:
 *   - Sum: wins, losses, draws, matchCount, totalTime
 *   - Max: bestStreak, currentStreak
 *   - Min (non-zero): fastestWin
 *   - Most recent: lastReplayId, lastUpdated, bestStreakReplayId,
 *                  fastestWinReplayId, username, color, icon
 *   - Remove: opponents field
 *   - Recalculate: winRate
 *
 * USAGE:
 *   cd functions
 *   npx ts-node src/migrate-leaderboard-v3.ts --dry-run
 *   npx ts-node src/migrate-leaderboard-v3.ts
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
  currentStreakBrokenAt?: number;
  currentStreakPeak?: number;
  lifetimeFlow?: number;
}

function canonicalId(uid: string, series: number, matchType: string): string {
  return `${uid}_${series}_${matchType}`;
}

function mergeDocs(docs: LeaderboardDoc[]): LeaderboardDoc {
  // Start with the most recently updated doc as base (most current username/color/icon)
  const sorted = [...docs].sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
  const base = { ...sorted[0] };

  // Sum counters from all docs
  base.wins = docs.reduce((s, d) => s + (d.wins || 0), 0);
  base.losses = docs.reduce((s, d) => s + (d.losses || 0), 0);
  base.draws = docs.reduce((s, d) => s + (d.draws || 0), 0);
  base.matchCount = docs.reduce((s, d) => s + (d.matchCount || 0), 0);
  base.totalTime = docs.reduce((s, d) => s + (d.totalTime || 0), 0);

  // Max for streaks
  base.bestStreak = Math.max(...docs.map(d => d.bestStreak || 0));
  base.currentStreak = Math.max(...docs.map(d => d.currentStreak || 0));

  // Min non-zero for fastestWin
  const fastTimes = docs.map(d => d.fastestWin || 0).filter(t => t > 0);
  base.fastestWin = fastTimes.length > 0 ? Math.min(...fastTimes) : 0;

  // Take replay IDs from the doc that earned the best value
  const bestStreakDoc = docs.reduce((best, d) => (d.bestStreak || 0) > (best.bestStreak || 0) ? d : best);
  base.bestStreakReplayId = bestStreakDoc.bestStreakReplayId || base.bestStreakReplayId || '';

  const fastestDoc = fastTimes.length > 0
    ? docs.reduce((best, d) => (d.fastestWin > 0 && d.fastestWin < (best.fastestWin || Infinity)) ? d : best)
    : base;
  base.fastestWinReplayId = fastestDoc.fastestWinReplayId || base.fastestWinReplayId || '';

  // Most recent replay and timestamp
  base.lastUpdated = Math.max(...docs.map(d => d.lastUpdated || 0));
  const latestDoc = docs.reduce((best, d) => (d.lastUpdated || 0) > (best.lastUpdated || 0) ? d : best);
  base.lastReplayId = latestDoc.lastReplayId || base.lastReplayId || '';

  // Sum lifetimeFlow if present
  const flows = docs.filter(d => d.lifetimeFlow !== undefined);
  if (flows.length > 0) {
    base.lifetimeFlow = flows.reduce((s, d) => s + (d.lifetimeFlow || 0), 0);
  }

  // Graveyard: take from doc with most recent broken streak
  const graveyardDocs = docs.filter(d => d.currentStreakBrokenAt);
  if (graveyardDocs.length > 0) {
    const latestGraveyard = graveyardDocs.reduce((best, d) =>
      (d.currentStreakBrokenAt || 0) > (best.currentStreakBrokenAt || 0) ? d : best);
    base.currentStreakBrokenAt = latestGraveyard.currentStreakBrokenAt;
    base.currentStreakPeak = latestGraveyard.currentStreakPeak;
  }

  // Recalculate win rate
  base.winRate = base.matchCount > 0
    ? Math.round((base.wins / base.matchCount) * 1000) / 10
    : 0;

  // Remove opponents field
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { opponents: _removed, ...clean } = base;
  return clean as LeaderboardDoc;
}

async function migrate(dryRun: boolean): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`  LEADERBOARD MIGRATION v3: MERGE DUPLICATES ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  console.log('='.repeat(60) + '\n');

  // ── Stage 1: Scan ──
  console.log('Stage 1: Scanning all leaderboard documents...\n');

  const allDocs = await db.collection('leaderboard').get();
  const docMap: { id: string; data: LeaderboardDoc }[] = [];

  allDocs.forEach(d => {
    docMap.push({ id: d.id, data: d.data() as LeaderboardDoc });
  });

  console.log(`  Total documents: ${allDocs.size}`);

  // Group by canonical key (uid, series, matchType) using FIELD values
  const groups = new Map<string, { id: string; data: LeaderboardDoc }[]>();
  for (const d of docMap) {
    const key = canonicalId(d.data.uid, d.data.series, d.data.matchType);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  // Separate into: needs merge, needs rename, already correct
  const needsMerge: [string, { id: string; data: LeaderboardDoc }[]][] = [];
  const needsRename: [string, { id: string; data: LeaderboardDoc }[]][] = [];
  let alreadyCorrect = 0;

  for (const [targetId, docs] of groups) {
    if (docs.length === 1 && docs[0].id === targetId && docs[0].data.opponents === undefined) {
      alreadyCorrect++;
    } else if (docs.length === 1) {
      needsRename.push([targetId, docs]);
    } else {
      needsMerge.push([targetId, docs]);
    }
  }

  console.log(`  Already correct:   ${alreadyCorrect}`);
  console.log(`  Need rename only:  ${needsRename.length}`);
  console.log(`  Need merge:        ${needsMerge.length}`);
  console.log(`  Total operations:  ${needsRename.length + needsMerge.length}`);

  if (needsRename.length === 0 && needsMerge.length === 0) {
    console.log('\n  Nothing to do. All documents are correct.\n');
    return;
  }

  // ── Stage 2: Preview ──
  console.log(`\nStage 2: Migration plan\n`);

  for (const [targetId, docs] of needsRename) {
    console.log(`  RENAME ${docs[0].id} → ${targetId} (${docs[0].data.username}, ${docs[0].data.matchCount} matches)`);
  }

  for (const [targetId, docs] of needsMerge) {
    const totalMatches = docs.reduce((sum, d) => sum + (d.data.matchCount || 0), 0);
    const totalWins = docs.reduce((sum, d) => sum + (d.data.wins || 0), 0);
    const sourceIds = docs.map(d => d.id).join(', ');
    const merged = mergeDocs(docs.map(d => d.data));
    console.log(`  MERGE  ${docs.length} docs → ${targetId} (${docs[0].data.username})`);
    console.log(`         From: ${sourceIds}`);
    console.log(`         Result: W:${merged.wins} L:${merged.losses} D:${merged.draws} M:${merged.matchCount} Streak:${merged.bestStreak} Fast:${merged.fastestWin > 0 ? merged.fastestWin.toFixed(2) + 's' : 'none'}`);
    console.log(`         (Sum of ${totalMatches} matches, ${totalWins} wins)`);
  }

  if (dryRun) {
    console.log(`\n  DRY RUN — no changes made.`);
    console.log(`  Run without --dry-run to apply.\n`);
    return;
  }

  // ── Stage 3: Apply ──
  console.log(`\nStage 3: Applying migration...\n`);

  let applied = 0;
  let errors = 0;

  // Process renames
  for (const [targetId, docs] of needsRename) {
    try {
      const data = { ...docs[0].data };
      delete data.opponents;
      await db.collection('leaderboard').doc(targetId).set(data);
      if (docs[0].id !== targetId) {
        await db.collection('leaderboard').doc(docs[0].id).delete();
      }
      applied++;
      console.log(`  OK RENAME ${docs[0].id} → ${targetId}`);
    } catch (err) {
      errors++;
      console.error(`  FAIL RENAME ${docs[0].id}: ${err}`);
    }
  }

  // Process merges
  for (const [targetId, docs] of needsMerge) {
    try {
      const merged = mergeDocs(docs.map(d => d.data));
      await db.collection('leaderboard').doc(targetId).set(merged);

      // Delete all old docs that aren't the target
      for (const d of docs) {
        if (d.id !== targetId) {
          await db.collection('leaderboard').doc(d.id).delete();
          console.log(`    Deleted: ${d.id}`);
        }
      }
      applied++;
      console.log(`  OK MERGE  ${docs.length} docs → ${targetId}`);
    } catch (err) {
      errors++;
      console.error(`  FAIL MERGE ${targetId}: ${err}`);
    }
  }

  // ── Stage 4: Verify ──
  console.log(`\nStage 4: Verification\n`);

  const afterDocs = await db.collection('leaderboard').get();
  let hasOpponents = 0;
  let badFormat = 0;
  const expectedFormat = /^[^_]+_\d+_(ai|casual)$/;
  const afterGroups = new Map<string, number>();

  afterDocs.forEach(d => {
    const data = d.data();
    if (data.opponents !== undefined) hasOpponents++;
    if (!expectedFormat.test(d.id)) badFormat++;
    const key = canonicalId(data.uid, data.series, data.matchType);
    afterGroups.set(key, (afterGroups.get(key) || 0) + 1);
  });

  const remainingDupes = Array.from(afterGroups.values()).filter(c => c > 1).length;

  console.log(`  Applied:            ${applied}`);
  console.log(`  Errors:             ${errors}`);
  console.log(`  Docs before:        ${allDocs.size}`);
  console.log(`  Docs after:         ${afterDocs.size}`);
  console.log(`  Still has opponents: ${hasOpponents}`);
  console.log(`  Bad ID format:      ${badFormat}`);
  console.log(`  Remaining dupes:    ${remainingDupes}`);

  if (hasOpponents === 0 && badFormat === 0 && remainingDupes === 0) {
    console.log(`\n  Migration complete. All duplicates merged, all IDs canonical.\n`);
  } else {
    console.log(`\n  WARNING: Some issues remain. Review the numbers above.\n`);
  }
}

const dryRun = process.argv.includes('--dry-run');
migrate(dryRun)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

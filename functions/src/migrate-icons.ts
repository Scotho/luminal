/**
 * ── Icon Migration Script ────────────────────────────────
 * Awards the 'star' (early adopter) icon to all existing users
 * who don't already have one.
 *
 * This is a one-time bulk backfill so users see the icon
 * without needing to log in first.
 *
 * USAGE:
 *   cd functions
 *   npx ts-node src/migrate-icons.ts --dry-run
 *   npx ts-node src/migrate-icons.ts
 */

import * as admin from 'firebase-admin';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serviceAccount = require('E:/ForClaude/luminal-game-firebase-adminsdk-fbsvc-079dcf1e78.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://luminal-game-default-rtdb.firebaseio.com',
});
const db = admin.firestore();

async function migrate(dryRun: boolean): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ICON MIGRATION ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Stage 1: Scan ──────────────────────────────────────
  console.log('Stage 1: Scanning all user documents...\n');

  const allUsers = await db.collection('users').get();
  const needIcon: { id: string; username: string }[] = [];
  let alreadyHave = 0;

  allUsers.forEach(doc => {
    const data = doc.data();
    if (data.icon) {
      alreadyHave++;
    } else {
      needIcon.push({ id: doc.id, username: data.username || '(no username)' });
    }
  });

  console.log(`  Total users:        ${allUsers.size}`);
  console.log(`  Already have icon:  ${alreadyHave}`);
  console.log(`  Need icon:          ${needIcon.length}`);

  if (needIcon.length === 0) {
    console.log('\n  Nothing to migrate. All users already have an icon.\n');
    return;
  }

  // ── Stage 2: Preview ──────────────────────────────────
  console.log(`\nStage 2: Users to receive 'star' icon\n`);

  for (const user of needIcon) {
    console.log(`  ${user.username.padEnd(20)} (${user.id})`);
  }

  if (dryRun) {
    console.log(`\n  DRY RUN — no changes made.`);
    console.log(`  Run without --dry-run to apply.\n`);
    return;
  }

  // ── Stage 3: Apply ───────────────────────────────────
  console.log(`\nStage 3: Applying icons...\n`);

  let applied = 0;
  let errors = 0;

  for (const user of needIcon) {
    try {
      await db.collection('users').doc(user.id).update({ icon: 'star' });
      applied++;
      console.log(`  ✓ ${user.username}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ ${user.username}: ${err}`);
    }
  }

  // ── Stage 4: Verify ──────────────────────────────────
  console.log(`\nStage 4: Verification\n`);

  const afterUsers = await db.collection('users').get();
  let afterWithIcon = 0;
  let afterWithout = 0;
  afterUsers.forEach(doc => {
    if (doc.data().icon) afterWithIcon++;
    else afterWithout++;
  });

  console.log(`  Applied:     ${applied}`);
  console.log(`  Errors:      ${errors}`);
  console.log(`  Users after: ${afterUsers.size} total (${afterWithIcon} with icon, ${afterWithout} without)`);

  if (afterWithout === 0) {
    console.log(`\n  Migration complete. All users now have an icon.\n`);
  } else {
    console.log(`\n  WARNING: ${afterWithout} users still missing icon.\n`);
  }
}

const dryRun = process.argv.includes('--dry-run');
migrate(dryRun)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

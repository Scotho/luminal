// src/e2e/browser/online-smoke/friend-lifecycle.test.ts
// Friend lifecycle test: add → accept via toast → remove → re-add → accept via Social UI.
// Validates each step with expected outcomes and auto-reports failures.

import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { VIEWPORTS } from '../helpers/viewports';
import { dismissLoadingScreen } from '../helpers/launch';
import { signIn, TEST_ACCOUNTS } from '../online/testAccounts';
import { startTestSession, endTestSession, reportBug } from '../online/bugReporter';

const BASE_URL = process.env.SMOKE_TARGET_URL ?? 'http://localhost:5173';

// ── Helpers ──────────────────────────────────────────────

/** Open the friends overlay via the SOCIAL button or direct nav. */
async function openFriendsOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Try social button in topbar
    const socialBtn = document.getElementById('btn-social')
      || document.querySelector('[data-screen="social"]')
      || document.querySelector('#social-dropdown-wrap');
    if (socialBtn) (socialBtn as HTMLElement).click();
  });
  await page.waitForTimeout(500);

  // If friends overlay isn't visible, try navigating to it directly
  const isVisible = await page.evaluate(() => {
    const el = document.getElementById('friends-overlay');
    return el && !el.classList.contains('hidden');
  });
  if (!isVisible) {
    await page.evaluate(() => {
      const el = document.getElementById('friends-overlay');
      if (el) el.classList.remove('hidden');
    });
    await page.waitForTimeout(300);
  }
}

/** Open the social overlay (topbar dropdown or overlay screen). */
async function openSocialOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const btn = document.getElementById('btn-social')
      || document.querySelector('[data-screen="social"]');
    if (btn) (btn as HTMLElement).click();
  });
  await page.waitForTimeout(500);

  // Ensure social overlay is visible
  await page.evaluate(() => {
    const el = document.getElementById('social-overlay');
    if (el) el.classList.remove('hidden');
  });
  await page.waitForTimeout(300);
}

/** Check if a username appears in the friend list. */
async function isInFriendList(page: Page, username: string): Promise<boolean> {
  return page.evaluate((name) => {
    const lists = ['friends-list', 'social-friends-list'];
    for (const id of lists) {
      const el = document.getElementById(id);
      if (el) {
        const rows = el.querySelectorAll('.friend-row');
        for (const row of rows) {
          if (row.querySelector('.friend-name')?.textContent?.trim() === name) return true;
        }
      }
    }
    return false;
  }, username);
}

/** Send a friend request by typing username into the add-friend input. */
async function sendFriendRequest(page: Page, username: string): Promise<string> {
  await openFriendsOverlay(page);

  // Type into whichever add-friend input is visible — use evaluate to avoid
  // Playwright's ambiguous selector resolution when both inputs exist in DOM.
  await page.waitForFunction(() => {
    const a = document.getElementById('friends-add-input');
    const b = document.getElementById('social-friends-add-input');
    return (a && a.offsetParent !== null) || (b && b.offsetParent !== null);
  }, { timeout: 5_000 });
  await page.evaluate((name) => {
    const input = (document.getElementById('friends-add-input') as HTMLInputElement) ??
                  (document.getElementById('social-friends-add-input') as HTMLInputElement);
    if (input) { input.value = name; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }, username);

  // Click add button (JS click — Playwright click can fail when btn is a styled div)
  await page.evaluate(() => {
    const btn = document.getElementById('btn-friends-add')
      || document.getElementById('btn-social-friends-add');
    if (btn) (btn as HTMLElement).click();
  });

  // Wait for status message (check both possible status elements)
  await page.waitForFunction(() => {
    const el = document.getElementById('friends-add-status')
      || document.getElementById('social-friends-add-status');
    const text = el?.textContent?.trim();
    return text && text.length > 0 && text !== 'SEARCHING...';
  }, { timeout: 10_000 });

  const status = await page.evaluate(() => {
    const el = document.getElementById('friends-add-status')
      || document.getElementById('social-friends-add-status');
    return el?.textContent?.trim() ?? '';
  });

  return status;
}

/** Remove a friend via the inline remove button (hover action). */
async function removeFriend(page: Page, username: string): Promise<boolean> {
  await openFriendsOverlay(page);
  await page.waitForTimeout(500);

  return page.evaluate((name) => {
    const lists = ['friends-list', 'social-friends-list'];
    for (const id of lists) {
      const el = document.getElementById(id);
      if (!el) continue;
      const rows = el.querySelectorAll('.friend-row');
      for (const row of rows) {
        if (row.querySelector('.friend-name')?.textContent?.trim() === name) {
          const removeBtn = row.querySelector('.friend-action-btn--remove') as HTMLElement;
          if (removeBtn) {
            removeBtn.click();
            return true;
          }
        }
      }
    }
    return false;
  }, username);
}

/** Wait for a notification toast to appear with friend request actions. */
async function waitForFriendRequestToast(page: Page, timeoutMs = 15_000): Promise<boolean> {
  try {
    await page.waitForSelector('.notif-toast .notif-action-btn--accept', {
      state: 'visible',
      timeout: timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

/** Accept friend request via toast notification. */
async function acceptViaToast(page: Page): Promise<boolean> {
  const btn = await page.$('.notif-toast .notif-action-btn--accept');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

/** Accept friend request via the Social UI panel (not toast). */
async function acceptViaSocialUI(page: Page, username: string): Promise<boolean> {
  await openSocialOverlay(page);

  // Click into the FRIENDS tab — the requests list only populates when that
  // panel is active (notifUI.renderFriendsIntoSocial copies innerHTML into
  // the tab's slot, but the listeners live on the primary #friends-requests-list).
  await page.evaluate(() => {
    const friendsTab = document.querySelector('[data-social-tab="friends"]') as HTMLElement | null;
    if (friendsTab) friendsTab.click();
  });

  // Wait for the request row for this username to appear in ANY of the
  // three surfaces the accept helper checks. Poll up to ~5s so the friend
  // request listener has time to deliver the row after the re-add.
  await page.waitForFunction((name) => {
    const hasName = (root: Document | Element, sel: string) =>
      Array.from(root.querySelectorAll(sel)).some(el => el.textContent?.includes(name));
    return hasName(document, '.social-notif-row')
      || hasName(document, '#friends-requests-list .friend-row')
      || hasName(document, '#social-friends-requests-list .friend-row')
      || hasName(document, '#notif-list .notif-row');
  }, username, { timeout: 5_000 }).catch(() => { /* fall through, the evaluate below logs which surface matched */ });

  const accepted = await page.evaluate((name) => {
    // Method 1: Social notification rows
    const notifRows = document.querySelectorAll('.social-notif-row');
    for (const row of notifRows) {
      if (row.textContent?.includes(name) || row.querySelector('.notif-name')?.textContent?.includes(name)) {
        const btn = row.querySelector('[data-social-notif-action="accept"]') as HTMLElement;
        if (btn) { btn.click(); return 'social-notif'; }
      }
    }
    // Method 2: Friends requests section — listeners live on #friends-requests-list
    // (the primary), so prefer that one. Fall back to the social clone otherwise.
    const preferOrder = ['#friends-requests-list .friend-row', '#social-friends-requests-list .friend-row'];
    for (const sel of preferOrder) {
      const reqRows = document.querySelectorAll(sel);
      for (const row of reqRows) {
        if (row.querySelector('.friend-name')?.textContent?.trim() === name) {
          const btn = row.querySelector('.friend-action-btn--accept') as HTMLElement;
          if (btn) { btn.click(); return `friend-request (${sel})`; }
        }
      }
    }
    // Method 3: Notification dropdown rows
    const dropRows = document.querySelectorAll('#notif-list .notif-row');
    for (const row of dropRows) {
      if (row.textContent?.includes(name)) {
        const btn = row.querySelector('.notif-row-btn--accept') as HTMLElement;
        if (btn) { btn.click(); return 'notif-dropdown'; }
      }
    }
    return null;
  }, username);

  if (accepted) {
    console.log(`  Accepted via: ${accepted}`);
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

// ── Test ──────────────────────────────────────────────────

describe('friend lifecycle: add → toast accept → remove → re-add → social accept', () => {
  let browserA: Browser;
  let browserB: Browser;
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let hasFailure = false;

  afterAll(async () => {
    await ctxA?.close().catch(() => {});
    await ctxB?.close().catch(() => {});
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await endTestSession(hasFailure);
  });

  it('full friend add/remove/re-add cycle with two acceptance methods', async () => {
    await startTestSession('friend-lifecycle');

    const vp = VIEWPORTS.desktop;
    browserA = await chromium.launch({ headless: false, args: ['--enable-webgl'] });
    browserB = await chromium.launch({ headless: false, args: ['--enable-webgl'] });
    ctxA = await browserA.newContext({ viewport: { width: vp.width, height: vp.height } });
    ctxB = await browserB.newContext({ viewport: { width: vp.width, height: vp.height } });
    ctxA.setDefaultTimeout(60_000);
    ctxB.setDefaultTimeout(60_000);
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();

    try {
      // ── Step 1: Both accounts sign in ──
      console.log('\n── Step 1: Sign in both accounts ──');

      await Promise.all([
        pageA.goto(BASE_URL, { waitUntil: 'commit', timeout: 30_000 }),
        pageB.goto(BASE_URL, { waitUntil: 'commit', timeout: 30_000 }),
      ]);
      await Promise.all([
        dismissLoadingScreen(pageA),
        dismissLoadingScreen(pageB),
      ]);

      const usernameA = await signIn(pageA, 'host');
      const usernameB = await signIn(pageB, 'guest');
      console.log(`  Account A: ${usernameA}`);
      console.log(`  Account B: ${usernameB}`);
      expect(usernameA).toBeTruthy();
      expect(usernameB).toBeTruthy();

      // ── Step 2: Clean slate — remove each other if already friends ──
      console.log('\n── Step 2: Ensure clean slate ──');

      await openFriendsOverlay(pageA);
      const alreadyFriendsA = await isInFriendList(pageA, TEST_ACCOUNTS.guest.username);
      if (alreadyFriendsA) {
        console.log('  Already friends — removing to start clean...');
        await removeFriend(pageA, TEST_ACCOUNTS.guest.username);
        await pageA.waitForTimeout(2000);
      }
      console.log('  Clean slate confirmed');

      // ── Step 3: Account A sends friend request to Account B ──
      console.log('\n── Step 3: Account A sends friend request ──');

      const sendStatus = await sendFriendRequest(pageA, TEST_ACCOUNTS.guest.username);
      console.log(`  Status: "${sendStatus}"`);

      // EXPECTED: "REQUEST SENT!" or "FRIEND ADDED!" (if reverse request existed)
      const validSend = sendStatus.includes('SENT') || sendStatus.includes('ADDED');
      if (!validSend) {
        hasFailure = true;
        await reportBug({
          testName: 'friend-lifecycle: send request failed',
          error: `Unexpected status after sending request: "${sendStatus}"`,
          expected: '"REQUEST SENT!" or "FRIEND ADDED!"',
          actual: sendStatus,
        });
      }
      expect(validSend, `Send request failed with status: "${sendStatus}"`).toBe(true);

      // ── Step 4: Account B accepts via notification toast ──
      console.log('\n── Step 4: Account B accepts via toast ──');

      const toastAppeared = await waitForFriendRequestToast(pageB, 15_000);

      if (toastAppeared) {
        const accepted = await acceptViaToast(pageB);
        expect(accepted, 'Toast accept button click failed').toBe(true);
        console.log('  Accepted via toast notification');
      } else {
        // Fallback: toast may have auto-dismissed — check notification dropdown
        console.log('  Toast not visible — trying notification dropdown...');
        await pageB.evaluate(() => {
          const btn = document.getElementById('notif-btn');
          if (btn) btn.click();
        });
        await pageB.waitForTimeout(1000);
        const accepted = await acceptViaSocialUI(pageB, TEST_ACCOUNTS.host.username);
        expect(accepted, 'Could not accept friend request via any method').toBe(true);
      }

      // EXPECTED: Both now see each other in friend list
      await pageA.waitForTimeout(2000);
      await pageB.waitForTimeout(2000);
      await openFriendsOverlay(pageA);
      await openFriendsOverlay(pageB);

      const friendA = await isInFriendList(pageA, TEST_ACCOUNTS.guest.username);
      const friendB = await isInFriendList(pageB, TEST_ACCOUNTS.host.username);

      if (!friendA || !friendB) {
        hasFailure = true;
        await reportBug({
          testName: 'friend-lifecycle: friend not in list after accept',
          error: `After accepting, friend not in list. A sees B: ${friendA}, B sees A: ${friendB}`,
          expected: 'Both see each other in friend list',
          actual: `A has B: ${friendA}, B has A: ${friendB}`,
        });
      }
      expect(friendA, 'Account A does not see B in friend list after accept').toBe(true);
      expect(friendB, 'Account B does not see A in friend list after accept').toBe(true);
      console.log(`  A sees B: ${friendA}, B sees A: ${friendB}`);

      // ── Step 5: Account A removes Account B ──
      console.log('\n── Step 5: Account A removes Account B ──');

      const removed = await removeFriend(pageA, TEST_ACCOUNTS.guest.username);
      expect(removed, 'Remove button not found for friend').toBe(true);
      console.log('  Remove clicked');

      // Reload to force Firestore re-fetch — real-time listeners in the
      // emulator can be slow to fire after subcollection deletes.
      await pageA.waitForTimeout(2000);
      await pageA.reload({ waitUntil: 'commit' });
      await dismissLoadingScreen(pageA);
      await pageA.waitForSelector('#menu-buttons', { state: 'visible', timeout: 15_000 });

      // EXPECTED: A no longer sees B in friend list
      await openFriendsOverlay(pageA);
      const stillFriendA = await isInFriendList(pageA, TEST_ACCOUNTS.guest.username);
      if (stillFriendA) {
        hasFailure = true;
        await reportBug({
          testName: 'friend-lifecycle: friend still in list after remove',
          error: 'Account A still sees B in friend list after removal',
          expected: 'B removed from A friend list',
          actual: 'B still visible',
        });
      }
      expect(stillFriendA, 'B still in A friend list after removal').toBe(false);
      console.log(`  A still sees B: ${stillFriendA}`);

      // ── Step 6: Account B re-adds Account A ──
      console.log('\n── Step 6: Account B sends friend request to A ──');

      const resendStatus = await sendFriendRequest(pageB, TEST_ACCOUNTS.host.username);
      console.log(`  Status: "${resendStatus}"`);

      const validResend = resendStatus.includes('SENT') || resendStatus.includes('ADDED');
      if (!validResend) {
        hasFailure = true;
        await reportBug({
          testName: 'friend-lifecycle: re-add request failed',
          error: `Re-add request status: "${resendStatus}"`,
          expected: '"REQUEST SENT!"',
          actual: resendStatus,
        });
      }
      expect(validResend, `Re-add failed: "${resendStatus}"`).toBe(true);

      // ── Step 7: Account A accepts via Social UI (not toast) ──
      console.log('\n── Step 7: Account A accepts via Social UI ──');

      // Wait for the request to arrive
      await pageA.waitForTimeout(3000);

      // Dismiss any toast that may appear (we specifically want to test Social UI acceptance)
      await pageA.evaluate(() => {
        const toasts = document.querySelectorAll('.notif-toast-close');
        toasts.forEach(t => (t as HTMLElement).click());
      });
      await pageA.waitForTimeout(500);

      // Open Social UI and accept from there
      const socialAccepted = await acceptViaSocialUI(pageA, TEST_ACCOUNTS.guest.username);
      if (!socialAccepted) {
        hasFailure = true;
        await reportBug({
          testName: 'friend-lifecycle: Social UI accept failed',
          error: 'Could not find or click accept button in Social UI',
          expected: 'Friend request visible in Social UI with accept button',
          actual: 'No accept button found in social-notif-row, friends-requests-list, or notif-dropdown',
        });
      }
      expect(socialAccepted, 'Could not accept via Social UI').toBe(true);
      console.log('  Accepted via Social UI');

      // ── Step 8: Final validation — both are friends again ──
      console.log('\n── Step 8: Final validation ──');

      await pageA.waitForTimeout(2000);
      await pageB.waitForTimeout(2000);
      await openFriendsOverlay(pageA);
      await openFriendsOverlay(pageB);

      const finalFriendA = await isInFriendList(pageA, TEST_ACCOUNTS.guest.username);
      const finalFriendB = await isInFriendList(pageB, TEST_ACCOUNTS.host.username);

      if (!finalFriendA || !finalFriendB) {
        hasFailure = true;
        await reportBug({
          testName: 'friend-lifecycle: not friends after re-add cycle',
          error: `Final state: A sees B: ${finalFriendA}, B sees A: ${finalFriendB}`,
          expected: 'Both see each other in friend list',
          actual: `A has B: ${finalFriendA}, B has A: ${finalFriendB}`,
        });
      }
      expect(finalFriendA, 'A does not see B after re-add').toBe(true);
      expect(finalFriendB, 'B does not see A after re-add').toBe(true);
      console.log(`  A sees B: ${finalFriendA}, B sees A: ${finalFriendB}`);
      console.log('\n── Friend lifecycle test PASSED ──\n');

    } catch (err) {
      hasFailure = true;
      await pageA?.screenshot({ path: 'test-results/screenshots/friend-lifecycle_A.png' }).catch(() => {});
      await pageB?.screenshot({ path: 'test-results/screenshots/friend-lifecycle_B.png' }).catch(() => {});
      await reportBug({
        testName: 'friend-lifecycle: test execution failure',
        error: String(err),
        expected: 'Full add/remove/re-add cycle completes',
        actual: `Error: ${String(err)}`,
      });
      throw err;
    }
  });
});

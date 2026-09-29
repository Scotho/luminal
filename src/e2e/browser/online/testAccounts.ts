// src/e2e/browser/online/testAccounts.ts
// Test account helpers for online browser tests.

import type { Page } from 'playwright';

/**
 * Dedicated test accounts. Defaults only exist in the Firebase emulator
 * (seeded by scripts/seed.ts / smokeGlobalSetup). To run against a real
 * project, supply your own via LUMINAL_TEST_<ROLE>_EMAIL / _PASSWORD.
 */
function account(role: string, username: string): { email: string; password: string; username: string } {
  const key = role.toUpperCase();
  return {
    email: process.env[`LUMINAL_TEST_${key}_EMAIL`] ?? `${role}@luminal-test.local`,
    password: process.env[`LUMINAL_TEST_${key}_PASSWORD`] ?? 'luminal-emulator-only',
    username,
  };
}

export const TEST_ACCOUNTS = {
  host: account('host', 'TestHost'),
  guest: account('guest', 'TestGuest'),
  spectator: account('spectator', 'TestSpectator'),
} as const;

export type TestRole = keyof typeof TEST_ACCOUNTS;

/**
 * Sign in via the email/password form in the login overlay.
 * Clicks LOG IN to open the overlay, fills credentials, submits,
 * then waits for the auth-username element to update.
 */
export async function signIn(page: Page, role: TestRole = 'host'): Promise<string> {
  const { email, password } = TEST_ACCOUNTS[role];

  // Open login overlay if not already visible
  const loginVisible = await page.evaluate(() =>
    !document.getElementById('login-overlay')?.classList.contains('hidden')
  );
  if (!loginVisible) {
    await page.evaluate(() => {
      const btn = document.getElementById('btn-login');
      if (btn) btn.click();
    });
    await page.waitForSelector('#login-overlay:not(.hidden)', { state: 'visible', timeout: 5_000 });
  }

  // Fill email + password
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);

  // Submit
  await page.click('#btn-signin-submit');

  // Wait for either: username picker (new account), auth success, or error
  const result = await page.waitForFunction(() => {
    // Check for username picker (new account in emulator)
    const usernameForm = document.getElementById('username-form');
    if (usernameForm && !usernameForm.classList.contains('hidden')) {
      return { state: 'username-picker' as const };
    }
    // Check for success: username updated
    const usernameEl = document.getElementById('auth-username');
    const username = usernameEl?.textContent?.trim();
    if (username && username.length > 0 && username !== 'LOG IN' && !username.includes('Anon')) {
      return { state: 'ok' as const, username };
    }
    // Check for error: login-error element visible with text
    const errorEl = document.getElementById('login-error');
    if (errorEl && !errorEl.classList.contains('hidden') && errorEl.textContent?.trim()) {
      return { state: 'error' as const, error: errorEl.textContent.trim() };
    }
    return null; // keep waiting
  }, { timeout: 30_000 });

  const value = await result.jsonValue() as { state: string; username?: string; error?: string };

  if (value.state === 'error') {
    throw new Error(`Sign-in failed for ${email}: ${value.error}`);
  }

  // Handle username picker for new accounts (emulator creates fresh accounts)
  if (value.state === 'username-picker') {
    const { username: desiredName } = TEST_ACCOUNTS[role];
    await page.fill('#sso-username', desiredName);
    await page.click('#btn-username-submit');
    // Wait for auth to fully complete after username selection
    await page.waitForFunction(() => {
      const el = document.getElementById('auth-username');
      const text = el?.textContent?.trim();
      return text && text.length > 0 && text !== 'LOG IN' && !text.includes('Anon');
    }, { timeout: 15_000 });
  }

  return page.evaluate(() =>
    document.getElementById('auth-username')?.textContent?.trim() ?? ''
  );
}

/**
 * Wait for any auth to complete (anonymous or real).
 * The app auto-signs in via signInAnon() on load.
 * We detect completion by waiting for the auth-username element
 * to show a name (anonymous users get "Luminal_Anon_XXXXXX").
 */
export async function waitForAuth(page: Page, timeoutMs = 10_000): Promise<string> {
  await page.waitForFunction(() => {
    const el = document.getElementById('auth-username');
    const text = el?.textContent?.trim();
    return text && text.length > 0 && text !== 'LOG IN';
  }, { timeout: timeoutMs });

  return page.evaluate(() =>
    document.getElementById('auth-username')?.textContent?.trim() ?? ''
  );
}

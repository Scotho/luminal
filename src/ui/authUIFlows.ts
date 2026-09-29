// ── Auth UI Flows ──────────────────────────────────────
// Extracted from authUI.ts — holds all the auth-screen wiring
// (sign-in, sign-up, SSO, phone, reset-password, username picker,
// overlay chrome) plus the shared mutable state and helpers.
//
// Public API is re-exported from ./authUI, which is the canonical
// import site for the rest of the codebase.
import { show, hide, toggleVisible } from './dom';
import {
  onAuthChange, signInWithGoogle, signInWithApple, signInWithGitHub,
  signInWithMicrosoft,
  sendPhoneCode, verifyPhoneCode,
  signInWithEmail, signUpWithEmail, resetPassword,
  sendEmailLink, checkEmailLinkRedirect, setUsernameForUser, signOutUser,
  getUsername, getUserSettings, getCurrentUser, ensureUserIcon, isUsernameTaken,
} from '../auth';
import type { ConfirmationResult, User } from 'firebase/auth';
import { initPresence } from '../presence';
import { backfillLeaderboardIcon } from '../leaderboard';
import { pushNotif, startInviteListener, stopInviteListener } from './notifUI';
import { initSettingsSync, stopSettingsSync } from '../settingsSync';
import { getSettingsSyncEnabled } from './settingsUI';
import { initProgression, clearProgression, flushProgressionState } from '../progression/progressionManager';
import { restoreLoadoutFromFirestore, stopLoadoutSync, resetLoadoutDefaults } from './characterSelectUI';
import { fetchProfile } from '../profile';
import { renderSocialAccountPanel, updateSocialAccountTabVisibility } from './socialUI';
import { updateSubplateUser } from './menuSubplate';
import { updateAccountFlowDisplay } from './accountFlowDisplay';

export interface AuthUIDeps {
  navigateTo: (screen: string) => void;
  navigateReset: (screen: string) => void;
  navigateBack: () => void;
  showScreen: (screen: string) => void;
  getCurrentScreen: () => string;
  setCurrentScreen: (screen: string) => void;
  updateTimeUserLabel: () => void;
  updateOnlineButton: () => void;
  checkLobbyInvite: () => void;
  checkPendingLobby: () => void;
  checkSavedLobby: () => void;
  startFriendsListeners: () => void;
  stopFriendsListeners: () => void;
  updateSubModuleUsers: (uid: string | null, username: string | null, isReal: boolean) => void;
}

// ── Auth state ──────────────────────────────────────────
let currentUsername: string | null = null;
let currentUid: string | null      = null;
let currentIcon: string | null     = null;
let isRealUser: boolean            = false; // false = anonymous or not logged in

// ── Injected callbacks (set via initAuthUI) ─────────────
let _navigateTo: ((screen: string) => void) | null        = null;
let _navigateReset: ((screen: string) => void) | null     = null;
let _navigateBack: (() => void) | null                    = null;
let _showScreen: ((screen: string) => void) | null        = null;
let _setCurrentScreen: ((screen: string) => void) | null  = null;
let _updateTimeUserLabel: (() => void) | null             = null;
let _updateOnlineButton: (() => void) | null              = null;
let _checkLobbyInvite: (() => void) | null                = null;
let _checkPendingLobby: (() => void) | null               = null;
let _checkSavedLobby: (() => void) | null                 = null;
let _startFriendsListeners: (() => void) | null           = null;
let _stopFriendsListeners: (() => void) | null            = null;
let _updateSubModuleUsers: ((uid: string | null, username: string | null, isReal: boolean) => void) | null = null;

// ── Getters ─────────────────────────────────────────────
export function getCurrentUid(): string | null      { return currentUid; }
export function getCurrentUsername(): string | null { return currentUsername; }
export function getCurrentIcon(): string | null     { return currentIcon; }
export function getIsRealUser(): boolean            { return isRealUser; }

// ── Anon name helper ────────────────────────────────────
function getAnonName(): string {
  let name: string | null = localStorage.getItem('luminal-anon-name');
  if (!name) {
    const hex: string = Math.random().toString(16).slice(2, 8).toUpperCase();
    name = `Luminal_Anon_${hex}`;
    localStorage.setItem('luminal-anon-name', name);
  }
  return name;
}

// ── ensureLoggedIn ──────────────────────────────────────
/**
 * Returns true if the user is a real (non-anonymous) signed-in user.
 * If not, navigates to the login screen and returns false.
 */
// ts-prune-ignore-next
export function ensureLoggedIn(): boolean {
  if (isRealUser && currentUid && currentUsername) return true;
  if (_navigateTo) _navigateTo('login');
  return false;
}

// ── Error mapping ──────────────────────────────────────
const FIREBASE_ERROR_MAP: Record<string, string> = {
  'auth/email-already-in-use': 'This email is already registered. Try signing in.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/account-exists-with-different-credential': 'An account with this email already exists. Try a different sign-in method.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/invalid-phone-number': 'Enter a valid phone number with country code (e.g. +1 555 123 4567).',
  'auth/invalid-verification-code': 'Incorrect code. Please try again.',
  'auth/code-expired': 'Code expired. Please request a new one.',
  'auth/quota-exceeded': 'SMS quota exceeded. Please try a different sign-in method.',
};

function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err.code && FIREBASE_ERROR_MAP[err.code]) return FIREBASE_ERROR_MAP[err.code];
  return (e instanceof Error ? e.message : '') || 'Something went wrong. Please try again.';
}

function setLoading(btn: HTMLElement, loading: boolean): void {
  if (loading) {
    // Hide children (icons/text) instead of destroying them
    for (const child of Array.from(btn.childNodes)) {
      if (child instanceof HTMLElement || child instanceof SVGElement) {
        (child as HTMLElement).style.visibility = 'hidden';
      }
    }
    btn.classList.add('auth-btn--loading');
    btn.style.pointerEvents = 'none';
  } else {
    for (const child of Array.from(btn.childNodes)) {
      if (child instanceof HTMLElement || child instanceof SVGElement) {
        (child as HTMLElement).style.visibility = '';
      }
    }
    btn.classList.remove('auth-btn--loading');
    btn.style.pointerEvents = '';
  }
}

// ── Auth sub-screen state ──────────────────────────────
let authSubScreen: 'root' | 'forgot' | 'phone' | 'username' = 'root';
let authMode: 'signin' | 'signup' = 'signin';

function resetAuthState(): void {
  authSubScreen = 'root';
  authMode = 'signin';
  show('login-form');
  hide('username-form');
  show('signin-mode');
  hide('signup-mode');
  hide('forgot-pw-form');
  show('auth-shared-section');
  hide('phone-panel');
  document.querySelectorAll('#login-overlay .auth-error').forEach(el => hide(el as HTMLElement));
  hide('reset-sent-msg');
  hide('email-sent-msg');
  const resetBtn = document.getElementById('btn-send-reset');
  if (resetBtn) resetBtn.style.display = '';
  const emailLinkBtn = document.getElementById('btn-email-link-signin');
  if (emailLinkBtn) emailLinkBtn.style.display = '';
  document.getElementById('login-header-title')!.textContent = 'SIGN IN';
  // Reset sign-in button / passwordless visibility
  hide('btn-signin-submit');
  show('btn-email-link-signin');
}

function showAuthSubScreen(screen: 'root' | 'forgot'): void {
  authSubScreen = screen;
  const signinMode = document.getElementById('signin-mode')!;
  const signupMode = document.getElementById('signup-mode')!;
  const forgotForm = document.getElementById('forgot-pw-form')!;
  const sharedSection = document.getElementById('auth-shared-section')!;

  if (screen === 'root') {
    // Return to the current auth mode (signin or signup)
    const currentModeEl = authMode === 'signin' ? signinMode : signupMode;
    const title = authMode === 'signin' ? 'SIGN IN' : 'CREATE';
    hide(forgotForm);
    show(sharedSection);
    crossfadeModes(forgotForm, currentModeEl, title);
    sharedSection.style.opacity = '0';
    sharedSection.style.transition = 'opacity 0.15s ease';
    setTimeout(() => {
      sharedSection.style.opacity = '1';
      setTimeout(() => { sharedSection.style.transition = ''; sharedSection.style.opacity = ''; }, 150);
    }, 150);
  } else if (screen === 'forgot') {
    // Pre-fill with the email from the sign-in field
    const loginEmail = (document.getElementById('login-email') as HTMLInputElement).value.trim();
    if (loginEmail) (document.getElementById('forgot-pw-email') as HTMLInputElement).value = loginEmail;
    // Reset forgot-pw state
    hide('reset-sent-msg');
    hide('forgot-pw-error');
    const resetBtn = document.getElementById('btn-send-reset');
    if (resetBtn) resetBtn.style.display = '';
    // Hide current mode and shared section
    const currentModeEl = authMode === 'signin' ? signinMode : signupMode;
    sharedSection.style.opacity = '1';
    sharedSection.style.transition = 'opacity 0.15s ease';
    sharedSection.style.opacity = '0';
    setTimeout(() => {
      hide(sharedSection);
      sharedSection.style.transition = '';
      sharedSection.style.opacity = '';
    }, 150);
    crossfadeModes(currentModeEl, forgotForm, 'RESET');
  }
}

export function getLoginExitHook(): () => void {
  return resetAuthState;
}

function showError(errorEl: HTMLElement, message: string): void {
  const span = errorEl.querySelector('span');
  if (span) {
    span.textContent = message;
  } else {
    // Fallback: append text without destroying existing children (e.g. SVG icon)
    const textNode = errorEl.lastChild?.nodeType === Node.TEXT_NODE
      ? errorEl.lastChild
      : errorEl.appendChild(document.createTextNode(''));
    textNode.textContent = message;
  }
  show(errorEl);
  // Trigger glitch-shake
  const form = errorEl.closest('.auth-form') as HTMLElement || document.getElementById('login-form')!;
  form.classList.remove('auth-form--error');
  void form.offsetWidth;
  form.classList.add('auth-form--error');
  form.addEventListener('animationend', () => form.classList.remove('auth-form--error'), { once: true });
}

function playSuccessStreak(callback: () => void): void {
  const content = document.querySelector('#login-overlay .content') as HTMLElement | null;
  if (content) {
    content.classList.add('auth-success');
    setTimeout(() => {
      content.classList.remove('auth-success');
      callback();
    }, 400);
  } else {
    callback();
  }
}

function crossfadeModes(outEl: HTMLElement, inEl: HTMLElement, newTitle: string): void {
  outEl.style.opacity = '1';
  outEl.style.transition = 'opacity 0.15s ease';
  outEl.style.opacity = '0';
  setTimeout(() => {
    hide(outEl);
    outEl.style.transition = '';
    outEl.style.opacity = '';
    document.getElementById('login-header-title')!.textContent = newTitle;
    show(inEl);
    inEl.style.opacity = '0';
    inEl.style.transition = 'opacity 0.15s ease';
    requestAnimationFrame(() => { inEl.style.opacity = '1'; });
    setTimeout(() => { inEl.style.transition = ''; inEl.style.opacity = ''; }, 150);
  }, 150);
}

async function handleSSOSignIn(
  signInFn: () => Promise<{ user: User; needsUsername: boolean }>,
  btn: HTMLElement,
  errorEl: HTMLElement,
): Promise<void> {
  hide(errorEl);
  setLoading(btn, true);
  try {
    const { needsUsername } = await signInFn();
    if (needsUsername) {
      hide('login-form');
      show('username-form');
      document.getElementById('login-header-title')!.textContent = 'USERNAME';
    } else {
      playSuccessStreak(() => {
        _navigateReset!('main');
        setTimeout(() => { if (_updateOnlineButton) _updateOnlineButton(); }, 100);
      });
    }
  } catch (e: unknown) {
    const err = e as { code?: string };
    const silentCodes = [
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/popup-blocked',
      'auth/user-cancelled',
    ];
    if (!silentCodes.includes(err.code || '')) {
      showError(errorEl, friendlyError(e));
    }
  } finally {
    setLoading(btn, false);
  }
}

// ── Init ────────────────────────────────────────────────
/**
 * Wire up auth observer and login / sign-out form handlers.
 * Caches the dep callbacks once, then delegates each auth flow
 * to a dedicated wire* helper. Event-handler registration order
 * matches the pre-refactor order.
 */
export function initAuthUI(deps: AuthUIDeps): void {
  _navigateTo           = deps.navigateTo;
  _navigateReset        = deps.navigateReset;
  _navigateBack         = deps.navigateBack;
  _showScreen           = deps.showScreen;
  _setCurrentScreen     = deps.setCurrentScreen;
  _updateTimeUserLabel  = deps.updateTimeUserLabel;
  _updateOnlineButton   = deps.updateOnlineButton;
  _checkLobbyInvite     = deps.checkLobbyInvite;
  _checkPendingLobby    = deps.checkPendingLobby;
  _checkSavedLobby      = deps.checkSavedLobby;
  _startFriendsListeners = deps.startFriendsListeners;
  _stopFriendsListeners  = deps.stopFriendsListeners;
  _updateSubModuleUsers  = deps.updateSubModuleUsers;

  wireAuthObserver();
  wireSignIn();
  wireSignUp();
  wireResetPassword();
  wireSSO();
  wirePhoneAuth();
  wireUsernamePicker();
  wireAuthChrome();
}

// ── Auth observer (anonymous/logged-in state transitions) ──
function wireAuthObserver(): void {
  onAuthChange(async (user: User | null) => {
    const loginBtn: HTMLElement   = document.getElementById('btn-login')!;
    const usernameEl: HTMLElement = document.getElementById('auth-username')!;
    const chatInput: HTMLInputElement  = document.getElementById('chat-input') as HTMLInputElement;

    if (user && !user.isAnonymous) {
      currentUid  = user.uid;
      isRealUser  = true;
      const username: string | null = await getUsername(user.uid);
      currentUsername = username;
      // Fetch or backfill early-adopter icon
      const iconResult = await ensureUserIcon(user.uid);
      currentIcon = iconResult.icon;
      if (currentIcon) backfillLeaderboardIcon(user.uid, currentIcon);
      if (iconResult.awarded) {
        pushNotif({ id: `icon-award-${Date.now()}`, type: 'info', message: 'You were awarded the Early Adopter icon!', createdAt: Date.now() });
      }

      if (_updateTimeUserLabel) _updateTimeUserLabel();

      if (username) {
        usernameEl.textContent = username;
        updateSubplateUser(username, 0, null);
        show('user-menu-wrap');
        hide(loginBtn);
        pushNotif({ id: `signin-${Date.now()}`, type: 'info', message: `Signed in as ${username}`, createdAt: Date.now() });
        chatInput.disabled = false;
        chatInput.placeholder = 'Type a message...';
        document.getElementById('chat-input-row')!.removeAttribute('data-tip');
        document.getElementById('btn-chat-send')!.classList.remove('btn-chat-send--disabled');
        (document.getElementById('match-chat-input') as HTMLInputElement).disabled = false;
        (document.getElementById('match-chat-input') as HTMLInputElement).placeholder = 'Match chat...';
        document.getElementById('btn-match-chat-send')!.classList.remove('btn-chat-send--disabled');
        if (_updateSubModuleUsers) _updateSubModuleUsers(currentUid, currentUsername, isRealUser);
        updateSocialAccountTabVisibility(isRealUser);
        // Fetch + render account panel on every sign-in transition.
        fetchProfile(user.uid)
          .then((profile) => {
            renderSocialAccountPanel(profile);
            updateSubplateUser(username, profile?.bankedFlow ?? 0, null);
            updateAccountFlowDisplay(profile?.bankedFlow ?? 0, profile?.lifetimeFlow ?? 0);
          })
          .catch(() => renderSocialAccountPanel(null));
        if (_updateOnlineButton)   _updateOnlineButton();
        if (_checkLobbyInvite)     _checkLobbyInvite();
        if (_checkPendingLobby)    _checkPendingLobby();
        if (_checkSavedLobby)      _checkSavedLobby();
        if (_startFriendsListeners) _startFriendsListeners();
        startInviteListener(user.uid);
        // Settings sync — only for logged-in users when enabled
        if (getSettingsSyncEnabled()) {
          const cached = await getUserSettings(user.uid);
          initSettingsSync(user.uid, cached);
        }
        // Progression — clear stale state, load fresh from Firestore
        clearProgression();
        initProgression(user.uid);
        restoreLoadoutFromFirestore(user.uid);
      } else {
        // SSO user without username — show username picker
        hide('user-menu-wrap');
        hide(loginBtn);
      }
    } else {
      // Anonymous or not logged in
      resetAuthState();
      if (_stopFriendsListeners) _stopFriendsListeners();
      stopInviteListener();
      stopSettingsSync();
      flushProgressionState();
      clearProgression();
      stopLoadoutSync();
      resetLoadoutDefaults();
      currentUid  = user ? user.uid : null;
      isRealUser  = false;
      currentIcon = null;
      const anonName: string = getAnonName();
      currentUsername = anonName;

      if (_updateTimeUserLabel) _updateTimeUserLabel();
      usernameEl.textContent = anonName;
      hide('user-menu-wrap');
      show(loginBtn);
      chatInput.disabled = true;
      chatInput.placeholder = 'Log in to chat...';
      document.getElementById('chat-input-row')!.setAttribute('data-tip', 'Sign in to use chat');
      document.getElementById('btn-chat-send')!.classList.add('btn-chat-send--disabled');
      (document.getElementById('match-chat-input') as HTMLInputElement).disabled = true;
      (document.getElementById('match-chat-input') as HTMLInputElement).placeholder = 'Sign in to chat...';
      document.getElementById('btn-match-chat-send')!.classList.add('btn-chat-send--disabled');
      if (_updateOnlineButton) _updateOnlineButton();
      if (_updateSubModuleUsers) _updateSubModuleUsers(currentUid, currentUsername, isRealUser);
      // Clear + hide the account tab on sign-out / anonymous transitions.
      renderSocialAccountPanel(null);
      updateSocialAccountTabVisibility(false);
      updateSubplateUser(null, null, null);
    }
  });
}

// ── Sign-in flow (login/signout buttons, mode toggle, email/password sign-in) ──
function wireSignIn(): void {
  // Login button
  document.getElementById('btn-login')!.addEventListener('click', () => _navigateTo!('login'));

  // Sign out
  document.getElementById('btn-signout')!.addEventListener('click', async () => {
    await signOutUser();
    initPresence();
  });

  // Sign-in / Sign-up mode toggle
  document.getElementById('btn-show-signup')!.addEventListener('click', () => {
    authMode = 'signup';
    crossfadeModes(
      document.getElementById('signin-mode')!,
      document.getElementById('signup-mode')!,
      'CREATE',
    );
  });
  document.getElementById('btn-show-signin')!.addEventListener('click', () => {
    authMode = 'signin';
    crossfadeModes(
      document.getElementById('signup-mode')!,
      document.getElementById('signin-mode')!,
      'SIGN IN',
    );
  });

  // Email / Password sign-in
  document.getElementById('btn-signin-submit')!.addEventListener('click', async () => {
    const email: string = (document.getElementById('login-email') as HTMLInputElement).value.trim();
    const password: string = (document.getElementById('login-password') as HTMLInputElement).value;
    const errorEl: HTMLElement = document.getElementById('login-error')!;
    hide(errorEl);

    if (!email || !password) {
      showError(errorEl, 'Enter your email and password');
      return;
    }

    const btn = document.getElementById('btn-signin-submit')!;
    setLoading(btn, true);
    try {
      const { needsUsername } = await signInWithEmail(email, password);
      if (needsUsername) {
        hide('login-form');
        show('username-form');
        document.getElementById('login-header-title')!.textContent = 'USERNAME';
      } else {
        playSuccessStreak(() => {
          _navigateReset!('main');
          setTimeout(() => { if (_updateOnlineButton) _updateOnlineButton(); }, 100);
        });
      }
    } catch (e: unknown) {
      showError(errorEl, friendlyError(e));
    } finally {
      setLoading(btn, false);
    }
  });
}

// ── Sign-up flow (email/password sign-up + debounced username validation) ──
function wireSignUp(): void {
  // Email / Password sign-up
  document.getElementById('btn-signup-submit')!.addEventListener('click', async () => {
    const username: string = (document.getElementById('signup-username') as HTMLInputElement).value.trim();
    const email: string = (document.getElementById('signup-email') as HTMLInputElement).value.trim();
    const password: string = (document.getElementById('signup-password') as HTMLInputElement).value;
    const errorEl: HTMLElement = document.getElementById('signup-error')!;
    hide(errorEl);

    if (!username || !email || !password) {
      showError(errorEl, 'All fields are required');
      return;
    }
    const consent = (document.getElementById('signup-consent') as HTMLInputElement).checked;
    if (!consent) {
      showError(errorEl, 'You must agree to the Privacy Policy and Terms of Service');
      return;
    }

    const btn = document.getElementById('btn-signup-submit')!;
    setLoading(btn, true);
    try {
      const { user: newUser } = await signUpWithEmail(email, password, username);
      // onAuthChange fires during createUser before username exists — fix up manually
      currentUsername = username;
      currentUid = newUser.uid;
      isRealUser = true;
      document.getElementById('auth-username')!.textContent = username;
      show('user-menu-wrap');
      hide(document.getElementById('btn-login')!);
      if (_updateTimeUserLabel) _updateTimeUserLabel();
      const chatInput = document.getElementById('chat-input') as HTMLInputElement;
      chatInput.disabled = false;
      chatInput.placeholder = 'Type a message...';
      document.getElementById('chat-input-row')!.removeAttribute('data-tip');
      document.getElementById('btn-chat-send')!.classList.remove('btn-chat-send--disabled');
      (document.getElementById('match-chat-input') as HTMLInputElement).disabled = false;
      (document.getElementById('match-chat-input') as HTMLInputElement).placeholder = 'Match chat...';
      document.getElementById('btn-match-chat-send')!.classList.remove('btn-chat-send--disabled');
      if (_updateSubModuleUsers) _updateSubModuleUsers(currentUid, currentUsername, isRealUser);
      if (_startFriendsListeners) _startFriendsListeners();
      startInviteListener(newUser.uid);
      if (getSettingsSyncEnabled()) {
        const cached = await getUserSettings(newUser.uid);
        initSettingsSync(newUser.uid, cached);
      }
      pushNotif({ id: `account-created-${Date.now()}`, type: 'info', message: `Account created! Signed in as ${username}`, createdAt: Date.now() });
      playSuccessStreak(() => {
        _navigateReset!('main');
        setTimeout(() => { if (_updateOnlineButton) _updateOnlineButton(); }, 100);
      });
    } catch (e: unknown) {
      showError(errorEl, friendlyError(e));
    } finally {
      setLoading(btn, false);
    }
  });

  // Debounced username validation
  let usernameTimer: ReturnType<typeof setTimeout> | null = null;
  document.getElementById('signup-username')!.addEventListener('input', () => {
    if (usernameTimer) clearTimeout(usernameTimer);
    const input = (document.getElementById('signup-username') as HTMLInputElement).value.trim();
    const statusEl = document.getElementById('username-status')!;
    const submitBtn = document.getElementById('btn-signup-submit')!;

    if (!input) { hide(statusEl); submitBtn.style.pointerEvents = ''; return; }

    if (input.length < 3 || input.length > 20) {
      statusEl.textContent = '3-20 characters required';
      statusEl.className = 'auth-username-status auth-username-status--invalid';
      submitBtn.style.pointerEvents = 'none';
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
      statusEl.textContent = 'Letters, numbers, _ and - only';
      statusEl.className = 'auth-username-status auth-username-status--invalid';
      submitBtn.style.pointerEvents = 'none';
      return;
    }

    statusEl.textContent = 'Checking...';
    statusEl.className = 'auth-username-status';
    usernameTimer = setTimeout(async () => {
      try {
        const taken = await isUsernameTaken(input);
        // Re-check input hasn't changed during async
        const current = (document.getElementById('signup-username') as HTMLInputElement).value.trim();
        if (current !== input) return;
        if (taken) {
          statusEl.textContent = 'Taken';
          statusEl.className = 'auth-username-status auth-username-status--taken';
          submitBtn.style.pointerEvents = 'none';
        } else {
          statusEl.textContent = 'Available';
          statusEl.className = 'auth-username-status auth-username-status--available';
          submitBtn.style.pointerEvents = '';
        }
      } catch {
        hide(statusEl);
        submitBtn.style.pointerEvents = '';
      }
    }, 300);
  });
}

// ── Reset password + email link (passwordless) flow ──
function wireResetPassword(): void {
  // Forgot password
  document.getElementById('btn-forgot-password')!.addEventListener('click', () => {
    showAuthSubScreen('forgot');
  });

  // Forgot password back button
  document.getElementById('btn-forgot-back')!.addEventListener('click', () => {
    showAuthSubScreen('root');
  });

  document.getElementById('btn-send-reset')!.addEventListener('click', async () => {
    const email: string = (document.getElementById('forgot-pw-email') as HTMLInputElement).value.trim();
    const errorEl: HTMLElement = document.getElementById('forgot-pw-error')!;
    hide(errorEl);

    if (!email) { showError(errorEl, 'Enter your email'); return; }

    const btn = document.getElementById('btn-send-reset')!;
    setLoading(btn, true);
    try {
      await resetPassword(email);
      show('reset-sent-msg');
      btn.style.display = 'none';
    } catch (e: unknown) {
      showError(errorEl, friendlyError(e));
    } finally {
      setLoading(btn, false);
    }
  });

  // Email link (passwordless) — demoted
  document.getElementById('btn-email-link-signin')!.addEventListener('click', async () => {
    const emailField = authMode === 'signup' ? 'signup-email' : 'login-email';
    const email: string = (document.getElementById(emailField) as HTMLInputElement).value.trim();
    const errorEl: HTMLElement = document.getElementById('login-error')!;
    hide(errorEl);

    if (!email) { showError(errorEl, 'Enter your email above first'); return; }

    try {
      await sendEmailLink(email);
      show('email-sent-msg');
      document.getElementById('btn-email-link-signin')!.style.display = 'none';
    } catch (e: unknown) {
      showError(errorEl, friendlyError(e));
    }
  });
}

// ── SSO buttons (Google / Apple / GitHub / Microsoft) ──
function wireSSO(): void {
  // Google SSO
  document.getElementById('btn-google-sso')!.addEventListener('click', function (this: HTMLElement) {
    handleSSOSignIn(signInWithGoogle, this, document.getElementById('login-error')!);
  });

  // Apple SSO
  document.getElementById('btn-apple-sso')!.addEventListener('click', function (this: HTMLElement) {
    if (this.classList.contains('auth-oauth-btn--disabled')) return;
    handleSSOSignIn(signInWithApple, this, document.getElementById('login-error')!);
  });

  // GitHub SSO
  document.getElementById('btn-github-sso')!.addEventListener('click', function (this: HTMLElement) {
    handleSSOSignIn(signInWithGitHub, this, document.getElementById('login-error')!);
  });

  // Microsoft SSO
  document.getElementById('btn-microsoft-sso')!.addEventListener('click', function (this: HTMLElement) {
    handleSSOSignIn(signInWithMicrosoft, this, document.getElementById('login-error')!);
  });
}

// ── Phone auth (send code + verify) ──
function wirePhoneAuth(): void {
  let phoneConfirmation: ConfirmationResult | null = null;
  const phonePanel = document.getElementById('phone-panel')!;
  const phoneInputState = document.getElementById('phone-input-state')!;
  const phoneCodeState = document.getElementById('phone-code-state')!;
  const phoneError = document.getElementById('phone-error')!;

  function showPhonePanel(): void {
    show(phonePanel);
    show(phoneInputState);
    hide(phoneCodeState);
    hide(phoneError);
    phoneConfirmation = null;
    (document.getElementById('phone-number') as HTMLInputElement).value = '';
    (document.getElementById('phone-code') as HTMLInputElement).value = '';
  }

  function hidePhonePanel(): void {
    hide(phonePanel);
    phoneConfirmation = null;
  }

  // Toggle phone panel on button click
  document.getElementById('btn-phone-sso')!.addEventListener('click', () => {
    if (phonePanel.classList.contains('hidden')) { showPhonePanel(); } else { hidePhonePanel(); }
  });

  // Send code
  document.getElementById('btn-send-code')!.addEventListener('click', async () => {
    const phone = (document.getElementById('phone-number') as HTMLInputElement).value.trim();
    hide(phoneError);
    if (!phone) { showError(phoneError, 'Enter your phone number'); return; }

    const btn = document.getElementById('btn-send-code')!;
    setLoading(btn, true);
    try {
      phoneConfirmation = await sendPhoneCode(phone);
      hide(phoneInputState);
      show(phoneCodeState);
      (document.getElementById('phone-code') as HTMLInputElement).focus();
    } catch (e: unknown) {
      showError(phoneError, friendlyError(e));
    } finally {
      setLoading(btn, false);
    }
  });

  // Verify code
  document.getElementById('btn-verify-code')!.addEventListener('click', async () => {
    const code = (document.getElementById('phone-code') as HTMLInputElement).value.trim();
    hide(phoneError);
    if (!code || !phoneConfirmation) { showError(phoneError, 'Enter the 6-digit code'); return; }

    const btn = document.getElementById('btn-verify-code')!;
    setLoading(btn, true);
    try {
      const { needsUsername } = await verifyPhoneCode(phoneConfirmation, code);
      hidePhonePanel();
      if (needsUsername) {
        hide('login-form');
        show('username-form');
        document.getElementById('login-header-title')!.textContent = 'USERNAME';
      } else {
        playSuccessStreak(() => {
          _navigateReset!('main');
          setTimeout(() => { if (_updateOnlineButton) _updateOnlineButton(); }, 100);
        });
      }
    } catch (e: unknown) {
      showError(phoneError, friendlyError(e));
    } finally {
      setLoading(btn, false);
    }
  });

  // Enter key in phone inputs
  document.getElementById('phone-number')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') document.getElementById('btn-send-code')!.click();
  });
  document.getElementById('phone-code')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') document.getElementById('btn-verify-code')!.click();
  });
}

// ── Username picker (after SSO or email link for new users) ──
function wireUsernamePicker(): void {
  document.getElementById('btn-username-submit')!.addEventListener('click', async () => {
    const username: string = (document.getElementById('sso-username') as HTMLInputElement).value.trim();
    const errorEl: HTMLElement  = document.getElementById('username-error')!;
    hide(errorEl);

    const user: User | null = getCurrentUser();
    if (!user) return;

    try {
      await setUsernameForUser(user.uid, user.email || '', username);
      const uname: string | null = await getUsername(user.uid);
      currentUsername = uname;
      if (_updateTimeUserLabel) _updateTimeUserLabel();
      document.getElementById('auth-username')!.textContent = uname;
      show('user-menu-wrap');
      (document.getElementById('chat-input') as HTMLInputElement).disabled = false;
      (document.getElementById('chat-input') as HTMLInputElement).placeholder = 'Type a message...';
      document.getElementById('btn-chat-send')!.classList.remove('btn-chat-send--disabled');
      isRealUser = true;
      // Enable match chat
      (document.getElementById('match-chat-input') as HTMLInputElement).disabled = false;
      (document.getElementById('match-chat-input') as HTMLInputElement).placeholder = 'Match chat...';
      document.getElementById('btn-match-chat-send')!.classList.remove('btn-chat-send--disabled');
      document.getElementById('chat-input-row')!.removeAttribute('data-tip');
      // Start listeners and sub-module updates
      if (_updateSubModuleUsers) _updateSubModuleUsers(currentUid, currentUsername, isRealUser);
      if (_startFriendsListeners) _startFriendsListeners();
      startInviteListener(user.uid);
      if (_checkLobbyInvite)   _checkLobbyInvite();
      if (_checkPendingLobby)  _checkPendingLobby();
      if (_checkSavedLobby)    _checkSavedLobby();
      if (getSettingsSyncEnabled()) {
        const cached = await getUserSettings(user.uid);
        initSettingsSync(user.uid, cached);
      }
      pushNotif({ id: `account-created-${Date.now()}`, type: 'info', message: `Account created! Signed in as ${uname}`, createdAt: Date.now() });
      playSuccessStreak(() => {
        _navigateReset!('main');
        if (_updateOnlineButton) _updateOnlineButton();
      });
    } catch (e: unknown) {
      showError(errorEl, (e instanceof Error ? e.message : '') || 'Failed to set username');
    }
  });
}

// ── Auth overlay chrome (pw toggle, enter keys, close, escape, visibility, trace, redirect) ──
function wireAuthChrome(): void {
  // Password show/hide toggle
  for (const [toggleId, inputId] of [['pw-toggle-signin', 'login-password'], ['pw-toggle-signup', 'signup-password']]) {
    document.getElementById(toggleId)!.addEventListener('click', () => {
      const input = document.getElementById(inputId) as HTMLInputElement;
      const icon = document.getElementById(toggleId)!.querySelector('use')!;
      if (input.type === 'password') {
        input.type = 'text';
        icon.setAttribute('href', '/icons.svg#i-eye-off');
      } else {
        input.type = 'password';
        icon.setAttribute('href', '/icons.svg#i-eye');
      }
    });
  }

  // Enter key in login inputs
  document.getElementById('login-password')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') document.getElementById('btn-signin-submit')!.click();
  });
  document.getElementById('login-email')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') document.getElementById('btn-signin-submit')!.click();
  });
  document.getElementById('signup-password')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') document.getElementById('btn-signup-submit')!.click();
  });
  document.getElementById('sso-username')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') document.getElementById('btn-username-submit')!.click();
  });

  // Close button
  document.querySelector('#login-overlay .auth-close')!.addEventListener('click', () => {
    resetAuthState();
    if (_navigateBack) _navigateBack();
    else if (_navigateReset) _navigateReset('main');
  });

  // Escape key
  document.getElementById('login-overlay')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      (document.querySelector('#login-overlay .auth-close') as HTMLElement)?.click();
    }
  });

  // Error auto-dismiss on input
  document.querySelectorAll('#login-overlay .auth-input').forEach(input => {
    input.addEventListener('input', () => {
      const container = input.closest('.auth-form, .auth-subscreen, .auth-phone-panel');
      container?.querySelectorAll('.auth-error').forEach(err => hide(err as HTMLElement));
    });
  });

  // Sign-in button + passwordless link visibility.
  // Show SIGN IN only when both email and password are filled.
  // Show passwordless link only when email is empty.
  const _loginEmail = document.getElementById('login-email') as HTMLInputElement;
  const _loginPassword = document.getElementById('login-password') as HTMLInputElement;
  const _signinBtn = document.getElementById('btn-signin-submit')!;
  const _emailLinkBtn = document.getElementById('btn-email-link-signin')!;

  function updateSigninVisibility(): void {
    const hasEmail = _loginEmail.value.trim().length > 0;
    const hasPassword = _loginPassword.value.length > 0;
    toggleVisible(_signinBtn, hasEmail && hasPassword);
    toggleVisible(_emailLinkBtn, !(hasEmail && hasPassword));
  }
  _loginEmail.addEventListener('input', updateSigninVisibility);
  _loginPassword.addEventListener('input', updateSigninVisibility);

  // Neon border trace trigger
  const traceSvg = document.querySelector('#login-overlay .auth-border-trace') as SVGElement | null;
  if (traceSvg) {
    const observer = new MutationObserver(() => {
      const overlay = document.getElementById('login-overlay')!;
      if (!overlay.classList.contains('hidden')) {
        if (!sessionStorage.getItem('luminal-auth-trace-played')) {
          sessionStorage.setItem('luminal-auth-trace-played', '1');
          const rect = traceSvg.querySelector('rect')!;
          const content = document.querySelector('#login-overlay .content') as HTMLElement;
          if (content) {
            const w = content.offsetWidth;
            const h = content.offsetHeight;
            const perimeter = 2 * (w + h);
            (rect as SVGElement).style.setProperty('--border-len', String(perimeter));
            rect.setAttribute('stroke-dasharray', String(perimeter));
            rect.setAttribute('stroke-dashoffset', String(perimeter));
          }
          traceSvg.classList.add('auth-border-trace--active');
          const form = document.getElementById('login-form') as HTMLElement;
          if (form) {
            form.style.opacity = '0';
            form.style.transition = 'opacity 0.3s ease 0.3s';
            requestAnimationFrame(() => { form.style.opacity = '1'; });
            setTimeout(() => { form.style.transition = ''; form.style.opacity = ''; }, 700);
          }
        }
      }
    });
    observer.observe(document.getElementById('login-overlay')!, { attributes: true, attributeFilter: ['class'] });
  }

  // Check for email link redirect on page load
  (async () => {
    const result: Promise<{ user: User; needsUsername: boolean }> | null = checkEmailLinkRedirect();
    if (result) {
      const { needsUsername }: { user: User; needsUsername: boolean } = await result;
      if (needsUsername) {
        if (_showScreen) _showScreen('login');
        hide('login-form');
        show('username-form');
        document.getElementById('login-header-title')!.textContent = 'USERNAME';
        if (_setCurrentScreen) _setCurrentScreen('login');
      }
    }
  })();
}

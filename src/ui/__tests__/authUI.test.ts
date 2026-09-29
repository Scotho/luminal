// ── Auth UI Tests ───────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../auth', () => ({
  onAuthChange: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithApple: vi.fn(),
  signInWithGitHub: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  signInWithFacebook: vi.fn(),
  sendPhoneCode: vi.fn(),
  verifyPhoneCode: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  resetPassword: vi.fn(),
  sendEmailLink: vi.fn(),
  checkEmailLinkRedirect: vi.fn(() => false),
  setUsernameForUser: vi.fn(),
  signOutUser: vi.fn(),
  getUsername: vi.fn(() => Promise.resolve(null)),
  getUserSettings: vi.fn(() => Promise.resolve(null)),
  getCurrentUser: vi.fn(() => null),
  ensureUserIcon: vi.fn(() => Promise.resolve({ icon: null, awarded: false })),
  isUsernameTaken: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('../../presence', () => ({
  initPresence: vi.fn(),
}));
vi.mock('../../leaderboard', () => ({
  backfillLeaderboardIcon: vi.fn(),
}));
vi.mock('../notifUI', () => ({
  pushNotif: vi.fn(),
  startInviteListener: vi.fn(),
  stopInviteListener: vi.fn(),
}));
vi.mock('../../settingsSync', () => ({
  initSettingsSync: vi.fn(),
  stopSettingsSync: vi.fn(),
}));
vi.mock('../settingsUI', () => ({
  getSettingsSyncEnabled: vi.fn(() => false),
}));

import { initAuthUI, getCurrentUid, getCurrentUsername, getIsRealUser, ensureLoggedIn, getLoginExitHook } from '../authUI';

describe('Auth UI', () => {
  const mockDeps = {
    navigateTo: vi.fn(),
    navigateReset: vi.fn(),
    navigateBack: vi.fn(),
    showScreen: vi.fn(),
    getCurrentScreen: vi.fn(() => 'main'),
    setCurrentScreen: vi.fn(),
    updateTimeUserLabel: vi.fn(),
    updateOnlineButton: vi.fn(),
    checkLobbyInvite: vi.fn(),
    checkPendingLobby: vi.fn(),
    checkSavedLobby: vi.fn(),
    startFriendsListeners: vi.fn(),
    stopFriendsListeners: vi.fn(),
    updateSubModuleUsers: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('initializes without errors', () => {
      expect(() => initAuthUI(mockDeps)).not.toThrow();
    });
  });

  describe('exports', () => {
    it('exports getLoginExitHook', () => {
      expect(typeof getLoginExitHook).toBe('function');
    });

    it('getLoginExitHook returns a function', () => {
      const hook = getLoginExitHook();
      expect(typeof hook).toBe('function');
    });
  });

  describe('initial state', () => {
    it('currentUid starts as null', () => {
      expect(getCurrentUid()).toBeNull();
    });

    it('currentUsername starts as null', () => {
      expect(getCurrentUsername()).toBeNull();
    });

    it('isRealUser starts as false', () => {
      expect(getIsRealUser()).toBe(false);
    });
  });

  describe('ensureLoggedIn', () => {
    it('returns false when not logged in and navigates to login', () => {
      initAuthUI(mockDeps);
      const result = ensureLoggedIn();
      expect(result).toBe(false);
      expect(mockDeps.navigateTo).toHaveBeenCalledWith('login');
    });
  });

  describe('login overlay DOM', () => {
    it('#login-overlay exists', () => {
      expect(document.getElementById('login-overlay')).toBeTruthy();
    });

    it('has .auth-close button with aria-label', () => {
      const closeBtn = document.querySelector('#login-overlay .auth-close') as HTMLElement;
      expect(closeBtn).toBeTruthy();
      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
    });

    it('has .auth-border-trace SVG', () => {
      const trace = document.querySelector('#login-overlay .auth-border-trace') as SVGElement;
      expect(trace).toBeTruthy();
      expect(trace.tagName.toLowerCase()).toBe('svg');
    });

    it('has email input wrapped in .auth-input-group', () => {
      const input = document.getElementById('login-email') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.type).toBe('email');
      expect(input.placeholder).toBe('EMAIL');
      const group = input.closest('.auth-input-group');
      expect(group).toBeTruthy();
      expect(group!.querySelector('.auth-input-icon')).toBeTruthy();
    });

    it('has password input wrapped in .auth-input-group', () => {
      const input = document.getElementById('login-password') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.type).toBe('password');
      const group = input.closest('.auth-input-group');
      expect(group).toBeTruthy();
      expect(group!.querySelector('.auth-input-icon')).toBeTruthy();
    });

    it('has sign-in button', () => {
      const btn = document.getElementById('btn-signin-submit')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('SIGN IN');
    });

    it('has email link button with auth-link--demoted class', () => {
      const btn = document.getElementById('btn-email-link-signin')!;
      expect(btn).toBeTruthy();
      expect(btn.classList.contains('auth-link--demoted')).toBe(true);
    });

    it('has a single deduplicated SSO row with 5 buttons', () => {
      const rows = document.querySelectorAll('#login-overlay .auth-oauth-row');
      expect(rows.length).toBe(1);
      const buttons = rows[0].querySelectorAll('.auth-oauth-btn');
      expect(buttons.length).toBe(5);
    });

    it('SSO buttons have aria-label attributes', () => {
      const ssoButtons = document.querySelectorAll('#login-overlay .auth-oauth-btn');
      ssoButtons.forEach(btn => {
        expect(btn.getAttribute('aria-label')).toBeTruthy();
      });
    });

    it('SSO buttons are <button> elements', () => {
      const ssoButtons = document.querySelectorAll('#login-overlay .auth-oauth-btn');
      ssoButtons.forEach(btn => {
        expect(btn.tagName.toLowerCase()).toBe('button');
      });
    });

    it('has Google SSO button', () => {
      const btn = document.getElementById('btn-google-sso')!;
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-label')).toContain('Google');
    });

    it('has Apple SSO button', () => {
      const btn = document.getElementById('btn-apple-sso')!;
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-label')).toContain('Apple');
    });

    it('has GitHub SSO button', () => {
      const btn = document.getElementById('btn-github-sso')!;
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-label')).toContain('GitHub');
    });

    it('has Microsoft SSO button', () => {
      const btn = document.getElementById('btn-microsoft-sso')!;
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-label')).toContain('Microsoft');
    });

    it('has Apple SSO button (disabled, coming soon)', () => {
      const btn = document.getElementById('btn-apple-sso')!;
      expect(btn).toBeTruthy();
      expect(btn.classList.contains('auth-oauth-btn--disabled')).toBe(true);
    });

    it('has Phone SSO button', () => {
      const btn = document.getElementById('btn-phone-sso')!;
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-label')).toContain('Phone');
    });

    it('has sign-up mode (hidden)', () => {
      const mode = document.getElementById('signup-mode')!;
      expect(mode).toBeTruthy();
      expect(mode.classList.contains('hidden')).toBe(true);
    });

    it('#auth-shared-section wraps SSO row, divider, phone panel', () => {
      const section = document.getElementById('auth-shared-section')!;
      expect(section).toBeTruthy();
      expect(section.querySelector('.auth-divider')).toBeTruthy();
      expect(section.querySelector('.auth-oauth-row')).toBeTruthy();
      expect(section.querySelector('#phone-panel')).toBeTruthy();
    });

    it('passwordless link is inside signin-mode', () => {
      const signinMode = document.getElementById('signin-mode')!;
      expect(signinMode.querySelector('#btn-email-link-signin')).toBeTruthy();
      expect(signinMode.querySelector('#email-sent-msg')).toBeTruthy();
    });

    it('sign-in button is hidden by default', () => {
      const btn = document.getElementById('btn-signin-submit')!;
      expect(btn.classList.contains('hidden')).toBe(true);
    });

    it('#auth-shared-section is visible by default (not hidden)', () => {
      const section = document.getElementById('auth-shared-section')!;
      expect(section.classList.contains('hidden')).toBe(false);
    });

    it('has forgot-password back button', () => {
      const backBtn = document.getElementById('btn-forgot-back')!;
      expect(backBtn).toBeTruthy();
      expect(backBtn.classList.contains('auth-link')).toBe(true);
    });

    it('#login-overlay has tabindex="-1" for keyboard events', () => {
      const overlay = document.getElementById('login-overlay')!;
      expect(overlay.getAttribute('tabindex')).toBe('-1');
    });

    it('has email sent message (hidden) with auth-success-msg class', () => {
      const msg = document.getElementById('email-sent-msg')!;
      expect(msg).toBeTruthy();
      expect(msg.classList.contains('hidden')).toBe(true);
      expect(msg.classList.contains('auth-success-msg')).toBe(true);
    });

    it('has login error display (hidden) with span child for text', () => {
      const err = document.getElementById('login-error')!;
      expect(err).toBeTruthy();
      expect(err.classList.contains('hidden')).toBe(true);
      const span = err.querySelector('span');
      expect(span).toBeTruthy();
      const icon = err.querySelector('svg.auth-error-icon');
      expect(icon).toBeTruthy();
    });

    it('has username form (hidden)', () => {
      const form = document.getElementById('username-form')!;
      expect(form).toBeTruthy();
      expect(form.classList.contains('hidden')).toBe(true);
    });

    it('has username input', () => {
      const input = document.getElementById('sso-username') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.maxLength).toBe(20);
    });

    it('all .auth-input elements are wrapped in .auth-input-group', () => {
      const inputs = document.querySelectorAll('#login-overlay .auth-input');
      inputs.forEach(input => {
        expect(input.closest('.auth-input-group')).toBeTruthy();
      });
    });
  });

  describe('auth status bar elements', () => {
    it('#btn-login exists', () => {
      const btn = document.getElementById('btn-login')!;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('LOG IN');
    });

    it('#user-menu-wrap is hidden when logged out', () => {
      const wrap = document.getElementById('user-menu-wrap')!;
      expect(wrap.classList.contains('hidden')).toBe(true);
    });

    it('#auth-username exists', () => {
      expect(document.getElementById('auth-username')).toBeTruthy();
    });

    it('#btn-signout exists', () => {
      expect(document.getElementById('btn-signout')).toBeTruthy();
    });

    it('#social-dropdown-wrap exists for social access', () => {
      expect(document.getElementById('social-dropdown-wrap')).toBeTruthy();
    });
  });
});

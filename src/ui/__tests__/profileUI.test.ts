// ── Profile UI Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Mock all Firebase / service dependencies ─────────────
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null }, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
  setDoc: vi.fn(),
  updateDoc: vi.fn(() => Promise.resolve()),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(() => Promise.resolve({ docs: [], empty: true })),
  startAfter: vi.fn(),
  Timestamp: { now: vi.fn(() => ({ seconds: 1234567890 })) },
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getBlob: vi.fn(),
}));

vi.mock('../../profile', () => ({
  fetchProfile: vi.fn(),
  updateProfile: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../leaderboard', () => ({
  fetchUserStats: vi.fn(() => Promise.resolve(null)),
  fetchLeaderboard: vi.fn(() => Promise.resolve([])),
  submitMatch: vi.fn(),
  getUserRank: vi.fn(() => Promise.resolve(null)),
  fetchAggregateStats: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../../auth', () => ({
  onAuthChange: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInAnonymously: vi.fn(),
  sendEmailLink: vi.fn(),
  checkEmailLinkRedirect: vi.fn(() => false),
  setUsernameForUser: vi.fn(),
  signOutUser: vi.fn(),
  getUsername: vi.fn(() => Promise.resolve(null)),
  getCurrentUser: vi.fn(() => null),
  getAuthCreationTime: vi.fn(() => null),
}));

vi.mock('../../cloudReplay', () => ({
  fetchMatchHistory: vi.fn(() => Promise.resolve({ entries: [], lastDoc: null })),
  downloadReplay: vi.fn(() => Promise.resolve([])),
}));

import { fetchProfile } from '../../profile';
import { fetchUserStats } from '../../leaderboard';
import { initProfileUI, openProfile } from '../profileUI';

// ── Helpers ───────────────────────────────────────────────

function makeProfile(overrides: Partial<{
  uid: string;
  username: string;
  icon: string;
  about: string;
  createdAt: Date | null;
  socials: { discord: string; steam: string; twitch: string; youtube: string };
}> = {}) {
  return {
    uid: 'uid-1',
    username: 'TestUser',
    icon: 'star',
    about: 'Hello world',
    createdAt: null,
    socials: { discord: '', steam: '', twitch: '', youtube: '' },
    ...overrides,
  };
}

function makeDeps(currentUid: string | null = null) {
  return {
    getCurrentUid: vi.fn(() => currentUid),
    navigateBack: vi.fn(),
  };
}

function resetProfileDOM() {
  // Reset tab state
  document.querySelectorAll('.profile-tab[data-ptab]').forEach(el => {
    el.classList.remove('profile-tab--active');
  });
  document.getElementById('profile-tab-stats')?.classList.add('profile-tab--active');

  // Reset panels
  document.getElementById('profile-panel-stats')?.classList.remove('hidden');
  document.getElementById('profile-panel-history')?.classList.add('hidden');

  // Reset edit modal
  document.getElementById('profile-edit-modal')?.classList.add('hidden');

  // Reset edit button visibility
  const editBtn = document.getElementById('profile-edit-btn') as HTMLElement | null;
  if (editBtn) editBtn.style.display = 'none';

  // Reset about counter
  const countEl = document.getElementById('profile-edit-about-count');
  if (countEl) countEl.textContent = '0';

  // Reset error fields
  for (const p of ['discord', 'steam', 'twitch', 'youtube']) {
    const errEl = document.getElementById(`profile-edit-${p}-error`);
    if (errEl) errEl.textContent = '';
  }

  // Reset mode tabs
  const modeTabs = document.getElementById('profile-mode-tabs');
  if (modeTabs) {
    modeTabs.querySelectorAll('.stats-mode-tab').forEach(t => t.classList.remove('stats-mode-tab--active'));
    modeTabs.querySelector('.stats-mode-tab[data-mode="ai"]')?.classList.add('stats-mode-tab--active');
  }

  // Reset series pills
  const seriesFilter = document.getElementById('profile-series-filter');
  if (seriesFilter) {
    seriesFilter.querySelectorAll('.stats-series-pill').forEach(p => p.classList.remove('stats-series-pill--active'));
    seriesFilter.querySelector('.stats-series-pill[data-series="1"]')?.classList.add('stats-series-pill--active');
  }
}

// ── Profile Overlay DOM ───────────────────────────────────

describe('Profile Overlay DOM', () => {
  it('#profile-overlay exists', () => {
    expect(document.getElementById('profile-overlay')).toBeTruthy();
  });

  it('has Stats and Match History tabs', () => {
    const tabs = document.querySelectorAll('.profile-tab[data-ptab]');
    const ptabs = Array.from(tabs).map(t => (t as HTMLElement).dataset.ptab);
    expect(ptabs).toContain('stats');
    expect(ptabs).toContain('history');
  });

  it('stats panel exists', () => {
    expect(document.getElementById('profile-panel-stats')).toBeTruthy();
  });

  it('history panel exists and starts hidden', () => {
    const panel = document.getElementById('profile-panel-history')!;
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('hidden')).toBe(true);
  });

  it('profile-mode-tabs contains OFFLINE, CASUAL, RANKED tabs', () => {
    const modeTabs = document.getElementById('profile-mode-tabs')!;
    const labels = Array.from(modeTabs.querySelectorAll('.stats-mode-tab')).map(t => t.textContent?.trim());
    expect(labels).toContain('OFFLINE');
    expect(labels).toContain('CASUAL');
    expect(labels).toContain('RANKED');
  });

  it('RANKED mode tab is disabled', () => {
    const rankedTab = document.querySelector('#profile-mode-tabs .stats-mode-tab[data-mode="ranked"]')!;
    expect(rankedTab.classList.contains('stats-mode-tab--disabled')).toBe(true);
  });

  it('profile-series-filter has BO1, BO3, BO5 pills', () => {
    const pills = document.querySelectorAll('#profile-series-filter .stats-series-pill');
    const labels = Array.from(pills).map(p => p.textContent?.trim());
    expect(labels).toEqual(['BO1', 'BO3', 'BO5']);
  });

  it('edit modal exists and starts hidden', () => {
    const modal = document.getElementById('profile-edit-modal')!;
    expect(modal).toBeTruthy();
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});

// ── Tab Switching ─────────────────────────────────────────

describe('Tab switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProfileDOM();
    initProfileUI(makeDeps('uid-1'));
  });

  it('clicking Stats tab adds profile-tab--active to stats tab', () => {
    const statsTab = document.getElementById('profile-tab-stats')!;
    const historyTab = document.getElementById('profile-tab-history')!;
    historyTab.click(); // switch away first
    statsTab.click();
    expect(statsTab.classList.contains('profile-tab--active')).toBe(true);
    expect(historyTab.classList.contains('profile-tab--active')).toBe(false);
  });

  it('clicking Stats tab shows stats panel and hides history panel', () => {
    const statsTab = document.getElementById('profile-tab-stats')!;
    const historyTab = document.getElementById('profile-tab-history')!;
    historyTab.click(); // ensure history is active first
    statsTab.click();
    expect(document.getElementById('profile-panel-stats')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('profile-panel-history')!.classList.contains('hidden')).toBe(true);
  });

  it('clicking Match History tab shows history panel and hides stats panel', () => {
    const historyTab = document.getElementById('profile-tab-history')!;
    historyTab.click();
    expect(document.getElementById('profile-panel-history')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('profile-panel-stats')!.classList.contains('hidden')).toBe(true);
  });

  it('clicking Match History tab adds profile-tab--active to history tab', () => {
    const historyTab = document.getElementById('profile-tab-history')!;
    historyTab.click();
    expect(historyTab.classList.contains('profile-tab--active')).toBe(true);
    expect(document.getElementById('profile-tab-stats')!.classList.contains('profile-tab--active')).toBe(false);
  });
});

// ── Mode Tabs ─────────────────────────────────────────────

describe('Mode tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProfileDOM();
    initProfileUI(makeDeps('uid-1'));
  });

  it('clicking CASUAL mode tab updates active class', () => {
    const modeTabs = document.getElementById('profile-mode-tabs')!;
    const casualTab = modeTabs.querySelector('.stats-mode-tab[data-mode="casual"]') as HTMLElement;
    casualTab.click();
    expect(casualTab.classList.contains('stats-mode-tab--active')).toBe(true);
    expect(modeTabs.querySelector('.stats-mode-tab[data-mode="ai"]')!.classList.contains('stats-mode-tab--active')).toBe(false);
  });

  it('clicking RANKED (disabled) mode tab does not change active state', () => {
    const modeTabs = document.getElementById('profile-mode-tabs')!;
    const rankedTab = modeTabs.querySelector('.stats-mode-tab[data-mode="ranked"]') as HTMLElement;
    rankedTab.click();
    expect(rankedTab.classList.contains('stats-mode-tab--active')).toBe(false);
    expect(modeTabs.querySelector('.stats-mode-tab[data-mode="ai"]')!.classList.contains('stats-mode-tab--active')).toBe(true);
  });

  it('clicking OFFLINE tab when already active stays active', () => {
    const modeTabs = document.getElementById('profile-mode-tabs')!;
    const aiTab = modeTabs.querySelector('.stats-mode-tab[data-mode="ai"]') as HTMLElement;
    aiTab.click();
    expect(aiTab.classList.contains('stats-mode-tab--active')).toBe(true);
  });
});

// ── Series Pills ──────────────────────────────────────────

describe('Series pills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProfileDOM();
    initProfileUI(makeDeps('uid-1'));
  });

  it('clicking BO3 pill makes it active and deactivates BO1', () => {
    const seriesFilter = document.getElementById('profile-series-filter')!;
    const bo3 = seriesFilter.querySelector('.stats-series-pill[data-series="3"]') as HTMLElement;
    const bo1 = seriesFilter.querySelector('.stats-series-pill[data-series="1"]') as HTMLElement;
    bo3.click();
    expect(bo3.classList.contains('stats-series-pill--active')).toBe(true);
    expect(bo1.classList.contains('stats-series-pill--active')).toBe(false);
  });

  it('clicking BO5 pill makes it active', () => {
    const seriesFilter = document.getElementById('profile-series-filter')!;
    const bo5 = seriesFilter.querySelector('.stats-series-pill[data-series="5"]') as HTMLElement;
    bo5.click();
    expect(bo5.classList.contains('stats-series-pill--active')).toBe(true);
  });

  it('only one series pill is active at a time', () => {
    const seriesFilter = document.getElementById('profile-series-filter')!;
    const bo3 = seriesFilter.querySelector('.stats-series-pill[data-series="3"]') as HTMLElement;
    bo3.click();
    const activePills = seriesFilter.querySelectorAll('.stats-series-pill--active');
    expect(activePills.length).toBe(1);
  });
});

// ── Edit Modal ────────────────────────────────────────────

describe('Edit modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProfileDOM();
  });

  it('cancel button closes the modal (adds hidden class)', () => {
    initProfileUI(makeDeps('uid-1'));
    const modal = document.getElementById('profile-edit-modal')!;
    modal.classList.remove('hidden'); // open it manually
    const cancelBtn = document.getElementById('profile-edit-cancel')!;
    cancelBtn.click();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('about textarea counter updates on input', () => {
    initProfileUI(makeDeps('uid-1'));
    const textarea = document.getElementById('profile-edit-about') as HTMLTextAreaElement;
    const counter = document.getElementById('profile-edit-about-count')!;
    textarea.value = 'Hello!';
    textarea.dispatchEvent(new Event('input'));
    expect(counter.textContent).toBe('6');
  });

  it('about counter updates to 0 when textarea is empty', () => {
    initProfileUI(makeDeps('uid-1'));
    const textarea = document.getElementById('profile-edit-about') as HTMLTextAreaElement;
    const counter = document.getElementById('profile-edit-about-count')!;
    textarea.value = '';
    textarea.dispatchEvent(new Event('input'));
    expect(counter.textContent).toBe('0');
  });

  it('Escape key closes modal when it is open', () => {
    initProfileUI(makeDeps('uid-1'));
    const modal = document.getElementById('profile-edit-modal')!;
    modal.classList.remove('hidden');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('Escape key does nothing when modal is already closed', () => {
    initProfileUI(makeDeps('uid-1'));
    const modal = document.getElementById('profile-edit-modal')!;
    expect(modal.classList.contains('hidden')).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});

// ── Save: social validation ───────────────────────────────

describe('Save: social validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProfileDOM();
    initProfileUI(makeDeps('uid-1'));
  });

  it('shows error for invalid discord handle', async () => {
    const discordInput = document.getElementById('profile-edit-discord') as HTMLInputElement;
    discordInput.value = 'a'; // too short
    const saveBtn = document.getElementById('profile-edit-save') as HTMLButtonElement;
    saveBtn.click();
    // Wait for async _saveProfile
    await new Promise(r => setTimeout(r, 10));
    const errEl = document.getElementById('profile-edit-discord-error')!;
    expect(errEl.textContent).not.toBe('');
  });

  it('clears error for valid discord handle', async () => {
    const discordInput = document.getElementById('profile-edit-discord') as HTMLInputElement;
    discordInput.value = 'validuser';
    const discordErr = document.getElementById('profile-edit-discord-error')!;
    discordErr.textContent = 'old error';
    const saveBtn = document.getElementById('profile-edit-save') as HTMLButtonElement;
    saveBtn.click();
    await new Promise(r => setTimeout(r, 10));
    expect(discordErr.textContent).toBe('');
  });
});

// ── Social badge rendering ────────────────────────────────

describe('Social badge rendering', () => {
  it('creates badges only for non-empty social fields', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile({
      socials: { discord: 'myDiscord', steam: '', twitch: '', youtube: '' },
    }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    await openProfile('uid-1', navigateTo);

    const socialsEl = document.getElementById('profile-socials')!;
    const badges = socialsEl.querySelectorAll('.profile-social-badge');
    expect(badges.length).toBe(1);
  });

  it('creates no badges when all socials are empty', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile({
      socials: { discord: '', steam: '', twitch: '', youtube: '' },
    }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    await openProfile('uid-2', navigateTo);

    const socialsEl = document.getElementById('profile-socials')!;
    const badges = socialsEl.querySelectorAll('.profile-social-badge');
    expect(badges.length).toBe(0);
  });

  it('badge has correct platform class', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile({
      socials: { discord: '', steam: '', twitch: 'mychannel', youtube: '' },
    }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    await openProfile('uid-3', navigateTo);

    const socialsEl = document.getElementById('profile-socials')!;
    const badge = socialsEl.querySelector('.profile-social-badge--twitch');
    expect(badge).toBeTruthy();
  });

  it('badge tooltip contains social value', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile({
      socials: { discord: '', steam: 'mySteamId', twitch: '', youtube: '' },
    }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    await openProfile('uid-4', navigateTo);

    const socialsEl = document.getElementById('profile-socials')!;
    const tip = socialsEl.querySelector('.profile-social-tip');
    expect(tip?.textContent).toBe('mySteamId');
  });
});

// ── openProfile ───────────────────────────────────────────

describe('openProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProfileDOM();
    initProfileUI(makeDeps('uid-self'));
  });

  it('sets loading state (username shows ...) before fetch resolves', async () => {
    let resolveProfile!: (v: ReturnType<typeof makeProfile> | null) => void;
    (fetchProfile as Mock).mockReturnValue(new Promise(r => { resolveProfile = r; }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    const promise = openProfile('uid-1', navigateTo);

    // Before resolving, username should show loading dots
    expect(document.getElementById('profile-username')!.textContent).toBe('...');

    resolveProfile(null);
    await promise;
  });

  it('shows edit button for own profile', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile({ uid: 'uid-self' }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const deps = makeDeps('uid-self');
    initProfileUI(deps);

    const navigateTo = vi.fn();
    await openProfile('uid-self', navigateTo);

    const editBtn = document.getElementById('profile-edit-btn') as HTMLElement;
    expect(editBtn.style.display).toBe('');
  });

  it('hides edit button for another user profile', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile({ uid: 'uid-other' }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const deps = makeDeps('uid-self');
    initProfileUI(deps);

    const navigateTo = vi.fn();
    await openProfile('uid-other', navigateTo);

    const editBtn = document.getElementById('profile-edit-btn') as HTMLElement;
    expect(editBtn.style.display).toBe('none');
  });

  it('calls navigateTo("profile")', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile());
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    await openProfile('uid-1', navigateTo);
    expect(navigateTo).toHaveBeenCalledWith('profile');
  });

  it('renders "Profile not found" when fetchProfile returns null', async () => {
    (fetchProfile as Mock).mockResolvedValue(null);
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    await openProfile('uid-missing', navigateTo);

    expect(document.getElementById('profile-username')!.textContent).toBe('Profile not found');
  });

  it('renders username from fetched profile', async () => {
    (fetchProfile as Mock).mockResolvedValue(makeProfile({ username: 'CoolPlayer' }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const navigateTo = vi.fn();
    await openProfile('uid-1', navigateTo);

    expect(document.getElementById('profile-username')!.textContent).toBe('CoolPlayer');
  });
});

// ── Match history: WATCH button ───────────────────────────

describe('Match history: WATCH button', () => {
  it('WATCH button is disabled (opacity 0.3, no pointer events) when replayStoragePath is empty', async () => {
    const { fetchMatchHistory } = await import('../../cloudReplay');
    (fetchMatchHistory as Mock).mockResolvedValueOnce({
      entries: [{
        id: 'match-1',
        players: [
          { uid: 'uid-1', username: 'P1', color: 0, vehicle: 'default' },
          { uid: 'uid-2', username: 'P2', color: 1, vehicle: 'default' },
        ],
        result: 'win',
        winnerUid: 'uid-1',
        series: 1,
        matchType: 'casual',
        duration: 60,
        map: 'default',
        seriesScore: { p1: 1, p2: 0 },
        participantUids: ['uid-1', 'uid-2'],
        replayStoragePath: '',
        createdAt: new Date(),
      }],
      lastDoc: null,
    });

    (fetchProfile as Mock).mockResolvedValue(makeProfile({ uid: 'uid-1' }));
    (fetchUserStats as Mock).mockResolvedValue(null);

    const deps = makeDeps('uid-1');
    initProfileUI(deps);

    const navigateTo = vi.fn();
    await openProfile('uid-1', navigateTo);

    // Switch to history tab to trigger load
    const historyTab = document.getElementById('profile-tab-history')!;
    historyTab.click();

    // Wait for async match history load
    await new Promise(r => setTimeout(r, 50));

    const historyContainer = document.getElementById('profile-panel-history')!;
    const watchBtn = historyContainer.querySelector('.profile-match-replay') as HTMLElement | null;
    if (watchBtn) {
      expect(watchBtn.style.pointerEvents).toBe('none');
      expect(watchBtn.style.opacity).toBe('0.3');
    }
  });
});

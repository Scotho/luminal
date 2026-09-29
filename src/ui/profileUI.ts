// ── Profile UI ────────────────────────────────────────────
import { fetchProfile, updateProfile } from '../profile';
import { validateSocial } from '../socialValidation';
import type { SocialPlatform } from '../socialValidation';
import { fetchUserStats } from '../leaderboard';
import { escapeHtml, show, hide } from './dom';
import { getAuthCreationTime } from '../auth';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchMatchHistory, downloadReplay, type MatchHistoryEntry } from '../cloudReplay';
import { findLocalReplay } from '../replayStore';
import { EVT_PLAY_CLOUD_REPLAY } from '../events';
import type { DocumentSnapshot } from 'firebase/firestore';
import { playUiTab } from '../sfx';
import { warnDev } from '../swallow';

// ── Deps interface ────────────────────────────────────────

export interface ProfileUIDeps {
  getCurrentUid: () => string | null;
  navigateBack: () => void;
}

// ── Internal state ────────────────────────────────────────

let _getCurrentUid: (() => string | null) | null = null;
let _navigateTo: ((screen: string) => void) | null = null;

let _viewingUid: string | null = null;
let _profileMode: 'ai' | 'casual' = 'ai';
let _profileSeries: number = 1;

let _historyLastDoc: DocumentSnapshot | null = null;
let _historyLoading = false;

// ── Time formatter ────────────────────────────────────────

function _fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

// ── Stats loader ──────────────────────────────────────────

async function _loadProfileStats(): Promise<void> {
  if (!_viewingUid) return;
  const capturedUid = _viewingUid;

  const stats = await fetchUserStats(capturedUid, _profileSeries, _profileMode);
  if (_viewingUid !== capturedUid) return; // stale call

  const set = (id: string, value: string | number) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  if (stats) {
    set('p-wins', stats.wins);
    set('p-beststreak', stats.bestStreak);
    set('p-fastestwin', stats.fastestWin > 0 ? _fmtTime(stats.fastestWin) : '—');
    set('p-matches', stats.matchCount);
    set('p-currentstreak', stats.currentStreak);
    set('p-winrate', stats.matchCount > 0 ? `${stats.winRate}%` : '—');
    set('p-wld-wins', stats.wins);
    set('p-wld-losses', stats.losses);
    set('p-wld-draws', stats.draws);
  } else {
    set('p-wins', 0);
    set('p-beststreak', 0);
    set('p-fastestwin', '—');
    set('p-matches', 0);
    set('p-currentstreak', 0);
    set('p-winrate', '—');
    set('p-wld-wins', 0);
    set('p-wld-losses', 0);
    set('p-wld-draws', 0);
  }
}

// ── Hero renderer ─────────────────────────────────────────

function _renderHero(profile: {
  uid: string;
  username: string;
  icon: string;
  about: string;
  createdAt: Date | null;
  socials: { discord: string; steam: string; twitch: string; youtube: string };
}): void {
  const usernameEl = document.getElementById('profile-username');
  if (usernameEl) usernameEl.textContent = profile.username || 'Unknown';

  const joinedEl = document.getElementById('profile-joined');
  if (joinedEl) {
    if (profile.createdAt) {
      joinedEl.textContent = 'Joined ' + profile.createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } else {
      joinedEl.textContent = '';
    }
  }

  const aboutEl = document.getElementById('profile-about');
  if (aboutEl) aboutEl.textContent = profile.about || '';

  // Icon
  const iconEl = document.getElementById('profile-icon');
  if (iconEl && profile.icon) {
    iconEl.innerHTML = `<use href="/icons.svg#i-${escapeHtml(profile.icon)}"/>`;
  } else if (iconEl) {
    iconEl.innerHTML = `<use href="/icons.svg#i-star"/>`;
  }

  // Social badges
  const socialsEl = document.getElementById('profile-socials');
  if (socialsEl) {
    const platforms: SocialPlatform[] = ['discord', 'steam', 'twitch', 'youtube'];
    const labels: Record<SocialPlatform, string> = {
      discord: 'Discord',
      steam: 'Steam',
      twitch: 'Twitch',
      youtube: 'YouTube',
    };

    const badges = platforms
      .filter(p => profile.socials[p])
      .map(p => {
        const val = escapeHtml(profile.socials[p]);
        const label = labels[p];
        return `<span class="profile-social-badge profile-social-badge--${p}" tabindex="0">${label}<span class="profile-social-tip">${val}</span></span>`;
      })
      .join('');

    socialsEl.innerHTML = badges;
  }
}

// ── Loading state ─────────────────────────────────────────

function _showLoadingState(): void {
  const setDots = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '...';
  };
  setDots('profile-username');
  setDots('profile-joined');
  setDots('profile-about');

  const socialsEl = document.getElementById('profile-socials');
  if (socialsEl) socialsEl.innerHTML = '';
}

// ── Edit modal ────────────────────────────────────────────

function _openEditModal(profile: {
  about: string;
  socials: { discord: string; steam: string; twitch: string; youtube: string };
}): void {
  const aboutEl = document.getElementById('profile-edit-about') as HTMLTextAreaElement | null;
  const aboutCount = document.getElementById('profile-edit-about-count');
  const discordEl = document.getElementById('profile-edit-discord') as HTMLInputElement | null;
  const steamEl = document.getElementById('profile-edit-steam') as HTMLInputElement | null;
  const twitchEl = document.getElementById('profile-edit-twitch') as HTMLInputElement | null;
  const youtubeEl = document.getElementById('profile-edit-youtube') as HTMLInputElement | null;

  if (aboutEl) {
    aboutEl.value = profile.about || '';
    if (aboutCount) aboutCount.textContent = String(aboutEl.value.length);
  }
  if (discordEl) discordEl.value = profile.socials.discord || '';
  if (steamEl) steamEl.value = profile.socials.steam || '';
  if (twitchEl) twitchEl.value = profile.socials.twitch || '';
  if (youtubeEl) youtubeEl.value = profile.socials.youtube || '';

  // Clear errors
  for (const platform of ['discord', 'steam', 'twitch', 'youtube']) {
    const errEl = document.getElementById(`profile-edit-${platform}-error`);
    if (errEl) errEl.textContent = '';
  }
  const saveError = document.getElementById('profile-edit-save-error');
  if (saveError) saveError.textContent = '';

  show('profile-edit-modal');
}

function _closeEditModal(): void {
  hide('profile-edit-modal');
}

// ── Current profile cache (for edit modal) ────────────────

let _cachedProfile: {
  uid: string;
  username: string;
  icon: string;
  about: string;
  createdAt: Date | null;
  socials: { discord: string; steam: string; twitch: string; youtube: string };
} | null = null;

// ── Save profile ──────────────────────────────────────────

async function _saveProfile(): Promise<void> {
  const uid = _getCurrentUid?.();
  if (!uid) return;

  const aboutEl = document.getElementById('profile-edit-about') as HTMLTextAreaElement | null;
  const discordEl = document.getElementById('profile-edit-discord') as HTMLInputElement | null;
  const steamEl = document.getElementById('profile-edit-steam') as HTMLInputElement | null;
  const twitchEl = document.getElementById('profile-edit-twitch') as HTMLInputElement | null;
  const youtubeEl = document.getElementById('profile-edit-youtube') as HTMLInputElement | null;
  const saveBtn = document.getElementById('profile-edit-save') as HTMLButtonElement | null;

  const platforms: SocialPlatform[] = ['discord', 'steam', 'twitch', 'youtube'];
  const inputs: Record<SocialPlatform, string> = {
    discord: discordEl?.value ?? '',
    steam: steamEl?.value ?? '',
    twitch: twitchEl?.value ?? '',
    youtube: youtubeEl?.value ?? '',
  };

  // Validate all socials
  let allValid = true;
  for (const platform of platforms) {
    const result = validateSocial(platform, inputs[platform]);
    const errEl = document.getElementById(`profile-edit-${platform}-error`);
    if (errEl) errEl.textContent = result.valid ? '' : (result.error ?? '');
    if (!result.valid) allValid = false;
  }

  if (!allValid) return;

  // Disable save button during save
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'SAVING...';
  }

  try {
    await updateProfile(uid, {
      about: aboutEl?.value ?? '',
      socials: {
        discord: inputs.discord.trim(),
        steam: inputs.steam.trim(),
        twitch: inputs.twitch.trim(),
        youtube: inputs.youtube.trim(),
      },
    });

    // Refetch and re-render hero
    const updated = await fetchProfile(uid);
    if (updated) {
      _cachedProfile = updated;
      _renderHero(updated);
    }

    _closeEditModal();
  } catch (e) {
    console.error('Failed to save profile:', e);
    const saveError = document.getElementById('profile-edit-save-error');
    if (saveError) saveError.textContent = 'SAVE FAILED — TRY AGAIN';
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'SAVE';
    }
  }
}

// ── Match History ─────────────────────────────────────────

function _renderMatchEntry(entry: MatchHistoryEntry): HTMLElement {
  const uid = _viewingUid!;
  const currentUid = _getCurrentUid?.() ?? null;

  // Determine which player index is "us" (viewing uid)
  const myIdx = entry.players.findIndex(p => p.uid === uid);
  const opponentIdx = myIdx === 0 ? 1 : 0;
  const opponent = entry.players[opponentIdx];

  // Result from perspective of viewed uid
  let resultLabel = 'DRAW';
  let resultClass = 'profile-match-result--draw';
  if (entry.winnerUid === uid) {
    resultLabel = 'WIN';
    resultClass = 'profile-match-result--win';
  } else if (entry.winnerUid && entry.winnerUid !== uid) {
    resultLabel = 'LOSS';
    resultClass = 'profile-match-result--loss';
  }

  // Series score from perspective of viewed uid
  const myScore = myIdx === 0 ? entry.seriesScore.p1 : entry.seriesScore.p2;
  const oppScore = myIdx === 0 ? entry.seriesScore.p2 : entry.seriesScore.p1;

  // Date short format
  const dateStr = entry.createdAt
    ? entry.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';

  // Duration format m:ss.d
  const durSec = entry.duration;
  const durM = Math.floor(durSec / 60);
  const durS = Math.floor(durSec % 60);
  const durD = Math.floor((durSec % 1) * 10);
  const durStr = `${durM}:${durS.toString().padStart(2, '0')}.${durD}`;

  const row = document.createElement('div');
  row.className = 'profile-match-row';

  row.innerHTML = `
    <span class="profile-match-date">${escapeHtml(dateStr)}</span>
    <span class="profile-match-opponent">${escapeHtml(opponent?.username ?? 'Unknown')}</span>
    <span class="profile-match-result ${escapeHtml(resultClass)}">${resultLabel}</span>
    <span class="profile-match-score">${myScore}-${oppScore}</span>
    <span class="profile-match-duration">${escapeHtml(durStr)}</span>
    <span class="profile-match-map">${escapeHtml(entry.map ?? '')}</span>
    <span class="profile-match-replay">WATCH</span>
  `;

  // Opponent name click → open profile
  const oppEl = row.querySelector('.profile-match-opponent') as HTMLElement;
  if (opponent && opponent.uid !== currentUid) {
    oppEl.style.cursor = 'pointer';
    oppEl.style.pointerEvents = 'auto';
    oppEl.style.color = 'rgba(var(--c-teal),0.7)';
    oppEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_navigateTo) openProfile(opponent.uid, _navigateTo).catch(console.error);
    });
  }

  // WATCH button → download replay and dispatch event
  const watchBtn = row.querySelector('.profile-match-replay') as HTMLElement;

  if (!entry.replayStoragePath) {
    watchBtn.style.opacity = '0.3';
    watchBtn.style.pointerEvents = 'none';
    watchBtn.textContent = '—';
  }

  watchBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!entry.replayStoragePath) return;
    watchBtn.textContent = '...';

    // Own profile: try local replay first (avoids cloud download)
    const isOwnProfile = currentUid && currentUid === uid;
    if (isOwnProfile && entry.createdAt) {
      try {
        const local = await findLocalReplay(
          entry.createdAt.getTime(),
          entry.duration,
          entry.matchType,
        );
        if (local) {
          window.dispatchEvent(new CustomEvent(EVT_PLAY_CLOUD_REPLAY, {
            detail: { frames: local.frames, entry },
          }));
          watchBtn.textContent = 'WATCH';
          return;
        }
      } catch (err) {
        warnDev('profileUI: local replay lookup failed — falling through to cloud', err);
      }
    }

    // Cloud download fallback
    downloadReplay(entry.replayStoragePath)
      .then(frames => {
        window.dispatchEvent(new CustomEvent(EVT_PLAY_CLOUD_REPLAY, {
          detail: { frames, entry },
        }));
        watchBtn.textContent = 'WATCH';
      })
      .catch(err => {
        console.error('Replay download failed:', err);
        watchBtn.textContent = 'ERR';
      });
  });

  return row;
}

async function _loadMatchHistory(reset: boolean): Promise<void> {
  if (_historyLoading) return;
  if (!_viewingUid) return;
  const capturedUid = _viewingUid;

  const container = document.getElementById('profile-panel-history');
  if (!container) return;

  if (reset) {
    _historyLastDoc = null;
    container.innerHTML = `<div class="profile-history-loading">LOADING...</div>`;
  }

  _historyLoading = true;

  try {
    const { entries, lastDoc } = await fetchMatchHistory(capturedUid, 20, _historyLastDoc ?? undefined);
    if (_viewingUid !== capturedUid) return; // stale call
    _historyLastDoc = lastDoc;

    if (reset) container.innerHTML = '';

    // Remove existing "LOAD MORE" button if present
    const oldMore = container.querySelector('.profile-history-more');
    if (oldMore) oldMore.remove();

    if (entries.length === 0 && reset) {
      container.innerHTML = `<div class="profile-history-loading">NO MATCHES YET</div>`;
      return;
    }

    for (const entry of entries) {
      container.appendChild(_renderMatchEntry(entry));
    }

    // Add "LOAD MORE" if there may be more results
    if (lastDoc && entries.length === 20) {
      const moreBtn = document.createElement('div');
      moreBtn.className = 'profile-history-more';
      moreBtn.textContent = 'LOAD MORE';
      moreBtn.addEventListener('click', () => {
        _loadMatchHistory(false).catch(console.error);
      });
      container.appendChild(moreBtn);
    }
  } catch (err) {
    console.error('Failed to load match history:', err);
    if (reset) container.innerHTML = `<div class="profile-history-loading">FAILED TO LOAD</div>`;
  } finally {
    _historyLoading = false;
  }
}

// ── Tab switching helpers ─────────────────────────────────

function _switchProfileTab(tab: 'stats' | 'history'): void {
  playUiTab();
  document.querySelectorAll('.profile-tab[data-ptab]').forEach(el => {
    const t = (el as HTMLElement).dataset.ptab;
    const isActive = t === tab;
    el.classList.toggle('profile-tab--active', isActive);
    el.setAttribute('aria-selected', String(isActive));
    (el as HTMLElement).tabIndex = isActive ? 0 : -1;
  });

  const statsPanel = document.getElementById('profile-panel-stats');
  const historyPanel = document.getElementById('profile-panel-history');
  if (statsPanel) statsPanel.classList.toggle('hidden', tab !== 'stats');
  if (historyPanel) historyPanel.classList.toggle('hidden', tab !== 'history');
}

// ── Escape key handler (named for cleanup) ───────────────
function _onEscapeKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    const modal = document.getElementById('profile-edit-modal');
    if (modal && !modal.classList.contains('hidden')) {
      e.preventDefault();
      _closeEditModal();
    }
  }
}

// ── initProfileUI ─────────────────────────────────────────

export function initProfileUI(deps: ProfileUIDeps): void {
  _getCurrentUid = deps.getCurrentUid;
  // navigateBack is available via the navigation system's back button; stored here for future use
  void deps.navigateBack;

  // Profile tab switching
  document.querySelectorAll('.profile-tab[data-ptab]').forEach(el => {
    el.addEventListener('click', () => {
      const tab = (el as HTMLElement).dataset.ptab as 'stats' | 'history';
      if (tab) {
        _switchProfileTab(tab);
        if (tab === 'history') _loadMatchHistory(true).catch(console.error);
      }
    });
  });

  // Mode tabs (scoped to #profile-mode-tabs)
  const modeTabs = document.getElementById('profile-mode-tabs');
  if (modeTabs) {
    modeTabs.querySelectorAll('.stats-mode-tab[data-mode]').forEach(el => {
      el.addEventListener('click', () => {
        const mode = (el as HTMLElement).dataset.mode;
        // Ranked is disabled
        if (mode === 'ranked') return;
        if (mode !== 'ai' && mode !== 'casual') return;
        playUiTab();
        modeTabs.querySelectorAll('.stats-mode-tab').forEach(t => t.classList.remove('stats-mode-tab--active'));
        el.classList.add('stats-mode-tab--active');
        _profileMode = mode;
        _loadProfileStats().catch(console.error);
      });
    });
  }

  // Series pills (scoped to #profile-series-filter)
  const seriesFilter = document.getElementById('profile-series-filter');
  if (seriesFilter) {
    seriesFilter.querySelectorAll('.stats-series-pill[data-series]').forEach(el => {
      el.addEventListener('click', () => {
        const series = parseInt((el as HTMLElement).dataset.series ?? '1', 10);
        if (!series) return;

        seriesFilter.querySelectorAll('.stats-series-pill').forEach(p => p.classList.remove('stats-series-pill--active'));
        el.classList.add('stats-series-pill--active');
        _profileSeries = series;
        _loadProfileStats().catch(console.error);
      });
    });
  }

  // Edit button
  const editBtn = document.getElementById('profile-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (_cachedProfile) _openEditModal(_cachedProfile);
    });
  }

  // About textarea char counter
  const aboutTextarea = document.getElementById('profile-edit-about') as HTMLTextAreaElement | null;
  const aboutCount = document.getElementById('profile-edit-about-count');
  if (aboutTextarea && aboutCount) {
    aboutTextarea.addEventListener('input', () => {
      aboutCount.textContent = String(aboutTextarea.value.length);
    });
  }

  // Cancel button
  const cancelBtn = document.getElementById('profile-edit-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', _closeEditModal);
  }

  // Save button
  const saveBtn = document.getElementById('profile-edit-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      _saveProfile().catch(console.error);
    });
  }

  // Escape key closes edit modal (use named fn to avoid duplicate listeners)
  document.removeEventListener('keydown', _onEscapeKey);
  document.addEventListener('keydown', _onEscapeKey);
}

// ── openProfile ───────────────────────────────────────────

export async function openProfile(uid: string, navigateTo: (screen: string) => void): Promise<void> {
  // Reset state
  _viewingUid = uid;
  _navigateTo = navigateTo;
  _profileMode = 'ai';
  _profileSeries = 1;
  _historyLastDoc = null;
  const historyContainer = document.getElementById('profile-panel-history');
  if (historyContainer) historyContainer.innerHTML = '<div class="profile-coming-soon">COMING SOON</div>';

  // Reset mode tabs UI
  const modeTabs = document.getElementById('profile-mode-tabs');
  if (modeTabs) {
    modeTabs.querySelectorAll('.stats-mode-tab').forEach(t => t.classList.remove('stats-mode-tab--active'));
    modeTabs.querySelector('.stats-mode-tab[data-mode="ai"]')?.classList.add('stats-mode-tab--active');
  }

  // Reset series pills UI
  const seriesFilter = document.getElementById('profile-series-filter');
  if (seriesFilter) {
    seriesFilter.querySelectorAll('.stats-series-pill').forEach(p => p.classList.remove('stats-series-pill--active'));
    seriesFilter.querySelector('.stats-series-pill[data-series="1"]')?.classList.add('stats-series-pill--active');
  }

  // Reset tab to stats
  _switchProfileTab('stats');

  // Show/hide edit button
  const currentUid = _getCurrentUid?.();
  const editBtn = document.getElementById('profile-edit-btn');
  if (editBtn) {
    editBtn.style.display = (currentUid && currentUid === uid) ? '' : 'none';
  }

  // Show loading state
  _showLoadingState();

  // Navigate to profile screen
  navigateTo('profile');

  // Fetch and render profile
  const profile = await fetchProfile(uid);
  if (_viewingUid !== uid) return; // stale call
  if (profile) {
    // Backfill createdAt from Firebase Auth if missing (own profile only)
    const isOwn = currentUid && currentUid === uid;
    if (isOwn && !profile.createdAt) {
      const authDate = getAuthCreationTime();
      if (authDate) {
        profile.createdAt = authDate;
        updateDoc(doc(db, 'users', uid), { createdAt: authDate }).catch(() => {});
      }
    }
    _cachedProfile = profile;
    _renderHero(profile);
  } else {
    const usernameEl = document.getElementById('profile-username');
    if (usernameEl) usernameEl.textContent = 'Profile not found';
    const joinedEl = document.getElementById('profile-joined');
    if (joinedEl) joinedEl.textContent = '';
    const aboutEl = document.getElementById('profile-about');
    if (aboutEl) aboutEl.textContent = '';
    const socialsEl = document.getElementById('profile-socials');
    if (socialsEl) socialsEl.innerHTML = '';
  }

  // Load stats
  await _loadProfileStats();
}

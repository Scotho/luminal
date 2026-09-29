import { auth, reinitFirebase } from './firebase';
import { renderDbSelector, renderGameSelector } from './envSwitcher';
import { renderEmulatorsDropdown, renderDevServersDropdown } from './ui/serverDropdowns';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import type { SectionName } from './types';
import { initBanner } from './ui/statusBanner';
import { initCCPanel } from './ui/ccPanel';
import { initToast } from './ui/toast';
import { initSidebarOrder, setNavClickHandler } from './ui/sidebarOrder';
import { initNotificationBus } from './sections/notifications';
import { initActivityFeed } from './ui/activityFeed';
import { initCommandBar } from './ui/commandBar';
import { initKeyboardShortcuts, setShortcutSectionSwitcher } from './ui/keyboardShortcuts';
import { initAutoRefresh } from './ui/autoRefresh';
import { loadSettings } from './ui/settingsStore';
import { applyFontPreset } from './ui/fontLoader';
import { applyTheme } from './ui/themeManager';
import { startSessionDataService, onSessionsChanged } from './ui/sessionDataService';
import { initSidebarResize } from './ui/sidebarResize';
import { initGlobalSearch, showGlobalSearch } from './ui/globalSearch';

function showSectionError(sectionId: string, error: unknown): void {
  const el = document.getElementById(sectionId);
  if (el) {
    el.innerHTML = `<div style="color:var(--red); padding:20px;"><h3>Failed to load section</h3><pre style="font-size:12px; white-space:pre-wrap;">${String(error)}</pre></div>`;
  }
}

// -- Auth Gate --
const authGate = document.getElementById('auth-gate')!;
const contentSections = document.querySelectorAll<HTMLElement>('.section');

// -- Sidebar Navigation --
// Declared before ensureDashboard() so switchSection can access it
// without hitting the temporal dead zone when ?e2e triggers immediate init.
let _activeSection: SectionName = 'live';

// E2E test mode: skip auth when ?e2e query param is present (local only)
const isE2E = new URLSearchParams(window.location.search).has('e2e');
let _dashboardInit = false;
function ensureDashboard(): void {
  if (_dashboardInit) return;
  _dashboardInit = true;
  authGate.style.display = 'none';
  initDashboard();
}

if (isE2E) {
  // Defer to next microtask so all module-level declarations
  // (setNavClickHandler, cleanup vars) are initialized first.
  queueMicrotask(() => ensureDashboard());
} else {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      ensureDashboard();
    } else {
      authGate.innerHTML = `
        <p>Sign in to access the admin dashboard.</p>
        <button id="sign-in-btn">Sign in with Google</button>
      `;
      document.getElementById('sign-in-btn')!.addEventListener('click', () => {
        signInWithPopup(auth, new GoogleAuthProvider());
      });
    }
  });
  // Fallback: if auth never responds (emulator down, network issue),
  // initialize the dashboard anyway after 4 seconds
  setTimeout(() => {
    if (!_dashboardInit) {
      console.warn('[admin] Auth timeout — initializing dashboard without auth');
      ensureDashboard();
    }
  }, 4000);
}

function switchSection(name: SectionName): void {
  // Clean up listeners from previous section
  if (_activeSection !== name) {
    for (const [, cleanup] of _cleanups) cleanup();
    _cleanups.clear();
  }
  _activeSection = name;
  const navItems = document.querySelectorAll<HTMLElement>('.nav-item[data-section]');
  navItems.forEach(el => {
    const isActive = el.dataset.section === name;
    el.classList.toggle('active', isActive);
    if (isActive) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  contentSections.forEach(el => {
    el.classList.toggle('active', el.id === `section-${name}`);
  });
  onSectionEnter(name);
}

// Register nav click handler for sidebar reorder module
setNavClickHandler((section: string) => {
  const name = section as SectionName;
  if (name === _activeSection) return;
  switchSection(name);
});

// -- Section Lifecycle --
const _cleanups = new Map<string, () => void>();

function initDashboard(): void {
  startSessionDataService();   // background polling — feeds agent panel + sessions section
  initBanner();
  initCCPanel();
  initToast();
  initNotificationBus();
  initActivityFeed();
  initCommandBar();
  initKeyboardShortcuts();
  setShortcutSectionSwitcher((name) => switchSection(name as SectionName));
  initSidebarOrder();
  initSidebarResize();
  initGlobalSearch((name) => switchSection(name as SectionName));

  // Global search keyboard shortcut: Ctrl+K / Cmd+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      showGlobalSearch();
    }
  });

  // Environment switchers (DB + Game Server)
  const dbEnvContainer = document.getElementById('db-env-selector');
  const gameEnvContainer = document.getElementById('game-env-selector');
  if (dbEnvContainer) {
    renderDbSelector(dbEnvContainer, () => {
      reinitFirebase();
      onSectionEnter(_activeSection);
    });
  }
  if (gameEnvContainer) {
    renderGameSelector(gameEnvContainer, () => {
      // Game server changes don't need Firebase reinit
    });
  }

  // Server control dropdowns (Emulators + Dev Servers)
  const emuContainer = document.getElementById('emu-selector');
  const devContainer = document.getElementById('dev-selector');
  if (emuContainer) renderEmulatorsDropdown(emuContainer);
  if (devContainer) renderDevServersDropdown(devContainer);

  // Apply saved theme
  applyTheme(loadSettings().theme);

  // Apply saved font preset
  const savedFont = loadSettings().fontFamily;
  if (savedFont && savedFont !== 'default') {
    void applyFontPreset(savedFont);
  }

  // Mobile hamburger menu
  const hamburger = document.getElementById('mobile-hamburger');
  const settingsButton = document.getElementById('banner-settings-btn');
  const sidebar = document.getElementById('sidebar')!;
  const backdrop = document.getElementById('mobile-backdrop')!;

  const closeMobileNav = () => {
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('visible');
  };

  hamburger?.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('mobile-open');
    backdrop.classList.toggle('visible', isOpen);
  });
  settingsButton?.addEventListener('click', () => {
    switchSection('settings');
    closeMobileNav();
  });
  backdrop.addEventListener('click', closeMobileNav);

  // Close drawer when a nav item is tapped
  sidebar.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.nav-item')) {
      closeMobileNav();
    }
  });

  // Mobile admin-tools tray toggle
  const banner = document.getElementById('status-banner');
  if (banner) {
    // Create toggle button
    const toolsToggle = document.createElement('button');
    toolsToggle.id = 'mobile-tools-toggle';
    toolsToggle.setAttribute('aria-label', 'Toggle admin tools');
    toolsToggle.setAttribute('title', 'Admin tools');
    toolsToggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';

    // Create tray container
    const tray = document.createElement('div');
    tray.id = 'mobile-admin-tray';

    // Insert toggle after hamburger
    const ccStatusBtn = document.getElementById('cc-status-btn');
    if (ccStatusBtn) banner.insertBefore(toolsToggle, ccStatusBtn);
    banner.appendChild(tray);

    // Move admin items into tray on mobile
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

    const envSelectors = banner.querySelectorAll('.env-split-wrap');
    const agentsWrap = document.getElementById('agents-dropdown-wrap');
    const settingsBtnEl = document.getElementById('banner-settings-btn');
    const themeToggle = document.getElementById('theme-toggle');

    const populateTray = () => {
      if (!isMobile()) return;
      // Clone env selectors and other items into the tray if not already there
      // We move the actual elements to avoid breaking their event handlers
      for (const el of envSelectors) {
        if (el.parentElement !== tray) tray.appendChild(el);
      }
      if (agentsWrap && agentsWrap.parentElement !== tray) tray.appendChild(agentsWrap);
      if (settingsBtnEl && settingsBtnEl.parentElement !== tray) tray.appendChild(settingsBtnEl);
      if (themeToggle && themeToggle.parentElement !== tray) tray.appendChild(themeToggle);
    };

    const restoreToBanner = () => {
      // Move items back to banner for desktop
      const flexSpacer = banner.querySelector('span[style*="flex:1"]');
      for (const el of envSelectors) {
        if (el.parentElement !== banner) {
          banner.insertBefore(el, flexSpacer || toolsToggle);
        }
      }
      if (agentsWrap && agentsWrap.parentElement !== banner) {
        banner.insertBefore(agentsWrap, ccStatusBtn);
      }
      if (settingsBtnEl && settingsBtnEl.parentElement !== banner) {
        banner.insertBefore(settingsBtnEl, ccStatusBtn);
      }
      if (themeToggle && themeToggle.parentElement !== banner) {
        banner.insertBefore(themeToggle, ccStatusBtn);
      }
    };

    toolsToggle.addEventListener('click', () => {
      const isOpen = tray.classList.toggle('open');
      toolsToggle.classList.toggle('active', isOpen);
      if (isOpen) populateTray();
    });

    // Close tray when clicking outside
    document.addEventListener('click', (e) => {
      if (!tray.contains(e.target as Node) && e.target !== toolsToggle && !toolsToggle.contains(e.target as Node)) {
        tray.classList.remove('open');
        toolsToggle.classList.remove('active');
      }
    });

    // On resize: restore items to banner if going desktop, populate tray if going mobile
    const mql = window.matchMedia('(max-width: 768px)');
    mql.addEventListener('change', (e) => {
      if (e.matches) {
        if (tray.classList.contains('open')) populateTray();
      } else {
        tray.classList.remove('open');
        toolsToggle.classList.remove('active');
        restoreToBanner();
      }
    });

    // Initial setup if already mobile
    if (isMobile()) populateTray();
  }

  // Mobile: sync cc-status-btn active state with flyout open/closed
  const flyoutEl = document.getElementById('cc-flyout');
  const ccBtnEl = document.getElementById('cc-status-btn');
  if (flyoutEl && ccBtnEl) {
    const syncFlyoutBtn = () => {
      ccBtnEl.classList.toggle('flyout-open', !flyoutEl.classList.contains('collapsed'));
    };
    new MutationObserver(syncFlyoutBtn).observe(flyoutEl, { attributes: true, attributeFilter: ['class'] });
    syncFlyoutBtn();
  }

  const defaultSection = (loadSettings().defaultSection || 'live') as SectionName;
  switchSection(defaultSection);

  // Reveal app — remove loading overlay
  requestAnimationFrame(() => {
    document.body.classList.remove('app-loading');
    // Clean up loading overlay after fade-out
    setTimeout(() => {
      document.querySelector('.load-screen')?.remove();
    }, 500);
  });

  // Start auto-refresh for local-JSON sections
  initAutoRefresh(
    () => _activeSection,
    (section) => onSectionEnter(section as SectionName),
  );

  // Keep sidebar sessions badge current regardless of active section
  onSessionsChanged((sessions) => {
    const activeCount = sessions.filter(
      s => s.status === 'active' || s.status === 'blocked' || s.status === 'needs-attention',
    ).length;
    updateBadge('sessions', activeCount > 0 ? String(activeCount) : '');
  });

  // Pipeline badge — polls build status every 30s
  initPipelineBadge();
}

// ── Persistent Sidebar Badges ─────────────────────────────────────────────

function updateBadge(section: string, text: string, bg?: string): void {
  const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (!navItem) return;
  const existing = navItem.querySelector('.nav-badge') as HTMLElement | null;
  const badge = (existing || document.createElement('span')) as HTMLElement;
  badge.className = 'nav-badge';
  badge.textContent = text;
  if (bg) badge.style.background = bg;
  else badge.style.background = '';
  if (!existing && text) {
    // Insert before the star so badge sits inline after the label
    const star = navItem.querySelector('.nav-star');
    if (star) navItem.insertBefore(badge, star);
    else navItem.appendChild(badge);
  }
}

async function refreshPipelineBadge(): Promise<void> {
  try {
    const [statusRes, ciRes] = await Promise.all([
      fetch('/__admin_pipeline/status').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/__admin_ci/runs').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    const status = statusRes as { build?: { conclusion?: string | null } } | null;
    const runs = (ciRes as { workflow_runs?: Array<{ status: string }> })?.workflow_runs ?? [];
    const inProgress = runs.filter(r => r.status === 'in_progress').length;

    if (inProgress > 0) {
      updateBadge('git', `${inProgress} running`, 'var(--orange)');
    } else if (status?.build?.conclusion === 'failure') {
      updateBadge('git', 'failing', 'var(--red-bright, #d45234)');
    } else if (status?.build?.conclusion === 'success') {
      updateBadge('git', 'passing', 'var(--green)');
    } else {
      updateBadge('git', '');
    }
  } catch { /* non-fatal */ }
}

function initPipelineBadge(): void {
  void refreshPipelineBadge();
  setInterval(() => void refreshPipelineBadge(), 30_000);
}

function onSectionEnter(name: SectionName): void {
  switch (name) {
    case 'live':
      import('./sections/live').then(m => {
        _cleanups.get('live')?.();
        _cleanups.set('live', m.startLiveListeners(document.getElementById('section-live')!));
      }).catch(e => showSectionError('section-live', e));
      break;
    case 'users':
      import('./sections/users').then(m => m.renderUsers(document.getElementById('section-users')!))
        .catch(e => showSectionError('section-users', e));
      break;
    case 'matches':
      import('./sections/matches').then(m => m.renderMatches(document.getElementById('section-matches')!))
        .catch(e => showSectionError('section-matches', e));
      break;
    case 'playtime':
      import('./sections/playtime').then(m => m.renderPlaytime(document.getElementById('section-playtime')!))
        .catch(e => showSectionError('section-playtime', e));
      break;
    case 'bugs':
      import('./sections/bugs').then(m => m.renderBugs(document.getElementById('section-bugs')!))
        .catch(e => showSectionError('section-bugs', e));
      break;
    case 'purge':
      import('./sections/purge').then(m => m.renderPurge(document.getElementById('section-purge')!))
        .catch(e => showSectionError('section-purge', e));
      break;
    case 'tasks':
      import('./sections/tasks').then(m => m.renderTasks(document.getElementById('section-tasks')!))
        .catch(e => showSectionError('section-tasks', e));
      break;
    case 'sessions':
      import('./sections/sessions').then(m => m.renderSessions(document.getElementById('section-sessions')!))
        .catch(e => showSectionError('section-sessions', e));
      break;
    case 'audits':
      import('./sections/audits').then(m => m.renderAudits(document.getElementById('section-audits')!))
        .catch(e => showSectionError('section-audits', e));
      break;
    case 'test-center':
      import('./sections/testCenter').then(m => {
        _cleanups.get('test-center')?.();
        m.renderTestCenter(document.getElementById('section-test-center')!).then(cleanup => {
          _cleanups.set('test-center', cleanup);
        });
      }).catch(e => showSectionError('section-test-center', e));
      break;
    case 'viewer':
      import('./sections/viewer').then(m => {
        _cleanups.get('viewer')?.();
        _cleanups.set('viewer', m.renderViewer(document.getElementById('section-viewer')!));
      }).catch(e => showSectionError('section-viewer', e));
      break;
    case 'trail-lab':
      import('./sections/trailLab').then(m => {
        _cleanups.get('trail-lab')?.();
        _cleanups.set('trail-lab', m.renderTrailLab(document.getElementById('section-trail-lab')!));
      }).catch(e => showSectionError('section-trail-lab', e));
      break;
    case 'notifications':
      import('./sections/notifications').then(m => m.renderNotifications(document.getElementById('section-notifications')!))
        .catch(e => showSectionError('section-notifications', e));
      break;
    case 'notes':
      import('./sections/notes').then(m => m.renderNotes(document.getElementById('section-notes')!))
        .catch(e => showSectionError('section-notes', e));
      break;
    case 'specs':
      import('./sections/specs').then(m => m.renderSpecs(document.getElementById('section-specs')!))
        .catch(e => showSectionError('section-specs', e));
      break;
    case 'e2e-matrix':
      import('./sections/e2eMatrix').then(m => m.renderE2eMatrix(document.getElementById('section-e2e-matrix')!))
        .catch(e => showSectionError('section-e2e-matrix', e));
      break;
    case 'links':
      import('./sections/links').then(m => m.renderLinks(document.getElementById('section-links')!))
        .catch(e => showSectionError('section-links', e));
      break;
    case 'help':
      import('./sections/help').then(m => m.renderHelp(document.getElementById('section-help')!))
        .catch(e => showSectionError('section-help', e));
      break;
    case 'settings':
      import('./sections/settings').then(m => m.renderSettings(document.getElementById('section-settings')!))
        .catch(e => showSectionError('section-settings', e));
      break;
    case 'ollama':
      import('./sections/ollama').then(m => m.renderOllama(document.getElementById('section-ollama')!))
        .catch(e => showSectionError('section-ollama', e));
      break;
    case 'feature-flags':
      import('./sections/featureFlags').then(m => m.renderFeatureFlags(document.getElementById('section-feature-flags')!))
        .catch(e => showSectionError('section-feature-flags', e));
      break;
    case 'announcements':
      import('./sections/announcements').then(m => {
        _cleanups.get('announcements')?.();
        m.renderAnnouncements(document.getElementById('section-announcements')!);
        _cleanups.set('announcements', m.cleanupAnnouncements);
      }).catch(e => showSectionError('section-announcements', e));
      break;
    case 'database':
      import('./sections/database').then(m => {
        _cleanups.get('database')?.();
        _cleanups.set('database', m.renderDatabase(document.getElementById('section-database')!));
      }).catch(e => showSectionError('section-database', e));
      break;
    case 'function-logs':
      import('./sections/functionLogs').then(m => {
        _cleanups.get('function-logs')?.();
        _cleanups.set('function-logs', m.renderFunctionLogs(document.getElementById('section-function-logs')!));
      }).catch(e => showSectionError('section-function-logs', e));
      break;
    case 'incidents':
      import('./sections/incidents').then(m => m.renderIncidents(document.getElementById('section-incidents')!))
        .catch(e => showSectionError('section-incidents', e));
      break;
    case 'firebase-metrics':
      import('./sections/firebaseMetrics').then(m => m.renderFirebaseMetrics(document.getElementById('section-firebase-metrics')!))
        .catch(e => showSectionError('section-firebase-metrics', e));
      break;
    case 'match-replay':
      import('./sections/matchReplay').then(m => m.renderMatchReplay(document.getElementById('section-match-replay')!))
        .catch(e => showSectionError('section-match-replay', e));
      break;
    case 'chat-moderation':
      import('./sections/chatModeration').then(m => {
        _cleanups.get('chat-moderation')?.();
        _cleanups.set('chat-moderation', m.renderChatModeration(document.getElementById('section-chat-moderation')!));
      }).catch(e => showSectionError('section-chat-moderation', e));
      break;
    case 'analytics':
      import('./sections/analytics').then(m => m.renderAnalytics(document.getElementById('section-analytics')!))
        .catch(e => showSectionError('section-analytics', e));
      break;
    case 'perf-tracker':
      import('./sections/perfTracker').then(m => {
        _cleanups.get('perf-tracker')?.();
        _cleanups.set('perf-tracker', m.renderPerfTracker(document.getElementById('section-perf-tracker')!));
      }).catch(e => showSectionError('section-perf-tracker', e));
      break;
    case 'scheduler':
      import('./sections/scheduler').then(m => m.renderScheduler(document.getElementById('section-scheduler')!))
        .catch(e => showSectionError('section-scheduler', e));
      break;
    case 'agents':
      import('./sections/agents').then(m => m.initAgents(document.getElementById('section-agents')!))
        .catch(e => showSectionError('section-agents', e));
      break;
    case 'overseer':
      import('./sections/overseer').then(m => m.renderOverseer(document.getElementById('section-overseer')!))
        .catch(e => showSectionError('section-overseer', e));
      break;
    case 'iterative-loop':
      import('./sections/iterativeLoop').then(m => {
        const cleanup = m.initIterativeLoop(document.getElementById('section-iterative-loop')!);
        _cleanups.set('iterative-loop', cleanup);
      }).catch(e => showSectionError('section-iterative-loop', e));
      break;
    case 'git':
      import('./sections/git').then(m => {
        _cleanups.get('git')?.();
        _cleanups.set('git', m.renderGit(document.getElementById('section-git')!));
      }).catch(e => showSectionError('section-git', e));
      break;
    case 'live-diff':
      import('./sections/liveDiff').then(m => {
        _cleanups.get('live-diff')?.();
        _cleanups.set('live-diff', m.initLiveDiff(document.getElementById('section-live-diff')!));
      }).catch(e => showSectionError('section-live-diff', e));
      break;
    case 'impact-analysis':
      import('./sections/impactAnalysis').then(m => m.renderImpactAnalysis(document.getElementById('section-impact-analysis')!))
        .catch(e => showSectionError('section-impact-analysis', e));
      break;
    case 'leaderboard':
      import('./sections/leaderboard').then(m => m.renderLeaderboard(document.getElementById('section-leaderboard')!))
        .catch(e => showSectionError('section-leaderboard', e));
      break;
    case 'memory-economy':
      import('./sections/memoryEconomy').then(m => m.initMemoryEconomy(document.getElementById('section-memory-economy')!))
        .catch(e => showSectionError('section-memory-economy', e));
      break;
    case 'file-browser':
      import('./sections/fileBrowser').then(m => m.renderFileBrowser(document.getElementById('section-file-browser')!))
        .catch(e => showSectionError('section-file-browser', e));
      break;
    case 'testing':
      import('./sections/testing').then(m => m.renderTesting(document.getElementById('section-testing')!))
        .catch(e => showSectionError('section-testing', e));
      break;
    case 'pulls':
      import('./sections/pulls').then(m => m.renderPulls(document.getElementById('section-pulls')!))
        .catch(e => showSectionError('section-pulls', e));
      break;
    case 'pipeline':
      import('./sections/pipeline').then(m => m.renderPipeline(document.getElementById('section-pipeline')!))
        .catch(e => showSectionError('section-pipeline', e));
      break;
    case 'ranked-sim':
      import('./sections/rankedSim').then(m => m.renderRankedSim(document.getElementById('section-ranked-sim')!))
        .catch(e => showSectionError('section-ranked-sim', e));
      break;
    case 'xp-sim':
      import('./sections/xpSim').then(m =>
        m.renderXpSim(document.getElementById('section-xp-sim')!)
      ).catch(e => showSectionError('section-xp-sim', e));
      break;
    case 'animation-viewer':
      import('./sections/viewer').then(m => {
        _cleanups.get('animation-viewer')?.();
        _cleanups.set('animation-viewer', m.renderViewer(document.getElementById('section-animation-viewer')!));
      }).catch(e => showSectionError('section-animation-viewer', e));
      break;
    case 'deploy-pipeline':
      import('./sections/deployPipeline').then(m => {
        _cleanups.get('deploy-pipeline')?.();
        _cleanups.set('deploy-pipeline', m.renderDeployPipeline(document.getElementById('section-deploy-pipeline')!));
      }).catch(e => showSectionError('section-deploy-pipeline', e));
      break;
    case 'flakiness-tracker':
      import('./sections/flakinessTracker').then(m => {
        _cleanups.get('flakiness-tracker')?.();
        _cleanups.set('flakiness-tracker', m.renderFlakinessTracker(document.getElementById('section-flakiness-tracker')!));
      }).catch(e => showSectionError('section-flakiness-tracker', e));
      break;
  }
}

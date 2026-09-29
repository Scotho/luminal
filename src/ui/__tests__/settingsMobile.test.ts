// ── Settings Mobile Drill-Down Tests ───────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initSettingsNav, switchTab, openMobileSubpage, closeMobileSubpage,
  isMobileSubpageOpen, getActiveTab, _resetForTesting, SETTINGS_TABS,
} from '../settingsNav';

// ── Helpers ─────────────────────────────────────────────

function mockMobileViewport(): void {
  (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: query === '(max-width: 768px)' || query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function mockDesktopViewport(): void {
  (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** Build minimal settings DOM needed for tests. */
function buildSettingsDOM(): void {
  document.body.innerHTML = `
    <div id="settings-overlay" class="settings-page overlay-screen hidden">
      <div class="settings-sidebar">
        <div class="settings-sidebar-nav">
          ${SETTINGS_TABS.map(t =>
            `<div class="settings-sidebar-item" data-tab="${t}">${t.toUpperCase()}</div>`
          ).join('\n')}
        </div>
      </div>
      <div class="settings-category-list">
        <div class="settings-cat-header">
          <div class="settings-cat-title">SETTINGS</div>
          <div class="settings-cat-subtitle">SYSTEM CONFIG</div>
        </div>
        ${SETTINGS_TABS.map(t =>
          `<div class="settings-cat-row" data-tab="${t}">
            <div class="settings-cat-row-text">
              <span class="settings-cat-row-name">${t.toUpperCase()}</span>
              <span class="settings-cat-row-desc">Description for ${t}</span>
            </div>
            <span class="settings-cat-row-chevron">&#8250;</span>
          </div>`
        ).join('\n')}
        <div class="settings-cat-footer">
          <div class="menu-btn" id="btn-settings-reset-mobile">RESET TO DEFAULTS</div>
        </div>
      </div>
      <div class="settings-content">
        <div class="settings-content-header">
          <span class="settings-content-title" id="settings-content-title">VIDEO</span>
          <span class="settings-content-desc" id="settings-content-desc"></span>
        </div>
        <div class="settings-content-body" id="settings-content-body">
          ${SETTINGS_TABS.map(t =>
            `<div id="settings-tab-${t}" class="${t === 'video' ? '' : 'hidden'}">
              <div class="setting-row"><label>${t.toUpperCase()} OPTION</label></div>
            </div>`
          ).join('\n')}
        </div>
      </div>
    </div>
  `;
}

// ── Mock sfx ────────────────────────────────────────────
vi.mock('../../sfx', () => ({ playTick: vi.fn(), playUiTab: vi.fn() }));

describe('Settings Mobile Drill-Down', () => {
  beforeEach(() => {
    buildSettingsDOM();
    _resetForTesting();
    mockMobileViewport();
  });

  describe('category list structure', () => {
    it('renders all 7 category rows', () => {
      const rows = document.querySelectorAll('.settings-cat-row');
      expect(rows.length).toBe(7);
    });

    it('each category row has a data-tab attribute matching a valid tab', () => {
      const rows = document.querySelectorAll('.settings-cat-row');
      rows.forEach((row) => {
        const tab = (row as HTMLElement).dataset.tab;
        expect(SETTINGS_TABS).toContain(tab);
      });
    });

    it('each category row has a name and description', () => {
      const rows = document.querySelectorAll('.settings-cat-row');
      rows.forEach((row) => {
        const name = row.querySelector('.settings-cat-row-name');
        const desc = row.querySelector('.settings-cat-row-desc');
        expect(name).toBeTruthy();
        expect(name!.textContent!.trim().length).toBeGreaterThan(0);
        expect(desc).toBeTruthy();
        expect(desc!.textContent!.trim().length).toBeGreaterThan(0);
      });
    });

    it('has a SETTINGS title header', () => {
      const title = document.querySelector('.settings-cat-title');
      expect(title).toBeTruthy();
      expect(title!.textContent).toBe('SETTINGS');
    });

    it('has a reset-to-defaults button', () => {
      const btn = document.getElementById('btn-settings-reset-mobile');
      expect(btn).toBeTruthy();
    });
  });

  describe('sub-page navigation', () => {
    it('starts with no sub-page open', () => {
      expect(isMobileSubpageOpen()).toBe(false);
    });

    it('opening a sub-page sets the active tab', () => {
      openMobileSubpage('audio');
      expect(getActiveTab()).toBe('audio');
      expect(isMobileSubpageOpen()).toBe(true);
    });

    it('opening a sub-page adds settings--subpage class to overlay', () => {
      openMobileSubpage('camera');
      const overlay = document.getElementById('settings-overlay')!;
      expect(overlay.classList.contains('settings--subpage')).toBe(true);
    });

    it('closing sub-page removes settings--subpage class', () => {
      openMobileSubpage('controls');
      closeMobileSubpage();
      const overlay = document.getElementById('settings-overlay')!;
      expect(overlay.classList.contains('settings--subpage')).toBe(false);
      expect(isMobileSubpageOpen()).toBe(false);
    });

    it('opening a sub-page shows the correct tab content', () => {
      openMobileSubpage('hud');
      const hudPanel = document.getElementById('settings-tab-hud')!;
      const videoPanel = document.getElementById('settings-tab-video')!;
      expect(hudPanel.classList.contains('hidden')).toBe(false);
      expect(videoPanel.classList.contains('hidden')).toBe(true);
    });

    it('category row click opens sub-page on mobile', () => {
      initSettingsNav();
      const row = document.querySelector('.settings-cat-row[data-tab="gameplay"]') as HTMLElement;
      row.click();
      expect(isMobileSubpageOpen()).toBe(true);
      expect(getActiveTab()).toBe('gameplay');
    });

    it('category row click does nothing on desktop', () => {
      mockDesktopViewport();
      initSettingsNav();
      const row = document.querySelector('.settings-cat-row[data-tab="gameplay"]') as HTMLElement;
      row.click();
      expect(isMobileSubpageOpen()).toBe(false);
    });
  });

  describe('reset cleans up mobile state', () => {
    it('_resetForTesting clears sub-page state', () => {
      openMobileSubpage('account');
      _resetForTesting();
      expect(isMobileSubpageOpen()).toBe(false);
      expect(getActiveTab()).toBe('video');
    });
  });

  describe('content visibility', () => {
    it('settings-content-body exists and has tab panels', () => {
      const body = document.getElementById('settings-content-body')!;
      expect(body).toBeTruthy();
      SETTINGS_TABS.forEach((tab) => {
        expect(document.getElementById('settings-tab-' + tab)).toBeTruthy();
      });
    });

    it('only the active tab panel is visible after opening sub-page', () => {
      openMobileSubpage('audio');
      SETTINGS_TABS.forEach((tab) => {
        const panel = document.getElementById('settings-tab-' + tab)!;
        if (tab === 'audio') {
          expect(panel.classList.contains('hidden')).toBe(false);
        } else {
          expect(panel.classList.contains('hidden')).toBe(true);
        }
      });
    });
  });
});

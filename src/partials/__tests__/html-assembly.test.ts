import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Assembles index.html by resolving @include directives, then verifies
 * all expected element IDs are present. This catches accidental omissions
 * when extracting partials.
 */
function assembleHtml(): string {
  const root = resolve(__dirname, '../../..');
  const indexPath = resolve(root, 'index.html');
  let html = readFileSync(indexPath, 'utf-8');

  const INCLUDE_RE = /<!--\s*@include\s+"([^"]+)"\s*-->/g;
  while (INCLUDE_RE.test(html)) {
    INCLUDE_RE.lastIndex = 0;
    html = html.replace(
      INCLUDE_RE,
      (_match: string, file: string) => {
        const filePath = resolve(root, file);
        return readFileSync(filePath, 'utf-8');
      },
    );
  }

  return html;
}

function extractIds(html: string): string[] {
  const ids: string[] = [];
  const re = /\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return [...new Set(ids)].sort();
}

// Critical element IDs that TS modules query at init time.
// If any of these are missing after extraction, something got lost.
const CRITICAL_IDS = [
  // Loading
  'loading-screen', 'loading-spinner', 'click-prompt', 'loading-status',
  // Topbar
  'auth-status', 'auth-row', 'mute-btn', 'vol-dropdown', 'social-dropdown',
  'user-menu-wrap', 'auth-username', 'btn-login', 'btn-signout',
  'notif-btn', 'notif-dropdown', 'tb-settings-btn', 'fullscreen-btn',
  // Online
  'online-overlay', 'btn-casual-match', 'join-lobby-overlay',
  'match-in-progress',
  // Lobby
  'lobby-overlay', 'lobby-vehicle-grid', 'lobby-color-row', 'lobby-map-grid',
  'btn-lobby-ready', 'btn-lobby-start', 'btn-lobby-leave', 'btn-lobby-invite',
  // Matchmaking
  'queue-overlay', 'queue-timer', 'btn-queue-cancel',
  'match-found-overlay', 'btn-match-accept',
  // Auth
  'login-overlay', 'login-email', 'login-password', 'signup-username',
  'signup-email', 'signup-password', 'btn-signin-submit', 'btn-signup-submit',
  'btn-google-sso', 'phone-panel', 'username-form',
  // HUD
  'controller-banner', 'pause-overlay', 'online-pause-overlay',
  'radar', 'radar-canvas', 'meter-wrap', 'meter-fill', 'pulse-canvas',
  // Main menu
  'overlay', 'btn-quickstart', 'btn-character-select', 'btn-online',
  'btn-create-lobby', 'btn-settings', 'menu-buttons', 'menu-subplate',
  // Character select (hub) — cs-save replaced by auto-save toast (cs-saved)
  'character-select-overlay', 'cs-carousel', 'cs-saved',
  // Settings
  'settings-overlay', 'settings-content-body',
  'settings-tab-gameplay', 'settings-tab-video', 'settings-tab-audio',
  'settings-tab-camera', 'settings-tab-controls', 'settings-tab-hud',
  'settings-tab-account',
  // Social
  'friends-overlay', 'social-overlay',
  // Stats
  'stats-overlay', 'stats-panel-mystats', 'stats-panel-history', 'stats-panel-leaderboard',
  'lb-rows', 'history-list',
  // Profile
  'profile-overlay', 'profile-edit-modal',
  // Music
  'music-overlay', 'music-np-track', 'music-playlist-list',
  // Gameplay
  'pregame-screen', 'countdown', 'result', 'replay-overlay',
  // Footer
  'bottom-bar', 'bugreport-overlay', 'debug-overlay',
  'global-chat', 'chat-input', 'match-chat-window', 'mobile-drawer',
];

describe('HTML partial assembly', () => {
  it('assembles index.html with all @include directives resolved', () => {
    const html = assembleHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<body');
    expect(html).not.toContain('@include');
  });

  it('contains all critical element IDs', () => {
    const html = assembleHtml();
    const ids = extractIds(html);
    const missing = CRITICAL_IDS.filter((id) => !ids.includes(id));
    expect(missing).toEqual([]);
  });

  it('contains the module script entry point', () => {
    const html = assembleHtml();
    expect(html).toContain('src="/src/main.js"');
  });
});

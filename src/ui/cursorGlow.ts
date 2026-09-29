import { TOUCH_ENABLED } from '../input';

export function initCursorGlow(): void {
  if (TOUCH_ENABLED) return;

  // Cursor shape is CSS-native (cursors.css). JS only drives the glow blob.
  const _glow = document.createElement('div');
  _glow.id = 'cursor-glow';
  document.body.appendChild(_glow);

  const _clickSel = 'a,button,[role="button"],.menu-btn,.lb-tab,.bestof-arrow,.quickstart-toggle,.skip-btn,.pause-btn,.mute-btn,.repeat-btn,.shuffle-btn,.playlist-drop-btn,.music-ctrl,.playlist-play-btn,.playlist-toggle,.playlist-remove,.playlist-download,.setting-arrow,.chat-tab,.chat-send-btn,.chat-close-btn,.chat-toggle,.tb-dropdown-wrap span[id],.auth-user-icon,#auth-username,.dropdown-item,.ann-close,.credits-name a,.social-tab,.social-drop-trigger,.party-member-action,.lobby-invite-btn,.lobby-settings-btn,.history-tab,.history-fav,.history-item,.control-toggle__option,.section-heading,.color-opt,.lobby-vehicle-tile,.notif-item,#btn-login,#btn-social-icon,.setting-select .bestof-arrow,.lobby-setting-row .bestof-arrow,.bb-bug-btn';

  document.addEventListener('mousemove', (e: MouseEvent) => {
    _glow.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
  });
  document.addEventListener('mouseover', (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    _glow.classList.toggle('active', !!(t.closest(_clickSel) || t.matches(_clickSel)));
  });
  document.addEventListener('mouseout', () => { _glow.classList.remove('active'); });
  document.addEventListener('mouseleave', () => { _glow.classList.remove('active'); });
}

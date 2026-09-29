// ── Orientation Change Animation ────────────────────────────────────────────
// Fades the screen briefly when the device orientation changes on touch devices.

import { TOUCH_ENABLED } from '../input';

export function initOrientationTransition(): void {
  if (!TOUCH_ENABLED) return;

  let _orientFade: HTMLElement | null = null;
  const _getOrientFade = (): HTMLElement => {
    if (!_orientFade) {
      _orientFade = document.createElement('div');
      _orientFade.id = 'orientation-fade';
      document.body.appendChild(_orientFade);
    }
    return _orientFade;
  };

  let _orientTimer = 0;
  const _onOrientChange = (): void => {
    const fade = _getOrientFade();
    document.body.classList.add('orientation-transitioning');
    document.body.classList.remove('orientation-settled');
    fade.classList.add('orientation-fade--active');
    clearTimeout(_orientTimer);
    _orientTimer = window.setTimeout(() => {
      fade.classList.remove('orientation-fade--active');
      document.body.classList.remove('orientation-transitioning');
      document.body.classList.add('orientation-settled');
      window.setTimeout(() => document.body.classList.remove('orientation-settled'), 400);
    }, 300);
  };

  if (screen.orientation) {
    screen.orientation.addEventListener('change', _onOrientChange);
  }
  window.addEventListener('orientationchange', _onOrientChange);
}

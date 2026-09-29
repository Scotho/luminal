import { setCameraDist } from '../scene';
import { TOUCH_ENABLED } from '../input';
import { notifySettingChanged } from '../settingsSync';

interface CameraInputDeps {
  game: {
    state: string;
    handleWheelZoom(deltaY: number): void;
  };
}

export function initCameraInput(deps: CameraInputDeps): void {
  const { game } = deps;

  // Mouse wheel: camera distance in-game + replay zoom
  window.addEventListener('wheel', (e: WheelEvent) => {
    // Let chat UI scroll naturally when hovered
    const target = e.target as HTMLElement;
    if (target.closest('#global-chat') || target.closest('#match-chat-window')) return;

    if (game.state === 'replay') {
      e.preventDefault();
      game.handleWheelZoom(e.deltaY);
    } else if (game.state === 'playing' || game.state === 'countdown' || game.state === 'transition') {
      e.preventDefault();
      const slider: HTMLInputElement = document.getElementById('cam-dist') as HTMLInputElement;
      const cur: number = Number(slider.value);
      const dir: number = e.deltaY > 0 ? 1 : -1;
      const proportionalStep: number = Math.max(0.5, cur * 0.07) * dir;
      const next: number = Math.round(Math.max(Number(slider.min), Math.min(Number(slider.max), cur + proportionalStep)));
      slider.value = String(next);
      setCameraDist(next);
      localStorage.setItem('luminal-cam-dist', String(next));
      notifySettingChanged();
    }
  }, { passive: false });

  // Pinch-to-zoom on mobile — adjusts camera distance during gameplay
  if (TOUCH_ENABLED) {
    let _pinchStartDist: number = 0;
    let _pinchStartCamDist: number = 0;
    let _pinching: boolean = false;

    window.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 2 && (game.state === 'playing' || game.state === 'countdown' || game.state === 'transition')) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        _pinchStartDist = Math.sqrt(dx * dx + dy * dy);
        const slider: HTMLInputElement = document.getElementById('cam-dist') as HTMLInputElement;
        _pinchStartCamDist = Number(slider.value);
        _pinching = true;
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e: TouchEvent) => {
      if (!_pinching || e.touches.length !== 2) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = _pinchStartDist / Math.max(dist, 1); // pinch in = zoom out (farther), spread = zoom in (closer)
      const newDist = Math.max(9, Math.min(37, _pinchStartCamDist * ratio));
      setCameraDist(newDist);
      const slider: HTMLInputElement = document.getElementById('cam-dist') as HTMLInputElement;
      slider.value = String(Math.round(newDist));
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (_pinching) {
        _pinching = false;
        const slider: HTMLInputElement = document.getElementById('cam-dist') as HTMLInputElement;
        localStorage.setItem('luminal-cam-dist', slider.value);
        notifySettingChanged();
      }
    }, { passive: true });
  }
}

import { swallow } from '../swallow';
import { ENABLE_PWA } from '../buildFlags';

let _installHint: HTMLElement | null | undefined;

export function initPWA(): void {
  if (!ENABLE_PWA) return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(swallow('main'));
  }

  let _deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  const _installBtn = document.getElementById('btn-install-app');
  _installHint = document.getElementById('loading-install-hint');

  const _installHintDismissed = localStorage.getItem('luminal-install-dismissed') === '1';

  window.addEventListener('beforeinstallprompt', (e: BeforeInstallPromptEvent) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    if (_installBtn) _installBtn.style.display = '';
    if (_installHint && !_installHintDismissed) _installHint.classList.add('loading-install-hint--visible');
  });

  document.getElementById('install-hint-close')?.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    if (_installHint) _installHint.classList.remove('loading-install-hint--visible');
    localStorage.setItem('luminal-install-dismissed', '1');
  });

  if (_installBtn) {
    _installBtn.addEventListener('click', () => {
      if (!_deferredInstallPrompt) return;
      _deferredInstallPrompt.prompt();
      _deferredInstallPrompt.userChoice.then(() => {
        _deferredInstallPrompt = null;
        if (_installBtn) _installBtn.style.display = 'none';
        if (_installHint) _installHint.classList.remove('loading-install-hint--visible');
      });
    });
  }

  window.addEventListener('appinstalled', () => {
    _deferredInstallPrompt = null;
    if (_installBtn) _installBtn.style.display = 'none';
    if (_installHint) _installHint.classList.remove('loading-install-hint--visible');
  });
}

export function getInstallHint(): HTMLElement | undefined {
  return _installHint ?? undefined;
}

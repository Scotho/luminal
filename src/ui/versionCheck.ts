// ── Version Check UI ─────────────────────────────────────
// Listens for server-published version and shows a toast when the client
// is behind, prompting the user to refresh.

import { ref, onValue as rtdbOnValue } from 'firebase/database';
import { rtdb as rtdbInstance } from '../firebase';
import { pushNotif } from './notifUI';

function _isNewerVersion(server: string, client: string): boolean {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map(Number);
  const s = parse(server), c = parse(client);
  for (let i = 0; i < 3; i++) {
    if ((s[i] || 0) > (c[i] || 0)) return true;
    if ((s[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

export function initVersionCheck(): void {
  // Read APP_VERSION from #version element (kept in sync by deploy script)
  const APP_VERSION: string = document.getElementById('version')?.textContent?.trim() || 'v0.0.0';

  let _versionNotified = false;
  const vRef = ref(rtdbInstance, 'meta/serverVersion');
  rtdbOnValue(vRef, (snap) => {
    const data = snap.val();
    if (!data?.version || _versionNotified) return;
    if (_isNewerVersion(data.version, APP_VERSION)) {
      _versionNotified = true;
      pushNotif({
        id: 'version-mismatch',
        type: 'info',
        message: `Update available (${data.version}) — tap to refresh`,
        createdAt: Date.now(),
      });
      // Click the toast to hard-reload (bust all caches)
      setTimeout(() => {
        const toast = document.querySelector('[data-notif-id="version-mismatch"]');
        if (toast) {
          (toast as HTMLElement).style.cursor = 'pointer';
          toast.addEventListener('click', async () => {
            // Unregister service workers so stale caches can't interfere
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map(r => r.unregister()));
            }
            // Purge all caches (Cache API)
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            // Navigate with a cache-bust param to bypass browser disk cache
            window.location.href = '/?_v=' + Date.now();
          });
        }
      }, 100);
    }
  });
}

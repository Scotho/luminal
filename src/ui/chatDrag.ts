// ── Chat & Announcement Panel Drag/Resize ────────────────────────────────────
// Makes the global chat panel draggable and resizable, and the announcement
// panel draggable by its top 50px.

import { makeDraggable } from './draggable';

export function initChatDrag(): void {
  // Chat drag + resize
  {
    const chatEl: HTMLElement = document.getElementById('global-chat')!;
    const handle: HTMLElement = document.getElementById('chat-tab-bar')!;
    const resizeH: HTMLElement = document.getElementById('chat-resize')!;
    makeDraggable(chatEl, handle, { saveKey: 'luminal-chat-pos', skipSelector: '.chat-tab-close, #chat-tab-match' });
    let resizing: boolean = false;
    resizeH.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); resizing = true; });
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!resizing) return;
      const r: DOMRect = chatEl.getBoundingClientRect();
      chatEl.style.width = Math.max(200, e.clientX - r.left) + 'px';
      chatEl.style.height = Math.max(80, e.clientY - r.top) + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        localStorage.setItem('luminal-chat-pos', JSON.stringify({
          x: parseInt(chatEl.style.left) || 0,
          y: parseInt(chatEl.style.top) || 0,
          w: chatEl.offsetWidth,
          h: chatEl.offsetHeight,
        }));
      }
    });
  }

  // Announcement panel drag (top 50px as handle)
  {
    const annPanel: HTMLElement | null = document.getElementById('announcement-panel');
    if (annPanel) {
      annPanel.style.cursor = 'grab';
      makeDraggable(annPanel, annPanel, {
        saveKey: 'luminal-ann-pos', skipSelector: '.ann-close', topMin: 42,
        hitTest: (e: MouseEvent) => { const r: DOMRect = annPanel!.getBoundingClientRect(); return e.clientY - r.top <= 50; },
      });
      annPanel.addEventListener('mousedown', (e: MouseEvent) => {
        const r: DOMRect = annPanel!.getBoundingClientRect();
        if (e.clientY - r.top <= 50) annPanel!.style.cursor = 'grabbing';
      });
      window.addEventListener('mouseup', () => { if (annPanel) annPanel.style.cursor = 'grab'; });
    }
  }
}

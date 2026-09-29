// admin/src/ui/shortcutOverlay.ts — Press ? to see keyboard shortcuts

let _overlayEl: HTMLElement | null = null;

const SHORTCUTS: { group: string; items: { key: string; desc: string }[] }[] = [
  {
    group: 'Navigation',
    items: [
      { key: 'Ctrl+K', desc: 'Command bar / global search' },
      { key: '?', desc: 'Show this shortcut overlay' },
      { key: 'Escape', desc: 'Close overlay / dismiss toast' },
    ],
  },
  {
    group: 'Sections',
    items: [
      { key: 'Alt+1', desc: 'Status (Live)' },
      { key: 'Alt+2', desc: 'Sessions' },
      { key: 'Alt+3', desc: 'Tasks' },
      { key: 'Alt+4', desc: 'Agents' },
      { key: 'Alt+5', desc: 'Git' },
    ],
  },
  {
    group: 'Actions',
    items: [
      { key: 'Ctrl+Shift+T', desc: 'Run tests' },
      { key: 'Ctrl+Shift+R', desc: 'Refresh current section' },
      { key: 'Ctrl+Shift+F', desc: 'Global search' },
    ],
  },
];

function renderOverlay(): string {
  const groups = SHORTCUTS.map(g => {
    const rows = g.items.map(i =>
      `<div class="shortcut-row">
        <span>${i.desc}</span>
        <span class="shortcut-key">${i.key}</span>
      </div>`
    ).join('');
    return `<h3>${g.group}</h3>${rows}`;
  }).join('');

  return `
    <div class="shortcut-panel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;">Keyboard Shortcuts</h3>
        <span style="font-size:11px;color:var(--text-quiet);">Press Escape to close</span>
      </div>
      ${groups}
    </div>
  `;
}

function showOverlay(): void {
  if (_overlayEl) return;
  _overlayEl = document.createElement('div');
  _overlayEl.className = 'shortcut-overlay';
  _overlayEl.innerHTML = renderOverlay();
  _overlayEl.addEventListener('click', (e) => {
    if (e.target === _overlayEl) hideOverlay();
  });
  document.body.appendChild(_overlayEl);
}

function hideOverlay(): void {
  if (!_overlayEl) return;
  _overlayEl.remove();
  _overlayEl = null;
}

export function initShortcutOverlay(): void {
  document.addEventListener('keydown', (e) => {
    // Skip if focused on input elements
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (_overlayEl) hideOverlay();
      else showOverlay();
    }

    if (e.key === 'Escape' && _overlayEl) {
      e.preventDefault();
      hideOverlay();
    }
  });
}

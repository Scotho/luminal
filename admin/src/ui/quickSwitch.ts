// admin/src/ui/quickSwitch.ts
import { sessionManager } from './ccSessionManager';
import { escapeHtml } from './render';

let _overlay: HTMLElement | null = null;
let _selectedIdx = 0;
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let _keyupHandler: ((e: KeyboardEvent) => void) | null = null;

export function isQuickSwitchOpen(): boolean {
  return _overlay !== null;
}

export function showQuickSwitch(reverse = false): void {
  const sessions = sessionManager.all();
  if (sessions.length === 0) return;

  if (_overlay) {
    // Already open — just cycle
    _selectedIdx = reverse
      ? (_selectedIdx - 1 + sessions.length) % sessions.length
      : (_selectedIdx + 1) % sessions.length;
    renderOverlay(sessions);
    return;
  }

  // Start on second item (first is current)
  _selectedIdx = reverse
    ? sessions.length - 1
    : Math.min(1, sessions.length - 1);

  _overlay = document.createElement('div');
  _overlay.className = 'quick-switch-overlay';
  document.body.appendChild(_overlay);
  renderOverlay(sessions);

  // Key handlers
  _keydownHandler = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      _selectedIdx = e.shiftKey
        ? (_selectedIdx - 1 + sessions.length) % sessions.length
        : (_selectedIdx + 1) % sessions.length;
      renderOverlay(sessions);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickSwitch();
    }
  };

  _keyupHandler = (e: KeyboardEvent) => {
    if (e.key === 'Control') {
      // User released Ctrl — select and close
      const session = sessions[_selectedIdx];
      if (session) sessionManager.selectedId = session.id;
      closeQuickSwitch();
    }
  };

  document.addEventListener('keydown', _keydownHandler, true);
  document.addEventListener('keyup', _keyupHandler, true);
}

function renderOverlay(sessions: ReturnType<typeof sessionManager.all>): void {
  if (!_overlay) return;

  _overlay.innerHTML = `
    <div class="qs-header">Switch Agent Session</div>
    ${sessions.map((s, i) => {
      const statusDot = s.status === 'running' ? '●' : s.status === 'error' ? '✗' : '○';
      const statusColor = s.status === 'running' ? 'var(--green)' : s.status === 'error' ? 'var(--red-bright,#d45234)' : 'var(--text-dim)';
      const elapsed = s.duration
        ? `${Math.round(s.duration / 1000)}s`
        : s.status === 'running'
          ? `${Math.round((Date.now() - s.startedAt) / 1000)}s`
          : '';
      const lastCard = s.cards[s.cards.length - 1];
      const preview = lastCard ? escapeHtml(lastCard.preview.slice(0, 60)) : 'No output yet';
      const selected = i === _selectedIdx ? 'qs-selected' : '';

      return `
        <div class="qs-item ${selected}" data-index="${i}">
          <span class="qs-dot" style="color:${statusColor}">${statusDot}</span>
          <div class="qs-item-body">
            <div class="qs-item-row">
              <span class="qs-label">${escapeHtml(s.label)}</span>
              <span class="qs-elapsed">${elapsed}</span>
            </div>
            <div class="qs-preview">${preview}</div>
          </div>
        </div>
      `;
    }).join('')}
  `;

  // Click to select
  _overlay.querySelectorAll('.qs-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt((el as HTMLElement).dataset.index ?? '0');
      const session = sessions[idx];
      if (session) sessionManager.selectedId = session.id;
      closeQuickSwitch();
    });
  });
}

export function closeQuickSwitch(): void {
  if (_keydownHandler) {
    document.removeEventListener('keydown', _keydownHandler, true);
    _keydownHandler = null;
  }
  if (_keyupHandler) {
    document.removeEventListener('keyup', _keyupHandler, true);
    _keyupHandler = null;
  }
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _selectedIdx = 0;
}

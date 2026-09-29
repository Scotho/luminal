import { bus } from './eventBus';
import type { EventName } from './eventBus';
import { getSetting } from './settingsStore';

// ── Toast config ─────────────────────────────────────────────────────────────

const MAX_TOASTS = 3;
const ANIM_MS = 300;

const TOAST_STYLES: Record<EventName, { color: string; icon: string; label: string }> = {
  'task:done':    { color: 'var(--green)',  icon: '\u2713', label: 'Task completed' },
  'bug:new':      { color: 'var(--red)',    icon: '\u26A0', label: 'New bug report' },
  'cc:done':      { color: 'var(--accent)', icon: '\u25B8', label: 'CC finished' },
  'cc:stalled':   { color: 'var(--orange, #e8a838)', icon: '\u23F1', label: 'Agent stalled' },
};

// ── Toast state ──────────────────────────────────────────────────────────────

interface ToastItem {
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

let _container: HTMLElement | null = null;
const _toasts: ToastItem[] = [];

/** Reset toast state — for testing only. */
export function _resetToasts(): void {
  _container = null;
  _toasts.length = 0;
}

function getContainer(): HTMLElement {
  if (_container && _container.isConnected) return _container;
  _toasts.length = 0;
  _container = document.createElement('div');
  _container.id = 'toast-container';
  _container.style.cssText = `
    position: fixed;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  `;
  // Inject animation stylesheet (once)
  const STYLE_ID = 'toast-keyframes';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes toast-in {
        from { opacity: 0; transform: translateY(-20px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes toast-out {
        from { opacity: 1; transform: translateY(0); }
        to   { opacity: 0; transform: translateY(-20px); }
      }
    `;
    document.head.appendChild(style);
  }
  const shell = document.getElementById('app-shell') ?? document.body;
  shell.appendChild(_container);
  return _container;
}

function dismissToast(item: ToastItem): void {
  clearTimeout(item.timer);
  // Remove from tracking array immediately to prevent infinite loops in showToast
  const idx = _toasts.indexOf(item);
  if (idx !== -1) _toasts.splice(idx, 1);
  item.el.style.animation = `toast-out ${ANIM_MS}ms ease forwards`;
  setTimeout(() => {
    item.el.remove();
  }, ANIM_MS);
}

/** When true, toast notifications are suppressed (e.g. during active chat sessions). */
let _suppressed = false;
export function suppressToasts(suppress: boolean): void { _suppressed = suppress; }

/** Show a toast notification. Exported for testing / direct use. */
export function showToast(type: EventName, message: string): void {
  if (_suppressed) return;
  const container = getContainer();
  const style = TOAST_STYLES[type];

  const el = document.createElement('div');
  el.className = 'admin-toast';
  el.style.cssText = `
    background: var(--bg-panel, #12121a);
    border: 1px solid var(--border, #2a2a3a);
    border-left: 3px solid ${style.color};
    border-radius: 6px;
    padding: 10px 16px;
    font-size: 13px;
    color: var(--text, #c8c8d8);
    min-width: 280px;
    max-width: 420px;
    pointer-events: auto;
    animation: toast-in ${ANIM_MS}ms ease forwards;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  `;

  el.innerHTML = `
    <span style="color:${style.color}; font-size:15px; flex-shrink:0;">${style.icon}</span>
    <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
      <strong style="color:${style.color};">${style.label}</strong>
      <span style="color:var(--text-dim, #6a6a7a); margin-left:6px;">${message}</span>
    </span>
  `;

  const timer = setTimeout(() => dismissToast(item), getSetting('toastDurationMs'));
  const item: ToastItem = { el, timer };

  // Evict oldest if at capacity
  while (_toasts.length >= MAX_TOASTS) {
    dismissToast(_toasts[0]);
  }

  _toasts.push(item);
  container.appendChild(el);
}

// ── Bus subscribers ──────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** Initialize toast notifications. Call once from main.ts after auth. */
export function initToast(): void {
  bus.on('task:done', (p) => {
    showToast('task:done', `${truncate(p.prompt, 60)} \u2014 ${p.tag}`);
  });

  bus.on('bug:new', (p) => {
    showToast('bug:new', `${p.username}: ${truncate(p.error, 50)}`);
  });

  bus.on('cc:done', (p) => {
    const status = p.exitCode === 0 ? 'success' : `exit ${p.exitCode}`;
    showToast('cc:done', `${p.label} \u2014 ${status}`);
  });

  bus.on('cc:stalled', (p) => {
    const mins = Math.round(p.idleSeconds / 60);
    showToast('cc:stalled', `${p.label} \u2014 no output for ${mins}m`);
  });
}

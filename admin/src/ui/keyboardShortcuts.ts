// admin/src/ui/keyboardShortcuts.ts — Global keyboard shortcut system
import { loadOrder } from './sidebarOrder';
import { detachSession, dockSession, getFloatingWindows, compareWindows } from './detachableWindow';
import { sessionManager } from './ccSessionManager';
import { openCommandBar } from './commandBar';

type ShortcutHandler = () => void;

interface Shortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  handler: ShortcutHandler;
}

const _shortcuts: Shortcut[] = [];
let _enabled = true;
let _sectionSwitcher: ((name: string) => void) | null = null;

/** Track which floating window was last focused (mousedown inside it). */
let _focusedWindowSessionId: string | null = null;

export function setShortcutSectionSwitcher(fn: (name: string) => void): void {
  _sectionSwitcher = fn;
}

export function registerShortcut(shortcut: Shortcut): void {
  _shortcuts.push(shortcut);
}

export function getRegisteredShortcuts(): Shortcut[] {
  return [..._shortcuts];
}

export function setShortcutsEnabled(enabled: boolean): void {
  _enabled = enabled;
}

/** Display label for a section key. */
const SECTION_LABELS: Record<string, string> = {
  'live': 'Status',
  'tasks': 'Tasks',
  'sessions': 'Sessions',
  'notes': 'Notes',
  'specs': 'Specs',
  'test-center': 'Test Center',
  'e2e-matrix': 'E2E Matrix',
  'agent-timeline': 'Timeline',
  'agent-diffs': 'Diffs',
  'agent-search': 'Search',
  'agent-pipelines': 'Pipelines',
  'agent-e2e': 'E2E Visual',
  'pipeline': 'Pipeline',
  'pulls': 'PR Reviews',
  'audits': 'Audits',
  'users': 'Users',
  'matches': 'Matches',
  'database': 'Database',
  'playtime': 'Playtime',
  'bugs': 'Bug Reports',
  'purge': 'Admin Actions',
  'reminders': 'Reminders',
  'links': 'Links',
  'notifications': 'Notifications',
  'viewer': 'Viewer',
  'ollama': 'Agents',
  'feature-flags': 'Feature Flags',
  'help': 'Help',
  'settings': 'Settings',
};

/** Returns true when the pipeline canvas or a pipeline node currently has focus/hover. */
const isPipelineFocused = (): boolean =>
  !!document.querySelector('.pipelines-canvas:hover, .pipeline-node:focus');

export function initKeyboardShortcuts(): () => void {
  // ── Focus-tracking for floating windows ────────────────────────────────────
  document.addEventListener('mousedown', (e) => {
    const win = (e.target as HTMLElement).closest('.cc-floating-window');
    if (win) {
      _focusedWindowSessionId =
        win.getAttribute('data-session-id') ||
        getFloatingWindows().find(
          w => w.element === win || w.element.contains(e.target as Node),
        )?.sessionId ||
        null;
    }
  });

  // Number keys 1-9 for section switching (uses current saved order)
  // loadOrder() is called at init time; order reflects user's saved sidebar layout
  const order = loadOrder();
  for (let i = 0; i < Math.min(9, order.length); i++) {
    const sectionName = order[i];
    const label = SECTION_LABELS[sectionName] ?? sectionName;
    registerShortcut({
      key: String(i + 1),
      description: `Go to ${label}`,
      handler: () => {
        if (_sectionSwitcher) _sectionSwitcher(sectionName);
      },
    });
  }

  // Ctrl+\ — toggle CC flyout
  registerShortcut({
    key: '\\',
    ctrl: true,
    description: 'Toggle agent flyout',
    handler: () => {
      const flyout = document.getElementById('cc-flyout');
      flyout?.classList.toggle('collapsed');
    },
  });

  // Ctrl+. — cycle to next agent tab
  registerShortcut({
    key: '.',
    ctrl: true,
    description: 'Next agent tab',
    handler: () => {
      const sessions = sessionManager.all();
      if (sessions.length < 2) return;
      const selected = sessionManager.selected();
      const idx = selected ? sessions.findIndex(s => s.id === selected.id) : -1;
      const next = sessions[(idx + 1) % sessions.length];
      if (next) {
        sessionManager.selectedId = next.id;
      }
    },
  });

  // Ctrl+Shift+F — navigate to agent-search section and focus search input
  registerShortcut({
    key: 'F',
    ctrl: true,
    shift: true,
    description: 'Navigate to Agent Search section',
    handler: () => {
      if (_sectionSwitcher) _sectionSwitcher('agent-search');
      setTimeout(() => {
        (document.querySelector('.agent-search-input') as HTMLElement)?.focus();
      }, 100);
    },
  });

  // Ctrl+Shift+N — click the new agent button
  registerShortcut({
    key: 'N',
    ctrl: true,
    shift: true,
    description: 'New agent',
    handler: () => {
      const btn = document.getElementById('cc-new-agent');
      btn?.click();
    },
  });

  // Ctrl+Shift+P — open skill palette (command bar filtered to skills)
  registerShortcut({
    key: 'P',
    ctrl: true,
    shift: true,
    description: 'Open skill palette',
    handler: () => {
      openCommandBar('skills');
    },
  });

  // Ctrl+Shift+D — dock/undock the focused (selected) floating window
  registerShortcut({
    key: 'D',
    ctrl: true,
    shift: true,
    description: 'Dock/undock focused agent window',
    handler: () => {
      const selected = sessionManager.selected();
      if (!selected) return;
      const floating = getFloatingWindows();
      const isDetached = floating.some(fw => fw.sessionId === selected.id);
      if (isDetached) {
        dockSession(selected.id);
      } else {
        detachSession(
          selected.id,
          Math.round(window.innerWidth / 2 - 210),
          Math.round(window.innerHeight / 2 - 250),
          { label: selected.label, status: selected.status },
        );
      }
    },
  });

  // Ctrl+Shift+C — side-by-side comparison mode for floating windows
  registerShortcut({
    key: 'C',
    ctrl: true,
    shift: true,
    description: 'Tile floating windows side-by-side (compare mode)',
    handler: () => {
      compareWindows();
    },
  });

  // ── Floating window snapping ───────────────────────────────────────────────

  // Ctrl+Shift+ArrowLeft — snap focused window to left half
  registerShortcut({
    key: 'ArrowLeft',
    ctrl: true,
    shift: true,
    description: 'Snap window to left half',
    handler: () => {
      const fw = getFloatingWindows().find(w => w.sessionId === _focusedWindowSessionId);
      if (fw) {
        fw.element.style.left = '0px';
        fw.element.style.top = '0px';
        fw.element.style.width = `${window.innerWidth / 2}px`;
        fw.element.style.height = `${window.innerHeight}px`;
      }
    },
  });

  // Ctrl+Shift+ArrowRight — snap focused window to right half
  registerShortcut({
    key: 'ArrowRight',
    ctrl: true,
    shift: true,
    description: 'Snap window to right half',
    handler: () => {
      const fw = getFloatingWindows().find(w => w.sessionId === _focusedWindowSessionId);
      if (fw) {
        fw.element.style.left = `${window.innerWidth / 2}px`;
        fw.element.style.top = '0px';
        fw.element.style.width = `${window.innerWidth / 2}px`;
        fw.element.style.height = `${window.innerHeight}px`;
      }
    },
  });

  // Ctrl+Shift+ArrowUp — maximize focused window
  registerShortcut({
    key: 'ArrowUp',
    ctrl: true,
    shift: true,
    description: 'Maximize focused window',
    handler: () => {
      const fw = getFloatingWindows().find(w => w.sessionId === _focusedWindowSessionId);
      fw?.maximize();
    },
  });

  // Ctrl+Shift+ArrowDown — minimize focused window
  registerShortcut({
    key: 'ArrowDown',
    ctrl: true,
    shift: true,
    description: 'Minimize focused window',
    handler: () => {
      const fw = getFloatingWindows().find(w => w.sessionId === _focusedWindowSessionId);
      fw?.minimize();
    },
  });

  // Escape — close open panels (CC flyout, command bar overlay, player detail)
  registerShortcut({
    key: 'Escape',
    description: 'Close open panel',
    handler: () => {
      // Close command bar overlay if open
      const cmdOverlay = document.getElementById('cmd-bar-overlay');
      if (cmdOverlay) { cmdOverlay.remove(); return; }

      // Close CC flyout if open
      const flyout = document.getElementById('cc-flyout');
      if (flyout?.classList.contains('open')) {
        flyout.classList.remove('open');
        return;
      }

      // Close any visible player-detail / modal panel
      const detail = document.querySelector<HTMLElement>('.player-detail-panel[style*="display: block"], .player-detail-panel.visible');
      if (detail) {
        detail.style.display = 'none';
        detail.classList.remove('visible');
      }
    },
  });

  function handleKeydown(e: KeyboardEvent): void {
    if (!_enabled) return;

    // Don't intercept when typing in input/textarea/contenteditable
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // Alt+Tab — cycle through floating windows
    if (e.altKey && e.key === 'Tab') {
      const windows = getFloatingWindows();
      if (windows.length > 0) {
        e.preventDefault();
        const currentIdx = windows.findIndex(w => w.sessionId === _focusedWindowSessionId);
        const nextIdx = (currentIdx + 1) % windows.length;
        windows[nextIdx].bringToFront();
        _focusedWindowSessionId = windows[nextIdx].sessionId;
      }
      return;
    }

    // Ctrl+1-9 — switch agent tab when flyout is open
    const flyout = document.getElementById('cc-flyout');
    if (
      e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9' &&
      flyout && !flyout.classList.contains('collapsed')
    ) {
      e.preventDefault();
      const tabs = document.querySelectorAll('.cc-agent-tab');
      const idx = parseInt(e.key) - 1;
      if (idx < tabs.length) {
        (tabs[idx] as HTMLElement).click();
      }
      return;
    }

    // Pipeline shortcuts (only when pipeline canvas is focused/hovered)
    if (isPipelineFocused()) {
      // Space — run pipeline if a node is selected
      if (e.key === ' ' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const selected = document.querySelector('.pipeline-node--selected');
        if (selected) {
          e.preventDefault();
          (document.querySelector('.pipelines-run') as HTMLElement)?.click();
          return;
        }
      }

      // Delete / Backspace — remove selected node
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const selected = document.querySelector('.pipeline-node--selected');
        if (selected) {
          e.preventDefault();
          selected.dispatchEvent(new CustomEvent('pipeline:delete-node', { bubbles: true }));
          selected.remove();
          return;
        }
      }

      // Ctrl+D — duplicate node
      if (e.ctrlKey && !e.shiftKey && e.key === 'd') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('pipeline:duplicate-node'));
        return;
      }

      // Ctrl+Z — undo
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('pipeline:undo'));
        return;
      }

      // Ctrl+Y — redo
      if (e.ctrlKey && !e.shiftKey && e.key === 'y') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('pipeline:redo'));
        return;
      }

      // + or = — zoom in
      if (!e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('pipeline:zoom-in'));
        return;
      }

      // - — zoom out
      if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '-') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('pipeline:zoom-out'));
        return;
      }

      // 0 — fit view
      if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '0') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('pipeline:fit-view'));
        return;
      }
    }

    for (const shortcut of _shortcuts) {
      const needsCtrl = shortcut.ctrl === true;
      const ctrlMatch = needsCtrl
        ? (e.ctrlKey || e.metaKey)
        : !e.ctrlKey && !e.metaKey;

      const needsShift = shortcut.shift === true;
      const shiftMatch = needsShift ? e.shiftKey : !e.shiftKey;

      if (e.key === shortcut.key && ctrlMatch && shiftMatch) {
        e.preventDefault();
        shortcut.handler();
        return;
      }
    }
  }

  document.addEventListener('keydown', handleKeydown);
  return () => document.removeEventListener('keydown', handleKeydown);
}

/** Render a hotkeys reference panel (for Settings section). */
export function renderHotkeysPanel(containerId: string): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Build a merged list: number-key shortcuts + Ctrl+K from commandBar + Escape
  // We show the registered shortcuts, plus Ctrl+K which is handled by commandBar
  const registered = getRegisteredShortcuts();

  // Prepend command palette shortcuts (wired in commandBar, not here)
  const allShortcuts: Array<{ keys: string[]; description: string }> = [
    { keys: ['`'], description: 'Open command palette' },
    { keys: ['Ctrl', 'K'], description: 'Open command palette (alt)' },
    { keys: ['Ctrl', 'Shift', 'P'], description: 'Open skill palette' },
    { keys: ['Alt', 'Tab'], description: 'Cycle floating windows' },
    ...registered.map(s => {
      const keys: string[] = [];
      if (s.ctrl) keys.push('Ctrl');
      if (s.meta) keys.push('\u2318');
      if (s.shift) keys.push('Shift');
      if (s.alt) keys.push('Alt');
      keys.push(s.key === 'Escape' ? 'Esc' : s.key.toUpperCase());
      return { keys, description: s.description };
    }),
  ];

  const rows = allShortcuts.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:12px;color:var(--text);">${s.description}</span>
      <kbd style="
        font-family:var(--font-mono);font-size:10px;
        padding:2px 6px;background:var(--bg-surface);
        border:1px solid var(--border);border-radius:3px;
        color:var(--accent);
      ">${s.keys.join('+')}</kbd>
    </div>
  `).join('');

  el.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text-heading);margin:0 0 12px;">Keyboard Shortcuts</h3>
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:8px 12px;">
      ${rows || '<p style="color:var(--text-dim);font-size:11px;">No shortcuts registered</p>'}
    </div>
    <p style="font-size:10px;color:var(--text-quiet);margin-top:8px;">Number keys (1-9) switch to the first 9 sections in sidebar order. Shortcuts are disabled when typing in text fields.</p>
  `;
}

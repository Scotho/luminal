// admin/src/ui/detachableWindow.ts — Floating agent panel system (SPEC-73)

import { sessionManager } from './ccSessionManager';
import { renderConversationThread, renderExternalSessionDetail, formatElapsed, loadTabOrder, saveTabOrder } from './ccRenderer';
import { continueConversation } from './ccDispatch';
import { getActiveSessions } from './sessionDataService';
import { PromptEditor } from './promptEditor';

const STORAGE_KEY = 'luminal-floating-windows';
const DEFAULT_WIDTH = 440;
const DEFAULT_HEIGHT = 560;
const MIN_W = 320;
const MIN_H = 240;

// ── Types ───────────────────────────────────────────────────────────────────

export interface FloatingWindow {
  sessionId: string;
  element: HTMLElement;
  minimize(): void;
  maximize(): void;
  close(): void;
  dock(): void;
  bringToFront(): void;
}

interface PersistedWindow {
  sessionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
}

// ── Public state ─────────────────────────────────────────────────────────────

/** Session IDs currently floating. ccRenderer uses this to exclude them from the main tab bar. */
export const detachedSessions = new Set<string>();

// ── Internal state ──────────────────────────────────────────────────────────

let _windows: FloatingWindow[] = [];
let _zCounter = 100;
let _tearOffWired = false;

// ── Persistence helpers ─────────────────────────────────────────────────────

function _persist(): void {
  const data: PersistedWindow[] = _windows.map(fw => {
    const el = fw.element;
    return {
      sessionId: fw.sessionId,
      x: parseInt(el.style.left, 10) || 0,
      y: parseInt(el.style.top, 10) || 0,
      width: parseInt(el.style.width, 10) || DEFAULT_WIDTH,
      height: parseInt(el.style.height, 10) || DEFAULT_HEIGHT,
      minimized: el.dataset.minimized === 'true',
      maximized: el.classList.contains('cc-float--maximized'),
    };
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

// ── Momentum drag ────────────────────────────────────────────────────────────
// Ported from src/ui/draggable.ts — velocity + friction + edge snap

// ── Dock insertion helpers ────────────────────────────────────────────────────

/** Find the session ID of the tab we'd insert BEFORE at a given X coordinate. Returns null = append at end. */
function _getInsertBeforeId(mouseX: number): string | null {
  const tabBar = document.getElementById('cc-agent-tabs');
  if (!tabBar) return null;
  const tabs = Array.from(tabBar.querySelectorAll<HTMLElement>('.cc-agent-tab'));
  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (mouseX < rect.left + rect.width / 2) {
      return tab.dataset.agentId ?? tab.dataset.externalId ?? null;
    }
  }
  return null;
}

/** Show a drop-position indicator on the appropriate tab. */
function _updateDockIndicator(insertBeforeId: string | null): void {
  const tabBar = document.getElementById('cc-agent-tabs');
  if (!tabBar) return;
  tabBar.querySelectorAll<HTMLElement>('.dock-drop-before, .dock-drop-after')
    .forEach(t => t.classList.remove('dock-drop-before', 'dock-drop-after'));
  if (insertBeforeId) {
    const tab = Array.from(tabBar.querySelectorAll<HTMLElement>('.cc-agent-tab'))
      .find(t => t.dataset.agentId === insertBeforeId || t.dataset.externalId === insertBeforeId);
    tab?.classList.add('dock-drop-before');
  } else {
    const tabs = tabBar.querySelectorAll<HTMLElement>('.cc-agent-tab');
    const last = tabs[tabs.length - 1] as HTMLElement | undefined;
    last?.classList.add('dock-drop-after');
  }
}

/** Remove all drop-position indicators. */
function _clearDockIndicator(): void {
  document.querySelectorAll<HTMLElement>('.dock-drop-before, .dock-drop-after')
    .forEach(t => t.classList.remove('dock-drop-before', 'dock-drop-after'));
}

function _makeMomentumDraggable(
  el: HTMLElement,
  handle: HTMLElement,
  opts: { topMin?: number; skipSelector?: string; onDock?: (insertBeforeId: string | null) => void; onEnd?: () => void } = {},
): { isDragging: () => boolean } {
  const topMin = opts.topMin ?? 0;
  const SNAP = 12;
  let dragging = false;
  let oX = 0, oY = 0, curX = 0, curY = 0;
  let velX = 0, velY = 0, pMX = 0, pMY = 0, pT = 0;
  let anim: number | null = null;
  let dockInsertBeforeId: string | null = null;

  function bnd() {
    return { maxX: Math.max(0, window.innerWidth - el.offsetWidth), maxY: Math.max(topMin, window.innerHeight - el.offsetHeight) };
  }
  function clamp() {
    const b = bnd();
    if (curX < 0) { curX = 0; velX *= -0.15; }
    if (curX > b.maxX) { curX = b.maxX; velX *= -0.15; }
    if (curY < topMin) { curY = topMin; velY *= -0.15; }
    if (curY > b.maxY) { curY = b.maxY; velY *= -0.15; }
  }
  function apply() {
    el.style.left = Math.round(curX) + 'px';
    el.style.top = Math.round(curY) + 'px';
  }
  function tick() {
    velX *= 0.85; velY *= 0.85;
    curX += velX; curY += velY;
    clamp(); apply();
    if (Math.abs(velX) > 0.15 || Math.abs(velY) > 0.15) {
      anim = requestAnimationFrame(tick);
    } else {
      anim = null;
      const b = bnd();
      if (curX < SNAP) curX = 0; else if (curX > b.maxX - SNAP) curX = b.maxX;
      if (curY - topMin < SNAP) curY = topMin; else if (curY > b.maxY - SNAP) curY = b.maxY;
      apply(); opts.onEnd?.(); _persist();
    }
  }

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (opts.skipSelector && (e.target as HTMLElement).closest(opts.skipSelector)) return;
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    dragging = true;
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    const r = el.getBoundingClientRect();
    curX = r.left; curY = r.top; apply();
    oX = e.clientX - curX; oY = e.clientY - curY;
    pMX = e.clientX; pMY = e.clientY; pT = performance.now();
    velX = 0; velY = 0;
    handle.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    const now = performance.now(), dt = Math.max(1, now - pT);
    curX = e.clientX - oX; curY = e.clientY - oY;
    const cap = 10;
    velX = 0.5 * velX + 0.5 * Math.max(-cap, Math.min(cap, (e.clientX - pMX) / dt * 16));
    velY = 0.5 * velY + 0.5 * Math.max(-cap, Math.min(cap, (e.clientY - pMY) / dt * 16));
    pMX = e.clientX; pMY = e.clientY; pT = now;
    clamp(); apply();

    // Proximity highlight + insertion indicator for re-docking
    const tabBar = document.getElementById('cc-agent-tabs');
    if (tabBar) {
      const rect = tabBar.getBoundingClientRect();
      const near = e.clientY >= rect.top - 40 && e.clientY <= rect.bottom + 10
        && e.clientX >= rect.left && e.clientX <= rect.right;
      tabBar.classList.toggle('dock-highlight', near);
      if (near) {
        dockInsertBeforeId = _getInsertBeforeId(e.clientX);
        _updateDockIndicator(dockInsertBeforeId);
      } else {
        _clearDockIndicator();
        dockInsertBeforeId = null;
      }
    }
  });

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';

    const tabBar = document.getElementById('cc-agent-tabs');
    const nearDock = tabBar?.classList.contains('dock-highlight');
    tabBar?.classList.remove('dock-highlight');
    _clearDockIndicator();

    if (nearDock && opts.onDock) {
      const insertId = dockInsertBeforeId;
      dockInsertBeforeId = null;
      opts.onDock(insertId);
      return;
    }

    dockInsertBeforeId = null;

    if (Math.abs(velX) > 0.15 || Math.abs(velY) > 0.15) {
      anim = requestAnimationFrame(tick);
    } else {
      opts.onEnd?.(); _persist();
    }
    void e;
  });

  window.addEventListener('resize', () => {
    if (dragging) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    curX = r.left; curY = r.top; clamp(); apply();
  });

  return { isDragging: () => dragging };
}

// ── Panel content helpers ────────────────────────────────────────────────────

function _renderPanelContent(outputEl: HTMLElement, sessionId: string): void {
  const ccSession = sessionManager.all().find(s => s.id === sessionId);
  if (ccSession) {
    outputEl.innerHTML = `<div class="conv-thread">${renderConversationThread(ccSession)}</div>`;
    outputEl.scrollTop = outputEl.scrollHeight;
    return;
  }
  const extSession = getActiveSessions().find(s => s.id === sessionId);
  if (extSession) {
    outputEl.innerHTML = renderExternalSessionDetail(extSession);
    return;
  }
  outputEl.innerHTML = '<div style="padding:16px; color:var(--text-dim); font-size:11px;">Session ended.</div>';
}

function _updatePanelActions(panel: HTMLElement, sessionId: string): void {
  const session = sessionManager.all().find(s => s.id === sessionId);
  if (!session) return;

  const cancelBtn = panel.querySelector<HTMLButtonElement>('.cc-float-action--cancel');
  const retryBtn = panel.querySelector<HTMLButtonElement>('.cc-float-action--retry');
  const dot = panel.querySelector<HTMLElement>('.cc-float-agent-dot');
  const timer = panel.querySelector<HTMLElement>('.cc-float-timer');
  const promptInput = panel.querySelector<HTMLInputElement>('.cc-float-prompt-input');

  if (cancelBtn) cancelBtn.style.display = session.status === 'running' ? 'inline-block' : 'none';
  if (retryBtn) retryBtn.style.display = (session.status !== 'running' && !!session.prompt) ? 'inline-block' : 'none';
  if (dot) {
    dot.className = 'cc-float-agent-dot';
    if (session.status === 'running') dot.classList.add('running');
    else if (session.status === 'done') dot.classList.add('done');
    else if (session.status === 'error') dot.classList.add('error');
  }
  if (timer) {
    timer.textContent = session.status === 'running'
      ? formatElapsed(Date.now() - session.startedAt)
      : (session.duration ? formatElapsed(session.duration) : '');
  }
  if (promptInput) {
    promptInput.placeholder = session.status === 'running'
      ? 'Agent is working...'
      : 'Continue conversation...';
    promptInput.disabled = session.status === 'running';
  }
}

// ── Core factory ────────────────────────────────────────────────────────────

export function detachSession(
  sessionId: string,
  x: number,
  y: number,
  opts: { label: string; status: string },
): FloatingWindow {
  dockSession(sessionId); // remove any existing panel for this session

  detachedSessions.add(sessionId);

  const el = document.createElement('div');
  el.className = 'cc-floating-window';
  el.dataset.sessionId = sessionId;

  Object.assign(el.style, {
    position: 'fixed',
    left: `${Math.max(0, Math.min(x, window.innerWidth - DEFAULT_WIDTH))}px`,
    top: `${Math.max(0, Math.min(y, window.innerHeight - DEFAULT_HEIGHT))}px`,
    width: `${DEFAULT_WIDTH}px`,
    height: `${DEFAULT_HEIGHT}px`,
    minWidth: `${MIN_W}px`,
    minHeight: `${MIN_H}px`,
    zIndex: String(++_zCounter),
  });

  // ── Titlebar ──────────────────────────────────────────────────────────────
  const titlebar = document.createElement('div');
  titlebar.className = 'cc-float-titlebar';
  titlebar.style.cursor = 'grab';

  const dot = document.createElement('span');
  dot.className = 'cc-float-agent-dot';
  if (opts.status === 'running') dot.classList.add('running');
  else if (opts.status === 'done') dot.classList.add('done');
  else if (opts.status === 'error') dot.classList.add('error');

  const title = document.createElement('span');
  title.className = 'cc-float-title';
  title.textContent = opts.label;

  const timer = document.createElement('span');
  timer.className = 'cc-float-timer';

  const btnDock = _makeBtn('⊞', 'cc-float-btn-dock', 'Dock to main panel');
  const btnMin = _makeBtn('─', 'cc-float-btn-minimize', 'Minimize');
  const btnMax = _makeBtn('□', 'cc-float-btn-maximize', 'Maximize');
  const btnClose = _makeBtn('✕', 'cc-float-btn-close', 'Close');

  titlebar.append(dot, title, timer, btnDock, btnMin, btnMax, btnClose);

  // ── Output area ───────────────────────────────────────────────────────────
  const outputEl = document.createElement('div');
  outputEl.className = 'cc-float-content';
  Object.assign(outputEl.style, { flex: '1', overflowY: 'auto', padding: '8px 10px', fontSize: '12px' });

  // ── Actions strip ─────────────────────────────────────────────────────────
  const actionsEl = document.createElement('div');
  actionsEl.className = 'cc-float-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'admin-btn admin-btn--danger admin-btn--small cc-float-action--cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.display = 'none';
  cancelBtn.addEventListener('click', async () => {
    try {
      await fetch(`/__admin_exec/cancel?agent=${encodeURIComponent(sessionId)}`, { method: 'POST' });
      sessionManager.cancelSession(sessionId);
    } catch { /* best-effort */ }
  });

  const retryBtn = document.createElement('button');
  retryBtn.className = 'admin-btn admin-btn--small cc-float-action--retry';
  retryBtn.textContent = 'Retry';
  retryBtn.style.display = 'none';
  retryBtn.addEventListener('click', () => {
    const session = sessionManager.all().find(s => s.id === sessionId);
    if (session?.prompt) {
      import('./ccDispatch').then(({ dispatchCC }) => { void dispatchCC(session.label, session.prompt!); });
    }
  });

  const diffBtn = document.createElement('button');
  diffBtn.className = 'admin-btn admin-btn--small cc-float-action--diff';
  diffBtn.textContent = 'Diff';
  diffBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/__admin_exec/diff');
      const data = await res.json() as { diff: string };
      import('./ccRenderer').then(({ showDiffModal }) => { showDiffModal(data.diff); });
    } catch { /* best-effort */ }
  });

  actionsEl.append(cancelBtn, retryBtn, diffBtn);

  // ── Per-panel PromptEditor ────────────────────────────────────────────────
  const editorMount = document.createElement('div');
  const floatEditor = new PromptEditor(editorMount, {
    onSend: async (text: string) => {
      if (!text.trim()) return;
      await continueConversation(sessionId, text, 'cc');
    },
  });
  floatEditor.setSessionId(sessionId);

  el.append(titlebar, outputEl, actionsEl, editorMount);

  // ── Expand/collapse wiring ─────────────────────────────────────────────────
  outputEl.addEventListener('click', (e) => {
    const h = (e.target as HTMLElement).closest('.conv-tool-header, .conv-system-header, .conv-result-header, .conv-agent-header');
    if (h) { (h.parentElement as HTMLElement)?.classList.toggle('expanded'); }
    const ch = (e.target as HTMLElement).closest('.cc-card-header');
    if (ch) { (ch.closest('.cc-card') as HTMLElement | null)?.classList.toggle('expanded'); }
  });

  // ── Resize handles (8 directions) ─────────────────────────────────────────
  const resizeDirections = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
  for (const dir of resizeDirections) {
    const handle = document.createElement('div');
    handle.className = `cc-float-resize cc-float-resize--${dir}`;
    el.appendChild(handle);

    let sX = 0, sY = 0, sW = 0, sH = 0, sL = 0, sT = 0;
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      sX = e.clientX; sY = e.clientY;
      sW = el.offsetWidth; sH = el.offsetHeight;
      sL = parseInt(el.style.left, 10); sT = parseInt(el.style.top, 10);

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - sX, dy = ev.clientY - sY;
        if (dir.includes('e')) el.style.width = Math.max(MIN_W, sW + dx) + 'px';
        if (dir.includes('w')) { el.style.width = Math.max(MIN_W, sW - dx) + 'px'; el.style.left = Math.min(sL + dx, sL + sW - MIN_W) + 'px'; }
        if (dir.includes('s')) el.style.height = Math.max(MIN_H, sH + dy) + 'px';
        if (dir.includes('n')) { el.style.height = Math.max(MIN_H, sH - dy) + 'px'; el.style.top = Math.min(sT + dy, sT + sH - MIN_H) + 'px'; }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        _persist();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  document.body.appendChild(el);
  el.addEventListener('mousedown', () => fw.bringToFront(), { capture: true });

  // ── Initial render ─────────────────────────────────────────────────────────
  _renderPanelContent(outputEl, sessionId);
  _updatePanelActions(el, sessionId);

  // ── Pill ──────────────────────────────────────────────────────────────────
  let pill: HTMLElement | null = null;

  // ── FloatingWindow API ─────────────────────────────────────────────────────
  const fw: FloatingWindow = {
    sessionId,
    element: el,

    minimize() {
      el.dataset.minimized = 'true';
      el.style.display = 'none';
      pill?.remove();
      pill = document.createElement('div');
      pill.className = 'cc-float-pill';
      const pillDot = document.createElement('span');
      pillDot.className = `cc-float-agent-dot ${opts.status === 'running' ? 'running' : opts.status === 'done' ? 'done' : ''}`;
      const pillLabel = document.createElement('span');
      pillLabel.textContent = opts.label;
      pill.append(pillDot, pillLabel);
      pill.addEventListener('click', () => {
        el.style.display = '';
        el.dataset.minimized = 'false';
        pill?.remove(); pill = null;
        fw.bringToFront(); _persist();
      });
      document.body.appendChild(pill);
      _persist();
    },

    maximize() {
      el.classList.toggle('cc-float--maximized');
      _persist();
    },

    close() {
      floatEditor.destroy();
      unsubscribeOnChange();
      el.remove(); pill?.remove(); pill = null;
      detachedSessions.delete(sessionId);
      _windows = _windows.filter(w => w.sessionId !== sessionId);
      _persist();
      import('./ccRenderer').then(m => { m.renderFlyout(); });
    },

    dock() {
      floatEditor.destroy();
      unsubscribeOnChange();
      el.remove(); pill?.remove(); pill = null;
      detachedSessions.delete(sessionId);
      _windows = _windows.filter(w => w.sessionId !== sessionId);
      _persist();
      import('./ccRenderer').then(m => { m.renderFlyout(); });
    },

    bringToFront() {
      el.style.zIndex = String(++_zCounter);
    },
  };

  // Button wiring
  btnMin.addEventListener('click', (e) => { e.stopPropagation(); fw.minimize(); });
  btnMax.addEventListener('click', (e) => { e.stopPropagation(); fw.maximize(); });
  btnClose.addEventListener('click', (e) => { e.stopPropagation(); fw.close(); });
  btnDock.addEventListener('click', (e) => { e.stopPropagation(); fw.dock(); });

  // Momentum drag — position-aware re-dock
  _makeMomentumDraggable(el, titlebar, {
    skipSelector: 'button',
    onDock: (insertBeforeId) => {
      // Positional dock: insert at the dragged position in the tab order
      floatEditor.destroy();
      unsubscribeOnChange();
      el.remove(); pill?.remove(); pill = null;
      detachedSessions.delete(sessionId);
      _windows = _windows.filter(w => w.sessionId !== sessionId);
      _persist();
      // Update tab order then re-render
      const order = loadTabOrder();
      const filtered = order.filter(id => id !== sessionId);
      if (insertBeforeId) {
        const idx = filtered.indexOf(insertBeforeId);
        if (idx >= 0) {
          filtered.splice(idx, 0, sessionId);
        } else {
          filtered.push(sessionId);
        }
      } else {
        filtered.push(sessionId);
      }
      saveTabOrder(filtered);
      import('./ccRenderer').then(m => { m.renderFlyout(); });
    },
    onEnd: () => _persist(),
  });

  // Subscribe to session changes
  const unsubscribeOnChange = sessionManager.onChange(() => {
    const session = sessionManager.all().find(s => s.id === sessionId);
    if (!session) {
      outputEl.innerHTML = '<div style="padding:16px; color:var(--text-dim); font-size:11px;">Session ended.</div>';
      return;
    }
    _renderPanelContent(outputEl, sessionId);
    _updatePanelActions(el, sessionId);
    floatEditor.setPlaceholder(session.status === 'running' ? 'Agent is working...' : 'Continue conversation...');
  });

  _windows.push(fw);
  _persist();

  return fw;
}

export function dockSession(sessionId: string): void {
  const fw = _windows.find(w => w.sessionId === sessionId);
  fw?.dock();
}

export function getFloatingWindows(): FloatingWindow[] {
  return [..._windows];
}

/**
 * Side-by-side comparison mode — tile up to 3 open floating windows
 * evenly across the viewport. Ctrl+Shift+C triggers this.
 */
export function compareWindows(): void {
  const windows = _windows.filter(fw => fw.element.dataset.minimized !== 'true');
  if (windows.length < 2) return;

  const count = Math.min(windows.length, 3);
  const w = Math.floor(window.innerWidth / count);
  const h = window.innerHeight;

  windows.slice(0, count).forEach((fw, i) => {
    const el = fw.element;
    el.classList.remove('cc-float--maximized');
    el.dataset.minimized = 'false';
    el.style.display = '';
    el.style.left = `${i * w}px`;
    el.style.top = '0px';
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transform = '';
    el.style.zIndex = String(++_zCounter);
  });

  _persist();
}

export function restoreFloatingPanels(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const persisted = JSON.parse(raw) as PersistedWindow[];
    for (const p of persisted) {
      const ccSession = sessionManager.all().find(s => s.id === p.sessionId);
      const extSession = getActiveSessions().find(s => s.id === p.sessionId);
      if (!ccSession && !extSession) continue;

      const label = ccSession?.label ?? extSession?.summary ?? p.sessionId;
      const status = ccSession?.status ?? extSession?.status ?? 'done';

      const fw = detachSession(p.sessionId, p.x, p.y, { label, status });
      fw.element.style.width = `${p.width}px`;
      fw.element.style.height = `${p.height}px`;
      if (p.minimized) fw.minimize();
      if (p.maximized) fw.maximize();
    }
  } catch { /* corrupted storage */ }
}

export function wireTabTearOff(
  tabBar: HTMLElement,
  getSessionData: (tabEl: HTMLElement) => { sessionId: string; label: string; status: string } | null,
): void {
  if (_tearOffWired) return;
  _tearOffWired = true;
  let tearActive = false;
  let startY = 0;
  let targetTab: HTMLElement | null = null;
  let ghost: HTMLElement | null = null;

  tabBar.addEventListener('mousedown', (e) => {
    const tab = (e.target as HTMLElement).closest('.cc-agent-tab') as HTMLElement;
    if (!tab) return;
    if ((e.target as HTMLElement).closest('.cc-session-close, .cc-tab-icon')) return;
    targetTab = tab;
    startY = e.clientY;
    tearActive = false;
  });

  // Prevent native HTML5 drag while our tear-off is capturing a tab.
  // Without this, the browser's drag system swallows the mouseup event,
  // leaving the ghost element stuck until a second click.
  document.addEventListener('dragstart', (e) => {
    if (targetTab) e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!targetTab) return;
    const dy = e.clientY - startY;

    if (!tearActive && dy > 12) {
      tearActive = true;
      targetTab.classList.add('tearing');
      ghost = targetTab.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, {
        position: 'fixed',
        opacity: '0.65',
        pointerEvents: 'none',
        zIndex: '9999',
        transform: 'rotate(2deg) scale(1.05)',
        transition: 'transform 0.1s',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      });
      document.body.appendChild(ghost);
    }

    if (tearActive && ghost) {
      ghost.style.left = e.clientX - 60 + 'px';
      ghost.style.top = e.clientY - 12 + 'px';
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (!targetTab) { tearActive = false; return; }

    ghost?.remove(); ghost = null;
    targetTab.classList.remove('tearing');

    if (tearActive) {
      const data = getSessionData(targetTab);
      if (data) {
        detachSession(data.sessionId, e.clientX - 210, e.clientY - 30, { label: data.label, status: data.status });
      }
    }

    targetTab = null;
    tearActive = false;
  });
}

export function _resetForTesting(): void {
  const copy = [..._windows];
  _windows = [];
  detachedSessions.clear();
  _zCounter = 100;
  _tearOffWired = false;
  for (const fw of copy) {
    try { fw.element.remove(); } catch { /* already removed */ }
  }
  document.querySelectorAll<HTMLElement>('.cc-float-pill').forEach(p => p.remove());
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
}

// ── Private helpers ─────────────────────────────────────────────────────────

function _makeBtn(label: string, cls: string, title?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `cc-float-btn ${cls}`;
  btn.textContent = label;
  if (title) btn.title = title;
  return btn;
}

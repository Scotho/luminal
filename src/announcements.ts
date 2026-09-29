// ── Announcement / MOTD System ───────────────────────────
// Listens to RTDB /announcements for active announcements and renders
// them in the existing #announcement-panel DOM element. Multiple
// announcements rotate on an 8-second interval, highest priority first.

import { rtdb } from './firebase';
import { ref, onValue, type Unsubscribe } from 'firebase/database';

// ── Types ───────────────────────────────────────────────

export interface Announcement {
  id: string;
  text: string;
  type: 'info' | 'warning' | 'maintenance' | 'update';
  priority: number;       // 1 = highest
  active: boolean;
  startAt: number;        // Unix timestamp ms
  endAt: number;          // Unix timestamp ms (0 = no expiry)
  createdBy: string;      // admin uid or 'system'
  createdAt: number;
}

// ── Constants ───────────────────────────────────────────

const ROTATE_INTERVAL_MS = 8_000;

const TYPE_LABELS: Record<Announcement['type'], string> = {
  info: 'ANNOUNCEMENT',
  warning: 'WARNING',
  maintenance: 'MAINTENANCE',
  update: 'UPDATE',
};

const TYPE_CSS_CLASS: Record<Announcement['type'], string> = {
  info: '',
  warning: 'ann--warning',
  maintenance: 'ann--maintenance',
  update: 'ann--update',
};

// ── State ───────────────────────────────────────────────

let _unsub: Unsubscribe | null = null;
let _rotateTimer: ReturnType<typeof setInterval> | null = null;
let _currentIndex = 0;
let _active: Announcement[] = [];

// ── Filtering ───────────────────────────────────────────

/** Filter and sort announcements: active, within time window, priority ascending. */
export function filterAnnouncements(
  raw: Record<string, Partial<Announcement>> | null,
  now: number = Date.now(),
): Announcement[] {
  if (!raw) return [];

  return Object.entries(raw)
    .map(([id, entry]) => ({ ...entry, id }) as Announcement)
    .filter(a =>
      a.active === true &&
      typeof a.text === 'string' && a.text.length > 0 &&
      typeof a.startAt === 'number' && a.startAt <= now &&
      (a.endAt === 0 || (typeof a.endAt === 'number' && a.endAt > now)),
    )
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

// ── Rendering ───────────────────────────────────────────

function getPanel(): HTMLElement | null {
  return document.getElementById('announcement-panel');
}

function renderCurrent(): void {
  const panel = getPanel();
  if (!panel) return;

  if (_active.length === 0) {
    panel.classList.remove('announcement--visible');
    return;
  }

  // Clamp index
  if (_currentIndex >= _active.length) _currentIndex = 0;

  const ann = _active[_currentIndex];
  const header = panel.querySelector('.ann-header');
  const body = panel.querySelector('.ann-body');

  if (header) header.textContent = TYPE_LABELS[ann.type] ?? 'ANNOUNCEMENT';
  if (body) body.textContent = ann.text;

  // Apply type class
  for (const cls of Object.values(TYPE_CSS_CLASS)) {
    if (cls) panel.classList.remove(cls);
  }
  const typeCls = TYPE_CSS_CLASS[ann.type];
  if (typeCls) panel.classList.add(typeCls);

  // Show indicator if multiple announcements
  const indicator = panel.querySelector('.ann-indicator');
  if (_active.length > 1) {
    const text = `${_currentIndex + 1}/${_active.length}`;
    if (indicator) {
      indicator.textContent = text;
    } else {
      const el = document.createElement('span');
      el.className = 'ann-indicator';
      el.textContent = text;
      body?.after(el);
    }
  } else if (indicator) {
    indicator.remove();
  }
}

function startRotation(): void {
  stopRotation();
  if (_active.length <= 1) return;
  _rotateTimer = setInterval(() => {
    _currentIndex = (_currentIndex + 1) % _active.length;
    renderCurrent();
  }, ROTATE_INTERVAL_MS);
}

function stopRotation(): void {
  if (_rotateTimer !== null) {
    clearInterval(_rotateTimer);
    _rotateTimer = null;
  }
}

// ── Public API ──────────────────────────────────────────

/** Initialize the announcement system. Sets up an RTDB listener on /announcements. */
export function initAnnouncements(): void {
  // Avoid double-init
  if (_unsub) return;

  const annRef = ref(rtdb, 'announcements');
  _unsub = onValue(annRef, (snap) => {
    const raw = snap.val() as Record<string, Partial<Announcement>> | null;
    _active = filterAnnouncements(raw);
    _currentIndex = 0;
    renderCurrent();
    startRotation();
  });
}

/** Tear down the announcement system. Removes RTDB listener and rotation timer. */
// ts-prune-ignore-next
export function teardownAnnouncements(): void {
  _unsub?.();
  _unsub = null;
  stopRotation();
  _active = [];
  _currentIndex = 0;

  // Hide panel
  const panel = getPanel();
  if (panel) {
    panel.classList.remove('announcement--visible');
    for (const cls of Object.values(TYPE_CSS_CLASS)) {
      if (cls) panel.classList.remove(cls);
    }
  }
}

/** Get the currently active (filtered) announcements. Useful for testing. */
// ts-prune-ignore-next
export function getActiveAnnouncements(): readonly Announcement[] {
  return _active;
}

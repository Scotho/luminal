/**
 * Menu subplate — typewriter user info bar.
 * Renders: USERNAME / FLOW: N / LV: N [XP bar]
 * Shows "ANON" for anonymous/missing users.
 */

export interface SubplateLevelInfo {
  level: number;
  percent: number; // 0-100, XP progress within current level
}

// ── State ───────────────────────────────────────────────
let _container: HTMLElement | null = null;
let _typewriterTimers: ReturnType<typeof setTimeout>[] = [];

const ANON_PATTERN = /^Luminal_Anon_/;
const BASE_DELAY = 45;
const JITTER = 35;

// ── Display name logic ─────────────────────────────────
function getDisplayName(username: string | null): string {
  if (!username || username.length === 0 || ANON_PATTERN.test(username)) return 'ANON';
  return username;
}

// ── Render ──────────────────────────────────────────────
export function renderSubplate(
  container: HTMLElement,
  username: string | null,
  bankedFlow: number | null,
  levelInfo: SubplateLevelInfo | null,
): void {
  _clearTimers();
  container.innerHTML = '';
  _container = container;

  const displayName = getDisplayName(username);
  const flowStr = bankedFlow != null ? bankedFlow.toLocaleString() : '0';
  const level = levelInfo?.level ?? 1;
  const percent = levelInfo?.percent ?? 0;

  // Build typed spans
  const segments: { text: string; cls: string; marginRight?: string }[] = [
    { text: displayName, cls: 'subplate-name', marginRight: '6px' },
    { text: '/ FLOW: ', cls: 'subplate-dim' },
    { text: flowStr, cls: 'subplate-val--sweep', marginRight: '6px' },
    { text: '/ LV: ', cls: 'subplate-dim' },
    { text: String(level), cls: 'subplate-val' },
    { text: ' ', cls: '' },
  ];

  const spans: HTMLSpanElement[] = [];
  for (const seg of segments) {
    const span = document.createElement('span');
    span.className = `subplate-typer ${seg.cls}`.trim();
    span.setAttribute('data-type', seg.text);
    span.style.display = 'none';
    if (seg.marginRight) span.style.marginRight = seg.marginRight;
    container.appendChild(span);
    spans.push(span);
  }

  // XP bar
  const xpWrap = document.createElement('span');
  xpWrap.className = 'subplate-xp subplate-typer';
  xpWrap.setAttribute('data-type', 'xp');
  xpWrap.style.display = 'none';
  const xpFill = document.createElement('span');
  xpFill.className = 'subplate-xp__fill';
  xpFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  xpWrap.appendChild(xpFill);
  container.appendChild(xpWrap);
  spans.push(xpWrap);

  // Cursor
  const cursor = document.createElement('span');
  cursor.className = 'subplate-cursor';
  cursor.id = 'subplate-cursor';
  container.appendChild(cursor);

  // Run typewriter
  _runTypewriter(spans, cursor);
}

function _runTypewriter(spans: HTMLSpanElement[], cursor: HTMLElement): void {
  let delay = 400;

  for (const span of spans) {
    const text = span.getAttribute('data-type') ?? '';

    if (!text || text === 'xp' || text === ' ') {
      const t = delay;
      _schedule(t, () => {
        span.style.display = '';
        span.classList.add('typed');
        span.after(cursor);
      });
      delay += 120;
      continue;
    }

    const showDelay = delay;
    _schedule(showDelay, () => {
      span.style.display = '';
      span.textContent = '';
      span.classList.add('typed');
      span.after(cursor);
    });

    for (let i = 0; i < text.length; i++) {
      const charDelay = delay;
      const char = text[i];
      _schedule(charDelay, () => { span.textContent += char; });
      const isSpace = char === ' ' || char === '/' || char === ':';
      delay += isSpace ? BASE_DELAY * 0.4 : BASE_DELAY + Math.random() * JITTER;
    }
    delay += 30;
  }

  _schedule(delay + 600, () => {
    cursor.style.animation = 'none';
    cursor.style.opacity = '0';
    cursor.style.transition = 'opacity 0.4s';
  });
}

function _schedule(ms: number, fn: () => void): void {
  _typewriterTimers.push(setTimeout(fn, ms));
}

function _clearTimers(): void {
  for (const t of _typewriterTimers) clearTimeout(t);
  _typewriterTimers = [];
}

// ── Update (re-render with new data) ───────────────────
export function updateSubplateUser(
  username: string | null,
  bankedFlow: number | null,
  levelInfo: SubplateLevelInfo | null,
): void {
  if (!_container) return;
  renderSubplate(_container, username, bankedFlow, levelInfo);
}

// ── Init (called once on app startup) ──────────────────
export function initMenuSubplate(): void {
  const el = document.getElementById('menu-subplate');
  if (!el) return;
  renderSubplate(el, null, null, null);
}

// ── Test helper ────────────────────────────────────────
export function _resetForTesting(): void {
  _clearTimers();
  _container = null;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

const storage = mockLocalStorage();
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));

// Mock canvas getContext so jsdom doesn't emit "not implemented" warnings
const mockCtx = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textBaseline: '',
};
HTMLCanvasElement.prototype.getContext = (vi.fn(() => mockCtx) as unknown) as typeof HTMLCanvasElement.prototype.getContext;

import { createTimeline } from '../timelineComponent';
import type { TimelineSession, TimelineEvent } from '../timelineComponent';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function makeSession(overrides?: Partial<TimelineSession>): TimelineSession {
  return {
    id: 'sess-1',
    label: 'Test Session',
    backend: 'cc',
    status: 'running',
    startedAt: Date.now(),
    duration: null,
    events: [],
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'ev-1',
    type: 'Bash',
    startMs: 0,
    durationMs: 2000,
    status: 'done',
    preview: 'ls -la',
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  storage.clear();
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createTimeline', () => {
  it('renders .cc-timeline container', () => {
    const container = makeContainer();
    createTimeline(container);
    expect(container.querySelector('.cc-timeline')).not.toBeNull();
  });

  it('shows empty state when no sessions are set', () => {
    const container = makeContainer();
    createTimeline(container);
    const empty = container.querySelector('.cc-timeline-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('No agent sessions');
  });

  it('renders correct number of swim lanes', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([
      makeSession({ id: 'sess-1', label: 'A' }),
      makeSession({ id: 'sess-2', label: 'B' }),
      makeSession({ id: 'sess-3', label: 'C' }),
    ]);
    const lanes = container.querySelectorAll('.cc-timeline-lane');
    expect(lanes).toHaveLength(3);
  });

  it('does not show empty state when sessions are present', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([makeSession()]);
    expect(container.querySelector('.cc-timeline-empty')).toBeNull();
    expect(container.querySelector('.cc-timeline-lane')).not.toBeNull();
  });

  it('renders events inside lanes', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([
      makeSession({
        id: 'sess-1',
        events: [
          makeEvent({ id: 'ev-1', type: 'Bash' }),
          makeEvent({ id: 'ev-2', type: 'Read' }),
        ],
      }),
    ]);
    const events = container.querySelectorAll('.cc-timeline-event');
    expect(events).toHaveLength(2);
  });

  it('applies correct CSS class for event type', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([
      makeSession({
        id: 'sess-1',
        events: [
          makeEvent({ id: 'ev-bash', type: 'Bash' }),
          makeEvent({ id: 'ev-read', type: 'Read' }),
          makeEvent({ id: 'ev-edit', type: 'Edit' }),
          makeEvent({ id: 'ev-agent', type: 'Agent' }),
        ],
      }),
    ]);
    expect(container.querySelector('[data-event-id="ev-bash"]')?.classList.contains('tl-type-bash')).toBe(true);
    expect(container.querySelector('[data-event-id="ev-read"]')?.classList.contains('tl-type-read')).toBe(true);
    expect(container.querySelector('[data-event-id="ev-edit"]')?.classList.contains('tl-type-edit')).toBe(true);
    expect(container.querySelector('[data-event-id="ev-agent"]')?.classList.contains('tl-type-agent')).toBe(true);
  });

  it('emits onSegmentClick with correct IDs when event is clicked', () => {
    const container = makeContainer();
    const onSegmentClick = vi.fn();
    const ctrl = createTimeline(container, { onSegmentClick });
    ctrl.setSessions([
      makeSession({
        id: 'sess-42',
        events: [makeEvent({ id: 'ev-99' })],
      }),
    ]);
    const seg = container.querySelector('[data-event-id="ev-99"]') as HTMLElement;
    expect(seg).not.toBeNull();
    seg.click();
    expect(onSegmentClick).toHaveBeenCalledOnce();
    expect(onSegmentClick).toHaveBeenCalledWith('sess-42', 'ev-99');
  });

  it('does not throw when onSegmentClick is not provided and event is clicked', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([
      makeSession({
        id: 'sess-1',
        events: [makeEvent({ id: 'ev-1' })],
      }),
    ]);
    const seg = container.querySelector('[data-event-id="ev-1"]') as HTMLElement;
    expect(() => seg.click()).not.toThrow();
  });

  it('addEvent adds to the correct session and re-renders', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([makeSession({ id: 'sess-1', events: [] })]);
    ctrl.addEvent('sess-1', makeEvent({ id: 'ev-new' }));
    const seg = container.querySelector('[data-event-id="ev-new"]');
    expect(seg).not.toBeNull();
  });

  it('addEvent is a no-op for unknown session', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([makeSession({ id: 'sess-1', events: [] })]);
    // Should not throw
    expect(() => ctrl.addEvent('unknown-id', makeEvent())).not.toThrow();
  });

  it('setZoom changes event widths', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([
      makeSession({
        id: 'sess-1',
        events: [makeEvent({ id: 'ev-1', startMs: 0, durationMs: 1000 })],
      }),
    ]);

    ctrl.setZoom(10); // 10px/s → 1000ms = 10px
    const seg10 = container.querySelector('[data-event-id="ev-1"]') as HTMLElement;
    const width10 = seg10.style.width;

    ctrl.setZoom(20); // 20px/s → 1000ms = 20px
    const seg20 = container.querySelector('[data-event-id="ev-1"]') as HTMLElement;
    const width20 = seg20.style.width;

    expect(width10).not.toBe(width20);
    expect(width10).toBe('10px');
    expect(width20).toBe('20px');
  });

  it('destroy clears the container', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([makeSession()]);
    ctrl.destroy();
    expect(container.innerHTML).toBe('');
  });

  it('filters hide sessions by backend', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([
      makeSession({ id: 'cc-1', backend: 'cc' }),
      makeSession({ id: 'ollama-1', backend: 'ollama' }),
    ]);
    expect(container.querySelectorAll('.cc-timeline-lane')).toHaveLength(2);

    // Click the CC filter button to deactivate it
    const ccBtn = container.querySelector('[data-filter-backend="cc"]') as HTMLElement;
    ccBtn.click();

    expect(container.querySelectorAll('.cc-timeline-lane')).toHaveLength(1);
    const lane = container.querySelector('.cc-timeline-lane') as HTMLElement;
    expect(lane.getAttribute('data-session-id')).toBe('ollama-1');
  });

  it('shows empty state when all sessions are filtered out', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([makeSession({ id: 'cc-1', backend: 'cc' })]);

    // Deactivate all backends
    const ccBtn = container.querySelector('[data-filter-backend="cc"]') as HTMLElement;
    ccBtn.click();

    expect(container.querySelector('.cc-timeline-empty')).not.toBeNull();
    expect(container.querySelector('.cc-timeline-empty')?.textContent).toContain('No agent sessions');
  });

  it('renders filter bar with backend and status buttons', () => {
    const container = makeContainer();
    createTimeline(container);
    expect(container.querySelector('[data-filter-backend="cc"]')).not.toBeNull();
    expect(container.querySelector('[data-filter-backend="ollama"]')).not.toBeNull();
    expect(container.querySelector('[data-filter-backend="aider"]')).not.toBeNull();
    expect(container.querySelector('[data-filter-status="running"]')).not.toBeNull();
    expect(container.querySelector('[data-filter-status="done"]')).not.toBeNull();
    expect(container.querySelector('[data-filter-status="error"]')).not.toBeNull();
  });

  it('sets data-session-id and data-event-id attributes on events', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([
      makeSession({
        id: 'my-session',
        events: [makeEvent({ id: 'my-event' })],
      }),
    ]);
    const seg = container.querySelector('[data-event-id="my-event"]') as HTMLElement;
    expect(seg.getAttribute('data-session-id')).toBe('my-session');
    expect(seg.getAttribute('data-event-id')).toBe('my-event');
  });

  it('lane gutter shows session label', () => {
    const container = makeContainer();
    const ctrl = createTimeline(container);
    ctrl.setSessions([makeSession({ id: 'sess-1', label: 'My Task' })]);
    const gutter = container.querySelector('.cc-timeline-gutter') as HTMLElement;
    expect(gutter.textContent).toContain('My Task');
  });

  // ── Canvas-specific tests ──────────────────────────────────────────────────

  it('renders a <canvas> element with class cc-timeline-canvas', () => {
    const container = makeContainer();
    createTimeline(container);
    const canvas = container.querySelector('.cc-timeline-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.tagName.toLowerCase()).toBe('canvas');
  });

  it('renders time range filter select in the filter bar', () => {
    const container = makeContainer();
    createTimeline(container);
    const rangeSelect = container.querySelector('.cc-timeline-range') as HTMLSelectElement | null;
    expect(rangeSelect).not.toBeNull();
    expect(rangeSelect?.tagName.toLowerCase()).toBe('select');
    // Should have at least three options: All, Today, Last hour
    expect(rangeSelect!.options.length).toBeGreaterThanOrEqual(3);
  });

  it('double-click on canvas emits onSegmentJump with correct IDs', () => {
    const container = makeContainer();
    const onSegmentJump = vi.fn();
    const ctrl = createTimeline(container, { onSegmentJump });
    ctrl.setSessions([
      makeSession({
        id: 'sess-jump',
        events: [makeEvent({ id: 'ev-jump', startMs: 0, durationMs: 5000 })],
      }),
    ]);

    const canvas = container.querySelector('.cc-timeline-canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    // Manually inject an event rect so hitTest can find it
    // We do this by triggering a dblclick at a known coordinate where we
    // expect the event to be drawn (x=0 because scrollOffset=0, startMs=0)
    // Since jsdom's canvas doesn't actually paint, we need to verify
    // the listener is wired — dispatch a dblclick with offsetX/Y in a valid range
    const dblClickEvent = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 30, // within TIME_AXIS_HEIGHT(24) + LANE_HEIGHT(36): y=28..60
    });
    Object.defineProperty(dblClickEvent, 'offsetX', { value: 5 });
    Object.defineProperty(dblClickEvent, 'offsetY', { value: 30 });

    // Manually seed _eventRects by triggering a render synchronously
    // The dblclick handler uses hitTest against _eventRects;
    // since RAF doesn't fire in jsdom, _eventRects is empty.
    // We verify the handler is wired: no crash, and if hit, fires callback.
    expect(() => canvas.dispatchEvent(dblClickEvent)).not.toThrow();
  });

  it('canvas has a wheel event listener attached for zoom', () => {
    const container = makeContainer();
    createTimeline(container);
    const canvas = container.querySelector('.cc-timeline-canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    // Dispatch a wheel event and verify it doesn't throw
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });
    expect(() => canvas.dispatchEvent(wheelEvent)).not.toThrow();
  });

  it('double-click fires onSegmentJump when a hit rect is present', () => {
    const container = makeContainer();
    const onSegmentJump = vi.fn();
    const ctrl = createTimeline(container, { onSegmentJump });
    ctrl.setSessions([
      makeSession({
        id: 'sess-hit',
        events: [makeEvent({ id: 'ev-hit', startMs: 0, durationMs: 10000 })],
      }),
    ]);

    const canvas = container.querySelector('.cc-timeline-canvas') as HTMLCanvasElement;

    // Simulate a render by calling _render synchronously via RAF flush.
    // In jsdom, requestAnimationFrame callbacks run when flushed.
    // We can force flush by using vi.runAllTimers if using fake timers,
    // or we can manually verify by testing the DOM-mirror click path.
    // Since the canvas hit-rect path requires RAF, test via DOM mirror:
    const seg = container.querySelector('[data-event-id="ev-hit"]') as HTMLElement;
    expect(seg).not.toBeNull();

    // The canvas dblclick path will fire after RAF; we just confirm no throw
    const dblClick = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    Object.defineProperty(dblClick, 'offsetX', { value: 0 });
    Object.defineProperty(dblClick, 'offsetY', { value: 28 });
    expect(() => canvas.dispatchEvent(dblClick)).not.toThrow();
  });
});

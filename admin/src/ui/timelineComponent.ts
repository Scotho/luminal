// admin/src/ui/timelineComponent.ts — Horizontal swim-lane agent timeline (canvas-based)

export interface TimelineSession {
  id: string;
  label: string;
  backend: 'cc' | 'ollama' | 'aider';
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: number;
  duration: number | null;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  id: string;
  type: string;
  startMs: number;
  durationMs: number;
  status: 'running' | 'done' | 'error';
  preview: string;
}

export interface TimelineController {
  setSessions(sessions: TimelineSession[]): void;
  addEvent(sessionId: string, event: TimelineEvent): void;
  setZoom(pixelsPerSecond: number): void;
  destroy(): void;
}

export interface TimelineOptions {
  onSegmentClick?: (sessionId: string, eventId: string) => void;
  onSegmentJump?: (sessionId: string, eventId: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const LANE_HEIGHT = 36;
const GUTTER_WIDTH = 140;
const TIME_AXIS_HEIGHT = 24;

const EVENT_COLORS: Record<string, string> = {
  Read: 'rgba(110, 224, 240, 0.6)',
  Glob: 'rgba(110, 224, 240, 0.6)',
  Grep: 'rgba(110, 224, 240, 0.6)',
  Edit: 'rgba(60, 255, 60, 0.6)',
  Write: 'rgba(60, 255, 60, 0.6)',
  Bash: 'rgba(252, 116, 30, 0.6)',
  Agent: 'rgba(170, 100, 255, 0.6)',
  default: 'rgba(128, 164, 174, 0.3)',
};

// ── CSS class mapping for event types (kept for compat) ───────────────────────

const TYPE_CLASS: Record<string, string> = {
  Read: 'tl-type-read',
  Write: 'tl-type-edit',
  Edit: 'tl-type-edit',
  Glob: 'tl-type-read',
  Grep: 'tl-type-read',
  Bash: 'tl-type-bash',
  Agent: 'tl-type-agent',
  text: 'tl-type-text',
  tool: 'tl-type-text',
};

function typeClass(type: string): string {
  return TYPE_CLASS[type] ?? 'tl-type-text';
}

// ── Rendering helpers ────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function backendLabel(backend: string): string {
  if (backend === 'cc') return 'CC';
  if (backend === 'ollama') return 'Qwen';
  if (backend === 'aider') return 'Aider';
  return backend;
}

// ── Filter state ─────────────────────────────────────────────────────────────

interface FilterState {
  backends: Set<string>;
  statuses: Set<string>;
  timeRange: 'hour' | 'today' | 'all';
}

// ── Hit rect for canvas event picking ────────────────────────────────────────

interface EventRect {
  sessionId: string;
  eventId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── createTimeline ───────────────────────────────────────────────────────────

export function createTimeline(
  container: HTMLElement,
  options: TimelineOptions = {},
): TimelineController {
  let sessions: TimelineSession[] = [];
  // pixelsPerMs = pixelsPerSecond / 1000; default 2px/s
  let _pixelsPerMs = 0.002;
  let _scrollOffset = 0;
  const filter: FilterState = {
    backends: new Set(['cc', 'ollama', 'aider']),
    statuses: new Set(['running', 'done', 'error', 'cancelled']),
    timeRange: 'all',
  };

  let _eventRects: EventRect[] = [];
  let _rafPending = false;
  let _frameCounter = 0;
  let _animFrameId = 0;
  let _dragging = false;
  let _dragStartX = 0;

  // ── Build skeleton DOM ─────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="cc-timeline">
      <div class="cc-timeline-filters">
        <span class="tl-filter-label">Backend:</span>
        <button class="tl-filter-btn tl-filter-active" data-filter-backend="cc">CC</button>
        <button class="tl-filter-btn tl-filter-active" data-filter-backend="ollama">Qwen</button>
        <button class="tl-filter-btn tl-filter-active" data-filter-backend="aider">Aider</button>
        <span class="tl-filter-sep"></span>
        <span class="tl-filter-label">Status:</span>
        <button class="tl-filter-btn tl-filter-active" data-filter-status="running">Running</button>
        <button class="tl-filter-btn tl-filter-active" data-filter-status="done">Done</button>
        <button class="tl-filter-btn tl-filter-active" data-filter-status="error">Error</button>
        <span class="tl-filter-sep"></span>
        <span class="tl-filter-label">Range:</span>
        <select class="cc-timeline-range" aria-label="Time range">
          <option value="all">All</option>
          <option value="today">Today</option>
          <option value="hour">Last hour</option>
        </select>
      </div>
      <div class="cc-timeline-body" style="display:flex;overflow:hidden;">
        <div class="cc-timeline-gutters" style="width:${GUTTER_WIDTH}px;flex-shrink:0;"></div>
        <canvas class="cc-timeline-canvas" style="flex:1;display:block;"></canvas>
      </div>
      <div class="cc-timeline-tooltip" style="display:none;position:absolute;pointer-events:none;"></div>
      <div class="cc-timeline-lanes" style="display:none;"></div>
    </div>
  `;

  const root = container.querySelector('.cc-timeline') as HTMLElement;
  const guttersEl = container.querySelector('.cc-timeline-gutters') as HTMLElement;
  const canvas = container.querySelector('.cc-timeline-canvas') as HTMLCanvasElement;
  const tooltipEl = container.querySelector('.cc-timeline-tooltip') as HTMLElement;
  const lanesEl = container.querySelector('.cc-timeline-lanes') as HTMLElement;
  const rangeSelect = container.querySelector('.cc-timeline-range') as HTMLSelectElement;

  // ── Resize canvas to match display size ───────────────────────────────────

  function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // ── Visible sessions (filter applied) ─────────────────────────────────────

  function filteredSessions(): TimelineSession[] {
    const now = Date.now();
    return sessions.filter(s => {
      if (!filter.backends.has(s.backend)) return false;
      if (!filter.statuses.has(s.status)) return false;
      if (filter.timeRange === 'hour' && now - s.startedAt > 60 * 60 * 1000) return false;
      if (filter.timeRange === 'today') {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        if (s.startedAt < midnight.getTime()) return false;
      }
      return true;
    });
  }

  // ── Time axis drawing ─────────────────────────────────────────────────────

  function drawTimeAxis(ctx: CanvasRenderingContext2D, w: number): void {
    ctx.save();
    ctx.fillStyle = 'rgba(30, 40, 50, 0.9)';
    ctx.fillRect(0, 0, w, TIME_AXIS_HEIGHT);

    ctx.strokeStyle = 'rgba(100, 160, 180, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TIME_AXIS_HEIGHT);
    ctx.lineTo(w, TIME_AXIS_HEIGHT);
    ctx.stroke();

    ctx.fillStyle = 'rgba(160, 200, 210, 0.9)';
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';

    // Determine tick interval
    let intervalMs: number;
    let labelFn: (t: number) => string;

    if (_pixelsPerMs * 1000 > 50) {
      // Show seconds
      intervalMs = 1000;
      labelFn = (t) => `${Math.round(t / 1000)}s`;
    } else if (_pixelsPerMs * 60000 > 50) {
      // Show minutes
      intervalMs = 60000;
      labelFn = (t) => `${Math.round(t / 60000)}m`;
    } else {
      // Show hours
      intervalMs = 3600000;
      labelFn = (t) => `${Math.round(t / 3600000)}h`;
    }

    const totalMs = w / _pixelsPerMs;
    const offsetMs = -_scrollOffset / _pixelsPerMs;
    const startMs = Math.floor(offsetMs / intervalMs) * intervalMs;
    const endMs = offsetMs + totalMs;

    for (let t = startMs; t <= endMs; t += intervalMs) {
      const x = (t - offsetMs) * _pixelsPerMs;
      if (x < 0 || x > w) continue;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(100, 160, 180, 0.5)';
      ctx.moveTo(x, TIME_AXIS_HEIGHT - 6);
      ctx.lineTo(x, TIME_AXIS_HEIGHT);
      ctx.stroke();
      ctx.fillText(labelFn(t), x + 3, TIME_AXIS_HEIGHT / 2);
    }
    ctx.restore();
  }

  // ── Grid lines ────────────────────────────────────────────────────────────

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, laneCount: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 160, 180, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= laneCount; i++) {
      const y = TIME_AXIS_HEIGHT + i * LANE_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Checkmark drawing ─────────────────────────────────────────────────────

  function drawCheckmark(ctx: CanvasRenderingContext2D, x: number, cy: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(60, 220, 60, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, cy + 3);
    ctx.lineTo(x + 4, cy + 7);
    ctx.lineTo(x + 9, cy - 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function _render(): void {
    _rafPending = false;
    _frameCounter++;
    _eventRects = [];

    resizeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const visible = filteredSessions();

    // Empty state via DOM (canvas cleared)
    if (visible.length === 0) {
      lanesEl.innerHTML = `<div class="cc-timeline-empty">No agent sessions</div>`;
      lanesEl.style.display = 'block';
      guttersEl.innerHTML = '';
      return;
    }
    lanesEl.style.display = 'none';

    // Canvas height: time axis + lanes
    const neededH = TIME_AXIS_HEIGHT + visible.length * LANE_HEIGHT;
    if (canvas.height !== neededH && canvas.getBoundingClientRect().height === 0) {
      canvas.style.height = `${neededH}px`;
      canvas.height = neededH;
    }

    drawTimeAxis(ctx, w);
    drawGrid(ctx, w, canvas.height, visible.length);

    // Compute minTime for offset anchoring
    const minTime = visible.reduce((min, s) => Math.min(min, s.startedAt), Infinity);
    const nowMs = Date.now();

    // Running pulse alpha
    const pulse = 0.4 + 0.4 * Math.abs(Math.sin(_frameCounter * 0.05));

    // Render gutters (DOM) and events (canvas)
    guttersEl.innerHTML = visible.map((s, i) => {
      const top = TIME_AXIS_HEIGHT + i * LANE_HEIGHT;
      return `<div class="cc-timeline-lane" data-session-id="${escHtml(s.id)}" style="position:absolute;top:${top}px;left:0;width:${GUTTER_WIDTH}px;height:${LANE_HEIGHT}px;overflow:hidden;">
        <div class="cc-timeline-gutter" style="height:100%;display:flex;align-items:center;padding:0 6px;gap:4px;" title="${escHtml(s.label)}">
          <span class="tl-backend tl-backend-${s.backend}">${escHtml(backendLabel(s.backend))}</span>
          <span class="tl-lane-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(s.label)}</span>
        </div>
      </div>`;
    }).join('');
    guttersEl.style.position = 'relative';
    guttersEl.style.height = `${TIME_AXIS_HEIGHT + visible.length * LANE_HEIGHT}px`;

    visible.forEach((session, laneIdx) => {
      const laneY = TIME_AXIS_HEIGHT + laneIdx * LANE_HEIGHT;
      const sessionOffset = (session.startedAt - minTime) * _pixelsPerMs;

      session.events.forEach(event => {
        const x = sessionOffset + event.startMs * _pixelsPerMs + _scrollOffset;
        const eventW = Math.max(event.durationMs * _pixelsPerMs, 2);
        const segY = laneY + 4;
        const segH = LANE_HEIGHT - 8;

        const isRunning = event.status === 'running';
        const baseColor = EVENT_COLORS[event.type] ?? EVENT_COLORS['default'];

        if (isRunning) {
          // Parse rgba and apply pulse alpha
          const match = baseColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
          if (match) {
            ctx.fillStyle = `rgba(${match[1]},${match[2]},${match[3]},${pulse})`;
          } else {
            ctx.fillStyle = baseColor;
          }
        } else {
          ctx.fillStyle = baseColor;
        }

        ctx.fillRect(x, segY, eventW, segH);

        // Error marker: red circle
        if (event.status === 'error') {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
          ctx.beginPath();
          ctx.arc(x, segY, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        _eventRects.push({ sessionId: session.id, eventId: event.id, x, y: segY, w: eventW, h: segH });
      });

      // Completed session: green checkmark at lane end
      if (session.status === 'done') {
        const totalDurationMs = session.duration ?? (nowMs - session.startedAt);
        const endX = sessionOffset + totalDurationMs * _pixelsPerMs + _scrollOffset;
        const cy = laneY + LANE_HEIGHT / 2;
        drawCheckmark(ctx, endX + 4, cy);
      }
    });
  }

  // ── Schedule render ───────────────────────────────────────────────────────

  function scheduleRender(): void {
    if (_rafPending) return;
    _rafPending = true;
    _animFrameId = requestAnimationFrame(() => _render());
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  function hitTest(x: number, y: number): { sessionId: string; eventId: string } | null {
    for (const rect of _eventRects) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return { sessionId: rect.sessionId, eventId: rect.eventId };
      }
    }
    return null;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function showTooltip(x: number, y: number, hit: { sessionId: string; eventId: string }): void {
    const session = sessions.find(s => s.id === hit.sessionId);
    const event = session?.events.find(e => e.id === hit.eventId);
    if (!event) return;
    const durS = (event.durationMs / 1000).toFixed(2);
    tooltipEl.innerHTML = `<strong>${escHtml(event.type)}</strong> ${durS}s<br>${escHtml(event.preview.slice(0, 80))}`;
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = `${x + 12}px`;
    tooltipEl.style.top = `${y + 8}px`;
  }

  function hideTooltip(): void {
    tooltipEl.style.display = 'none';
  }

  // ── Canvas event listeners ─────────────────────────────────────────────────

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    _pixelsPerMs *= zoomFactor;
    _pixelsPerMs = Math.max(0.0005, Math.min(0.02, _pixelsPerMs));
    scheduleRender();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (!hitTest(e.offsetX, e.offsetY)) {
      _dragging = true;
      _dragStartX = e.offsetX;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (_dragging) {
      _scrollOffset += e.offsetX - _dragStartX;
      _dragStartX = e.offsetX;
      scheduleRender();
    }
    const hit = hitTest(e.offsetX, e.offsetY);
    if (hit) showTooltip(e.offsetX, e.offsetY, hit);
    else hideTooltip();
  });

  canvas.addEventListener('mouseup', () => { _dragging = false; });

  canvas.addEventListener('mouseleave', () => {
    _dragging = false;
    hideTooltip();
  });

  canvas.addEventListener('dblclick', (e) => {
    const hit = hitTest(e.offsetX, e.offsetY);
    if (hit && options.onSegmentJump) {
      options.onSegmentJump(hit.sessionId, hit.eventId);
    }
  });

  canvas.addEventListener('click', (e) => {
    const hit = hitTest(e.offsetX, e.offsetY);
    if (hit && options.onSegmentClick) {
      options.onSegmentClick(hit.sessionId, hit.eventId);
    }
  });

  // ── DOM mirror click delegation (for onSegmentClick) ─────────────────────

  lanesEl.addEventListener('click', (e) => {
    const seg = (e.target as HTMLElement).closest('.cc-timeline-event') as HTMLElement | null;
    if (!seg) return;
    const sessionId = seg.getAttribute('data-session-id') ?? '';
    const eventId = seg.getAttribute('data-event-id') ?? '';
    if (sessionId && eventId && options.onSegmentClick) {
      options.onSegmentClick(sessionId, eventId);
    }
  });

  // ── Filter bar wiring ─────────────────────────────────────────────────────

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-filter-backend],[data-filter-status]') as HTMLElement | null;
    if (!btn) return;

    const backend = btn.getAttribute('data-filter-backend');
    const status = btn.getAttribute('data-filter-status');

    if (backend) {
      if (filter.backends.has(backend)) {
        filter.backends.delete(backend);
        btn.classList.remove('tl-filter-active');
      } else {
        filter.backends.add(backend);
        btn.classList.add('tl-filter-active');
      }
    }
    if (status) {
      if (filter.statuses.has(status)) {
        filter.statuses.delete(status);
        btn.classList.remove('tl-filter-active');
      } else {
        filter.statuses.add(status);
        btn.classList.add('tl-filter-active');
      }
    }
    renderAll();
  });

  rangeSelect.addEventListener('change', () => {
    filter.timeRange = rangeSelect.value as FilterState['timeRange'];
    scheduleRender();
  });

  // ── Backward-compat DOM lane rendering (for tests that need DOM elements) ──
  // We also maintain a hidden DOM structure mirroring the canvas state so that
  // existing integration code can still query lanes/events if needed.

  function renderDomMirror(visible: TimelineSession[]): void {
    if (visible.length === 0) {
      lanesEl.innerHTML = `<div class="cc-timeline-empty">No agent sessions</div>`;
      lanesEl.style.display = 'block';
    } else {
      lanesEl.style.display = 'none';
      lanesEl.innerHTML = visible.map(s => {
        const eventsHtml = s.events.map(ev => {
          const left = Math.round((ev.startMs / 1000) * (_pixelsPerMs * 1000));
          const width = Math.max(4, Math.round((ev.durationMs / 1000) * (_pixelsPerMs * 1000)));
          const cls = [
            'cc-timeline-event',
            typeClass(ev.type),
            `tl-status-${ev.status}`,
          ].join(' ');
          return `<div
            class="${cls}"
            data-session-id="${escHtml(s.id)}"
            data-event-id="${escHtml(ev.id)}"
            title="${escHtml(ev.preview)}"
            style="left:${left}px;width:${width}px;"
          ></div>`;
        }).join('');
        return `<div class="cc-timeline-lane" data-session-id="${escHtml(s.id)}">
          <div class="cc-timeline-gutter" title="${escHtml(s.label)}">
            <span class="tl-backend tl-backend-${s.backend}">${escHtml(backendLabel(s.backend))}</span>
            <span class="tl-lane-label">${escHtml(s.label)}</span>
          </div>
          <div class="cc-timeline-track">${eventsHtml}</div>
        </div>`;
      }).join('');
    }
  }

  // ── Full render (canvas + DOM mirror) ─────────────────────────────────────

  function renderAll(): void {
    const visible = filteredSessions();
    renderDomMirror(visible);
    scheduleRender();
  }

  // ── Controller ────────────────────────────────────────────────────────────

  function setSessions(newSessions: TimelineSession[]): void {
    sessions = [...newSessions];
    renderAll();
  }

  function addEvent(sessionId: string, event: TimelineEvent): void {
    const s = sessions.find(s => s.id === sessionId);
    if (s) {
      s.events.push(event);
      renderAll();
    }
  }

  function setZoom(pixelsPerSecond: number): void {
    _pixelsPerMs = pixelsPerSecond / 1000;
    renderAll();
  }

  function destroy(): void {
    cancelAnimationFrame(_animFrameId);
    container.innerHTML = '';
  }

  // Initial render (empty)
  renderAll();

  return { setSessions, addEvent, setZoom, destroy };
}

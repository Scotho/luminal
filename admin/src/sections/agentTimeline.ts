// admin/src/sections/agentTimeline.ts — Agent Timeline section
//
// Subscribes to the CC session manager and renders a swim-lane timeline
// of all agent sessions into #section-agent-timeline.

import { sessionManager } from '../ui/ccSessionManager';
import { createTimeline } from '../ui/timelineComponent';
import type { TimelineSession, TimelineEvent, TimelineController } from '../ui/timelineComponent';
import type { CCSession, CCCard } from '../types';

// ── Conversion helpers ───────────────────────────────────────────────────────

function cardToEvent(card: CCCard, sessionStartedAt: number): TimelineEvent {
  const startMs = card.ts - sessionStartedAt;
  return {
    id: card.id,
    type: card.type === 'tool' ? (card.title ?? 'tool') : card.type,
    startMs: Math.max(0, startMs),
    durationMs: 500, // cards don't carry duration; use a fixed visual width
    status: card.toolStatus ?? (card.type === 'error' ? 'error' : 'done'),
    preview: card.preview ?? card.title ?? '',
  };
}

function sessionToTimeline(s: CCSession): TimelineSession {
  const events: TimelineEvent[] = s.cards.map(c => cardToEvent(c, s.startedAt));
  return {
    id: s.id,
    label: s.label,
    backend: s.backend,
    status: s.status as TimelineSession['status'],
    startedAt: s.startedAt,
    duration: s.duration,
    events,
  };
}

// ── initAgentTimeline ────────────────────────────────────────────────────────

export function initAgentTimeline(): void {
  const container = document.getElementById('section-agent-timeline');
  if (!container) return;

  let ctrl: TimelineController | null = null;

  function refresh(): void {
    const tlSessions = sessionManager.getAllSessions().map(sessionToTimeline);

    if (!ctrl) {
      ctrl = createTimeline(container!, {
        onSegmentClick: (sessionId, eventId) => {
          // Select the CC session and scroll to the card
          sessionManager.selectedId = sessionId;
          const el = document.querySelector(`[data-card-id="${eventId}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        },
      });
    }

    ctrl.setSessions(tlSessions);
  }

  // Initial render
  refresh();

  // Subscribe to future changes
  sessionManager.onChange(refresh);
}

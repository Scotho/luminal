// ── Sessions section tests ──────────────────────────────────
import { describe, it, expect } from 'vitest';
import { renderSessionCard, sortSessions, getSessionsBySection } from '../sections/sessions';
import type { Session, AgentTask } from '../types';

// ── Fixtures ────────────────────────────────────────────────

const activeSession: Session = {
  id: 'sess-001',
  summary: 'Implement spatial audio system',
  type: 'feature',
  status: 'active',
  section: 'current-stack',
  phases: [
    { label: 'Design', done: true },
    { label: 'Implement', done: false },
    { label: 'Test', done: false },
  ],
  plan: 'Build spatial audio with HRTF panning.',
  branch: 'feat/spatial-audio',
  specPath: 'specs/spatial-audio.md',
  notes: [
    { ts: '2026-04-03T10:00:00Z', text: 'Started implementation' },
    { ts: '2026-04-04T14:00:00Z', text: 'Panning logic done' },
  ],
  created: '2026-04-02T08:00:00Z',
};

const doneSession: Session = {
  id: 'sess-002',
  summary: 'Fix lobby disconnect bug',
  type: 'bugfix',
  status: 'done',
  section: 'current-stack',
  phases: [
    { label: 'Investigate', done: true },
    { label: 'Fix', done: true },
  ],
  plan: 'Track down and fix lobby disconnect.',
  notes: [],
  created: '2026-04-01T09:00:00Z',
  completed: '2026-04-03T12:00:00Z',
};

const blockedSession: Session = {
  id: 'sess-003',
  summary: 'Ranked matchmaking integration',
  type: 'feature',
  status: 'blocked',
  section: 'current-stack',
  phases: [],
  plan: 'Integrate MMR-based matchmaking.',
  notes: [{ ts: '2026-04-03T08:00:00Z', text: 'Waiting on backend API' }],
  created: '2026-04-01T10:00:00Z',
};

const todoSession: Session = {
  id: 'sess-004',
  summary: 'Add replay export feature',
  type: 'feature',
  status: 'todo',
  section: 'backlog',
  phases: [],
  plan: 'Allow players to export replays.',
  notes: [],
  created: '2026-04-01T11:00:00Z',
};

const doneFollowupSession: Session = {
  id: 'sess-005',
  summary: 'Polish leaderboard UI',
  type: 'polish',
  status: 'done-followup',
  section: 'backlog',
  phases: [{ label: 'Design', done: true }, { label: 'Review', done: false }],
  plan: 'Clean up leaderboard styles.',
  notes: [],
  created: '2026-03-30T08:00:00Z',
};

const needsAttentionSession: Session = {
  id: 'sess-006',
  summary: 'Desync recovery logic',
  type: 'tuning',
  status: 'needs-attention',
  section: 'current-stack',
  phases: [],
  plan: 'Handle game state desync.',
  notes: [],
  created: '2026-04-02T07:00:00Z',
};

const xssSession: Session = {
  id: 'sess-xss',
  summary: '<script>alert("xss")</script>',
  type: 'feature',
  status: 'active',
  section: 'current-stack',
  phases: [],
  plan: '',
  notes: [],
  created: '2026-04-04T10:00:00Z',
};

const agentTasks: AgentTask[] = [
  { id: 'at-1', sessionId: 'sess-001', prompt: 'Run linter on spatial audio module', agentStatus: 'done' },
  { id: 'at-2', sessionId: 'sess-001', prompt: 'Generate test stubs for HRTF panner', agentStatus: 'running' },
  { id: 'at-3', sessionId: 'sess-001', prompt: 'Check type errors in audio context', agentStatus: 'error' },
  { id: 'at-4', sessionId: 'sess-001', prompt: 'Stub out integration test', agentStatus: 'pending' },
];

// ── renderSessionCard ───────────────────────────────────────

describe('renderSessionCard', () => {
  it('renders session summary text', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('Implement spatial audio system');
  });

  it('renders status badge with correct label for done', () => {
    const html = renderSessionCard(doneSession, []);
    expect(html).toContain('Done');
  });

  it('renders status badge with correct label for active', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('Active');
  });

  it('renders status badge with correct label for blocked', () => {
    const html = renderSessionCard(blockedSession, []);
    expect(html).toContain('Blocked');
  });

  it('renders status badge with correct label for todo', () => {
    const html = renderSessionCard(todoSession, []);
    expect(html).toContain('To Do');
  });

  it('renders status badge with correct label for done-followup', () => {
    const html = renderSessionCard(doneFollowupSession, []);
    expect(html).toContain('Follow-up');
  });

  it('renders status badge with correct label for needs-attention', () => {
    const html = renderSessionCard(needsAttentionSession, []);
    expect(html).toContain('Needs Attention');
  });

  it('applies green status color for done', () => {
    const html = renderSessionCard(doneSession, []);
    expect(html).toContain('var(--green)');
  });

  it('applies accent status color for active', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('var(--accent)');
  });

  it('applies red status color for blocked', () => {
    const html = renderSessionCard(blockedSession, []);
    expect(html).toContain('var(--red)');
  });

  it('applies opacity 0.6 for done sessions', () => {
    const html = renderSessionCard(doneSession, []);
    expect(html).toContain('opacity:0.6');
  });

  it('applies opacity 0.8 for done-followup sessions', () => {
    const html = renderSessionCard(doneFollowupSession, []);
    expect(html).toContain('opacity:0.8');
  });

  it('applies opacity 0.6 for todo sessions', () => {
    const html = renderSessionCard(todoSession, []);
    expect(html).toContain('opacity:0.6');
  });

  it('applies opacity 1 for active sessions', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('opacity:1');
  });

  it('renders type pill with correct text', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('feature');
  });

  it('renders BLOCKED overlay for blocked sessions', () => {
    const html = renderSessionCard(blockedSession, []);
    expect(html).toContain('BLOCKED');
  });

  it('applies red border for blocked sessions', () => {
    const html = renderSessionCard(blockedSession, []);
    expect(html).toContain('border:1px solid var(--red)');
  });

  it('renders phase checkboxes with check for done phases', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('☑ Design');
  });

  it('renders phase checkboxes with empty box for pending phases', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('☐ Implement');
    expect(html).toContain('☐ Test');
  });

  it('displays agent task count when tasks exist', () => {
    const html = renderSessionCard(activeSession, agentTasks);
    expect(html).toContain('4 agent tasks');
  });

  it('does not display agent task count when no tasks', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).not.toContain('agent task');
  });

  it('displays notes count when notes exist', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('2 notes');
  });

  it('renders branch when present', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('feat/spatial-audio');
    expect(html).toContain('Branch:');
  });

  it('does not render branch when absent', () => {
    const html = renderSessionCard(todoSession, []);
    expect(html).not.toContain('Branch:');
  });

  it('renders spec path when present', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('specs/spatial-audio.md');
    expect(html).toContain('Spec:');
  });

  it('sorts notes most recent first in timeline', () => {
    const html = renderSessionCard(activeSession, []);
    const panningIdx = html.indexOf('Panning logic done');
    const startedIdx = html.indexOf('Started implementation');
    expect(panningIdx).toBeLessThan(startedIdx);
  });

  it('renders agent task emoji 🟢 for done status', () => {
    const html = renderSessionCard(activeSession, agentTasks);
    expect(html).toContain('&#x1F7E2;');
  });

  it('renders agent task emoji 🔵 for running status', () => {
    const html = renderSessionCard(activeSession, agentTasks);
    expect(html).toContain('&#x1F535;');
  });

  it('renders agent task emoji 🔴 for error status', () => {
    const html = renderSessionCard(activeSession, agentTasks);
    expect(html).toContain('&#x1F534;');
  });

  it('renders agent task emoji ⚪ for pending status', () => {
    const html = renderSessionCard(activeSession, agentTasks);
    expect(html).toContain('&#x26AA;');
  });

  it('shows stale indicator for active sessions idle >24h', () => {
    // Set now to 48 hours after the latest note (2026-04-04T14:00:00Z)
    const latestNoteTime = new Date('2026-04-04T14:00:00Z').getTime();
    const now = latestNoteTime + 25 * 60 * 60 * 1000; // 25 hours later
    const html = renderSessionCard(activeSession, [], now);
    expect(html).toContain('●');
    expect(html).toContain('stale');
  });

  it('does not show stale indicator for non-active sessions even if old', () => {
    const now = new Date('2026-05-01T00:00:00Z').getTime(); // far future
    const html = renderSessionCard(todoSession, [], now);
    expect(html).not.toContain('stale');
  });

  it('includes data-session-id attribute', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('data-session-id="sess-001"');
  });

  it('includes data-status attribute', () => {
    const html = renderSessionCard(activeSession, []);
    expect(html).toContain('data-status="active"');
  });

  it('escapes HTML in summary to prevent XSS', () => {
    const html = renderSessionCard(xssSession, []);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ── sortSessions ────────────────────────────────────────────

describe('sortSessions', () => {
  it('places current-stack sessions before backlog', () => {
    const sessions = [todoSession, activeSession];
    const sorted = sortSessions(sessions);
    expect(sorted[0].section).toBe('current-stack');
    expect(sorted[1].section).toBe('backlog');
  });

  it('sorts newest first within the same section', () => {
    const sessions = [doneSession, activeSession]; // doneSession created 04-01, activeSession created 04-02
    const sorted = sortSessions(sessions);
    expect(sorted[0].id).toBe('sess-001'); // activeSession (newer)
    expect(sorted[1].id).toBe('sess-002'); // doneSession (older)
  });

  it('does not mutate the original array', () => {
    const sessions = [todoSession, activeSession];
    const original = [...sessions];
    sortSessions(sessions);
    expect(sessions).toEqual(original);
  });

  it('handles empty array', () => {
    expect(sortSessions([])).toEqual([]);
  });

  it('handles mixed sections correctly', () => {
    const sessions = [todoSession, doneFollowupSession, activeSession, blockedSession];
    const sorted = sortSessions(sessions);
    // current-stack first (activeSession, blockedSession), then backlog (todoSession, doneFollowupSession)
    expect(sorted[0].section).toBe('current-stack');
    expect(sorted[1].section).toBe('current-stack');
    expect(sorted[2].section).toBe('backlog');
    expect(sorted[3].section).toBe('backlog');
  });
});

// ── getSessionsBySection ────────────────────────────────────

describe('getSessionsBySection', () => {
  const allSessions = [activeSession, doneSession, blockedSession, todoSession, doneFollowupSession];

  it('returns only current-stack sessions', () => {
    const result = getSessionsBySection(allSessions, 'current-stack');
    expect(result.every(s => s.section === 'current-stack')).toBe(true);
    expect(result.length).toBe(3); // activeSession, doneSession, blockedSession
  });

  it('returns only backlog sessions', () => {
    const result = getSessionsBySection(allSessions, 'backlog');
    expect(result.every(s => s.section === 'backlog')).toBe(true);
    expect(result.length).toBe(2); // todoSession, doneFollowupSession
  });

  it('returns empty array when no sessions match', () => {
    const currentOnly = [activeSession, doneSession];
    const result = getSessionsBySection(currentOnly, 'backlog');
    expect(result).toEqual([]);
  });
});

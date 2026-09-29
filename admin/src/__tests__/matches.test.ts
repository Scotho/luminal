// ── Matches section tests ──────────────────────────────────
import { describe, it, expect, vi } from 'vitest';

// Mock firebase and store before importing
vi.mock('../firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('../store', () => ({
  loadSnapshot: vi.fn().mockResolvedValue(null),
  saveSnapshot: vi.fn(),
}));

vi.mock('../ui/render', () => ({
  sectionHeader: (title: string) => `<h2>${title}</h2>`,
  statCard: (value: unknown, label: string) => `<div class="stat">${value} ${label}</div>`,
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
}));

import { computeSummary, formatDuration } from '../sections/matches';
import type { MatchDoc } from '../types';

// ── Helpers ─────────────────────────────────────────────────

function makeMatch(overrides: Partial<MatchDoc> = {}): MatchDoc {
  return {
    players: [
      { uid: 'u1', username: 'Alice', color: 0, vehicle: 'default' },
      { uid: 'u2', username: 'Bob', color: 1, vehicle: 'default' },
    ],
    result: 'win',
    winnerUid: 'u1',
    series: 3,
    matchType: 'casual',
    duration: 120,
    map: 'grid',
    createdAt: { seconds: 1700000000, nanoseconds: 0 },
    ...overrides,
  };
}

// ── formatDuration ──────────────────────────────────────────

describe('formatDuration', () => {
  it('formats zero seconds as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats seconds less than a minute', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(180)).toBe('3:00');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('pads single-digit seconds with leading zero', () => {
    expect(formatDuration(61)).toBe('1:01');
    expect(formatDuration(69)).toBe('1:09');
  });

  it('handles large values', () => {
    expect(formatDuration(3661)).toBe('61:01');
  });
});

// ── computeSummary ──────────────────────────────────────────

describe('computeSummary', () => {
  it('returns zero counts for empty array', () => {
    const result = computeSummary([]);
    expect(result.total).toBe(0);
    expect(result.ai).toBe(0);
    expect(result.casual).toBe(0);
    expect(result.online).toBe(0);
    expect(result.avgDuration).toBe(0);
  });

  it('counts AI matches', () => {
    const matches = [makeMatch({ matchType: 'ai' }), makeMatch({ matchType: 'ai' })];
    const result = computeSummary(matches);
    expect(result.ai).toBe(2);
    expect(result.casual).toBe(0);
  });

  it('counts casual matches', () => {
    const matches = [makeMatch({ matchType: 'casual' })];
    const result = computeSummary(matches);
    expect(result.casual).toBe(1);
  });

  it('counts online matches (anything not ai or casual)', () => {
    const matches = [makeMatch({ matchType: 'ranked' }), makeMatch({ matchType: 'online' })];
    const result = computeSummary(matches);
    expect(result.online).toBe(2);
  });

  it('computes correct average duration', () => {
    const matches = [
      makeMatch({ duration: 60 }),
      makeMatch({ duration: 120 }),
      makeMatch({ duration: 180 }),
    ];
    const result = computeSummary(matches);
    expect(result.avgDuration).toBe(120);
  });

  it('rounds average duration to nearest integer', () => {
    const matches = [
      makeMatch({ duration: 10 }),
      makeMatch({ duration: 11 }),
    ];
    const result = computeSummary(matches);
    // (10 + 11) / 2 = 10.5 → rounds to 11
    expect(result.avgDuration).toBe(11);
  });

  it('handles missing duration gracefully', () => {
    const matches = [makeMatch({ duration: undefined as any }), makeMatch({ duration: 60 })];
    const result = computeSummary(matches);
    // undefined || 0 → 0, so total = 60, avg = 30
    expect(result.avgDuration).toBe(30);
  });

  it('returns correct total', () => {
    const matches = [
      makeMatch({ matchType: 'ai' }),
      makeMatch({ matchType: 'casual' }),
      makeMatch({ matchType: 'online' }),
    ];
    const result = computeSummary(matches);
    expect(result.total).toBe(3);
  });
});

// ── renderMatches ───────────────────────────────────────────

describe('renderMatches', () => {
  it('renders without crashing when no snapshot exists', async () => {
    const { renderMatches } = await import('../sections/matches');
    const container = document.createElement('div');
    container.id = 'section-matches';
    document.body.appendChild(container);

    await renderMatches(container);

    expect(container.innerHTML).toContain('Matches');
    expect(container.innerHTML).toContain('No snapshot yet');

    document.body.removeChild(container);
  });
});

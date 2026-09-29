// ── Users section tests ────────────────────────────────────
import { describe, it, expect, vi } from 'vitest';

// Mock firebase and store before importing
vi.mock('../firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
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

import { computeSummary } from '../sections/users';
import type { UserDoc } from '../types';

// ── Helpers ─────────────────────────────────────────────────

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    uid: 'uid-1',
    username: 'TestUser',
    icon: 'default',
    about: '',
    color: 0,
    createdAt: { seconds: 1700000000, nanoseconds: 0 },
    socials: { discord: '', steam: '', twitch: '', youtube: '' },
    ...overrides,
  };
}

// ── computeSummary ──────────────────────────────────────────

describe('computeSummary', () => {
  it('returns zero counts for empty array', () => {
    const result = computeSummary([]);
    expect(result.total).toBe(0);
    expect(result.real).toBe(0);
    expect(result.anonymous).toBe(0);
    expect(result.withProfile).toBe(0);
  });

  it('counts a user with username as real', () => {
    const result = computeSummary([makeUser({ username: 'Alice' })]);
    expect(result.real).toBe(1);
    expect(result.anonymous).toBe(0);
  });

  it('counts a user without username as anonymous', () => {
    const result = computeSummary([makeUser({ username: '' })]);
    expect(result.real).toBe(0);
    expect(result.anonymous).toBe(1);
  });

  it('counts user with non-default icon as withProfile', () => {
    const result = computeSummary([makeUser({ username: 'Alice', icon: 'custom-avatar' })]);
    expect(result.withProfile).toBe(1);
  });

  it('does not count user with default icon as withProfile', () => {
    const result = computeSummary([makeUser({ username: 'Alice', icon: 'default' })]);
    expect(result.withProfile).toBe(0);
  });

  it('does not count anonymous user as withProfile even with custom icon', () => {
    const result = computeSummary([makeUser({ username: '', icon: 'custom-avatar' })]);
    expect(result.withProfile).toBe(0);
  });

  it('returns correct total', () => {
    const users = [
      makeUser({ uid: '1', username: 'Alice', icon: 'custom' }),
      makeUser({ uid: '2', username: 'Bob', icon: 'default' }),
      makeUser({ uid: '3', username: '' }),
    ];
    const result = computeSummary(users);
    expect(result.total).toBe(3);
    expect(result.real).toBe(2);
    expect(result.anonymous).toBe(1);
    expect(result.withProfile).toBe(1);
  });

  it('returns an empty providers record', () => {
    const result = computeSummary([makeUser()]);
    expect(result.providers).toEqual({});
  });
});

// ── renderUsers ─────────────────────────────────────────────

describe('renderUsers', () => {
  it('renders without crashing when no snapshot exists', async () => {
    const { renderUsers } = await import('../sections/users');
    const container = document.createElement('div');
    container.id = 'section-users';
    document.body.appendChild(container);

    await renderUsers(container);

    expect(container.innerHTML).toContain('Users');
    expect(container.innerHTML).toContain('No snapshot yet');

    document.body.removeChild(container);
  });
});

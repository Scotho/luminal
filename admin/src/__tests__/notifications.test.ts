import { describe, it, expect } from 'vitest';
import { renderNotificationCard, renderNotificationFilter, relativeTime } from '../sections/notifications';
import type { NotificationEntry } from '../types';

const entry: NotificationEntry = {
  id: 'notif-001',
  type: 'task:done',
  title: 'Task completed',
  message: 'Remove empty catches — code-hygiene',
  ts: new Date().toISOString(),
};

const bugEntry: NotificationEntry = {
  id: 'notif-002',
  type: 'bug:new',
  title: 'New bug report',
  message: 'user1: TypeError in lobby',
  ts: new Date(Date.now() - 3600_000).toISOString(), // 1h ago
};

describe('renderNotificationCard', () => {
  it('renders the message text', () => {
    const html = renderNotificationCard(entry);
    expect(html).toContain('Remove empty catches');
  });

  it('renders the type badge', () => {
    const html = renderNotificationCard(entry);
    expect(html).toContain('Task');
  });

  it('renders bug type badge', () => {
    const html = renderNotificationCard(bugEntry);
    expect(html).toContain('Bug');
  });

  it('renders relative time', () => {
    const html = renderNotificationCard(bugEntry);
    expect(html).toContain('1h ago');
  });

  it('uses green color for task:done', () => {
    const html = renderNotificationCard(entry);
    expect(html).toContain('var(--green)');
  });

  it('uses red color for bug:new', () => {
    const html = renderNotificationCard(bugEntry);
    expect(html).toContain('var(--red)');
  });

  it('escapes HTML in message', () => {
    const xss: NotificationEntry = { ...entry, message: '<script>alert(1)</script>' };
    const html = renderNotificationCard(xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderNotificationFilter', () => {
  it('renders All button', () => {
    const html = renderNotificationFilter(['task:done', 'bug:new'], 'all');
    expect(html).toContain('>All<');
  });

  it('renders type filter buttons', () => {
    const html = renderNotificationFilter(['task:done', 'bug:new', 'cc:done'], 'all');
    expect(html).toContain('Task');
    expect(html).toContain('Bug');
    expect(html).toContain('CC');
  });

  it('marks active filter', () => {
    const html = renderNotificationFilter(['task:done'], 'task:done');
    expect(html).toMatch(/active[^"]*"[^>]*data-notif-filter="task:done"/);
  });
});

describe('relativeTime', () => {
  it('returns "just now" for recent timestamps', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now');
  });

  it('returns minutes ago', () => {
    const ts = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(ts)).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const ts = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(relativeTime(ts)).toBe('2h ago');
  });

  it('returns days ago', () => {
    const ts = new Date(Date.now() - 3 * 86400_000).toISOString();
    expect(relativeTime(ts)).toBe('3d ago');
  });
});

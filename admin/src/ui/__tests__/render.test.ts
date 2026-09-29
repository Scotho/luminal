// ── Admin render helpers tests ────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { escapeHtml, ago, formatBytes, deltaBadge, statCard } from '../render';

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes all special characters together', () => {
    expect(escapeHtml('<a href="x&y">')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('ago', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats seconds ago', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:30Z'));
    const ts = new Date('2024-01-01T00:00:00Z').getTime();
    expect(ago(ts)).toBe('30s ago');
  });

  it('formats minutes ago', () => {
    vi.setSystemTime(new Date('2024-01-01T00:05:00Z'));
    const ts = new Date('2024-01-01T00:00:00Z').getTime();
    expect(ago(ts)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    vi.setSystemTime(new Date('2024-01-01T03:00:00Z'));
    const ts = new Date('2024-01-01T00:00:00Z').getTime();
    expect(ago(ts)).toBe('3h ago');
  });

  it('uses seconds for values just under a minute', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:59Z'));
    const ts = new Date('2024-01-01T00:00:00Z').getTime();
    expect(ago(ts)).toBe('59s ago');
  });

  it('uses minutes for values just under an hour', () => {
    vi.setSystemTime(new Date('2024-01-01T00:59:59Z'));
    const ts = new Date('2024-01-01T00:00:00Z').getTime();
    expect(ago(ts)).toBe('59m ago');
  });
});

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats exactly 1 B', () => {
    expect(formatBytes(1)).toBe('1 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('formats kilobytes with rounding', () => {
    expect(formatBytes(1536)).toBe('2 KB');
  });

  it('formats megabytes to one decimal place', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('formats megabytes without fractional part when whole', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('deltaBadge', () => {
  it('returns empty string for zero', () => {
    expect(deltaBadge(0)).toBe('');
  });

  it('returns empty string for negative values', () => {
    expect(deltaBadge(-5)).toBe('');
  });

  it('returns badge HTML for positive values', () => {
    expect(deltaBadge(3)).toBe('<span class="stat-delta">+3 new</span>');
  });

  it('returns badge HTML for value of 1', () => {
    expect(deltaBadge(1)).toBe('<span class="stat-delta">+1 new</span>');
  });
});

describe('statCard', () => {
  it('renders value and label', () => {
    const html = statCard(42, 'Total Users');
    expect(html).toContain('<div class="stat-val">42</div>');
    expect(html).toContain('<div class="stat-label">Total Users</div>');
  });

  it('escapes HTML in label', () => {
    const html = statCard(1, '<b>label</b>');
    expect(html).toContain('&lt;b&gt;label&lt;/b&gt;');
    expect(html).not.toContain('<b>label</b>');
  });

  it('includes delta badge when delta is positive', () => {
    const html = statCard(10, 'Users', 3);
    expect(html).toContain('<span class="stat-delta">+3 new</span>');
  });

  it('includes no badge when delta is zero', () => {
    const html = statCard(10, 'Users', 0);
    expect(html).not.toContain('stat-delta');
  });

  it('omits delta entirely when delta is not provided', () => {
    const html = statCard(10, 'Users');
    expect(html).not.toContain('stat-delta');
  });

  it('accepts string values', () => {
    const html = statCard('N/A', 'Score');
    expect(html).toContain('<div class="stat-val">N/A</div>');
  });
});

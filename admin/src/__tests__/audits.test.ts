// ── Audits section tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAuditStatus, renderAuditCard, renderAddAuditForm, DEFAULT_AUDITS } from '../sections/audits';
import type { AuditEntry } from '../types';

// ── Fake time setup ──────────────────────────────────────────
// System time fixed to 2026-04-10T12:00:00Z for all tests

const FIXED_NOW = new Date('2026-04-10T12:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Fixtures ─────────────────────────────────────────────────

function makeAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    name: 'test-audit',
    label: 'Test Audit',
    description: 'A test audit entry',
    prompt: 'Do the audit.',
    intervalDays: 7,
    lastRun: null,
    builtin: true,
    ...overrides,
  };
}

// ── getAuditStatus ────────────────────────────────────────────

describe('getAuditStatus', () => {
  it('returns OVERDUE with red color and urgency 999 when lastRun is null', () => {
    const audit = makeAudit({ lastRun: null });
    const status = getAuditStatus(audit);
    expect(status.label).toBe('OVERDUE');
    expect(status.color).toBe('var(--red)');
    expect(status.urgency).toBe(999);
  });

  it('returns OVERDUE Xd when past the interval', () => {
    // lastRun 10 days ago, interval 7d → overdue by 3d
    const lastRun = new Date(FIXED_NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 7 });
    const status = getAuditStatus(audit);
    expect(status.label).toMatch(/^OVERDUE \d+d$/);
    expect(status.color).toBe('var(--red)');
    expect(status.urgency).toBeGreaterThan(0);
  });

  it('returns "due in Xd" with yellow color when within 50% of interval remaining', () => {
    // interval 7d, so threshold is 3.5d. lastRun 5 days ago → 2d left (≤3.5d threshold)
    const lastRun = new Date(FIXED_NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 7 });
    const status = getAuditStatus(audit);
    expect(status.label).toMatch(/^due in \d+d$/);
    expect(status.color).toBe('var(--yellow)');
    expect(status.urgency).toBeLessThan(0);
  });

  it('returns "done Xd ago" with green color when recently completed', () => {
    // lastRun 1 day ago, interval 7d → 6d left (> 3.5d threshold)
    const lastRun = new Date(FIXED_NOW - 1 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 7 });
    const status = getAuditStatus(audit);
    expect(status.label).toMatch(/^done \d+d ago$/);
    expect(status.color).toBe('var(--green)');
    expect(status.urgency).toBe(-7);
  });

  it('urgency for overdue is positive and equals abs(daysUntilDue)', () => {
    // 14 days ago, interval 7 → overdue by 7d
    const lastRun = new Date(FIXED_NOW - 14 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 7 });
    const status = getAuditStatus(audit);
    expect(status.urgency).toBeCloseTo(7, 0);
    expect(status.color).toBe('var(--red)');
  });

  it('urgency for "due soon" is negative daysUntilDue', () => {
    // 6 days ago, interval 7d → 1d left (≤3.5d threshold)
    const lastRun = new Date(FIXED_NOW - 6 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 7 });
    const status = getAuditStatus(audit);
    expect(status.urgency).toBeLessThan(0);
    expect(status.urgency).toBeCloseTo(-1, 0);
  });

  it('urgency for recently done is -intervalDays', () => {
    const lastRun = new Date(FIXED_NOW - 1 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 14 });
    const status = getAuditStatus(audit);
    expect(status.urgency).toBe(-14);
  });

  it('handles 14-day interval audits correctly', () => {
    // 8 days ago, interval 14 → 6d left (≤7d = 50% threshold)
    const lastRun = new Date(FIXED_NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 14 });
    const status = getAuditStatus(audit);
    expect(status.label).toMatch(/^due in \d+d$/);
    expect(status.color).toBe('var(--yellow)');
  });
});

// ── DEFAULT_AUDITS ────────────────────────────────────────────

describe('DEFAULT_AUDITS', () => {
  it('has exactly 4 builtin audits', () => {
    expect(DEFAULT_AUDITS).toHaveLength(4);
  });

  it('all entries have builtin=true', () => {
    for (const audit of DEFAULT_AUDITS) {
      expect(audit.builtin).toBe(true);
    }
  });

  it('includes code-hygiene', () => {
    const names = DEFAULT_AUDITS.map(a => a.name);
    expect(names).toContain('code-hygiene');
  });

  it('includes test-coverage', () => {
    const names = DEFAULT_AUDITS.map(a => a.name);
    expect(names).toContain('test-coverage');
  });

  it('includes mobile-gamepad', () => {
    const names = DEFAULT_AUDITS.map(a => a.name);
    expect(names).toContain('mobile-gamepad');
  });

  it('includes arch-docs', () => {
    const names = DEFAULT_AUDITS.map(a => a.name);
    expect(names).toContain('arch-docs');
  });

  it('code-hygiene has 7-day interval', () => {
    const audit = DEFAULT_AUDITS.find(a => a.name === 'code-hygiene');
    expect(audit?.intervalDays).toBe(7);
  });

  it('test-coverage has 7-day interval', () => {
    const audit = DEFAULT_AUDITS.find(a => a.name === 'test-coverage');
    expect(audit?.intervalDays).toBe(7);
  });

  it('mobile-gamepad has 14-day interval', () => {
    const audit = DEFAULT_AUDITS.find(a => a.name === 'mobile-gamepad');
    expect(audit?.intervalDays).toBe(14);
  });

  it('arch-docs has 14-day interval', () => {
    const audit = DEFAULT_AUDITS.find(a => a.name === 'arch-docs');
    expect(audit?.intervalDays).toBe(14);
  });

  it('all entries start with lastRun null', () => {
    for (const audit of DEFAULT_AUDITS) {
      expect(audit.lastRun).toBeNull();
    }
  });

  it('all entries have non-empty prompts', () => {
    for (const audit of DEFAULT_AUDITS) {
      expect(audit.prompt.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── renderAuditCard ───────────────────────────────────────────

describe('renderAuditCard', () => {
  it('renders the audit label', () => {
    const audit = makeAudit({ label: 'Code Hygiene' });
    const html = renderAuditCard(audit);
    expect(html).toContain('Code Hygiene');
  });

  it('renders the audit description', () => {
    const audit = makeAudit({ description: 'Check for empty catches' });
    const html = renderAuditCard(audit);
    expect(html).toContain('Check for empty catches');
  });

  it('renders the status label', () => {
    // lastRun null → OVERDUE
    const audit = makeAudit({ lastRun: null });
    const html = renderAuditCard(audit);
    expect(html).toContain('OVERDUE');
  });

  it('renders Copy Audit Prompt button', () => {
    const html = renderAuditCard(makeAudit());
    expect(html).toContain('Copy Audit Prompt');
  });

  it('renders Run in CC button', () => {
    const html = renderAuditCard(makeAudit());
    expect(html).toContain('Run in CC');
  });

  it('renders Reset button with interval days', () => {
    const audit = makeAudit({ intervalDays: 7 });
    const html = renderAuditCard(audit);
    expect(html).toContain('Reset (7d)');
  });

  it('renders Reset button with 14d for 14-day audits', () => {
    const audit = makeAudit({ intervalDays: 14 });
    const html = renderAuditCard(audit);
    expect(html).toContain('Reset (14d)');
  });

  it('includes data-audit-name attribute on card', () => {
    const audit = makeAudit({ name: 'code-hygiene' });
    const html = renderAuditCard(audit);
    expect(html).toContain('data-audit-name="code-hygiene"');
  });

  it('includes data-audit-name on action buttons', () => {
    const audit = makeAudit({ name: 'test-coverage' });
    const html = renderAuditCard(audit);
    const matches = html.match(/data-audit-name="test-coverage"/g);
    // Should appear on card + 3 buttons = at least 4 times
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it('applies red border when overdue', () => {
    const audit = makeAudit({ lastRun: null });
    const html = renderAuditCard(audit);
    expect(html).toContain('var(--red)');
  });

  it('applies green when done recently', () => {
    const lastRun = new Date(FIXED_NOW - 1 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 7 });
    const html = renderAuditCard(audit);
    expect(html).toContain('var(--green)');
  });

  it('applies yellow when due soon', () => {
    const lastRun = new Date(FIXED_NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
    const audit = makeAudit({ lastRun, intervalDays: 7 });
    const html = renderAuditCard(audit);
    expect(html).toContain('var(--yellow)');
  });

  it('escapes HTML in audit label', () => {
    const audit = makeAudit({ label: '<script>xss</script>' });
    const html = renderAuditCard(audit);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in audit description', () => {
    const audit = makeAudit({ description: '<img src=x onerror=alert(1)>' });
    const html = renderAuditCard(audit);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes HTML in audit name used as data attribute', () => {
    const audit = makeAudit({ name: 'evil"name' });
    const html = renderAuditCard(audit);
    expect(html).not.toContain('evil"name');
    expect(html).toContain('evil&quot;name');
  });
});

// ── renderAddAuditForm ───────────────────────────────────────

describe('renderAddAuditForm', () => {
  it('renders a form with name, description, prompt, and interval fields', () => {
    const html = renderAddAuditForm();
    expect(html).toContain('name="audit-name"');
    expect(html).toContain('name="audit-description"');
    expect(html).toContain('name="audit-prompt"');
    expect(html).toContain('name="audit-interval"');
  });

  it('renders Add Audit and Cancel buttons', () => {
    const html = renderAddAuditForm();
    expect(html).toContain('Add Audit');
    expect(html).toContain('Cancel');
  });

  it('has a default interval of 7 days', () => {
    const html = renderAddAuditForm();
    expect(html).toContain('value="7"');
  });
});

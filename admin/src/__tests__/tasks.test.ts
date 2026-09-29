// ── Tasks section tests ─────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { renderTaskCard, renderFilterBar, getUniqueTags, shortDateLabel, buildAuditPrompt } from '../sections/tasks';
import type { TaskEntry } from '../types';

// ── Fixtures ────────────────────────────────────────────────

const pendingTask: TaskEntry = {
  id: 'task-001',
  ref: 'TASK-1',
  tag: 'code-hygiene',
  prompt: 'Remove all empty catch blocks from the codebase.',
  source: 'code-review',
  status: 'pending',
  priority: 3,
  created: '2026-04-01T10:00:00Z',
};

const completedTask: TaskEntry = {
  id: 'task-002',
  ref: 'QA-1',
  tag: 'test-coverage',
  prompt: 'Add tests for the auth module.',
  source: 'spec',
  status: 'done',
  priority: 3,
  created: '2026-04-01T09:00:00Z',
  modified: '2026-04-02T11:00:00Z',
  completed: '2026-04-02T11:00:00Z',
};

const xssTask: TaskEntry = {
  id: 'task-xss',
  ref: 'TASK-2',
  tag: 'docs',
  prompt: '<script>alert("xss")</script>',
  source: '<img src=x onerror=alert(1)>',
  status: 'pending',
  priority: 3,
  created: '2026-04-01T08:00:00Z',
};

// ── renderTaskCard ───────────────────────────────────────────

describe('renderTaskCard', () => {
  it('renders the task tag', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('code-hygiene');
  });

  it('renders the task prompt', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('Remove all empty catch blocks from the codebase.');
  });

  it('renders the task source', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('code-review');
  });

  it('renders Copy button', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('task-copy-btn');
    expect(html).toContain('Copy');
  });

  it('renders Done button for pending tasks', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('task-done-btn');
  });

  it('does not render Done button for completed tasks', () => {
    const html = renderTaskCard(completedTask);
    expect(html).not.toContain('task-done-btn');
  });

  it('renders Delete button', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('task-delete-btn');
  });

  it('fades completed tasks with lower opacity', () => {
    const html = renderTaskCard(completedTask);
    expect(html).toContain('opacity:0.4');
  });

  it('renders pending tasks at full opacity', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('opacity:1');
  });

  it('escapes HTML in prompt text', () => {
    const html = renderTaskCard(xssTask);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in source', () => {
    const html = renderTaskCard(xssTask);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('applies tag color for known tags', () => {
    const html = renderTaskCard(pendingTask); // tag: code-hygiene
    expect(html).toContain('var(--accent)');
  });

  it('applies yellow color for as-any tag', () => {
    const task: TaskEntry = { ...pendingTask, tag: 'as-any' };
    const html = renderTaskCard(task);
    expect(html).toContain('var(--yellow)');
  });

  it('applies green color for test-coverage tag', () => {
    const html = renderTaskCard(completedTask); // tag: test-coverage
    expect(html).toContain('var(--green)');
  });

  it('applies accent color for unknown tags', () => {
    const task: TaskEntry = { ...pendingTask, tag: 'unknown-tag' };
    const html = renderTaskCard(task);
    expect(html).toContain('var(--accent)');
  });

  it('includes the task id in data attributes', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('data-task-id="task-001"');
  });
});

// ── getUniqueTags ────────────────────────────────────────────

describe('getUniqueTags', () => {
  it('returns empty array for empty task list', () => {
    expect(getUniqueTags([])).toEqual([]);
  });

  it('extracts unique tags sorted alphabetically', () => {
    const tasks: TaskEntry[] = [
      { ...pendingTask, tag: 'test-coverage' },
      { ...pendingTask, tag: 'code-hygiene' },
      { ...pendingTask, tag: 'as-any' },
    ];
    expect(getUniqueTags(tasks)).toEqual(['as-any', 'code-hygiene', 'test-coverage']);
  });

  it('deduplicates repeated tags', () => {
    const tasks: TaskEntry[] = [
      { ...pendingTask, id: 'a', tag: 'docs' },
      { ...pendingTask, id: 'b', tag: 'docs' },
      { ...pendingTask, id: 'c', tag: 'docs' },
    ];
    expect(getUniqueTags(tasks)).toEqual(['docs']);
  });

  it('handles a single task', () => {
    expect(getUniqueTags([pendingTask])).toEqual(['code-hygiene']);
  });

  it('returns tags for mixed pending and done tasks', () => {
    const tasks: TaskEntry[] = [pendingTask, completedTask];
    expect(getUniqueTags(tasks)).toEqual(['code-hygiene', 'test-coverage']);
  });
});

// ── renderFilterBar ──────────────────────────────────────────

describe('renderFilterBar', () => {
  it('renders the All button', () => {
    const html = renderFilterBar([], 'all');
    expect(html).toContain('>All<');
  });

  it('renders a button for each tag', () => {
    const html = renderFilterBar(['code-hygiene', 'docs'], 'all');
    expect(html).toContain('code-hygiene');
    expect(html).toContain('docs');
  });

  it('renders All button as active when filter is all', () => {
    const html = renderFilterBar(['docs'], 'all');
    // The All button should have the active class
    expect(html).toMatch(/filter-btn[^"]*active[^"]*"[^>]*>All/);
  });

  it('highlights active tag filter', () => {
    const html = renderFilterBar(['code-hygiene', 'docs'], 'docs');
    // docs button should be active
    expect(html).toMatch(/active[^>]*>\s*docs/);
  });

  it('does not mark All as active when a tag is selected', () => {
    const html = renderFilterBar(['code-hygiene'], 'code-hygiene');
    // All button should not have active class
    const allBtnMatch = html.match(/data-filter="all"[^>]*class="([^"]*)"/);
    if (allBtnMatch) {
      expect(allBtnMatch[1]).not.toContain('active');
    } else {
      // Check via class before data-filter
      const allBtnMatch2 = html.match(/class="([^"]*)"[^>]*data-filter="all"/);
      expect(allBtnMatch2?.[1]).not.toContain('active');
    }
  });

  it('sets data-filter attribute on each button', () => {
    const html = renderFilterBar(['mobile-ui'], 'all');
    expect(html).toContain('data-filter="all"');
    expect(html).toContain('data-filter="mobile-ui"');
  });

  it('escapes HTML in tag names', () => {
    const html = renderFilterBar(['<evil>'], 'all');
    expect(html).not.toContain('<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });

  it('renders no tag buttons when tags array is empty', () => {
    const html = renderFilterBar([], 'all');
    const btnCount = (html.match(/filter-btn/g) ?? []).length;
    expect(btnCount).toBe(1); // only the All button
  });
});

// ── shortDateLabel ──────────────────────────────────────────

describe('shortDateLabel', () => {
  it('formats an ISO date as "Mon D"', () => {
    const label = shortDateLabel('2026-04-01T10:00:00Z');
    expect(label).toContain('Apr');
    expect(label).toContain('1');
  });

  it('includes year when date is in a different year', () => {
    const label = shortDateLabel('2025-01-15T10:00:00Z');
    expect(label).toContain('2025');
  });

  it('omits year for dates in the current year', () => {
    const now = new Date();
    const iso = `${now.getFullYear()}-06-15T10:00:00Z`;
    const label = shortDateLabel(iso);
    expect(label).not.toContain(String(now.getFullYear()));
  });
});

// ── renderTaskCard timestamps ──────────────────────────────

describe('renderTaskCard timestamps', () => {
  it('renders Added date from created field', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).toContain('Added');
    expect(html).toContain('ago');
  });

  it('renders Modified date when present', () => {
    const task: TaskEntry = { ...pendingTask, modified: '2026-04-03T12:00:00Z' };
    const html = renderTaskCard(task);
    expect(html).toContain('Modified');
  });

  it('does not render Modified when absent', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).not.toContain('Modified');
  });

  it('renders Completed date for done tasks', () => {
    const html = renderTaskCard(completedTask);
    expect(html).toContain('Completed');
  });

  it('does not render Completed for pending tasks', () => {
    const html = renderTaskCard(pendingTask);
    expect(html).not.toContain('Completed');
  });
});

// ── buildAuditPrompt ────────────────────────────────────────

describe('buildAuditPrompt', () => {
  it('returns empty string when no tasks are done', () => {
    expect(buildAuditPrompt([pendingTask])).toBe('');
  });

  it('includes completed task prompts', () => {
    const prompt = buildAuditPrompt([completedTask]);
    expect(prompt).toContain('Add tests for the auth module.');
  });

  it('includes task count', () => {
    const prompt = buildAuditPrompt([completedTask]);
    expect(prompt).toContain('1 task(s)');
  });

  it('includes tag and priority', () => {
    const prompt = buildAuditPrompt([completedTask]);
    expect(prompt).toContain('test-coverage');
    expect(prompt).toContain('P3');
  });

  it('excludes pending tasks', () => {
    const prompt = buildAuditPrompt([pendingTask, completedTask]);
    expect(prompt).not.toContain('Remove all empty catch blocks');
    expect(prompt).toContain('Add tests for the auth module.');
  });

  it('includes audit instructions', () => {
    const prompt = buildAuditPrompt([completedTask]);
    expect(prompt).toContain('PASS');
    expect(prompt).toContain('NEEDS ATTENTION');
    expect(prompt).toContain('FAIL');
  });
});

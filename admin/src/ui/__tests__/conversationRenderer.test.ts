import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage, makeCCSession, makeCCCard } from '../../__tests__/helpers';
import type { CCSession, CCCard } from '../../types';

const storage = mockLocalStorage();
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));
vi.mock('../sessionDataService', () => ({
  getActiveSessions: () => [],
  onSessionsChanged: () => () => {},
}));

import { renderConversationThread } from '../ccRenderer';

beforeEach(() => storage.clear());

// ── Markdown rendering ─────────────────────────────────────

describe('markdown rendering', () => {
  it('renders inline code with cc-md-code-inline class for user cards with backtick code', () => {
    const card = makeCCCard({
      role: 'user',
      type: 'text',
      title: 'You',
      body: 'Use `npm install` to install',
      preview: 'Use npm install to install',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('cc-md-code-inline');
    expect(html).toContain('npm install');
  });

  it('renders fenced code blocks with cc-code-block class for assistant cards', () => {
    const card = makeCCCard({
      role: 'assistant',
      type: 'text',
      title: 'Response',
      body: '```typescript\nconst x: number = 1;\n```',
      preview: 'const x: number = 1;',
    });
    const session = makeCCSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('cc-code-block');
    expect(html).toContain('language-typescript');
  });

  it('renders bold text in assistant cards', () => {
    const card = makeCCCard({
      role: 'assistant',
      type: 'text',
      title: 'Response',
      body: 'This is **important** text',
      preview: 'This is important text',
    });
    const session = makeCCSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('<strong>');
    expect(html).toContain('important');
  });
});

// ── Tool call status classes ───────────────────────────────

describe('tool call status classes', () => {
  it('adds tool-running class for running tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Read',
      body: '',
      toolStatus: 'running',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-running');
  });

  it('adds tool-done class for done tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Read',
      body: '',
      toolStatus: 'done',
    });
    const session = makeCCSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-done');
  });

  it('adds tool-error class for error tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Read',
      body: '',
      toolStatus: 'error',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-error');
  });
});

// ── Tool type badge colors ─────────────────────────────────

describe('tool type badge colors', () => {
  it('adds tool-type-read badge for Read tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Read',
      body: '',
      toolStatus: 'done',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-type-read');
  });

  it('adds tool-type-edit badge for Edit tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Edit',
      body: '',
      toolStatus: 'done',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-type-edit');
  });

  it('adds tool-type-bash badge for Bash tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Bash',
      body: '',
      toolStatus: 'done',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-type-bash');
  });

  it('adds tool-type-read badge for Glob tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Glob',
      body: '',
      toolStatus: 'done',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-type-read');
  });

  it('adds tool-type-read badge for Grep tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Grep',
      body: '',
      toolStatus: 'done',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-type-read');
  });

  it('adds tool-type-edit badge for Write tool', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Write',
      body: '',
      toolStatus: 'done',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('tool-type-edit');
  });
});

// ── Auto-grouping ─────────────────────────────────────────

describe('auto-grouping', () => {
  it('does not group 2 consecutive same-type tool cards', () => {
    const cards: CCCard[] = [
      makeCCCard({ id: 'c1', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
      makeCCCard({ id: 'c2', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
    ];
    const session = makeCCSession({ cards });
    const html = renderConversationThread(session);
    expect(html).not.toContain('cc-group');
  });

  it('groups 3+ consecutive same-type tool cards into cc-group', () => {
    const cards: CCCard[] = [
      makeCCCard({ id: 'c1', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
      makeCCCard({ id: 'c2', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
      makeCCCard({ id: 'c3', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
    ];
    const session = makeCCSession({ cards });
    const html = renderConversationThread(session);
    expect(html).toContain('cc-group');
  });

  it('groups 5 consecutive tool cards', () => {
    const cards: CCCard[] = Array.from({ length: 5 }, (_, i) =>
      makeCCCard({ id: `c${i}`, role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' })
    );
    const session = makeCCSession({ cards });
    const html = renderConversationThread(session);
    expect(html).toContain('cc-group');
  });

  it('does not group non-consecutive same-type cards', () => {
    const cards: CCCard[] = [
      makeCCCard({ id: 'c1', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
      makeCCCard({ id: 'c2', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
      makeCCCard({ id: 'c3', role: 'assistant', type: 'text', title: 'Response', body: 'some text', toolStatus: undefined }),
      makeCCCard({ id: 'c4', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
      makeCCCard({ id: 'c5', role: 'tool', type: 'tool', title: 'Read', body: '', toolStatus: 'done' }),
    ];
    const session = makeCCSession({ cards, status: 'done' });
    const html = renderConversationThread(session);
    expect(html).not.toContain('cc-group');
  });
});

// ── Agent blocks ──────────────────────────────────────────

describe('agent blocks', () => {
  it('has conv-agent class', () => {
    const card = makeCCCard({
      role: 'agent',
      type: 'tool',
      title: 'Agent',
      agentLabel: 'Subagent',
      toolStatus: 'running',
      body: '',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-agent');
  });

  it('has conv-depth-1 class when depth is 1', () => {
    const card = makeCCCard({
      role: 'agent',
      type: 'tool',
      title: 'Agent',
      agentLabel: 'Subagent',
      toolStatus: 'running',
      body: '',
      depth: 1,
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-agent');
    expect(html).toContain('conv-depth-1');
  });
});

// ── Result block ──────────────────────────────────────────

describe('result block', () => {
  it('has conv-result class', () => {
    const card = makeCCCard({
      role: 'assistant',
      type: 'result',
      title: 'Done',
      body: 'Completed successfully',
      preview: 'Completed successfully',
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-result');
  });
});

// ── Depth indentation ─────────────────────────────────────

describe('depth indentation', () => {
  it('adds conv-depth-2 class for tool card with depth 2', () => {
    const card = makeCCCard({
      role: 'tool',
      type: 'tool',
      title: 'Read',
      body: '',
      toolStatus: 'done',
      depth: 2,
    });
    const session = makeCCSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-depth-2');
  });

  it('adds conv-depth-1 class for assistant card with depth 1', () => {
    const card = makeCCCard({
      role: 'assistant',
      type: 'text',
      body: 'nested reply',
      depth: 1,
    });
    const session = makeCCSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-depth-1');
  });
});

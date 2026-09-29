import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';
import { makeCCSession, makeCCCard } from '../../__tests__/helpers';
import type { CCSession, CCCard } from '../../types';

// Install localStorage mock (needed by various UI modules)
const storage = mockLocalStorage();

// Stub fetch (needed by ccSessionManager -> _tryLinkToSession)
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));

// Mock the sessionDataService to avoid real polling
vi.mock('../sessionDataService', () => ({
  getActiveSessions: () => [],
  onSessionsChanged: () => () => {},
}));

import {
  renderConversationThread,
  formatElapsed,
  renderCard,
} from '../ccRenderer';

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
});

// ── formatElapsed ──────────────────────────────────────

describe('formatElapsed', () => {
  it('returns seconds for values under 60s', () => {
    expect(formatElapsed(5000)).toBe('5s');
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(59999)).toBe('59s');
  });

  it('returns minutes and seconds for values >= 60s', () => {
    expect(formatElapsed(60000)).toBe('1m 0s');
    expect(formatElapsed(90000)).toBe('1m 30s');
    expect(formatElapsed(125000)).toBe('2m 5s');
  });

  it('handles large values', () => {
    expect(formatElapsed(3600000)).toBe('60m 0s');
  });
});

// ── renderConversationThread ───────────────────────────

describe('renderConversationThread', () => {
  function makeSession(overrides?: Partial<CCSession>): CCSession {
    return makeCCSession(overrides);
  }

  function makeCard_(overrides?: Partial<CCCard>): CCCard {
    return makeCCCard(overrides);
  }

  it('produces HTML string', () => {
    const session = makeSession();
    const html = renderConversationThread(session);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('includes session header with backend info', () => {
    const session = makeSession({ backend: 'cc' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-session-header');
    expect(html).toContain('conv-backend-icon');
    expect(html).toContain('Claude');
  });

  it('shows Ollama label for ollama backend', () => {
    const session = makeSession({ backend: 'ollama' });
    const html = renderConversationThread(session);
    expect(html).toContain('Qwen (Local)');
    expect(html).toContain('conv-backend--ollama');
  });

  it('renders initial prompt as user turn when no user card exists', () => {
    const session = makeSession({ prompt: 'What is this?', cards: [] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-turn--user');
    expect(html).toContain('What is this?');
  });

  it('does not duplicate prompt when user card already exists', () => {
    const userCard = makeCard_({ role: 'user', body: 'Hello', title: 'You' });
    const session = makeSession({ prompt: 'Hello', cards: [userCard] });
    const html = renderConversationThread(session);
    // Count user turns — should be exactly one
    const matches = html.match(/conv-turn--user/g) || [];
    expect(matches).toHaveLength(1);
  });

  // ── User turns ────────────────────────────────────────
  it('renders user turns with conv-turn--user class', () => {
    const card = makeCard_({ role: 'user', body: 'My question', title: 'You' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-turn--user');
    expect(html).toContain('My question');
  });

  // ── Assistant text ────────────────────────────────────
  it('renders assistant text with conv-turn--assistant class', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: 'Here is my answer' });
    const session = makeSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-turn--assistant');
    expect(html).toContain('Here is my answer');
  });

  it('adds conv-streaming class when session is running and card is last assistant text', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: 'streaming...' });
    const session = makeSession({ cards: [card], status: 'running' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-streaming');
  });

  it('does not add conv-streaming class when session is done', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: 'done text' });
    const session = makeSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).not.toContain('conv-streaming');
  });

  // ── Tool calls ────────────────────────────────────────
  it('renders tool calls with conv-tool class', () => {
    const card = makeCard_({
      role: 'tool',
      type: 'tool',
      title: 'Read',
      preview: 'Reading file...',
      body: '',
      toolStatus: 'running',
    });
    const session = makeSession({ cards: [card], status: 'running' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-tool');
    expect(html).toContain('Read');
  });

  it('shows spinner for running tool', () => {
    const card = makeCard_({ role: 'tool', type: 'tool', title: 'Edit', toolStatus: 'running', body: '' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-tool-spinner');
  });

  it('shows checkmark for done tool', () => {
    const card = makeCard_({ role: 'tool', type: 'tool', title: 'Edit', toolStatus: 'done', body: '' });
    const session = makeSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('&#10003;');
    expect(html).not.toContain('conv-tool-spinner');
  });

  it('shows X mark for error tool', () => {
    const card = makeCard_({ role: 'tool', type: 'tool', title: 'Edit', toolStatus: 'error', body: '' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('&#10007;');
  });

  // ── Agent blocks ──────────────────────────────────────
  it('renders agent blocks with conv-agent class', () => {
    const card = makeCard_({
      role: 'agent',
      type: 'tool',
      title: 'Agent',
      agentLabel: 'Subagent',
      toolStatus: 'running',
      body: '',
    });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-agent');
    expect(html).toContain('Subagent');
  });

  // ── Depth nesting ─────────────────────────────────────
  it('adds conv-depth-1 class for depth 1', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: 'nested', depth: 1 });
    const session = makeSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-depth-1');
  });

  it('adds conv-depth-2 class for depth 2', () => {
    const card = makeCard_({ role: 'tool', type: 'tool', title: 'Read', body: '', depth: 2, toolStatus: 'done' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-depth-2');
  });

  it('caps depth class at conv-depth-3 for depth > 3', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: 'deep', depth: 5 });
    const session = makeSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-depth-3');
    expect(html).not.toContain('conv-depth-5');
  });

  it('no depth class for depth 0', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: 'top', depth: 0 });
    const session = makeSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).not.toContain('conv-depth-');
  });

  // ── Result blocks ─────────────────────────────────────
  it('renders result blocks with conv-result class', () => {
    const card = makeCard_({ role: 'assistant', type: 'result', title: 'Result', body: 'Task done', preview: 'Task done' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-result');
    expect(html).toContain('Result');
  });

  // ── Thinking indicator ────────────────────────────────
  it('shows thinking indicator mount when running but no streaming text', () => {
    const session = makeSession({ cards: [], status: 'running' });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-thinking-mount');
    expect(html).toContain('conv-thinking');
  });

  it('does not show "Thinking..." when last card is streaming assistant text', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: 'writing...' });
    const session = makeSession({ cards: [card], status: 'running' });
    const html = renderConversationThread(session);
    expect(html).not.toContain('conv-thinking');
  });

  it('does not show "Thinking..." when session is done', () => {
    const session = makeSession({ cards: [], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).not.toContain('Thinking...');
  });

  // ── XSS safety ────────────────────────────────────────
  it('escapes HTML in user card body', () => {
    const card = makeCard_({ role: 'user', body: '<script>alert("xss")</script>', title: 'You' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in assistant card body', () => {
    const card = makeCard_({ role: 'assistant', type: 'text', body: '<img src=x onerror=alert(1)>' });
    const session = makeSession({ cards: [card], status: 'done' });
    const html = renderConversationThread(session);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('escapes HTML in tool card title', () => {
    const card = makeCard_({ role: 'tool', type: 'tool', title: '<b>Evil</b>', body: '', toolStatus: 'done' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).not.toContain('<b>Evil</b>');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
  });

  it('escapes HTML in result card content', () => {
    const card = makeCard_({
      role: 'assistant',
      type: 'result',
      title: 'Result',
      body: '<script>hack()</script>',
      preview: '<script>hack()</script>',
    });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).not.toContain('<script>hack()');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in system/error card preview', () => {
    const card = makeCard_({
      role: 'system',
      type: 'error',
      title: 'Error',
      preview: '<img onerror=alert(1)>',
      body: '<img onerror=alert(1)>',
    });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  // ── System/error cards ────────────────────────────────
  it('renders system cards with conv-system class', () => {
    const card = makeCard_({ role: 'system', type: 'system', title: 'System', preview: 'init' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-system');
    expect(html).not.toContain('conv-system--error');
  });

  it('renders error cards with conv-system--error class', () => {
    const card = makeCard_({ role: 'system', type: 'error', title: 'Error', preview: 'broke' });
    const session = makeSession({ cards: [card] });
    const html = renderConversationThread(session);
    expect(html).toContain('conv-system--error');
  });
});

// ── renderCard (legacy card renderer) ──────────────────

describe('renderCard', () => {
  it('produces HTML with card class and type', () => {
    const card = makeCCCard({ type: 'text', title: 'Test', preview: 'hello', body: 'hello world' });
    const html = renderCard(card);
    expect(html).toContain('cc-card');
    expect(html).toContain('cc-card-text');
  });

  it('escapes card title', () => {
    const card = makeCCCard({ title: '<script>xss</script>' });
    const html = renderCard(card);
    expect(html).not.toContain('<script>xss');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows chevron when body is longer than preview', () => {
    const card = makeCCCard({ preview: 'short', body: 'this is a much longer body text that exceeds the preview' });
    const html = renderCard(card);
    expect(html).toContain('cc-card-chevron');
  });

  it('hides chevron when body equals preview', () => {
    const card = makeCCCard({ preview: 'same text', body: 'same text' });
    const html = renderCard(card);
    expect(html).not.toContain('cc-card-chevron');
  });
});

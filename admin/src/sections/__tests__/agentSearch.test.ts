// admin/src/sections/__tests__/agentSearch.test.ts — Cross-agent search tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage, makeCCSession, makeCCCard } from '../../__tests__/helpers';

const storage = mockLocalStorage();
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));
vi.mock('../../ui/sessionDataService', () => ({ getActiveSessions: () => [], onSessionsChanged: () => () => {} }));

// Mock sessionManager before importing agentSearch
vi.mock('../../ui/ccSessionManager', () => ({
  sessionManager: {
    getAllSessions: vi.fn(() => []),
  },
}));

import { initAgentSearch } from '../agentSearch';
import { sessionManager } from '../../ui/ccSessionManager';

const mockGetAllSessions = vi.mocked(sessionManager.getAllSessions);

// ── Setup ─────────────────────────────────────────────────────

function setup(): HTMLElement {
  document.body.innerHTML = '<div id="section-agent-search" class="section"></div>';
  return document.getElementById('section-agent-search')!;
}

// ── Tests ──────────────────────────────────────────────────────

describe('initAgentSearch', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    mockGetAllSessions.mockReturnValue([]);
  });

  it('initializes .agent-search container in section', () => {
    setup();
    initAgentSearch();
    const section = document.getElementById('section-agent-search')!;
    expect(section.querySelector('.agent-search')).not.toBeNull();
  });

  it('search input exists with correct placeholder', () => {
    setup();
    initAgentSearch();
    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Search across all agents...');
  });

  it('scope select has correct options', () => {
    setup();
    initAgentSearch();
    const select = document.querySelector('.agent-search-scope') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.options).map(o => o.text);
    expect(options).toContain('All');
    expect(options).toContain('Tool Output');
    expect(options).toContain('Assistant Text');
    expect(options).toContain('User Prompts');
    expect(options).toContain('Errors Only');
  });

  it('backend select has correct options', () => {
    setup();
    initAgentSearch();
    const select = document.querySelector('.agent-search-backend') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.options).map(o => o.text);
    expect(options).toContain('All');
    expect(options).toContain('CC');
    expect(options).toContain('Qwen');
    expect(options).toContain('Aider');
  });

  it('empty search shows no results', async () => {
    setup();
    initAgentSearch();
    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input'));

    // Wait for debounce
    await new Promise(r => setTimeout(r, 250));

    const results = document.querySelector('.agent-search-results')!;
    expect(results.children.length).toBe(0);
  });

  it('search returns matching cards', async () => {
    setup();

    const card = makeCCCard({
      id: 'card-match-1',
      body: 'This card contains the keyword luminal',
      title: 'Response',
      role: 'assistant',
    });
    const session = makeCCSession({
      id: 'sess-a',
      label: 'Agent Alpha',
      cards: [card],
      backend: 'cc',
    });
    mockGetAllSessions.mockReturnValue([session]);

    initAgentSearch();

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'luminal';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const results = document.querySelector('.agent-search-results')!;
    expect(results.innerHTML).toContain('luminal');
  });

  it('results are grouped by session', async () => {
    setup();

    const card1 = makeCCCard({ id: 'c1', body: 'tron game test', role: 'assistant' });
    const card2 = makeCCCard({ id: 'c2', body: 'another tron result', role: 'assistant' });
    const card3 = makeCCCard({ id: 'c3', body: 'tron session two', role: 'user' });

    const sessA = makeCCSession({ id: 'sess-a', label: 'Agent Alpha', cards: [card1, card2], backend: 'cc' });
    const sessB = makeCCSession({ id: 'sess-b', label: 'Agent Beta', cards: [card3], backend: 'cc' });
    mockGetAllSessions.mockReturnValue([sessA, sessB]);

    initAgentSearch();

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'tron';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const groups = document.querySelectorAll('.agent-search-result-group');
    expect(groups.length).toBe(2);
  });

  it('groups sorted by match count (most matches first)', async () => {
    setup();

    const card1 = makeCCCard({ id: 'c1', body: 'luminal test one', role: 'assistant' });
    const card2 = makeCCCard({ id: 'c2', body: 'luminal test two', role: 'assistant' });
    const card3 = makeCCCard({ id: 'c3', body: 'luminal test three', role: 'assistant' });
    const card4 = makeCCCard({ id: 'c4', body: 'luminal single', role: 'assistant' });

    // sessA has 3 matches, sessB has 1 — sessA should appear first
    const sessA = makeCCSession({ id: 'sess-a', label: 'Agent Alpha', cards: [card1, card2, card3], backend: 'cc' });
    const sessB = makeCCSession({ id: 'sess-b', label: 'Agent Beta', cards: [card4], backend: 'cc' });
    // Return B first to verify sorting flips it
    mockGetAllSessions.mockReturnValue([sessB, sessA]);

    initAgentSearch();

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'luminal';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const groups = document.querySelectorAll('.agent-search-result-group');
    expect(groups.length).toBe(2);
    // First group should show Agent Alpha (3 matches) before Agent Beta (1 match)
    expect(groups[0].innerHTML).toContain('Agent Alpha');
    expect(groups[1].innerHTML).toContain('Agent Beta');
  });

  it('pin action adds item to pinned panel', async () => {
    setup();

    const card = makeCCCard({ id: 'pin-card-1', body: 'pinnable content here', role: 'assistant' });
    const session = makeCCSession({ id: 'sess-pin', label: 'Pin Agent', cards: [card], backend: 'cc' });
    mockGetAllSessions.mockReturnValue([session]);

    initAgentSearch();

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'pinnable';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const pinnedList = document.querySelector('.agent-search-pinned-list')!;
    expect(pinnedList.children.length).toBe(0);

    const pinBtn = document.querySelector('.agent-search-pin-btn') as HTMLButtonElement;
    expect(pinBtn).not.toBeNull();
    pinBtn.click();

    expect(pinnedList.children.length).toBe(1);
  });

  it('pin remove button removes the pin', async () => {
    setup();

    const card = makeCCCard({ id: 'removable-card', body: 'remove me content', role: 'assistant' });
    const session = makeCCSession({ id: 'sess-rm', label: 'Remove Agent', cards: [card], backend: 'cc' });
    mockGetAllSessions.mockReturnValue([session]);

    initAgentSearch();

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'remove me';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const pinBtn = document.querySelector('.agent-search-pin-btn') as HTMLButtonElement;
    pinBtn.click();

    const pinnedList = document.querySelector('.agent-search-pinned-list')!;
    expect(pinnedList.children.length).toBe(1);

    const removeBtn = pinnedList.querySelector('.agent-search-pin-remove') as HTMLButtonElement;
    removeBtn.click();

    expect(pinnedList.children.length).toBe(0);
  });

  it('duplicate pins are ignored', async () => {
    setup();

    const card = makeCCCard({ id: 'dup-card', body: 'unique searchable text', role: 'assistant' });
    const session = makeCCSession({ id: 'sess-dup', label: 'Dup Agent', cards: [card], backend: 'cc' });
    mockGetAllSessions.mockReturnValue([session]);

    initAgentSearch();

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'unique searchable';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const pinBtn = document.querySelector('.agent-search-pin-btn') as HTMLButtonElement;
    pinBtn.click();
    pinBtn.click(); // second click should be ignored

    const pinnedList = document.querySelector('.agent-search-pinned-list')!;
    expect(pinnedList.children.length).toBe(1);
  });

  it('send to prompt dispatches cc:inject-prompt event', async () => {
    setup();

    const card = makeCCCard({ id: 'prompt-card', body: 'send this content', role: 'assistant' });
    const session = makeCCSession({ id: 'sess-prompt', label: 'Prompt Agent', cards: [card], backend: 'cc' });
    mockGetAllSessions.mockReturnValue([session]);

    initAgentSearch();

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'send this';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const pinBtn = document.querySelector('.agent-search-pin-btn') as HTMLButtonElement;
    pinBtn.click();

    // Listen for custom event instead of clipboard
    let receivedText = '';
    document.addEventListener('cc:inject-prompt', ((e: CustomEvent) => {
      receivedText = e.detail.text;
    }) as EventListener);

    const sendBtn = document.querySelector('.agent-search-send-prompt') as HTMLButtonElement;
    sendBtn.click();

    expect(receivedText).toContain('[Context from Agent Search]');
    expect(receivedText).toContain('[End Context]');
    expect(receivedText).toContain('Prompt Agent');
    expect(receivedText).toContain('send this content');
  });

  it('jump button dispatches agent-search:jump event', async () => {
    setup();

    const card = makeCCCard({ id: 'jump-card', body: 'jump test content', role: 'assistant' });
    const session = makeCCSession({ id: 'sess-jump', label: 'Jump Agent', cards: [card], backend: 'cc' });
    mockGetAllSessions.mockReturnValue([session]);

    initAgentSearch();

    const section = document.getElementById('section-agent-search')!;
    const jumpEvents: CustomEvent[] = [];
    section.addEventListener('agent-search:jump', (e) => jumpEvents.push(e as CustomEvent));

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'jump test';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const jumpBtn = document.querySelector('.agent-search-jump-btn') as HTMLButtonElement;
    expect(jumpBtn).not.toBeNull();
    jumpBtn.click();

    expect(jumpEvents.length).toBe(1);
    expect(jumpEvents[0].detail.sessionId).toBe('sess-jump');
    expect(jumpEvents[0].detail.cardId).toBe('jump-card');
  });

  it('scope filter restricts to tool role cards only', async () => {
    setup();

    const toolCard = makeCCCard({ id: 'tool-card', body: 'tool scope filter test', role: 'tool', type: 'tool' });
    const assistCard = makeCCCard({ id: 'asst-card', body: 'tool scope filter test', role: 'assistant', type: 'text' });
    const session = makeCCSession({
      id: 'sess-scope',
      label: 'Scope Agent',
      cards: [toolCard, assistCard],
      backend: 'cc',
    });
    mockGetAllSessions.mockReturnValue([session]);

    initAgentSearch();

    const scopeSelect = document.querySelector('.agent-search-scope') as HTMLSelectElement;
    scopeSelect.value = 'Tool Output';
    scopeSelect.dispatchEvent(new Event('change'));

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'tool scope filter';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    // Only tool card should match — 1 item in the single group
    const items = document.querySelectorAll('.agent-search-result-item');
    expect(items.length).toBe(1);
  });

  it('backend filter restricts to CC sessions', async () => {
    setup();

    const ccCard = makeCCCard({ id: 'cc-card', body: 'backend filter test', role: 'assistant' });
    const ollamaCard = makeCCCard({ id: 'ollama-card', body: 'backend filter test', role: 'assistant' });
    const ccSession = makeCCSession({ id: 'sess-cc', label: 'CC Agent', cards: [ccCard], backend: 'cc' });
    const ollamaSession = makeCCSession({ id: 'sess-ol', label: 'Qwen Agent', cards: [ollamaCard], backend: 'ollama' });
    mockGetAllSessions.mockReturnValue([ccSession, ollamaSession]);

    initAgentSearch();

    const backendSelect = document.querySelector('.agent-search-backend') as HTMLSelectElement;
    backendSelect.value = 'CC';
    backendSelect.dispatchEvent(new Event('change'));

    const input = document.querySelector('.agent-search-input') as HTMLInputElement;
    input.value = 'backend filter';
    input.dispatchEvent(new Event('input'));

    await new Promise(r => setTimeout(r, 250));

    const groups = document.querySelectorAll('.agent-search-result-group');
    expect(groups.length).toBe(1);
    expect(groups[0].innerHTML).toContain('CC Agent');
  });

  it('does not crash when section element is missing', () => {
    document.body.innerHTML = '';
    expect(() => initAgentSearch()).not.toThrow();
  });
});

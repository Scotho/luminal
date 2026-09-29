// Shared test utilities for the admin dashboard test suite.
// Provides mock factories, fixture builders, and common patterns.

import { vi } from 'vitest';
import type { TestRun, CCCard, CCSession, CCUsage } from '../types';

// ── Mock fetch factory ──────────────────────────────────────────────────────

interface MockResponse {
  ok: boolean;
  json?: unknown;
  text?: string;
  status?: number;
}

/**
 * Stub `globalThis.fetch` with sequential mock responses.
 * When calls exceed the response array, the last response is reused.
 */
export function mockFetch(responses: MockResponse[]): void {
  let callIdx = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const resp = responses[callIdx] ?? responses[responses.length - 1];
    callIdx++;
    return {
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 500),
      json: async () => resp.json ?? {},
      text: async () => resp.text ?? '',
    };
  }));
}

// ── Fixture builder pattern ─────────────────────────────────────────────────

/**
 * Create a fixture factory from a defaults object.
 * Returns a function that merges partial overrides into defaults.
 */
export function makeFixture<T>(defaults: T) {
  return (overrides?: Partial<T>): T => ({ ...defaults, ...overrides });
}

// ── Domain-specific fixture factories ───────────────────────────────────────

export const makeTestRun = makeFixture<TestRun>({
  id: 'run-1',
  config: 'unit',
  startedAt: '2026-04-06T12:00:00Z',
  duration: 5000,
  total: 100,
  passed: 95,
  failed: 3,
  skipped: 2,
  failures: [],
});

export const makeCCCard = makeFixture<CCCard>({
  id: 'card-1',
  type: 'text',
  title: 'Response',
  preview: 'Hello world',
  body: 'Hello world from the assistant',
  ts: Date.now(),
  role: 'assistant',
  depth: 0,
});

export const makeCCUsage = makeFixture<CCUsage>({
  inputTokens: 1000,
  outputTokens: 500,
  cacheRead: 200,
  cacheCreation: 50,
});

export const makeCCSession = makeFixture<CCSession>({
  id: 'session-1',
  label: 'Test Session',
  status: 'running',
  startedAt: Date.now(),
  duration: null,
  cards: [],
  result: null,
  usage: null,
  exitCode: null,
  prompt: 'Hello',
  backend: 'cc',
  agentIds: [],
  lastAgentId: null,
});

// ── localStorage mock helper ────────────────────────────────────────────────

/**
 * Install a Map-backed localStorage mock on globalThis.
 * Returns the backing Map for direct inspection/clearing.
 */
export function mockLocalStorage(): Map<string, string> {
  const storage = new Map<string, string>();
  const mock = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, val: string) => { storage.set(key, val); }),
    removeItem: vi.fn((key: string) => { storage.delete(key); }),
    clear: vi.fn(() => storage.clear()),
    get length() { return storage.size; },
    key: vi.fn(() => null),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true });
  return storage;
}

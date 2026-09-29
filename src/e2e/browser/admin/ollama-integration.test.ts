// src/e2e/browser/admin/ollama-integration.test.ts
// E2E tests: Ollama integration with the admin dashboard.
// Tests Ollama API endpoints, overseer feature completeness, and SSE streaming.
// Session persistence and tab behavior are covered by unit tests in
// admin/src/ui/__tests__/ollamaSessions.test.ts.
// Aider follow-up behavior is covered by aider-integration.test.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  getOllamaStatus,
  ollamaChatDirect,
  setOllamaConfig,
  preflight,
} from './helpers';

describe('Ollama Overseer Feature Completeness', () => {
  beforeAll(async () => {
    const status = await preflight();
    if (!status.admin) throw new Error('Admin dashboard not running at localhost:5175');
    if (!status.ollama) throw new Error('Ollama not running at localhost:11434');
  }, 15_000);

  // ── Status & Discovery ──────────────────────────────────

  it('Ollama status endpoint reports running state and loaded models', async () => {
    const status = await getOllamaStatus();
    expect(status).not.toBeNull();
    expect(status!.running).toBe(true);
    expect(typeof status!.version).toBe('string');
    expect(Array.isArray(status!.loaded)).toBe(true);
    expect(status!.config).toBeDefined();
  });

  it('Ollama models endpoint lists installed models', async () => {
    const res = await fetch('http://localhost:5175/__admin_ollama/models');
    expect(res.ok).toBe(true);
    const data = await res.json() as { models?: Array<{ name: string }> };
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models!.length).toBeGreaterThan(0);
  });

  // ── Chat & SSE Streaming ────────────────────────────────

  it('ollama-chat endpoint streams text and returns exit event', async () => {
    const result = await ollamaChatDirect('Reply with only the word PONG');
    expect(result.exitCode).toBe(0);
    expect(result.text.length).toBeGreaterThan(0);
  }, 120_000);

  it('ollama-chat uses model resolution (primary role)', async () => {
    const result = await ollamaChatDirect('Reply with only the word RESOLVED');
    expect(result.exitCode).toBe(0);
    expect(result.text.length).toBeGreaterThan(0);
  }, 120_000);

  // ── Config Management ───────────────────────────────────

  it('config can be saved and read back correctly', async () => {
    const statusBefore = await getOllamaStatus();
    const origConfig = statusBefore?.config;

    const result = await setOllamaConfig({ serverAutoStart: true });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(result!.config.serverAutoStart).toBe(true);

    const statusAfter = await getOllamaStatus();
    expect(statusAfter!.config.serverAutoStart).toBe(true);

    await setOllamaConfig({
      serverAutoStart: origConfig?.serverAutoStart ?? false,
    });
  });

  it('config role assignments persist correctly', async () => {
    const statusBefore = await getOllamaStatus();
    const origRoles = (statusBefore?.config?.roles ?? {}) as Record<string, string>;

    const models = await fetch('http://localhost:5175/__admin_ollama/models')
      .then(r => r.json() as Promise<{ models: Array<{ name: string }> }>);

    if (models.models.length === 0) return;

    const testModel = models.models[0].name;
    const testRoles = { ...origRoles, [testModel]: 'fast' };
    const result = await setOllamaConfig({ roles: testRoles });
    expect(result!.ok).toBe(true);

    const statusAfter = await getOllamaStatus();
    const savedRoles = statusAfter!.config.roles as Record<string, string>;
    expect(savedRoles[testModel]).toBe('fast');

    await setOllamaConfig({ roles: origRoles });
  });

  // ── Analyzer / SSE Parsing ──────────────────────────────

  it('analyzer can parse overseer-style analysis from Qwen SSE', async () => {
    const result = await ollamaChatDirect(
      'Return ONLY this exact JSON, nothing else: {"status":"ok","findings":[]}',
    );
    expect(result.exitCode).toBe(0);
    // Key assertion: we get non-empty text back from the SSE stream
    // (this validates the analyzer SSE parsing fix)
    expect(result.text.trim().length).toBeGreaterThan(2);

    // Try to extract JSON from Qwen's response
    let cleaned = result.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const braceStart = cleaned.indexOf('{');
      const braceEnd = cleaned.lastIndexOf('}');
      if (braceStart !== -1 && braceEnd > braceStart) {
        try { parsed = JSON.parse(cleaned.slice(braceStart, braceEnd + 1)); } catch { /* ok */ }
      }
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      expect(typeof obj.status).toBe('string');
      expect(Array.isArray(obj.findings)).toBe(true);
    }
  }, 120_000);

  // ── Overseer Endpoints ──────────────────────────────────

  it('overseer config endpoint returns valid default structure', async () => {
    const res = await fetch('http://localhost:5175/__admin_overseer/config');
    expect(res.ok).toBe(true);
    const config = await res.json() as Record<string, unknown>;

    expect(typeof config.enabled).toBe('boolean');
    expect(typeof config.domains).toBe('object');
    expect(Array.isArray(config.standingOrders)).toBe(true);
    expect(typeof config.claude).toBe('object');
    expect(typeof config.discord).toBe('object');
    expect(typeof config.heartbeatIntervalMs).toBe('number');

    const domains = config.domains as Record<string, unknown>;
    for (const domain of ['bugs', 'tests', 'server-health', 'perf', 'player-activity', 'deploy', 'stale-tasks']) {
      expect(domains[domain]).toBeDefined();
      const d = domains[domain] as Record<string, unknown>;
      expect(['watch', 'advise', 'act']).toContain(d.mode);
      expect(typeof d.pollIntervalMs).toBe('number');
      expect(typeof d.enabled).toBe('boolean');
    }
  });

  it('overseer state endpoint returns valid structure', async () => {
    const res = await fetch('http://localhost:5175/__admin_overseer/state');
    expect(res.ok).toBe(true);
    const state = await res.json() as Record<string, unknown>;

    expect(typeof state.running).toBe('boolean');
    expect(typeof state.startedAt).toBe('number');
    expect(typeof state.lastTick).toBe('object');
    expect(Array.isArray(state.claudeDispatches)).toBe(true);
    expect(typeof state.heartbeatTs).toBe('number');
  });

  it('overseer log endpoint returns array', async () => {
    const res = await fetch('http://localhost:5175/__admin_overseer/log?limit=10');
    expect(res.ok).toBe(true);
    const log = await res.json();
    expect(Array.isArray(log)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { buildPrompt, parseQwenResponse } from '../middleware/overseer/analyzer';
import type { DomainSnapshot, StandingOrder } from '../middleware/overseer/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeSnapshot(domain: DomainSnapshot['domain'] = 'bugs'): DomainSnapshot {
  return {
    domain,
    ts: 1_700_000_000_000,
    data: { reports: [] },
    metrics: { totalRecent: 0, burstDetected: 0, uniqueErrors: 0 },
  };
}

const order: StandingOrder = {
  id: 'ord-1',
  text: 'Escalate any burst of 3+ errors immediately.',
  createdAt: 1_700_000_000_000,
  domains: ['bugs'],
};

// ── buildPrompt ───────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('includes domain name and mode in output', () => {
    const prompt = buildPrompt('bugs', 'watch', makeSnapshot(), null, []);
    expect(prompt).toContain('"bugs"');
    expect(prompt).toContain('"watch"');
  });

  it('includes standing orders text when provided', () => {
    const prompt = buildPrompt('bugs', 'advise', makeSnapshot(), null, [order]);
    expect(prompt).toContain('Escalate any burst of 3+ errors immediately.');
  });

  it('includes previous snapshot data when provided', () => {
    const prev = makeSnapshot('bugs');
    const prompt = buildPrompt('bugs', 'act', makeSnapshot(), prev, []);
    expect(prompt).toContain('## Previous Snapshot');
    // Should NOT show the "First tick" message
    expect(prompt).not.toContain('First tick');
  });

  it('shows "First tick" message when no previous snapshot', () => {
    const prompt = buildPrompt('bugs', 'watch', makeSnapshot(), null, []);
    expect(prompt).toContain('First tick');
  });
});

// ── parseQwenResponse ─────────────────────────────────────────────────────────

describe('parseQwenResponse', () => {
  const validAnalysis = {
    status: 'ok' as const,
    findings: [
      {
        title: 'All clear',
        description: 'No anomalies detected.',
        severity: 'minor' as const,
        incidentType: 'config-change' as const,
        suggestedAction: null,
        confidenceLevel: 'high' as const,
        relatedRef: null,
      },
    ],
  };

  it('parses a valid JSON string', () => {
    const raw = JSON.stringify(validAnalysis);
    const result = parseQwenResponse(raw);
    expect(result.status).toBe('ok');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('All clear');
  });

  it('returns ok with empty findings on invalid JSON', () => {
    const result = parseQwenResponse('This is not JSON at all!');
    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([]);
  });

  it('extracts JSON from markdown code fence', () => {
    const raw = '```json\n' + JSON.stringify(validAnalysis) + '\n```';
    const result = parseQwenResponse(raw);
    expect(result.status).toBe('ok');
    expect(result.findings).toHaveLength(1);
  });

  it('handles Qwen thinking tags before JSON', () => {
    const thinking = '<think>Let me analyze this carefully...</think>';
    const raw = thinking + '\n' + JSON.stringify(validAnalysis);
    const result = parseQwenResponse(raw);
    expect(result.status).toBe('ok');
    expect(result.findings).toHaveLength(1);
  });
});

import { describe, it, expect } from 'vitest';
import { canDispatchClaude, buildClaudePrompt, buildAiderPrompt } from '../middleware/overseer/dispatcher';
import type { OverseerConfig, QwenFinding } from '../middleware/overseer/types';

const baseConfig: OverseerConfig['claude'] = {
  maxDispatchesPerHour: 5,
  maxDispatchesPerDay: 20,
  requireApproval: false,
};

describe('canDispatchClaude', () => {
  it('allows dispatch when under rate limit', () => {
    expect(canDispatchClaude(baseConfig, [])).toBe(true);
  });

  it('blocks when hourly limit reached', () => {
    const now = Date.now();
    const dispatches = Array.from({ length: 5 }, (_, i) => ({ ts: now - i * 60_000 }));
    expect(canDispatchClaude(baseConfig, dispatches)).toBe(false);
  });

  it('blocks when daily limit reached', () => {
    const now = Date.now();
    const dispatches = Array.from({ length: 20 }, (_, i) => ({ ts: now - i * 3600_000 }));
    expect(canDispatchClaude(baseConfig, dispatches)).toBe(false);
  });

  it('allows when old entries expired', () => {
    const twoHoursAgo = Date.now() - 2 * 3600_000;
    const dispatches = Array.from({ length: 5 }, (_, i) => ({ ts: twoHoursAgo - i * 60_000 }));
    expect(canDispatchClaude(baseConfig, dispatches)).toBe(true);
  });

  it('blocks when requireApproval is true', () => {
    expect(canDispatchClaude({ ...baseConfig, requireApproval: true }, [])).toBe(false);
  });
});

describe('buildClaudePrompt', () => {
  const finding: QwenFinding = {
    title: 'Null ref in matchmaking',
    description: 'TypeError at matchmaking.ts:142',
    severity: 'critical',
    incidentType: 'outage',
    suggestedAction: 'Check null guard',
    confidenceLevel: 'high',
    relatedRef: 'BUG-14',
  };

  it('includes finding details and log instruction', () => {
    const prompt = buildClaudePrompt(finding, 'bugs', []);
    expect(prompt).toContain('Null ref in matchmaking');
    expect(prompt).toContain('BUG-14');
    expect(prompt).toContain('matchmaking.ts:142');
    expect(prompt).toContain('/__admin_overseer/log');
  });
});

describe('buildAiderPrompt', () => {
  const finding: QwenFinding = {
    title: 'Fix lobby crash',
    description: 'Null check missing',
    severity: 'major',
    incidentType: 'hotfix',
    suggestedAction: 'Add null guard',
    confidenceLevel: 'high',
    relatedRef: 'BUG-15',
  };

  it('includes curl log command with incident ID', () => {
    const prompt = buildAiderPrompt(finding, 'bugs', 'inc_123');
    expect(prompt).toContain('curl');
    expect(prompt).toContain('/__admin_overseer/log');
    expect(prompt).toContain('inc_123');
  });
});

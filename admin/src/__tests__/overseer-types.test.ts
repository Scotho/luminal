import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OVERSEER_CONFIG,
  DOMAIN_IDS,
  isValidMode,
  isValidDomainId,
  type OverseerConfig,
} from '../middleware/overseer/types';

describe('overseer types', () => {
  it('DEFAULT_OVERSEER_CONFIG has all 7 domains', () => {
    const config = DEFAULT_OVERSEER_CONFIG;
    expect(Object.keys(config.domains)).toHaveLength(7);
    for (const id of DOMAIN_IDS) {
      expect(config.domains[id]).toBeDefined();
      expect(config.domains[id].mode).toBe('watch');
      expect(config.domains[id].enabled).toBe(true);
    }
  });

  it('ships disabled with requireApproval true', () => {
    const config = DEFAULT_OVERSEER_CONFIG;
    expect(config.enabled).toBe(false);
    expect(config.claude.requireApproval).toBe(true);
  });

  it('isValidMode accepts watch/advise/act', () => {
    expect(isValidMode('watch')).toBe(true);
    expect(isValidMode('advise')).toBe(true);
    expect(isValidMode('act')).toBe(true);
    expect(isValidMode('destroy')).toBe(false);
  });

  it('isValidDomainId validates all 7 domains', () => {
    for (const id of DOMAIN_IDS) {
      expect(isValidDomainId(id)).toBe(true);
    }
    expect(isValidDomainId('unknown')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { isDomainDue } from '../middleware/overseer/daemon';

describe('isDomainDue', () => {
  it('returns true when no previous tick recorded', () => {
    expect(isDomainDue({}, 'bugs', 120_000)).toBe(true);
  });

  it('returns false when within interval', () => {
    const now = Date.now();
    expect(isDomainDue({ bugs: now - 60_000 }, 'bugs', 120_000)).toBe(false);
  });

  it('returns true when interval has elapsed', () => {
    const now = Date.now();
    expect(isDomainDue({ bugs: now - 130_000 }, 'bugs', 120_000)).toBe(true);
  });
});

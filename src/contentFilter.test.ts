import { describe, it, expect } from 'vitest';
import { isBlocked, buildHashes } from './contentFilter';

describe('isBlocked', () => {
  it('returns false for empty string', () => {
    expect(isBlocked('')).toBe(false);
  });

  it('returns false for normal text', () => {
    expect(isBlocked('hello world')).toBe(false);
    expect(isBlocked('good game!')).toBe(false);
    expect(isBlocked('nice play')).toBe(false);
  });

  it('returns false for single characters', () => {
    expect(isBlocked('a')).toBe(false);
    expect(isBlocked('x')).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(isBlocked('12345')).toBe(false);
  });

  it('returns false for common chat messages', () => {
    expect(isBlocked('gg')).toBe(false);
    expect(isBlocked('rematch?')).toBe(false);
    expect(isBlocked('that was close')).toBe(false);
    expect(isBlocked('lol')).toBe(false);
  });

  it('returns false for profanity (not filtered by design)', () => {
    expect(isBlocked('damn')).toBe(false);
    expect(isBlocked('hell')).toBe(false);
  });
});

describe('buildHashes', () => {
  it('returns array of term-hash pairs', () => {
    const result = buildHashes(['test', 'hello']);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('term', 'test');
    expect(result[0]).toHaveProperty('hash');
    expect(typeof result[0].hash).toBe('number');
  });

  it('produces consistent hashes', () => {
    const r1 = buildHashes(['test']);
    const r2 = buildHashes(['test']);
    expect(r1[0].hash).toBe(r2[0].hash);
  });

  it('produces different hashes for different terms', () => {
    const result = buildHashes(['alpha', 'beta']);
    expect(result[0].hash).not.toBe(result[1].hash);
  });

  it('normalizes before hashing (leetspeak)', () => {
    const normal = buildHashes(['test']);
    const leet = buildHashes(['t3st']);
    expect(normal[0].hash).toBe(leet[0].hash);
  });
});

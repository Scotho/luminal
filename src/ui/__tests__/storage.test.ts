// ── Storage Utility Tests ────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLocalBool, setLocalBool,
  getLocalString, setLocalString,
  getLocalNumber, setLocalNumber,
} from '../storage';

beforeEach(() => {
  localStorage.clear();
});

describe('getLocalBool / setLocalBool', () => {
  it('returns defaultVal when key is missing', () => {
    expect(getLocalBool('missing', true)).toBe(true);
    expect(getLocalBool('missing', false)).toBe(false);
  });

  it('returns true for "true" string', () => {
    localStorage.setItem('k', 'true');
    expect(getLocalBool('k', false)).toBe(true);
  });

  it('returns false for "false" string', () => {
    localStorage.setItem('k', 'false');
    expect(getLocalBool('k', true)).toBe(false);
  });

  it('returns false for garbage value', () => {
    localStorage.setItem('k', 'banana');
    expect(getLocalBool('k', true)).toBe(false);
  });

  it('round-trips correctly', () => {
    setLocalBool('k', true);
    expect(getLocalBool('k', false)).toBe(true);
    setLocalBool('k', false);
    expect(getLocalBool('k', true)).toBe(false);
  });
});

describe('getLocalString / setLocalString', () => {
  it('returns default when key is missing', () => {
    expect(getLocalString('missing', 'fallback')).toBe('fallback');
  });

  it('returns empty string as default when no default provided', () => {
    expect(getLocalString('missing')).toBe('');
  });

  it('round-trips correctly', () => {
    setLocalString('k', 'hello');
    expect(getLocalString('k')).toBe('hello');
  });
});

describe('getLocalNumber / setLocalNumber', () => {
  it('returns default when key is missing', () => {
    expect(getLocalNumber('missing', 42)).toBe(42);
  });

  it('returns 0 as default when no default provided', () => {
    expect(getLocalNumber('missing')).toBe(0);
  });

  it('parses valid numbers', () => {
    localStorage.setItem('k', '3.14');
    expect(getLocalNumber('k')).toBe(3.14);
  });

  it('returns default for NaN string', () => {
    localStorage.setItem('k', 'abc');
    expect(getLocalNumber('k', 99)).toBe(99);
  });

  it('returns default for Infinity', () => {
    localStorage.setItem('k', 'Infinity');
    expect(getLocalNumber('k', 10)).toBe(10);
  });

  it('round-trips correctly', () => {
    setLocalNumber('k', 7);
    expect(getLocalNumber('k')).toBe(7);
  });
});

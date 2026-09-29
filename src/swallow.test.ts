import { describe, it, expect, vi } from 'vitest';
import { swallow, warnDev } from './swallow';

describe('swallow', () => {
  it('returns a function', () => {
    const handler = swallow('audio');
    expect(typeof handler).toBe('function');
  });

  it('returned function ignores its argument and returns undefined', () => {
    const handler = swallow('audio');
    expect(handler(new Error('test'))).toBeUndefined();
    expect(handler('string error')).toBeUndefined();
    expect(handler(undefined)).toBeUndefined();
  });

  it('works as a .catch() handler without throwing', async () => {
    const rejected = Promise.reject(new Error('fail'));
    // Should resolve without error
    await rejected.catch(swallow('test'));
  });

  it('different labels return independent handlers', () => {
    const h1 = swallow('a');
    const h2 = swallow('b');
    expect(h1).not.toBe(h2);
  });
});

describe('warnDev', () => {
  it('logs warning with [DEV] prefix in dev mode', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnDev('hello', 42);
    expect(spy).toHaveBeenCalledWith('[DEV]', 'hello', 42);
    spy.mockRestore();
  });

  it('handles multiple arguments', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnDev('a', 'b', 'c');
    expect(spy).toHaveBeenCalledWith('[DEV]', 'a', 'b', 'c');
    spy.mockRestore();
  });

  it('handles no arguments', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnDev();
    expect(spy).toHaveBeenCalledWith('[DEV]');
    spy.mockRestore();
  });
});

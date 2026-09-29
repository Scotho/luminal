// ── Admin store tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot } from '../types';

// Mock fetch before importing the module under test
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { loadSnapshot, saveSnapshot } from '../store';

const sampleSnapshot: Snapshot<{ id: string }> = {
  lastUpdated: '2024-01-01T00:00:00Z',
  summary: { total: 5 },
  entries: [{ id: 'abc' }],
};

describe('loadSnapshot', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await loadSnapshot('users');

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/data/users.json');
  });

  it('returns parsed JSON on 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(sampleSnapshot),
    });

    const result = await loadSnapshot('users');

    expect(result).toEqual(sampleSnapshot);
  });

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await loadSnapshot('users');

    expect(result).toBeNull();
  });
});

describe('saveSnapshot', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends POST with correct URL, headers, and body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await saveSnapshot('users', sampleSnapshot);

    expect(mockFetch).toHaveBeenCalledWith(
      '/__admin_save?file=users.json',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleSnapshot, null, 2),
      }),
    );
  });

  it('handles a non-ok response gracefully without throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(saveSnapshot('users', sampleSnapshot)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('handles fetch rejection gracefully without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(saveSnapshot('users', sampleSnapshot)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});

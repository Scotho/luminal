import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _clearCache } from '../middleware/routes/githubHelper';

beforeEach(() => {
  _clearCache();
  process.env.GITHUB_TOKEN = 'test-token-123';
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
  vi.restoreAllMocks();
});

import { ghFetchJSON, GITHUB_REPO } from '../middleware/routes/githubHelper';

describe('githubHelper', () => {
  it('exports the correct repo', () => {
    expect(GITHUB_REPO).toBe('Scotho/luminal');
  });

  it('returns null when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await ghFetchJSON('actions/runs?per_page=1');
    expect(result).toBeNull();
  });

  it('fetches from GitHub API with auth header', async () => {
    const mockData = { workflow_runs: [] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const result = await ghFetchJSON('actions/runs?per_page=1');
    expect(result).toEqual(mockData);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/Scotho/luminal/actions/runs?per_page=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token test-token-123',
        }),
      }),
    );
  });

  it('returns null on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'rate limited' }),
    } as unknown as Response);

    const result = await ghFetchJSON('actions/runs');
    expect(result).toBeNull();
  });

  it('caches results for the specified duration', async () => {
    const mockData = { runs: [1] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const result1 = await ghFetchJSON('actions/runs', 60);
    const result2 = await ghFetchJSON('actions/runs', 60);

    expect(result1).toEqual(mockData);
    expect(result2).toEqual(mockData);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

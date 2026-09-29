export const GITHUB_REPO = 'Scotho/luminal';
const GITHUB_API = 'https://api.github.com';

// ── In-memory cache ──────────────────────────────────────────
interface CacheEntry { data: unknown; expiresAt: number }
const _cache = new Map<string, CacheEntry>();

/** For testing: clear the cache. */
export function _clearCache(): void { _cache.clear(); }

/**
 * Fetch JSON from the GitHub API. Returns parsed JSON or null on error.
 * Results are cached in memory for `cacheSec` seconds.
 */
export async function ghFetchJSON(ghPath: string, cacheSec = 60): Promise<unknown | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  // Check cache
  const cached = _cache.get(ghPath);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const response = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/${ghPath}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    _cache.set(ghPath, { data, expiresAt: Date.now() + cacheSec * 1000 });
    return data;
  } catch {
    return null;
  }
}

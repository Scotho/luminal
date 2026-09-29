// ── Content Filter ───────────────────────────────────────
// Blocks CSAM and severe illegal content only. Does NOT filter profanity.
// Terms are hashed to avoid the blocklist itself being problematic in source.

// Simple hash for obfuscation (not crypto — just avoids plain text in source)
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Pre-computed hashes of blocked terms (CSAM / child exploitation / severe illegal)
const BLOCKED_HASHES = new Set<number>([
  -906537541, 1361505, 1507354, 93344025, -1309377747,
  -1723675188, 1242178462, -287208201, 1087491, -1817832888,
  3045380, 68681, 96203, -1397792965, 1844797404,
  -1067493866, 1994092953, -1190625753, 2035819, 1608741,
]);

// Normalize: lowercase, collapse repeats, decode leetspeak
function normalize(text: string): string {
  let s = text.toLowerCase();
  // Leetspeak
  s = s.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
       .replace(/@/g, 'a').replace(/\$/g, 's').replace(/5/g, 's')
       .replace(/7/g, 't').replace(/4/g, 'a').replace(/8/g, 'b');
  // Collapse repeated chars (e.g., "cchhiildd" -> "child")
  s = s.replace(/(.)\1+/g, '$1');
  // Remove non-alpha
  s = s.replace(/[^a-z]/g, ' ');
  return s;
}

// Generate n-grams (substrings of 1-4 words)
function getNGrams(text: string): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const grams: string[] = [];
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      grams.push(words.slice(i, i + n).join(' '));
    }
  }
  return grams;
}

export function isBlocked(text: string): boolean {
  if (!text || text.length === 0) return false;
  const normalized = normalize(text);
  const grams = getNGrams(normalized);
  for (const gram of grams) {
    if (BLOCKED_HASHES.has(simpleHash(gram))) return true;
  }
  return false;
}

// Build hashes for a list of terms (dev utility, not called at runtime)
// ts-prune-ignore-next
export function buildHashes(terms: string[]): Array<{ term: string; hash: number }> {
  return terms.map(t => ({ term: t, hash: simpleHash(normalize(t)) }));
}

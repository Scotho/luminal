// ── Typed localStorage Wrapper ───────────────────────────
// Replaces scattered raw localStorage calls with typed, default-aware accessors.

export function getLocalBool(key: string, defaultVal: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return defaultVal;
  return raw === 'true';
}

export function setLocalBool(key: string, val: boolean): void {
  localStorage.setItem(key, val ? 'true' : 'false');
}

export function getLocalString(key: string, defaultVal: string = ''): string {
  return localStorage.getItem(key) ?? defaultVal;
}

export function setLocalString(key: string, val: string): void {
  localStorage.setItem(key, val);
}

// ts-prune-ignore-next
export function getLocalNumber(key: string, defaultVal: number = 0): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return defaultVal;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultVal;
}

// ts-prune-ignore-next
export function setLocalNumber(key: string, val: number): void {
  localStorage.setItem(key, String(val));
}

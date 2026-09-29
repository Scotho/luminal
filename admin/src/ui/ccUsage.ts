import type { CCSession, CCUsageRecord } from '../types';

// ── Usage persistence ───────────────────────────────────

export async function persistUsage(session: CCSession): Promise<void> {
  if (!session.usage) return;
  try {
    const res = await fetch('/data/cc-usage.json');
    const existing: CCUsageRecord[] = res.ok ? await res.json() as CCUsageRecord[] : [];
    if (!Array.isArray(existing)) return;
    if (existing.length > 500) existing.splice(0, existing.length - 500);

    existing.push({
      sessionId: session.id,
      label: session.label,
      ts: new Date(session.startedAt).toISOString(),
      duration: session.duration,
      usage: session.usage,
      exitCode: session.exitCode,
    });

    await fetch('/__admin_save?file=cc-usage.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(existing, null, 2),
    });
  } catch {
    // Best-effort — don't break session flow
  }
}

/** Load usage records from disk. */
export async function loadUsageRecords(): Promise<CCUsageRecord[]> {
  try {
    const res = await fetch('/data/cc-usage.json');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data as CCUsageRecord[] : [];
  } catch {
    return [];
  }
}

/** Aggregate usage totals from records. */
export function aggregateUsage(records: CCUsageRecord[]): {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  totalSessions: number;
  totalDurationMs: number;
} {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalDurationMs = 0;
  for (const r of records) {
    totalInput += r.usage.inputTokens;
    totalOutput += r.usage.outputTokens;
    totalCacheRead += r.usage.cacheRead ?? 0;
    totalCacheCreation += r.usage.cacheCreation ?? 0;
    totalDurationMs += r.duration ?? 0;
  }
  return {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreation,
    totalSessions: records.length,
    totalDurationMs,
  };
}

/** Estimate cost from usage records. Rates are per million tokens. */
export function estimateCost(records: CCUsageRecord[], inputRate = 15, outputRate = 75, cacheReadRate = 1.5): number {
  let total = 0;
  for (const r of records) {
    const input = r.usage.inputTokens - (r.usage.cacheRead ?? 0);
    total += (input / 1_000_000) * inputRate;
    total += ((r.usage.cacheRead ?? 0) / 1_000_000) * cacheReadRate;
    total += (r.usage.outputTokens / 1_000_000) * outputRate;
  }
  return total;
}

/** Compute usage within a time window. */
export function usageInWindow(records: CCUsageRecord[], windowMs: number): {
  input: number;
  output: number;
  sessions: number;
  activeTimeMs: number;
} {
  const cutoff = Date.now() - windowMs;
  let input = 0, output = 0, sessions = 0, activeTimeMs = 0;
  for (const r of records) {
    if (new Date(r.ts).getTime() < cutoff) continue;
    input += r.usage.inputTokens;
    output += r.usage.outputTokens;
    sessions++;
    activeTimeMs += r.duration ?? 0;
  }
  return { input, output, sessions, activeTimeMs };
}

/** Estimate usage percentage of a time budget. */
export function estimateUsagePct(activeTimeMs: number, budgetHours: number): number {
  const budgetMs = budgetHours * 3_600_000;
  return Math.min(100, Math.round((activeTimeMs / budgetMs) * 100));
}

/** Format ms as "Xh Xm" */
export function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Ollama usage persistence (localStorage) ───────────

const OLLAMA_USAGE_KEY = 'luminal-ollama-usage';

export interface OllamaUsageRecord {
  sessionId: string;
  label: string;
  ts: string;
  duration: number | null;
  estimatedTokens: number;  // chars / 4
  exitCode: number | null;
}

/** Persist an Ollama session's usage to localStorage. */
export function persistOllamaUsage(session: CCSession): void {
  try {
    const raw = localStorage.getItem(OLLAMA_USAGE_KEY);
    const existing: OllamaUsageRecord[] = raw ? JSON.parse(raw) as OllamaUsageRecord[] : [];
    // Estimate tokens from user/assistant card bodies only (chars / 4)
    let totalChars = 0;
    for (const card of session.cards) {
      if (card.role === 'user' || card.role === 'assistant') {
        totalChars += card.body.length;
      }
    }
    const estimatedTokens = Math.round(totalChars / 4);
    existing.push({
      sessionId: session.id,
      label: session.label,
      ts: new Date(session.startedAt).toISOString(),
      duration: session.duration,
      estimatedTokens,
      exitCode: session.exitCode,
    });
    // Keep at most 500 records
    if (existing.length > 500) existing.splice(0, existing.length - 500);
    localStorage.setItem(OLLAMA_USAGE_KEY, JSON.stringify(existing));
  } catch {
    // Best-effort
  }
}

/** Load Ollama usage records from localStorage. */
export function loadOllamaUsageRecords(): OllamaUsageRecord[] {
  try {
    const raw = localStorage.getItem(OLLAMA_USAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data as OllamaUsageRecord[] : [];
  } catch {
    return [];
  }
}

/** Aggregate Ollama usage totals. */
export function aggregateOllamaUsage(records: OllamaUsageRecord[]): {
  totalTokens: number;
  totalSessions: number;
  totalDurationMs: number;
} {
  let totalTokens = 0;
  let totalDurationMs = 0;
  for (const r of records) {
    totalTokens += r.estimatedTokens;
    totalDurationMs += r.duration ?? 0;
  }
  return { totalTokens, totalSessions: records.length, totalDurationMs };
}

/** Reset usage records — returns count deleted. */
export async function resetUsageRecords(): Promise<number> {
  const records = await loadUsageRecords();
  const count = records.length;
  await fetch('/__admin_save?file=cc-usage.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '[]',
  });
  return count;
}

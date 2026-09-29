// admin/src/middleware/overseer/analyzer.ts
// Qwen analysis module: builds prompts, parses responses, and sends requests.

import type { DomainId, DomainSnapshot, OverseerMode, StandingOrder, QwenAnalysis } from './types';

// ── Prompt Builder ────────────────────────────────────────────────────────────

export function buildPrompt(
  domain: DomainId,
  mode: OverseerMode,
  current: DomainSnapshot,
  previous: DomainSnapshot | null,
  orders: StandingOrder[],
): string {
  const sections: string[] = [];

  // Role header
  sections.push(`You are an automated ops monitor analyzing the "${domain}" domain in "${mode}" mode.`);

  // Standing Orders
  const activeOrders = orders.filter(
    (o) => o.domains === 'all' || o.domains.includes(domain),
  );
  if (activeOrders.length > 0) {
    const bullets = activeOrders.map((o) => `- ${o.text}`).join('\n');
    sections.push(`## Standing Orders\n${bullets}`);
  } else {
    sections.push(`## Standing Orders\nNone active.`);
  }

  // Current Snapshot
  const currentJson = JSON.stringify({ data: current.data, metrics: current.metrics }, null, 2);
  sections.push(`## Current Snapshot\n${currentJson}`);

  // Previous Snapshot
  if (previous !== null) {
    const previousJson = JSON.stringify({ data: previous.data, metrics: previous.metrics }, null, 2);
    sections.push(`## Previous Snapshot\n${previousJson}`);
  } else {
    sections.push(`## Previous Snapshot\nFirst tick — no history.`);
  }

  // Instructions with response schema
  sections.push(`## Instructions
Analyze the current snapshot against the previous one and any standing orders.
Respond with valid JSON matching this schema exactly:

{
  "status": "ok" | "warning" | "critical",
  "findings": [
    {
      "title": string,
      "description": string,
      "severity": "critical" | "major" | "minor",
      "incidentType": "outage" | "deploy" | "config-change" | "hotfix" | "rollback",
      "suggestedAction": string | null,
      "confidenceLevel": "high" | "medium" | "low",
      "relatedRef": string | null
    }
  ]
}

Return only the JSON object, no extra text.`);

  return sections.join('\n\n');
}

// ── Response Parser ───────────────────────────────────────────────────────────

const FALLBACK: QwenAnalysis = { status: 'ok', findings: [] };

function isValidAnalysis(val: unknown): val is QwenAnalysis {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return typeof obj['status'] === 'string' && Array.isArray(obj['findings']);
}

export function parseQwenResponse(raw: string): QwenAnalysis {
  if (!raw || typeof raw !== 'string') return FALLBACK;

  // 1. Strip Qwen thinking tags
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Extract from markdown code fence
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // 3. Try direct parse
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (isValidAnalysis(parsed)) return parsed;
    return FALLBACK;
  } catch {
    // fall through
  }

  // 4. Find first {...} block in the string
  const braceStart = cleaned.indexOf('{');
  const braceEnd = cleaned.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    const candidate = cleaned.slice(braceStart, braceEnd + 1);
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isValidAnalysis(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  // 5. Unparseable — return safe fallback
  return FALLBACK;
}

// ── Qwen API Caller ───────────────────────────────────────────────────────────

interface OllamaChunk {
  type?: string;
  content?: string;
  result?: string;
}

export async function analyzeWithQwen(
  adminBase: string,
  prompt: string,
  model: string,
): Promise<string> {
  try {
    const res = await fetch(`${adminBase}/__admin_exec/ollama-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model }),
    });

    if (!res.ok || !res.body) return '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete ndjson lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed) as OllamaChunk;
          if (chunk.type === 'text' && typeof chunk.content === 'string') {
            output += chunk.content;
          } else if (chunk.type === 'result' && typeof chunk.result === 'string') {
            output += chunk.result;
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as OllamaChunk;
        if (chunk.type === 'text' && typeof chunk.content === 'string') {
          output += chunk.content;
        } else if (chunk.type === 'result' && typeof chunk.result === 'string') {
          output += chunk.result;
        }
      } catch {
        // skip
      }
    }

    return output;
  } catch {
    return '';
  }
}

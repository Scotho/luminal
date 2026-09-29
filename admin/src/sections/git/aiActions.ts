// admin/src/sections/git/aiActions.ts — Centralized AI dispatch helpers for Git section

import { dispatchCC } from '../../ui/ccPanel';

// ── Types ────────────────────────────────────────────────

export type AIModel = 'claude' | 'qwen';

// ── Model preference persistence ─────────────────────────

const MODEL_PREF_PREFIX = 'git-ai-model-';

export function getModelPref(feature: string): AIModel {
  const stored = localStorage.getItem(`${MODEL_PREF_PREFIX}${feature}`);
  return stored === 'qwen' ? 'qwen' : 'claude';
}

export function setModelPref(feature: string, model: AIModel): void {
  localStorage.setItem(`${MODEL_PREF_PREFIX}${feature}`, model);
}

// ── Model toggle pill ────────────────────────────────────

export function modelToggle(feature: string): string {
  const current = getModelPref(feature);

  const claudeActive = current === 'claude';
  const qwenActive = current === 'qwen';

  const claudeStyle = claudeActive
    ? 'background:var(--accent); color:var(--bg); font-weight:700;'
    : 'background:transparent; color:var(--text-dim);';
  const qwenStyle = qwenActive
    ? 'background:var(--green); color:var(--bg); font-weight:700;'
    : 'background:transparent; color:var(--text-dim);';

  const btnBase = 'border:none; cursor:pointer; padding:2px 7px; line-height:1.4; font-size:10px;';

  return (
    `<span class="ai-model-toggle" data-feature="${feature}" ` +
    `style="display:inline-flex; border:1px solid var(--border); border-radius:10px; overflow:hidden; font-size:10px;">` +
      `<button class="ai-model-opt" data-model="claude" style="${btnBase} ${claudeStyle}">Claude</button>` +
      `<button class="ai-model-opt" data-model="qwen" style="${btnBase} ${qwenStyle}">Qwen</button>` +
    `</span>`
  );
}

// ── Wire model toggles ────────────────────────────────────

export function wireModelToggles(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.ai-model-opt') as HTMLElement | null;
    if (!btn) return;

    const toggleEl = btn.closest('.ai-model-toggle') as HTMLElement | null;
    if (!toggleEl) return;

    const feature = toggleEl.dataset.feature;
    if (!feature) return;

    const model = btn.dataset.model as AIModel | undefined;
    if (model !== 'claude' && model !== 'qwen') return;

    setModelPref(feature, model);
    toggleEl.outerHTML = modelToggle(feature);
  });
}

// ── Inline AI streaming ───────────────────────────────────

export async function aiInline(
  feature: string,
  prompt: string,
  onToken: (token: string) => void,
): Promise<string> {
  const model = getModelPref(feature);

  if (model === 'qwen') {
    return _streamQwen(prompt, onToken);
  } else {
    return _streamClaude(feature, prompt, onToken);
  }
}

async function _streamQwen(
  prompt: string,
  onToken: (token: string) => void,
): Promise<string> {
  try {
    const res = await fetch('/__admin_exec/ollama-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: 'qwen3:14b', stream: true }),
    });

    if (!res.ok || !res.body) {
      onToken('[Error: model unavailable]');
      return '';
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      onToken(chunk);
      full += chunk;
    }

    return full;
  } catch {
    onToken('[Error: model unavailable]');
    return '';
  }
}

async function _streamClaude(
  feature: string,
  prompt: string,
  onToken: (token: string) => void,
): Promise<string> {
  return new Promise<string>((resolve) => {
    (async () => {
      let agentId: string;

      try {
        const res = await fetch('/__admin_exec/claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, label: `Git AI: ${feature}` }),
        });

        if (!res.ok) {
          onToken('[Error: model unavailable]');
          resolve('');
          return;
        }

        const body = await res.json() as { agentId: string };
        agentId = body.agentId;
      } catch {
        onToken('[Error: model unavailable]');
        resolve('');
        return;
      }

      const es = new EventSource(`/__admin_exec/stream?agent=${encodeURIComponent(agentId)}`);
      let full = '';

      es.addEventListener('stdout', (ev: MessageEvent) => {
        try {
          const payload = JSON.parse((ev as MessageEvent<string>).data) as { line: string };
          const token = payload.line + '\n';
          onToken(token);
          full += token;
        } catch {
          const raw = (ev as MessageEvent<string>).data + '\n';
          onToken(raw);
          full += raw;
        }
      });

      const done = (code: number): void => {
        es.close();
        if (code !== 0 && full === '') {
          onToken('[Error: model unavailable]');
        }
        resolve(full);
      };

      es.addEventListener('exit', (ev: MessageEvent) => {
        try {
          const payload = JSON.parse((ev as MessageEvent<string>).data) as { code: number };
          done(payload.code ?? 0);
        } catch {
          done(0);
        }
      });

      es.addEventListener('error', () => {
        done(1);
      });

      es.onerror = () => {
        done(1);
      };
    })().catch(() => {
      onToken('[Error: model unavailable]');
      resolve('');
    });
  });
}

// ── CC flyout dispatch ────────────────────────────────────

export async function aiFlyout(
  feature: string,
  label: string,
  prompt: string,
): Promise<string> {
  void feature; // feature is reserved for future routing / logging
  return dispatchCC(label, prompt);
}

import { sessionManager } from './ccSessionManager';
import type { EffortLevel } from '../types';
import { EFFORT_GLYPHS } from '../types';

// Simple cost estimate: ~$3/MTok input, ~$15/MTok output (Claude Sonnet)
function estimateCostFromSession(s: {
  usage?: { inputTokens: number; outputTokens: number; cacheRead?: number } | null;
}): number {
  if (!s.usage) return 0;
  const inputCost = (s.usage.inputTokens / 1_000_000) * 3;
  const outputCost = (s.usage.outputTokens / 1_000_000) * 15;
  return inputCost + outputCost;
}

export function createAmbientStatusBar(container: HTMLElement): { update(): void; destroy(): void } {
  const bar = document.createElement('div');
  bar.className = 'ambient-status-bar';
  container.appendChild(bar);

  function render(): void {
    const sessions = sessionManager.all();
    const running = sessions.filter(s => s.status === 'running');

    // Cost today from all sessions with usage
    const todayCost = sessions.reduce((sum, s) => sum + estimateCostFromSession(s), 0);

    const segments: string[] = [];

    // Effort glyph from most recent running session, or default 'high'
    const effort: EffortLevel = (running[0]?.effort) ?? 'high';
    segments.push(`<span class="asb-seg asb-effort" title="Effort: ${effort}">${EFFORT_GLYPHS[effort]} Opus</span>`);

    // Cost today
    if (todayCost > 0) {
      segments.push(`<span class="asb-seg asb-cost" title="Estimated API cost today">$${todayCost.toFixed(2)}</span>`);
    }

    // Agent count dots
    const runCount = running.length;
    const total = sessions.length;
    if (total > 0) {
      const dots = sessions.slice(0, 5).map(s => {
        if (s.status === 'running') return '●';
        if (s.status === 'error') return '<span style="color:var(--red-bright)">●</span>';
        return '○';
      }).join('');
      segments.push(`<span class="asb-seg asb-agents" title="${runCount} running / ${total} total">${dots} ${runCount} active</span>`);
    }

    // Context tokens from selected session
    const sel = sessionManager.selected();
    if (sel?.tokenCount) {
      const totalK = Math.round((sel.tokenCount.input + sel.tokenCount.output) / 1000);
      if (totalK > 0) {
        segments.push(`<span class="asb-seg asb-ctx" title="Context tokens used">${totalK}K ctx</span>`);
      }
    }

    if (segments.length === 0) {
      bar.innerHTML = '<span class="asb-seg asb-idle">No agents</span>';
    } else {
      bar.innerHTML = segments.join('<span class="asb-dot">·</span>');
    }

    // Ambient border color
    const hasError = sessions.some(s => s.status === 'error');
    const hasStalled = running.some(s => {
      const elapsed = Date.now() - (s.lastActivityTs ?? s.startedAt);
      return elapsed > 60_000;
    });
    bar.classList.toggle('asb--error', hasError);
    bar.classList.toggle('asb--stalled', hasStalled && !hasError);
  }

  const unsub = sessionManager.onChange(render);
  const interval = setInterval(render, 5000);
  render();

  return {
    update: render,
    destroy() {
      unsub();
      clearInterval(interval);
      bar.remove();
    },
  };
}

// admin/src/ui/contextGauge.ts
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'opus': 200_000,
  'sonnet': 200_000,
  'haiku': 200_000,
  'opus-1m': 1_000_000,
  'default': 200_000,
};

export function createContextGauge(container: HTMLElement): {
  update(input: number, output: number, cacheRead: number): void;
  destroy(): void;
} {
  const bar = document.createElement('div');
  bar.className = 'ctx-gauge';
  bar.innerHTML = `
    <div class="ctx-gauge-track">
      <div class="ctx-gauge-fill"></div>
    </div>
    <span class="ctx-gauge-label"></span>
  `;
  container.appendChild(bar);

  const fill = bar.querySelector('.ctx-gauge-fill') as HTMLElement;
  const label = bar.querySelector('.ctx-gauge-label') as HTMLElement;
  const maxCtx = MODEL_CONTEXT_WINDOWS['default'];

  return {
    update(input: number, output: number, _cacheRead: number) {
      const total = input + output;
      const pct = Math.min(100, (total / maxCtx) * 100);
      fill.style.width = `${pct}%`;
      fill.style.background = pct > 80 ? 'var(--red-bright, #d45234)' : pct > 50 ? 'var(--yellow)' : 'var(--green)';
      const totalK = (total / 1000).toFixed(0);
      const maxK = (maxCtx / 1000).toFixed(0);
      label.textContent = `${totalK}K / ${maxK}K`;
    },
    destroy() { bar.remove(); },
  };
}

import type { CCCard } from '../types';

const TOOL_COLORS: Record<string, string> = {
  Read: '#6ee0f0',
  Glob: '#6ee0f0',
  Grep: '#4a9eff',
  Edit: '#f0a040',
  Write: '#f0a040',
  Bash: '#d45234',
  Agent: '#b07aff',
  WebSearch: '#4a9eff',
  WebFetch: '#4a9eff',
  Skill: '#70d070',
  default: '#888',
};

function toolColor(name: string): string {
  for (const key of Object.keys(TOOL_COLORS)) {
    if (key !== 'default' && name.startsWith(key)) return TOOL_COLORS[key];
  }
  return TOOL_COLORS['default'];
}

function toolKey(title: string): string | null {
  for (const key of Object.keys(TOOL_COLORS)) {
    if (key !== 'default' && title.startsWith(key)) return key;
  }
  return null;
}

export function renderToolTimeline(cards: CCCard[], container: HTMLElement): void {
  const toolCards = cards.filter(c => c.type === 'tool');
  if (toolCards.length === 0) {
    container.innerHTML = '<div class="tl-empty">No tool calls yet</div>';
    return;
  }

  const earliest = toolCards[0].ts;
  const latest = toolCards[toolCards.length - 1].ts;
  const span = Math.max(latest - earliest, 1000);

  const usedToolKeys = [
    ...new Set(toolCards.map(c => toolKey(c.title)).filter((k): k is string => k !== null)),
  ];

  const bars = toolCards.map(c => {
    const left = ((c.ts - earliest) / span) * 100;
    const width = Math.max(0.5, ((c.toolDuration ?? 300) / span) * 100);
    const color = toolColor(c.title);
    const durLabel = c.toolDuration != null ? `${(c.toolDuration / 1000).toFixed(1)}s` : '...';
    return `<div class="tl-bar" style="left:${left}%;width:${width}%;background:${color};" title="${c.title} (${durLabel})"></div>`;
  }).join('');

  const legendItems = usedToolKeys
    .map(name => `<span class="tl-legend-item"><span class="tl-legend-dot" style="background:${TOOL_COLORS[name]}"></span>${name}</span>`)
    .join('');

  container.innerHTML = `
    <div class="tl-wrap">
      <div class="tl-track">${bars}</div>
      ${usedToolKeys.length > 0 ? `<div class="tl-legend">${legendItems}</div>` : ''}
    </div>
  `;
}

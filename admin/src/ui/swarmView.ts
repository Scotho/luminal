import { sessionManager } from './ccSessionManager';
import type { CCSession } from '../types';

const AGENT_COLORS = [
  '#6ee0f0', '#b07aff', '#f0a040', '#70d070', '#ff6b9d',
  '#ffd93d', '#4a9eff', '#ff8c42', '#a8e6cf', '#dda0dd',
];

function heartbeatClass(session: CCSession): string {
  if (session.status !== 'running') return 'hb-off';
  return 'hb-active';
}

function formatElapsedShort(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

export function renderSwarmView(container: HTMLElement): { update(): void; destroy(): void } {
  const canvas = document.createElement('div');
  canvas.className = 'swarm-canvas';
  container.appendChild(canvas);

  let _unsub: (() => void) | null = null;

  function render(): void {
    const sessions = sessionManager.all();

    if (sessions.length === 0) {
      canvas.innerHTML = '<div class="swarm-empty">No agent sessions</div>';
      return;
    }

    // Grid layout: 4 columns
    const cols = Math.min(4, sessions.length);
    const cellW = 110;
    const cellH = 90;
    const padX = 20;
    const padY = 15;

    canvas.innerHTML = sessions.map((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padX + col * (cellW + 12);
      const y = padY + row * (cellH + 12);
      const color = AGENT_COLORS[i % AGENT_COLORS.length];
      const hbClass = heartbeatClass(s);
      const elapsed = s.duration ?? (Date.now() - s.startedAt);
      const statusLabel = s.status === 'running' ? 'running' : s.status === 'done' ? 'done' : s.status === 'error' ? 'error' : s.status;
      const cardCount = s.cards.length;
      const selected = sessionManager.selectedId === s.id;

      return `
        <div class="swarm-node ${selected ? 'swarm-node--selected' : ''}" data-id="${s.id}" style="left:${x}px;top:${y}px;border-color:${color};width:${cellW}px;">
          <div class="swarm-node-header">
            <span class="swarm-node-dot hb-dot ${hbClass}"></span>
            <span class="swarm-node-time">${formatElapsedShort(elapsed)}</span>
          </div>
          <div class="swarm-node-label" style="color:${color};" title="${s.label}">${s.label.slice(0, 18)}</div>
          <div class="swarm-node-meta">
            <span class="swarm-node-status">${statusLabel}</span>
            <span class="swarm-node-cards">${cardCount} cards</span>
          </div>
        </div>
      `;
    }).join('');

    // Set canvas min-height based on grid
    const rows = Math.ceil(sessions.length / cols);
    canvas.style.minHeight = `${padY * 2 + rows * (cellH + 12)}px`;

    // Wire click handlers
    canvas.querySelectorAll('.swarm-node').forEach(el => {
      el.addEventListener('click', () => {
        sessionManager.selectedId = (el as HTMLElement).dataset.id ?? null;
      });
    });
  }

  _unsub = sessionManager.onChange(render);
  render();

  return {
    update: render,
    destroy() {
      _unsub?.();
      canvas.remove();
    },
  };
}

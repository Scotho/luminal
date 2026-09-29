// admin/src/ui/agentManager.ts — Active/Inactive agent column UI with drag-between
import { icon } from './icons';

const STORAGE_KEY = 'luminal-admin-active-agents';

export interface ManagedAgent {
  id: string;
  label: string;
  type: 'cloud' | 'local';
}

const ALL_AGENTS: ManagedAgent[] = [
  { id: 'claude', label: 'Claude', type: 'cloud' },
  { id: 'qwen',   label: 'Qwen (Ollama)', type: 'local' },
];

export function loadActiveAgentIds(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored) as string[]);
  } catch { /* corrupted localStorage entry — use defaults */ }
  return new Set(['claude']);
}

export function saveActiveAgentIds(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function getActiveAgents(): ManagedAgent[] {
  const active = loadActiveAgentIds();
  return ALL_AGENTS.filter(a => active.has(a.id));
}

export function getInactiveAgents(): ManagedAgent[] {
  const active = loadActiveAgentIds();
  return ALL_AGENTS.filter(a => !active.has(a.id));
}

export function renderAgentManager(container: HTMLElement): void {
  const active = getActiveAgents();
  const inactive = getInactiveAgents();

  function agentCard(agent: ManagedAgent): string {
    const typeIcon = agent.type === 'cloud' ? icon('globe', 14) : icon('cpu', 14);
    return `
      <div class="agent-mgr-card" draggable="true" data-agent-id="${agent.id}">
        ${typeIcon}
        <span class="agent-mgr-name">${agent.label}</span>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="agent-mgr-wrap">
      <div class="agent-mgr-col" id="agent-mgr-active" data-zone="active">
        <div class="agent-mgr-col-header" style="color:var(--green);">${icon('activity', 14)} ACTIVE</div>
        ${active.length > 0 ? active.map(agentCard).join('') : '<div class="agent-mgr-empty">Drag agents here</div>'}
      </div>
      <div class="agent-mgr-col" id="agent-mgr-inactive" data-zone="inactive">
        <div class="agent-mgr-col-header" style="color:var(--text-quiet);">${icon('circle-dot', 14)} INACTIVE</div>
        ${inactive.length > 0 ? inactive.map(agentCard).join('') : '<div class="agent-mgr-empty">No inactive agents</div>'}
      </div>
    </div>
  `;

  let draggedId: string | null = null;

  container.querySelectorAll<HTMLElement>('.agent-mgr-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedId = card.dataset.agentId ?? null;
      card.style.opacity = '0.4';
      e.dataTransfer!.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      draggedId = null;
    });
  });

  container.querySelectorAll<HTMLElement>('.agent-mgr-col').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      col.classList.add('agent-mgr-col--dragover');
    });
    col.addEventListener('dragleave', () => {
      col.classList.remove('agent-mgr-col--dragover');
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('agent-mgr-col--dragover');
      if (!draggedId) return;

      const zone = col.dataset.zone;
      const activeIds = loadActiveAgentIds();

      if (zone === 'active') {
        activeIds.add(draggedId);
      } else {
        activeIds.delete(draggedId);
      }

      saveActiveAgentIds(activeIds);
      renderAgentManager(container);
      window.dispatchEvent(new CustomEvent('agent-manager-change'));
    });
  });
}

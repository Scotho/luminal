// admin/src/sections/agents.ts — Unified Agents section with tabs
//
// Consolidates agent-timeline, agent-diffs, agent-search, agent-pipelines,
// and agent-e2e into a single tabbed section.

import { icon } from '../ui/icons';

type AgentTab = 'timeline' | 'diffs' | 'search' | 'pipelines' | 'e2e' | 'orchestrate';

const TABS: { id: AgentTab; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'diffs', label: 'Diffs' },
  { id: 'search', label: 'Search' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'e2e', label: 'E2E Visual' },
  { id: 'orchestrate', label: 'Orchestrate' },
];

let _activeTab: AgentTab = 'timeline';
let _container: HTMLElement | null = null;

export function initAgents(container: HTMLElement): void {
  _container = container;
  render();
}

function render(): void {
  if (!_container) return;

  _container.innerHTML = `
    <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid var(--border);">
      ${TABS.map(t => `<button class="agent-tab-btn" data-tab="${t.id}" style="padding:7px 14px 6px;font-family:var(--font-body);font-size:12.5px;font-weight:600;letter-spacing:0.2px;border:none;border-bottom:2px solid ${_activeTab === t.id ? 'var(--accent)' : 'transparent'};background:transparent;color:${_activeTab === t.id ? 'var(--accent)' : 'var(--text-dim)'};cursor:pointer;transition:all 0.15s;">${t.label}</button>`).join('')}
    </div>
    <div id="agents-tab-content"></div>
  `;

  // Wire tab clicks
  _container.querySelectorAll<HTMLElement>('.agent-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as AgentTab;
      if (tab === _activeTab) return;
      _activeTab = tab;
      render();
    });
  });

  // Load active tab content
  const mount = document.getElementById('agents-tab-content');
  if (!mount) return;

  switch (_activeTab) {
    case 'timeline':
      mount.id = 'section-agent-timeline';
      import('./agentTimeline').then(m => m.initAgentTimeline());
      break;
    case 'diffs':
      mount.id = 'section-agent-diffs';
      import('./agentDiffs').then(m => m.initAgentDiffs());
      break;
    case 'search':
      mount.id = 'section-agent-search';
      import('./agentSearch').then(m => m.initAgentSearch());
      break;
    case 'pipelines':
      mount.id = 'section-agent-pipelines';
      import('./agentPipelines').then(m => m.initAgentPipelines());
      break;
    case 'e2e':
      mount.id = 'section-agent-e2e';
      import('./agentE2E').then(m => m.initAgentE2E());
      break;
    case 'orchestrate':
      mount.id = 'section-agent-orchestrate';
      import('./agentOrchestrate').then(m => m.initAgentOrchestrate());
      break;
  }
}

// admin/src/sections/iterativeLoop.ts — Iterative Loop control panel
// Uses the pipeline canvas for the agent flowchart (drag, reorder, bezier edges).
import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import { sessionManager } from '../ui/ccSessionManager';
import { wireAgentStream } from '../ui/ccDispatch';
import {
  type Pipeline,
  type PipelineNode,
  createNodeEl,
  createPipelineCanvas,
  refreshEdges,
  renderEdges,
} from '../ui/pipelineCanvas';

// ── Types ─────────────────────────────────────────────────

interface LoopHistoryEntry {
  iteration: number; agent: string; agentId: string;
  startedAt: number; completedAt: number | null; exitCode: number | null; summary: string;
}

interface LoopState {
  enabled: boolean; mode: 'supervised' | 'autonomous';
  iteration: number; maxIterations: number; maxWallClockMs: number;
  startedAt: number | null; currentAgent: string | null; currentAgentId: string | null;
  baseCommit: string | null; tags: string[];
  prompts: Record<string, string>;
  backends: Record<string, string>;
  history: LoopHistoryEntry[];
}

// ── Constants ─────────────────────────────────────────────

const ROLES = ['scout', 'analyst', 'operator', 'reviewer'] as const;
const ROLE_LABELS: Record<string, string> = { scout: 'Scout', analyst: 'Analyst', operator: 'Operator', reviewer: 'Reviewer' };
const ROLE_COLORS: Record<string, string> = { scout: '#38bdf8', analyst: '#facc15', operator: '#f97316', reviewer: '#818cf8' };
const ROLE_ICONS: Record<string, string> = { scout: '\u2606', analyst: '\u2261', operator: '\u2699', reviewer: '\u2713' };
const ROLE_SUBTITLES: Record<string, string> = {
  scout: 'Instrument & collect', analyst: 'Interpret & spec',
  operator: 'Fix & improve', reviewer: 'Review & verify',
};

const CANVAS_STORAGE_KEY = 'luminal-loop-canvas';

// ── Flyout bridge ─────────────────────────────────────────

let _pollInterval: ReturnType<typeof setInterval> | null = null;
const _wiredAgents = new Set<string>();

function bridgeToFlyout(agentId: string, label: string): void {
  if (_wiredAgents.has(agentId)) return;
  const existing = sessionManager.all().find(s => s.agentIds?.includes(agentId));
  if (existing) { _wiredAgents.add(agentId); return; }
  _wiredAgents.add(agentId);
  const session = sessionManager.createSession(label, agentId, 'cc');
  wireAgentStream(session, agentId);
  document.getElementById('cc-flyout')?.classList.remove('collapsed');
}

// ── Entry point ───────────────────────────────────────────

export function initIterativeLoop(container: HTMLElement): () => void {
  renderLoop(container);
  _pollInterval = setInterval(() => renderLoop(container), 5000);
  return () => { if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; } };
}

// ── Main render ───────────────────────────────────────────

let _lastStateJson = '';

async function renderLoop(container: HTMLElement): Promise<void> {
  let state: LoopState;
  try {
    const res = await fetch('/__admin_loop');
    if (!res.ok) throw new Error('Failed');
    state = await res.json();
  } catch {
    container.innerHTML = `<p style="color:var(--red-bright);">Failed to load loop state.</p>`;
    return;
  }

  // Bridge running agent
  if (state.enabled && state.currentAgentId && state.currentAgent) {
    bridgeToFlyout(state.currentAgentId, `Loop ${ROLE_LABELS[state.currentAgent] ?? state.currentAgent} (iter ${state.iteration})`);
  }

  // Skip full re-render if state hasn't changed (preserves canvas drag state)
  const stateJson = JSON.stringify({ enabled: state.enabled, iteration: state.iteration, currentAgent: state.currentAgent, mode: state.mode, historyLen: state.history.length });
  if (stateJson === _lastStateJson) {
    updateLiveIndicators(container, state);
    return;
  }
  _lastStateJson = stateJson;

  const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
  const maxHours = Math.round(state.maxWallClockMs / 3_600_000);
  const currentColor = state.currentAgent ? ROLE_COLORS[state.currentAgent] ?? '#94a3b8' : '#94a3b8';
  const currentLabel = state.currentAgent ? ROLE_LABELS[state.currentAgent] ?? 'Unknown' : 'Idle';

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div>
        <h2 style="margin:0 0 2px;">${icon('repeat', 18)} Iterative Loop</h2>
        <span style="font-size:11px;color:var(--text-dim);">Self-sustaining 4-agent improvement chain</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <select id="loop-mode" style="background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 10px;font-size:12px;" ${state.enabled ? 'disabled' : ''}>
          <option value="supervised" ${state.mode === 'supervised' ? 'selected' : ''}>Supervised</option>
          <option value="autonomous" ${state.mode === 'autonomous' ? 'selected' : ''}>Autonomous</option>
        </select>
        <button id="loop-toggle" class="admin-btn" style="min-width:110px;font-weight:700;background:${state.enabled ? 'var(--red)' : 'var(--green)'};color:#000;padding:8px 20px;font-size:13px;border-radius:6px;">
          ${state.enabled ? 'STOP' : 'START'}
        </button>
      </div>
    </div>

    <!-- Status bar -->
    <div id="loop-status-bar" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:12px 18px;margin-bottom:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <span id="loop-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${state.enabled ? currentColor : 'var(--text-quiet)'};${state.enabled ? 'animation:loop-pulse 1.5s infinite;' : ''}flex-shrink:0;"></span>
      <span id="loop-agent-label" style="font-size:14px;font-weight:700;color:${currentColor};">${currentLabel}</span>
      <span style="font-size:12px;color:var(--text-dim);">Iteration <strong>${state.iteration || 0}</strong> / ${state.maxIterations}</span>
      <span id="loop-elapsed" style="font-size:12px;color:var(--text-dim);">${elapsed > 0 ? fmtDuration(elapsed) + ' elapsed' : ''}</span>
      ${state.currentAgentId ? `<button id="loop-view-agent" class="admin-btn admin-btn--small" style="font-size:11px;background:${currentColor};color:#000;font-weight:600;">View Output</button>` : ''}
    </div>

    <!-- Pipeline canvas for agent chain -->
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;margin-bottom:16px;overflow:hidden;">
      <div style="padding:8px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);">Agent Chain</span>
        <span style="font-size:10px;color:var(--text-quiet);">Drag nodes to rearrange &middot; Drag ports to reconnect</span>
      </div>
      <div class="loop-canvas" style="position:relative;overflow:auto;background:var(--bg);background-image:radial-gradient(circle, var(--border) 1px, transparent 1px);background-size:24px 24px;height:220px;">
        <svg class="pipelines-svg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;">
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--accent-dim, rgba(100,149,237,0.6))" />
            </marker>
          </defs>
        </svg>
        <div class="pipelines-nodes" style="position:absolute;top:0;left:0;width:100%;height:100%;"></div>
      </div>
    </div>

    <!-- Prompt editors -->
    <div style="margin-bottom:16px;">
      <h3 style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin:0 0 10px;">Agent Prompts</h3>
      ${ROLES.map(r => renderPromptEditor(r, state)).join('')}
    </div>

    <!-- Configuration -->
    <div style="margin-bottom:16px;">
      <h3 style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin:0 0 10px;">Configuration</h3>
      <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:14px 18px;display:flex;gap:20px;flex-wrap:wrap;align-items:end;">
        <div>
          <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px;">Max Iterations</label>
          <input id="loop-max-iter" type="number" min="1" max="100" value="${state.maxIterations}" style="width:70px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-size:12px;" ${state.enabled ? 'disabled' : ''}>
        </div>
        <div>
          <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px;">Max Hours</label>
          <input id="loop-max-hours" type="number" min="1" max="72" value="${maxHours}" style="width:70px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-size:12px;" ${state.enabled ? 'disabled' : ''}>
        </div>
        <div>
          <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px;">Task Tags</label>
          <input id="loop-tags" type="text" value="${escapeHtml(state.tags.join(', '))}" placeholder="netcode, performance, bugs" style="width:240px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-size:12px;" ${state.enabled ? 'disabled' : ''}>
        </div>
        <button id="loop-save-config" class="admin-btn admin-btn--small" ${state.enabled ? 'disabled' : ''}>Save Config</button>
      </div>
    </div>

    <!-- History -->
    <div>
      <h3 style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin:0 0 10px;">History</h3>
      ${state.history.length > 0 ? renderHistory(state.history) : '<p style="color:var(--text-quiet);font-size:12px;">No history yet.</p>'}
    </div>
    <style>@keyframes loop-pulse{0%,100%{opacity:1}50%{opacity:0.35}}</style>
  `;

  initCanvas(container, state);
  wireEvents(container, state);
}

// ── Pipeline canvas for agent chain ───────────────────────

function loadCanvasPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(CANVAS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveCanvasPositions(pipeline: Pipeline): void {
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of pipeline.nodes) pos[n.id] = { x: n.x, y: n.y };
  localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(pos));
}

function buildLoopPipeline(state: LoopState): Pipeline {
  const saved = loadCanvasPositions();
  const gap = 180;
  const nodes: PipelineNode[] = ROLES.map((role, i) => {
    const id = `loop-${role}`;
    const pos = saved[id] ?? { x: 40 + i * gap, y: 50 };
    const backend = state.backends?.[role] ?? 'claude';
    return {
      id,
      type: 'cc-agent' as const,
      x: pos.x, y: pos.y,
      config: {
        label: `${ROLE_ICONS[role]} ${ROLE_LABELS[role]}`,
        template: ROLE_SUBTITLES[role],
        backend,
      },
    };
  });

  // Edges: linear chain (scout → analyst → operator → reviewer)
  // Return edge (reviewer → scout) is not rendered via pipeline edges
  // since the canvas draws left-to-right only. A separate SVG arc handles it.
  const edges = ROLES.slice(0, -1).map((_, i) => ({
    from: `loop-${ROLES[i]}`, fromPort: 'out',
    to: `loop-${ROLES[i + 1]}`, toPort: 'in',
  }));

  return { id: 'loop-chain', name: 'Iterative Loop', nodes, edges };
}

function initCanvas(container: HTMLElement, state: LoopState): void {
  const canvasEl = container.querySelector<HTMLElement>('.loop-canvas');
  if (!canvasEl) return;

  const pipeline = buildLoopPipeline(state);
  const svgEl = canvasEl.querySelector<SVGSVGElement>('.pipelines-svg')!;

  // Render initial edges
  svgEl.insertAdjacentHTML('beforeend', renderEdges(pipeline));
  svgEl.querySelectorAll('.pipeline-edge').forEach(el => {
    (el as SVGElement).style.pointerEvents = 'stroke';
  });

  const { nodesContainer, wireCanvas } = createPipelineCanvas(
    canvasEl,
    (_node) => { /* double-click opens config — not needed for loop */ },
    (from, fromPort, to, toPort) => {
      // New edge created by dragging ports
      const exists = pipeline.edges.some(e => e.from === from && e.to === to);
      if (!exists) {
        pipeline.edges.push({ from, fromPort, to, toPort });
        refreshEdges(svgEl, pipeline);
      }
    },
  );

  // Create node elements
  for (const node of pipeline.nodes) {
    const el = createNodeEl(node);
    // Add backend badge
    const backend = node.config.backend ?? 'claude';
    const badgeColor = backend === 'ollama' ? 'var(--green)' : 'var(--claude, #D97757)';
    const badgeLabel = backend === 'ollama' ? 'LLAMA' : 'CC';
    const badge = document.createElement('div');
    badge.style.cssText = `position:absolute;bottom:3px;right:8px;font-size:8px;font-weight:700;color:${badgeColor};letter-spacing:0.5px;`;
    badge.textContent = badgeLabel;
    el.appendChild(badge);

    // Highlight active agent
    if (state.enabled && state.currentAgent === node.id.replace('loop-', '')) {
      el.style.borderColor = ROLE_COLORS[node.id.replace('loop-', '')] ?? 'var(--accent)';
      el.style.borderWidth = '2px';
      el.style.boxShadow = `0 0 12px ${ROLE_COLORS[node.id.replace('loop-', '')] ?? 'var(--accent)'}40`;
    }

    nodesContainer.appendChild(el);
  }

  wireCanvas(pipeline, () => saveCanvasPositions(pipeline));

  // Draw return arc (reviewer → scout) as a separate curved path below the nodes
  const firstNode = pipeline.nodes[0];
  const lastNode = pipeline.nodes[pipeline.nodes.length - 1];
  if (firstNode && lastNode) {
    const x1 = lastNode.x + 160; // right edge of last node
    const y1 = lastNode.y + 32;  // vertical center
    const x2 = firstNode.x;      // left edge of first node
    const y2 = firstNode.y + 32;
    const arcY = Math.max(y1, y2) + 60; // arc drops below
    const returnPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    returnPath.setAttribute('d', `M ${x1} ${y1} Q ${x1 + 30} ${arcY}, ${(x1 + x2) / 2} ${arcY} Q ${x2 - 30} ${arcY}, ${x2} ${y2}`);
    returnPath.setAttribute('fill', 'none');
    returnPath.setAttribute('stroke', 'var(--text-quiet)');
    returnPath.setAttribute('stroke-width', '1.5');
    returnPath.setAttribute('stroke-dasharray', '5 4');
    returnPath.setAttribute('marker-end', 'url(#arrow)');
    svgEl.appendChild(returnPath);
    // Label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String((x1 + x2) / 2));
    label.setAttribute('y', String(arcY + 14));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', 'var(--text-quiet)');
    label.setAttribute('font-size', '9');
    label.setAttribute('font-family', 'var(--font-body)');
    label.textContent = 'next iteration';
    svgEl.appendChild(label);
  }

  // Edge deletion on click
  svgEl.addEventListener('click', (e) => {
    const path = (e.target as Element).closest('.pipeline-edge') as SVGElement | null;
    if (!path) return;
    const from = path.dataset.from ?? '';
    const to = path.dataset.to ?? '';
    pipeline.edges = pipeline.edges.filter(ed => !(ed.from === from && ed.to === to));
    refreshEdges(svgEl, pipeline);
  });
}

// ── Live indicator updates (no full re-render) ────────────

function updateLiveIndicators(container: HTMLElement, state: LoopState): void {
  const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
  const elSpan = container.querySelector('#loop-elapsed');
  if (elSpan) elSpan.textContent = elapsed > 0 ? fmtDuration(elapsed) + ' elapsed' : '';
}

// ── Prompt editors ────────────────────────────────────────

function renderPromptEditor(role: string, state: LoopState): string {
  const prompt = state.prompts[role] ?? '';
  const color = ROLE_COLORS[role] ?? '#94a3b8';
  const backend = state.backends?.[role] ?? 'claude';

  return `
    <details style="margin-bottom:4px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;overflow:hidden;">
      <summary style="cursor:pointer;font-size:13px;font-weight:700;color:${color};padding:10px 14px;user-select:none;display:flex;align-items:center;gap:8px;">
        <span>${ROLE_ICONS[role] ?? ''}</span> ${ROLE_LABELS[role] ?? role}
        <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:${backend === 'ollama' ? 'var(--green)' : 'var(--claude, #D97757)'};color:#000;font-weight:700;">${backend === 'ollama' ? 'LLAMA' : 'CLAUDE'}</span>
        <select class="loop-backend-select" data-role="${role}" style="margin-left:auto;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:2px 6px;font-size:10px;" ${state.enabled ? 'disabled' : ''}>
          <option value="claude" ${backend === 'claude' ? 'selected' : ''}>Claude</option>
          <option value="ollama" ${backend === 'ollama' ? 'selected' : ''}>Llama (Ollama)</option>
        </select>
        <span style="font-size:10px;color:var(--text-dim);font-weight:400;">${prompt.length} chars</span>
      </summary>
      <div style="padding:0 14px 12px;">
        <textarea id="loop-prompt-${role}" rows="10" style="width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:10px;font-size:11px;font-family:var(--font-mono);resize:vertical;line-height:1.5;box-sizing:border-box;" ${state.enabled ? 'disabled' : ''}>${escapeHtml(prompt)}</textarea>
        <div style="text-align:right;margin-top:4px;">
          <button class="admin-btn admin-btn--small loop-reset-prompt" data-role="${role}" ${state.enabled ? 'disabled' : ''} style="font-size:10px;">Reset to default</button>
        </div>
      </div>
    </details>
  `;
}

// ── History table ─────────────────────────────────────────

function renderHistory(history: LoopHistoryEntry[]): string {
  const rows = [...history].reverse().map(h => {
    const exitColor = h.exitCode === null ? 'var(--text-dim)' : h.exitCode === 0 ? 'var(--green)' : 'var(--red-bright)';
    const agentColor = ROLE_COLORS[h.agent] ?? 'var(--text-dim)';
    const duration = h.completedAt && h.startedAt ? fmtDuration(h.completedAt - h.startedAt) : '<span style="color:var(--green);">running</span>';
    const summary = h.summary ? escapeHtml(h.summary.slice(0, 120)) + (h.summary.length > 120 ? '...' : '') : '<span style="color:var(--text-quiet);">\u2014</span>';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:6px 10px;font-size:12px;color:var(--text-dim);text-align:center;">${h.iteration}</td>
      <td style="padding:6px 10px;font-size:12px;font-weight:600;color:${agentColor};">${ROLE_LABELS[h.agent] ?? h.agent}</td>
      <td style="padding:6px 10px;font-size:11px;font-family:var(--font-mono);color:var(--text-dim);">${duration}</td>
      <td style="padding:6px 10px;font-size:12px;color:${exitColor};text-align:center;">${h.exitCode ?? '\u2014'}</td>
      <td style="padding:6px 10px;font-size:11px;">${summary}</td>
    </tr>`;
  }).join('');

  return `<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;overflow:hidden;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid var(--border-strong);background:var(--bg-panel-alt);">
        <th style="padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);text-align:center;width:50px;">Iter</th>
        <th style="padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);text-align:left;">Agent</th>
        <th style="padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);text-align:left;width:80px;">Dur</th>
        <th style="padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);text-align:center;width:50px;">Exit</th>
        <th style="padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);text-align:left;">Summary</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Event wiring ──────────────────────────────────────────

function wireEvents(container: HTMLElement, state: LoopState): void {
  container.querySelector('#loop-toggle')?.addEventListener('click', async () => {
    if (state.enabled) {
      if (!window.confirm('Stop the iterative loop?')) return;
      await fetch('/__admin_loop/stop', { method: 'POST' });
    } else {
      const res = await fetch('/__admin_loop/start', { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { agentId?: string };
        if (data.agentId) bridgeToFlyout(data.agentId, 'Loop Scout (iter 1)');
      }
    }
    _lastStateJson = '';
    renderLoop(container);
  });

  container.querySelector('#loop-view-agent')?.addEventListener('click', () => {
    if (!state.currentAgentId) return;
    bridgeToFlyout(state.currentAgentId, `Loop ${ROLE_LABELS[state.currentAgent ?? ''] ?? 'Agent'} (iter ${state.iteration})`);
    const s = sessionManager.all().find(s => s.agentIds?.includes(state.currentAgentId!));
    if (s) sessionManager.selectedId = s.id;
    document.getElementById('cc-flyout')?.classList.remove('collapsed');
  });

  container.querySelector('#loop-mode')?.addEventListener('change', async (e) => {
    await fetch('/__admin_loop/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: (e.target as HTMLSelectElement).value }) });
  });

  // Backend selectors in prompt editors
  container.querySelectorAll<HTMLSelectElement>('.loop-backend-select').forEach(sel => {
    sel.addEventListener('click', (e) => e.stopPropagation()); // Prevent details toggle
    sel.addEventListener('change', async () => {
      const role = sel.dataset.role;
      if (!role) return;
      await fetch('/__admin_loop/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backends: { [role]: sel.value } }),
      });
      _lastStateJson = '';
      renderLoop(container);
    });
  });

  container.querySelector('#loop-save-config')?.addEventListener('click', async () => {
    const maxIterations = parseInt((container.querySelector('#loop-max-iter') as HTMLInputElement)?.value ?? '10', 10);
    const maxHours = parseInt((container.querySelector('#loop-max-hours') as HTMLInputElement)?.value ?? '12', 10);
    const tags = ((container.querySelector('#loop-tags') as HTMLInputElement)?.value ?? '').split(',').map(t => t.trim()).filter(Boolean);
    const prompts: Record<string, string> = {};
    for (const role of ROLES) {
      const ta = container.querySelector(`#loop-prompt-${role}`) as HTMLTextAreaElement | null;
      if (ta) prompts[role] = ta.value;
    }
    const res = await fetch('/__admin_loop/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxIterations, maxWallClockMs: maxHours * 3_600_000, tags, prompts }) });
    if (res.ok) window.alert('Config saved.');
    else { const err = await res.json(); window.alert(`Failed: ${err.error}`); }
  });

  container.querySelectorAll<HTMLElement>('.loop-reset-prompt').forEach(btn => {
    btn.addEventListener('click', async () => {
      const role = btn.dataset.role;
      if (!role || !window.confirm(`Reset ${ROLE_LABELS[role] ?? role} prompt?`)) return;
      await fetch('/__admin_loop/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompts: { [role]: '' } }) });
      _lastStateJson = '';
      renderLoop(container);
    });
  });
}

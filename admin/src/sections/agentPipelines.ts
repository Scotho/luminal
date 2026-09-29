// admin/src/sections/agentPipelines.ts — Pipeline Builder section (init, toolbar, persistence)

import {
  type Pipeline,
  type PipelineNode,
  type NodeType,
  NODE_TYPE_LABELS,
  NODE_TYPE_ICONS,
  NODE_COLORS,
  createNodeEl,
  createPipelineCanvas,
  refreshEdges,
  renderEdges,
  showConfigPanel,
} from '../ui/pipelineCanvas';
import { executePipeline, type CancelToken } from '../ui/pipelineExecution';

export type { PipelineNode, Pipeline, NodeType };

const STORAGE_KEY = 'luminal-pipelines';

// ── State ──────────────────────────────────────────────────────────────────

interface PipelineState {
  pipelines: Pipeline[];
  activePipelineId: string | null;
  running: boolean;
  cancelToken: CancelToken;
}

const _state: PipelineState = {
  pipelines: [],
  activePipelineId: null,
  running: false,
  cancelToken: { cancelled: false },
};

// ── Persistence ────────────────────────────────────────────────────────────

function loadFromStorage(): Pipeline[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Pipeline[];
  } catch {
    // corrupted storage — return empty
  }
  return [];
}

function saveToStorage(pipelines: Pipeline[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelines));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getActivePipeline(): Pipeline | null {
  if (!_state.activePipelineId) return null;
  return _state.pipelines.find(p => p.id === _state.activePipelineId) ?? null;
}

function newPipelineId(): string { return `pl_${Date.now()}`; }
function newNodeId(): string { return `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Section init ───────────────────────────────────────────────────────────

export function initAgentPipelines(): void {
  const section = document.getElementById('section-agent-pipelines');
  if (!section) return;

  const stored = loadFromStorage();
  _state.pipelines = stored;

  fetch('/data/pipelines.json')
    .then(r => r.ok ? (r.json() as Promise<Pipeline[]>) : Promise.resolve([]))
    .catch(() => [])
    .then((presets: Pipeline[]) => {
      for (const preset of presets) {
        if (!_state.pipelines.some(p => p.id === preset.id)) {
          _state.pipelines.unshift(preset);
        }
      }
      if (!_state.activePipelineId && _state.pipelines.length > 0) {
        _state.activePipelineId = _state.pipelines[0].id;
      }
      renderUI(section);
    });

  if (!_state.activePipelineId && _state.pipelines.length > 0) {
    _state.activePipelineId = _state.pipelines[0].id;
  }
  renderUI(section);
}

// ── Layout ─────────────────────────────────────────────────────────────────

function renderUI(section: HTMLElement): void {
  section.innerHTML = `
    <div class="agent-pipelines" style="display:flex;flex-direction:column;height:100%;gap:0;">
      <div class="pipelines-toolbar" style="
        display:flex;align-items:center;gap:8px;padding:10px 14px;
        background:var(--bg-surface);border-bottom:1px solid var(--border);
        flex-shrink:0;flex-wrap:wrap;
      ">
        <h2 style="margin:0;font-size:14px;font-family:var(--font-display);letter-spacing:1px;">
          &#9862; PIPELINE BUILDER
        </h2>
        <select class="pipelines-load" style="
          background:var(--bg);border:1px solid var(--border);color:var(--text);
          font-size:12px;padding:4px 8px;border-radius:3px;
        ">
          <option value="">-- Load Pipeline --</option>
          ${_state.pipelines.map(p =>
            `<option value="${p.id}" ${p.id === _state.activePipelineId ? 'selected' : ''}>${p.name}</option>`
          ).join('')}
        </select>
        <input class="pipelines-name" placeholder="Pipeline Name" value="${getActivePipeline()?.name ?? ''}"
          style="
            background:var(--bg);border:1px solid var(--border);color:var(--text);
            font-size:12px;padding:4px 8px;border-radius:3px;width:160px;
          "
        />
        <button class="pipelines-new admin-btn admin-btn--small">+ New</button>
        <button class="pipelines-save admin-btn admin-btn--small">Save</button>
        <button class="pipelines-run admin-btn admin-btn--small" style="color:var(--green);border-color:var(--green);">
          &#9654; Run
        </button>
        <button class="pipelines-stop admin-btn admin-btn--small" style="color:var(--orange);border-color:var(--orange);">
          &#9632; Stop
        </button>
      </div>
      <div class="pipelines-body" style="display:flex;flex:1;overflow:hidden;min-height:400px;">
        <div class="pipelines-palette" style="
          width:120px;flex-shrink:0;
          background:var(--bg-surface);border-right:1px solid var(--border);
          padding:10px 8px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;
        ">
          <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:4px;">
            NODE TYPES
          </div>
          ${(Object.keys(NODE_TYPE_LABELS) as NodeType[]).map(type => `
            <button class="pipelines-palette-btn admin-btn admin-btn--small" data-type="${type}"
              style="
                text-align:left;width:100%;padding:5px 8px;font-size:10px;
                border-color:${NODE_COLORS[type]};color:${NODE_COLORS[type]};
                display:flex;align-items:center;gap:5px;
              ">
              <span>${NODE_TYPE_ICONS[type]}</span>
              <span>${NODE_TYPE_LABELS[type]}</span>
            </button>
          `).join('')}
        </div>
        <div class="pipelines-canvas" style="
          flex:1;position:relative;overflow:auto;background:var(--bg);
          background-image:radial-gradient(circle, var(--border) 1px, transparent 1px);
          background-size:24px 24px;
        ">
          <svg class="pipelines-svg" style="
            position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;
          ">
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="var(--accent-dim, rgba(100,149,237,0.6))" />
              </marker>
            </defs>
            ${getActivePipeline() ? renderEdges(getActivePipeline()!) : ''}
          </svg>
          <div class="pipelines-nodes" style="position:absolute;top:0;left:0;width:100%;height:100%;">
          </div>
        </div>
      </div>
    </div>
  `;

  const canvasEl = section.querySelector<HTMLElement>('.pipelines-canvas')!;
  const svgEl = section.querySelector<SVGSVGElement>('.pipelines-svg')!;
  svgEl.querySelectorAll('.pipeline-edge').forEach(el => {
    (el as SVGElement).style.pointerEvents = 'stroke';
  });

  const active = getActivePipeline();
  const { nodesContainer, wireCanvas } = createPipelineCanvas(
    section.querySelector<HTMLElement>('.pipelines-canvas')!,
    (node: PipelineNode) => {
      if (!active) return;
      showConfigPanel(canvasEl, node, () => saveToStorage(_state.pipelines));
    },
    (from, fromPort, to, toPort) => {
      if (!active) return;
      const exists = active.edges.some(
        ed => ed.from === from && ed.fromPort === fromPort && ed.to === to
      );
      if (!exists) {
        active.edges.push({ from, fromPort, to, toPort });
        refreshEdges(svgEl, active);
        saveToStorage(_state.pipelines);
      }
    },
  );

  if (active) {
    for (const node of active.nodes) {
      nodesContainer.appendChild(createNodeEl(node, (n) => {
        showConfigPanel(canvasEl, n, () => saveToStorage(_state.pipelines));
      }));
    }
    wireCanvas(active, () => saveToStorage(_state.pipelines));
  }

  wireToolbar(section, nodesContainer, svgEl, canvasEl);
}

// ── Toolbar wiring ─────────────────────────────────────────────────────────

function wireToolbar(
  section: HTMLElement,
  nodesContainer: HTMLElement,
  svgEl: SVGSVGElement,
  canvasEl: HTMLElement,
): void {
  section.querySelector<HTMLSelectElement>('.pipelines-load')?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    _state.activePipelineId = id;
    renderUI(section);
  });

  section.querySelector('.pipelines-new')?.addEventListener('click', () => {
    const name = `Pipeline ${_state.pipelines.length + 1}`;
    const newPl: Pipeline = { id: newPipelineId(), name, nodes: [], edges: [] };
    _state.pipelines.push(newPl);
    _state.activePipelineId = newPl.id;
    saveToStorage(_state.pipelines);
    renderUI(section);
  });

  section.querySelector('.pipelines-save')?.addEventListener('click', () => {
    const active = getActivePipeline();
    if (!active) return;
    const nameInput = section.querySelector<HTMLInputElement>('.pipelines-name');
    if (nameInput?.value.trim()) active.name = nameInput.value.trim();
    saveToStorage(_state.pipelines);
    const btn = section.querySelector<HTMLButtonElement>('.pipelines-save');
    if (btn) {
      const orig = btn.textContent ?? 'Save';
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  });

  section.querySelector('.pipelines-run')?.addEventListener('click', () => {
    const active = getActivePipeline();
    if (!active || _state.running) return;
    _state.running = true;
    _state.cancelToken = { cancelled: false };

    nodesContainer.querySelectorAll('.pipeline-node').forEach(el => {
      el.classList.remove('pipeline-node--running', 'pipeline-node--done', 'pipeline-node--error');
    });

    void executePipeline(
      active,
      (nodeId) => {
        nodesContainer.querySelector(`[data-node-id="${nodeId}"]`)?.classList.add('pipeline-node--running');
      },
      (nodeId) => {
        const el = nodesContainer.querySelector(`[data-node-id="${nodeId}"]`);
        el?.classList.remove('pipeline-node--running');
        el?.classList.add('pipeline-node--done');
      },
      (nodeId) => {
        const el = nodesContainer.querySelector(`[data-node-id="${nodeId}"]`);
        el?.classList.remove('pipeline-node--running');
        el?.classList.add('pipeline-node--error');
      },
      _state.cancelToken,
    ).then(() => { _state.running = false; });
  });

  section.querySelector('.pipelines-stop')?.addEventListener('click', () => {
    if (_state.running) _state.cancelToken.cancelled = true;
  });

  section.querySelectorAll<HTMLElement>('.pipelines-palette-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type as NodeType;
      const active = getActivePipeline();
      if (!active) return;

      const node: PipelineNode = {
        id: newNodeId(), type,
        x: 80 + Math.floor(Math.random() * 200),
        y: 60 + Math.floor(Math.random() * 160),
        config: { label: NODE_TYPE_LABELS[type] },
      };
      active.nodes.push(node);

      const el = createNodeEl(node, (n) => {
        showConfigPanel(canvasEl, n, () => saveToStorage(_state.pipelines));
      });
      nodesContainer.appendChild(el);
      refreshEdges(svgEl, active);
      saveToStorage(_state.pipelines);
    });
  });
}

// admin/src/ui/pipelineCanvas.ts — Canvas/SVG rendering, node creation, dragging, edges, config panel

export type NodeType =
  | 'prompt' | 'cc-agent' | 'qwen-agent' | 'aider-agent'
  | 'transform' | 'e2e-test' | 'gate' | 'qwen-vl';

export interface PipelineNode {
  id: string; type: NodeType; x: number; y: number; config: Record<string, string>;
}
export interface PipelineEdge {
  from: string; fromPort: string; to: string; toPort: string;
}
export interface Pipeline {
  id: string; name: string; nodes: PipelineNode[]; edges: PipelineEdge[];
}

// ── Constants ──────────────────────────────────────────────────────────────

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  'prompt':'Prompt','cc-agent':'CC Agent','qwen-agent':'Qwen','aider-agent':'Aider',
  'transform':'Transform','e2e-test':'E2E Test','gate':'Gate','qwen-vl':'Qwen-VL',
};
export const NODE_TYPE_ICONS: Record<NodeType, string> = {
  'prompt':'&#9998;','cc-agent':'&#9733;','qwen-agent':'&#128736;','aider-agent':'&#128295;',
  'transform':'&#8594;','e2e-test':'&#10003;','gate':'&#128682;','qwen-vl':'&#128247;',
};
export const NODE_COLORS: Record<NodeType, string> = {
  'prompt':'var(--accent)','cc-agent':'var(--gold, #f5a623)','qwen-agent':'var(--green)',
  'aider-agent':'var(--orange)','transform':'var(--text-dim)','e2e-test':'var(--blue, #4a9eff)',
  'gate':'var(--red-bright, #d45234)','qwen-vl':'var(--purple, #a855f7)',
};

const NODE_W = 160, NODE_H = 64, PORT_R = 6;
const FIELD_STYLE = 'width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:11px;border-radius:3px;box-sizing:border-box;';
const LABEL_STYLE = 'font-size:10px;color:var(--text-dim);';

// ── SVG helpers ────────────────────────────────────────────────────────────

type PortId = 'in' | 'out' | 'out-true' | 'out-false';

function portPos(node: PipelineNode, port: PortId): { x: number; y: number } {
  if (port === 'in')        return { x: node.x, y: node.y + NODE_H / 2 };
  if (port === 'out-true')  return { x: node.x + NODE_W, y: node.y + NODE_H * 0.3 };
  if (port === 'out-false') return { x: node.x + NODE_W, y: node.y + NODE_H * 0.7 };
  return { x: node.x + NODE_W, y: node.y + NODE_H / 2 };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

export function renderEdges(pipeline: Pipeline): string {
  return pipeline.edges.map(e => {
    const fn = pipeline.nodes.find(n => n.id === e.from);
    const tn = pipeline.nodes.find(n => n.id === e.to);
    if (!fn || !tn) return '';
    const fp = portPos(fn, (e.fromPort as PortId) ?? 'out');
    const tp = portPos(tn, (e.toPort as PortId) ?? 'in');
    const color = e.fromPort === 'out-true' ? 'var(--green,#4caf50)'
      : e.fromPort === 'out-false' ? 'var(--red-bright,#d45234)'
      : 'var(--accent-dim,rgba(100,149,237,0.6))';
    return `<path class="pipeline-edge" data-from="${e.from}" data-from-port="${e.fromPort}" data-to="${e.to}"
      d="${bezierPath(fp.x, fp.y, tp.x, tp.y)}"
      fill="none" stroke="${color}" stroke-width="2" marker-end="url(#arrow)"/>`;
  }).join('\n');
}

export function refreshEdges(svg: SVGSVGElement, pipeline: Pipeline): void {
  svg.querySelectorAll('.pipeline-edge').forEach(p => p.remove());
  svg.insertAdjacentHTML('beforeend', renderEdges(pipeline));
}

// ── Config panel helpers ───────────────────────────────────────────────────

function fieldInput(field: string, value: string, extra = ''): string {
  return `<input data-field="${field}" value="${value}" style="${FIELD_STYLE}padding:5px 7px;${extra}" />`;
}
function fieldSelect(field: string, options: string[], current: string, extra = ''): string {
  const opts = options.map(o => `<option value="${o}"${current === o ? ' selected' : ''}>${o}</option>`).join('');
  return `<select data-field="${field}" style="${FIELD_STYLE}padding:5px 7px;${extra}">${opts}</select>`;
}
function fieldTextarea(field: string, value: string, rows = 4): string {
  return `<textarea data-field="${field}" rows="${rows}" style="${FIELD_STYLE}padding:6px;resize:vertical;">${value}</textarea>`;
}
function lbl(text: string): string { return `<label style="${LABEL_STYLE}">${text}</label>`; }

function configFields(node: PipelineNode): string {
  const c = node.config;
  switch (node.type) {
    case 'prompt':
      return lbl('Prompt Text') + fieldTextarea('text', c.text ?? '', 5);
    case 'cc-agent': case 'qwen-agent': case 'aider-agent':
      return lbl('Label') + fieldInput('label', c.label ?? '', 'margin-bottom:8px;')
        + lbl('Template') + fieldTextarea('template', c.template ?? '');
    case 'transform':
      return lbl('Transform Type')
        + fieldSelect('transformType', ['extract-code','filter-errors','summarize','regex'], c.transformType ?? '');
    case 'e2e-test':
      return lbl('Test File') + fieldInput('testFile', c.testFile ?? '', 'margin-bottom:8px;')
        + lbl('Assertion Set') + fieldSelect('assertionSet', ['full-suite','local','smoke','online'], c.assertionSet ?? '');
    case 'gate':
      return lbl('Condition')
        + fieldSelect('condition', ['pass/fail','keyword','regex','manual'], c.condition ?? '', 'margin-bottom:8px;')
        + lbl('Value') + fieldInput('value', c.value ?? '');
    case 'qwen-vl':
      return lbl('Screen Type')
        + fieldSelect('screenType', ['game','lobby','menu','admin'], c.screenType ?? '', 'margin-bottom:8px;')
        + lbl('Threshold') + `<input data-field="threshold" type="number" value="${c.threshold ?? '0.8'}" style="${FIELD_STYLE}padding:5px 7px;" />`;
    default: return '';
  }
}

export function showConfigPanel(canvasEl: HTMLElement, node: PipelineNode, onSave: (n: PipelineNode) => void): void {
  canvasEl.querySelector('.pipeline-config-panel')?.remove();
  const panel = document.createElement('div');
  panel.className = 'pipeline-config-panel';
  panel.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:280px;'
    + 'background:var(--bg-surface);border-left:1px solid var(--border);'
    + 'display:flex;flex-direction:column;z-index:10;box-shadow:-4px 0 12px rgba(0,0,0,0.3);';

  const color = NODE_COLORS[node.type] ?? 'var(--accent)';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <span style="color:${color};font-size:13px;">${NODE_TYPE_ICONS[node.type]}</span>
      <span style="font-size:12px;font-weight:700;color:var(--text);flex:1;">${NODE_TYPE_LABELS[node.type]}</span>
      <button class="pipeline-config-close" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;padding:0;">&#x2715;</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px;">
      ${configFields(node)}
    </div>
    <div style="padding:10px 12px;border-top:1px solid var(--border);flex-shrink:0;">
      <button class="pipeline-config-save admin-btn admin-btn--small" style="width:100%;">Save</button>
    </div>`;

  panel.querySelector('.pipeline-config-close')?.addEventListener('click', () => panel.remove());
  panel.querySelector('.pipeline-config-save')?.addEventListener('click', () => {
    panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-field]')
      .forEach(f => { if (f.dataset.field) node.config[f.dataset.field] = f.value; });
    onSave(node);
    panel.remove();
  });
  canvasEl.appendChild(panel);
}

// ── Node DOM rendering ─────────────────────────────────────────────────────

function portDiv(nodeId: string, cls: string, port: string, style: string, title = ''): string {
  return `<div class="pipeline-port ${cls}" data-node-id="${nodeId}" data-port="${port}"
    style="${style}" ${title ? `title="${title}"` : ''}></div>`;
}

export function createNodeEl(node: PipelineNode, onNodeSelect?: (n: PipelineNode) => void): HTMLElement {
  const color = NODE_COLORS[node.type] ?? 'var(--accent)';
  const label = node.config.label ?? NODE_TYPE_LABELS[node.type];
  const isGate = node.type === 'gate';

  const portBase = `position:absolute;width:${PORT_R * 2}px;height:${PORT_R * 2}px;border-radius:50%;border:2px solid var(--bg-surface);cursor:crosshair;z-index:2;`;
  const inPort = portDiv(node.id, 'pipeline-port--in', 'in',
    `${portBase}left:-${PORT_R}px;top:50%;transform:translateY(-50%);background:var(--border);`);
  const outPorts = isGate
    ? portDiv(node.id, 'pipeline-port--out-true', 'out-true',
        `${portBase}right:-${PORT_R}px;top:30%;transform:translateY(-50%);background:var(--green,#4caf50);`, 'True')
      + portDiv(node.id, 'pipeline-port--out-false', 'out-false',
        `${portBase}right:-${PORT_R}px;top:70%;transform:translateY(-50%);background:var(--red-bright,#d45234);`, 'False')
    : portDiv(node.id, 'pipeline-port--out', 'out',
        `${portBase}right:-${PORT_R}px;top:50%;transform:translateY(-50%);background:var(--accent-dim,#4a9eff);`);

  const el = document.createElement('div');
  el.className = 'pipeline-node';
  el.dataset.nodeId = node.id;
  el.style.cssText = `left:${node.x}px;top:${node.y}px;width:${NODE_W}px;min-height:${NODE_H}px;`
    + 'position:absolute;background:var(--bg-surface);border:1.5px solid var(--border);'
    + 'border-radius:6px;cursor:grab;user-select:none;box-sizing:border-box;z-index:1;';

  el.innerHTML = `${inPort}
    <div class="pipeline-node-header" style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--border);">
      <span style="color:${color};font-size:14px;">${NODE_TYPE_ICONS[node.type]}</span>
      <span style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${label}</span>
      <button class="pipeline-node-delete" data-node-id="${node.id}"
        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:12px;padding:0 2px;opacity:0;transition:opacity 0.15s;">&#x2715;</button>
    </div>
    <div style="padding:4px 10px 6px;font-size:10px;color:var(--text-quiet);">${node.type}</div>
    ${outPorts}`;

  el.addEventListener('mouseenter', () => { const b = el.querySelector<HTMLElement>('.pipeline-node-delete'); if (b) b.style.opacity = '1'; });
  el.addEventListener('mouseleave', () => { const b = el.querySelector<HTMLElement>('.pipeline-node-delete'); if (b) b.style.opacity = '0'; });

  if (onNodeSelect) {
    el.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.pipeline-port,.pipeline-node-delete')) return;
      onNodeSelect(node);
    });
  }
  return el;
}

// ── Canvas wiring ──────────────────────────────────────────────────────────

interface DragState { nodeId: string; startX: number; startY: number; origX: number; origY: number; }
interface EdgeDragState { fromNodeId: string; fromPort: string; svg: SVGSVGElement; previewPath: SVGPathElement; canvasRect: DOMRect; }

export function createPipelineCanvas(
  container: HTMLElement,
  onNodeSelect: (n: PipelineNode) => void,
  onEdgeCreate: (from: string, fromPort: string, to: string, toPort: string) => void,
): { nodesContainer: HTMLElement; svg: SVGSVGElement; wireCanvas: (pipeline: Pipeline, onUpdate: () => void) => void } {
  const svg = container.querySelector<SVGSVGElement>('.pipelines-svg')!;
  const nodesContainer = container.querySelector<HTMLElement>('.pipelines-nodes')!;

  function wireCanvas(pipeline: Pipeline, onUpdate: () => void): void {
    let drag: DragState | null = null;
    let edgeDrag: EdgeDragState | null = null;

    nodesContainer.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.pipeline-port,.pipeline-node-delete')) return;
      const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.pipeline-node');
      if (!nodeEl?.dataset.nodeId) return;
      const node = pipeline.nodes.find(n => n.id === nodeEl.dataset.nodeId);
      if (!node) return;
      e.preventDefault();
      drag = { nodeId: node.id, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
      nodeEl.style.cursor = 'grabbing';
    });

    nodesContainer.addEventListener('mousedown', (e) => {
      const port = (e.target as HTMLElement).closest<HTMLElement>('.pipeline-port--out,.pipeline-port--out-true,.pipeline-port--out-false');
      if (!port?.dataset.nodeId) return;
      e.preventDefault(); e.stopPropagation();
      const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      preview.setAttribute('fill', 'none'); preview.setAttribute('stroke', 'var(--accent)');
      preview.setAttribute('stroke-width', '1.5'); preview.setAttribute('stroke-dasharray', '6 3');
      svg.appendChild(preview);
      edgeDrag = { fromNodeId: port.dataset.nodeId, fromPort: port.dataset.port ?? 'out', svg, previewPath: preview, canvasRect: svg.getBoundingClientRect() };
    });

    document.addEventListener('mousemove', (e) => {
      if (drag) {
        const node = pipeline.nodes.find(n => n.id === drag!.nodeId);
        if (!node) return;
        node.x = Math.max(0, drag.origX + (e.clientX - drag.startX));
        node.y = Math.max(0, drag.origY + (e.clientY - drag.startY));
        const el = nodesContainer.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`);
        if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; }
        refreshEdges(svg, pipeline);
      }
      if (edgeDrag) {
        const fn = pipeline.nodes.find(n => n.id === edgeDrag!.fromNodeId);
        if (!fn) return;
        const fp = portPos(fn, edgeDrag.fromPort as PortId);
        const r = edgeDrag.canvasRect;
        edgeDrag.previewPath.setAttribute('d', bezierPath(fp.x, fp.y, e.clientX - r.left, e.clientY - r.top));
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (drag) {
        const el = nodesContainer.querySelector<HTMLElement>(`[data-node-id="${drag.nodeId}"]`);
        if (el) el.style.cursor = 'grab';
        drag = null; onUpdate();
      }
      if (edgeDrag) {
        edgeDrag.previewPath.remove();
        const target = (e.target as HTMLElement).closest<HTMLElement>('.pipeline-port--in');
        if (target?.dataset.nodeId && target.dataset.nodeId !== edgeDrag.fromNodeId) {
          onEdgeCreate(edgeDrag.fromNodeId, edgeDrag.fromPort, target.dataset.nodeId, 'in');
          refreshEdges(svg, pipeline); onUpdate();
        }
        edgeDrag = null;
      }
    });

    nodesContainer.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.pipeline-node-delete');
      if (!btn?.dataset.nodeId) return;
      e.stopPropagation();
      const id = btn.dataset.nodeId;
      const idx = pipeline.nodes.findIndex(n => n.id === id);
      if (idx >= 0) {
        pipeline.nodes.splice(idx, 1);
        pipeline.edges = pipeline.edges.filter(ed => ed.from !== id && ed.to !== id);
        btn.closest<HTMLElement>('.pipeline-node')?.remove();
        refreshEdges(svg, pipeline); onUpdate();
      }
    });

    svg.addEventListener('dblclick', (e) => {
      const path = (e.target as SVGElement).closest<SVGPathElement>('.pipeline-edge');
      if (!path) return;
      pipeline.edges = pipeline.edges.filter(
        ed => !(ed.from === path.dataset.from && ed.fromPort === path.dataset.fromPort && ed.to === path.dataset.to)
      );
      path.remove(); onUpdate();
    });
  }

  return { nodesContainer, svg, wireCanvas };
}

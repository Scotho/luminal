// admin/src/sections/__tests__/agentPipelines.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

const storage = mockLocalStorage();

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => ([]),
  text: async () => '[]',
})));

import { initAgentPipelines } from '../agentPipelines';
import { topologicalSort } from '../../ui/pipelineExecution';
import type { PipelineNode, PipelineEdge } from '../../ui/pipelineCanvas';

describe('initAgentPipelines', () => {
  beforeEach(() => {
    storage.clear();
    document.body.innerHTML = '<div id="section-agent-pipelines" class="section"></div>';
  });

  it('section initializes — .agent-pipelines exists', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector('.agent-pipelines')).toBeTruthy();
  });

  it('canvas renders — .pipelines-svg exists', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector('.pipelines-svg')).toBeTruthy();
  });

  it('palette has 8 node type buttons', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));
    const btns = document.querySelectorAll('.pipelines-palette-btn');
    expect(btns.length).toBe(8);
  });

  it('adding a node creates .pipeline-node in canvas', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const newBtn = document.querySelector<HTMLButtonElement>('.pipelines-new');
    newBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const paletteBtn = document.querySelector<HTMLButtonElement>('.pipelines-palette-btn[data-type="prompt"]');
    paletteBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('.pipeline-node')).toBeTruthy();
  });

  it('save persists to localStorage', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const newBtn = document.querySelector<HTMLButtonElement>('.pipelines-new');
    newBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const saveBtn = document.querySelector<HTMLButtonElement>('.pipelines-save');
    saveBtn?.click();

    expect(storage.has('luminal-pipelines')).toBe(true);
    const saved = JSON.parse(storage.get('luminal-pipelines') ?? '[]') as unknown[];
    expect(Array.isArray(saved)).toBe(true);
  });

  it('preset pipelines load via dropdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ([
        { id: 'preset-1', name: 'Feature + Test', nodes: [], edges: [] },
        { id: 'preset-2', name: 'Bug Fix', nodes: [], edges: [] },
      ]),
      text: async () => '[]',
    })));

    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const select = document.querySelector<HTMLSelectElement>('.pipelines-load');
    expect(select).toBeTruthy();
    const options = Array.from(select?.options ?? []).map(o => o.text);
    expect(options.some(o => o === 'Feature + Test')).toBe(true);
    expect(options.some(o => o === 'Bug Fix')).toBe(true);
  });

  it('running node gets .pipeline-node--running class', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const newBtn = document.querySelector<HTMLButtonElement>('.pipelines-new');
    newBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const paletteBtn = document.querySelector<HTMLButtonElement>('.pipelines-palette-btn[data-type="prompt"]');
    paletteBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const runBtn = document.querySelector<HTMLButtonElement>('.pipelines-run');
    runBtn?.click();

    await new Promise(r => setTimeout(r, 0));

    const nodes = document.querySelectorAll('.pipeline-node');
    const hasRunning = Array.from(nodes).some(n => n.classList.contains('pipeline-node--running'));
    expect(hasRunning).toBe(true);
  });

  it('double-click on node opens config panel', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const newBtn = document.querySelector<HTMLButtonElement>('.pipelines-new');
    newBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const paletteBtn = document.querySelector<HTMLButtonElement>('.pipelines-palette-btn[data-type="prompt"]');
    paletteBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const nodeEl = document.querySelector<HTMLElement>('.pipeline-node');
    expect(nodeEl).toBeTruthy();

    // Dispatch dblclick on the node header (not a port)
    const header = nodeEl?.querySelector('.pipeline-node-header');
    header?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    expect(document.querySelector('.pipeline-config-panel')).toBeTruthy();
  });

  it('gate node has two output ports (out-true and out-false)', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const newBtn = document.querySelector<HTMLButtonElement>('.pipelines-new');
    newBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const paletteBtn = document.querySelector<HTMLButtonElement>('.pipelines-palette-btn[data-type="gate"]');
    paletteBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const truePort = document.querySelector('.pipeline-port--out-true');
    const falsePort = document.querySelector('.pipeline-port--out-false');
    expect(truePort).toBeTruthy();
    expect(falsePort).toBeTruthy();
    // Regular out port should NOT be on gate
    expect(document.querySelector('.pipeline-port--out[data-port="out"]')).toBeFalsy();
  });

  it('config panel shows type-specific fields for gate node', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const newBtn = document.querySelector<HTMLButtonElement>('.pipelines-new');
    newBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const paletteBtn = document.querySelector<HTMLButtonElement>('.pipelines-palette-btn[data-type="gate"]');
    paletteBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const nodeEl = document.querySelector<HTMLElement>('.pipeline-node');
    const header = nodeEl?.querySelector('.pipeline-node-header');
    header?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const panel = document.querySelector('.pipeline-config-panel');
    expect(panel).toBeTruthy();
    // Gate panel should have a condition select and value input
    const condSelect = panel?.querySelector('[data-field="condition"]');
    const valInput = panel?.querySelector('[data-field="value"]');
    expect(condSelect).toBeTruthy();
    expect(valInput).toBeTruthy();
  });

  it('config panel shows prompt textarea for prompt node', async () => {
    initAgentPipelines();
    await new Promise(r => setTimeout(r, 0));

    const newBtn = document.querySelector<HTMLButtonElement>('.pipelines-new');
    newBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const paletteBtn = document.querySelector<HTMLButtonElement>('.pipelines-palette-btn[data-type="prompt"]');
    paletteBtn?.click();
    await new Promise(r => setTimeout(r, 0));

    const nodeEl = document.querySelector<HTMLElement>('.pipeline-node');
    const header = nodeEl?.querySelector('.pipeline-node-header');
    header?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));

    const panel = document.querySelector('.pipeline-config-panel');
    expect(panel?.querySelector('[data-field="text"]')).toBeTruthy();
  });
});

describe('topologicalSort', () => {
  it('sorts linear chain correctly', () => {
    const nodes: PipelineNode[] = [
      { id: 'a', type: 'prompt', x: 0, y: 0, config: {} },
      { id: 'b', type: 'cc-agent', x: 0, y: 0, config: {} },
      { id: 'c', type: 'e2e-test', x: 0, y: 0, config: {} },
    ];
    const edges: PipelineEdge[] = [
      { from: 'a', fromPort: 'out', to: 'b', toPort: 'in' },
      { from: 'b', fromPort: 'out', to: 'c', toPort: 'in' },
    ];
    const sorted = topologicalSort(nodes, edges);
    expect(sorted.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles single node', () => {
    const nodes: PipelineNode[] = [
      { id: 'x', type: 'prompt', x: 0, y: 0, config: {} },
    ];
    const sorted = topologicalSort(nodes, []);
    expect(sorted[0].id).toBe('x');
  });

  it('handles empty graph', () => {
    expect(topologicalSort([], [])).toEqual([]);
  });
});

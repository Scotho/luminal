// admin/src/ui/pipelineExecution.ts — Topological sort, pipeline run, gate branching

import type { Pipeline, PipelineNode, PipelineEdge } from './pipelineCanvas';

export interface CancelToken {
  cancelled: boolean;
}

// ── Topological sort ───────────────────────────────────────────────────────

export function topologicalSort(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: PipelineNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodes.find(n => n.id === id);
    if (node) sorted.push(node);
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  return sorted;
}

// ── Gate evaluation ────────────────────────────────────────────────────────

function evaluateGate(node: PipelineNode, input: string): boolean {
  const condition = node.config.condition ?? 'pass/fail';
  const value = node.config.value ?? '';

  switch (condition) {
    case 'pass/fail':
      return input.toUpperCase().includes('PASS');

    case 'keyword':
      return value.length > 0 && input.toLowerCase().includes(value.toLowerCase());

    case 'regex':
      try {
        return new RegExp(value).test(input);
      } catch {
        return false;
      }

    case 'manual':
      return typeof window !== 'undefined'
        ? window.confirm(`Gate "${node.config.label ?? 'Gate'}": Route to True?`)
        : true;

    default:
      return true;
  }
}

// ── Execution ──────────────────────────────────────────────────────────────

export async function executePipeline(
  pipeline: Pipeline,
  onNodeStart: (nodeId: string) => void,
  onNodeComplete: (nodeId: string) => void,
  onNodeError: (nodeId: string, error: string) => void,
  cancelToken: CancelToken,
): Promise<void> {
  // Track outputs per node (simulated)
  const outputs = new Map<string, string>();
  // Track which nodes are blocked by a gate routing them out
  const skipped = new Set<string>();

  const sorted = topologicalSort(pipeline.nodes, pipeline.edges);

  for (const node of sorted) {
    if (cancelToken.cancelled) break;
    if (skipped.has(node.id)) continue;

    onNodeStart(node.id);

    try {
      // Simulate async work
      await new Promise<void>(resolve => setTimeout(resolve, 700));

      if (cancelToken.cancelled) {
        onNodeError(node.id, 'Cancelled');
        break;
      }

      // Simulate a node output (real impl would call agent API)
      const simulatedOutput = `PASS output from ${node.id}`;
      outputs.set(node.id, simulatedOutput);

      // Gate branching logic
      if (node.type === 'gate') {
        const input = outputs.get(node.id) ?? '';
        const result = evaluateGate(node, input);

        // Edges from gate: find which port to follow and which to suppress
        const trueEdges = pipeline.edges.filter(e => e.from === node.id && e.fromPort === 'out-true');
        const falseEdges = pipeline.edges.filter(e => e.from === node.id && e.fromPort === 'out-false');

        const activeEdges = result ? trueEdges : falseEdges;
        const suppressedEdges = result ? falseEdges : trueEdges;

        // Mark suppressed branch nodes as skipped (transitively)
        for (const edge of suppressedEdges) {
          markSkipped(edge.to, pipeline.edges, skipped);
        }

        // Ensure active branch nodes are not skipped
        for (const edge of activeEdges) {
          skipped.delete(edge.to);
        }
      }

      onNodeComplete(node.id);
    } catch (err) {
      onNodeError(node.id, String(err));
    }
  }
}

function markSkipped(nodeId: string, edges: PipelineEdge[], skipped: Set<string>): void {
  if (skipped.has(nodeId)) return;
  skipped.add(nodeId);
  for (const e of edges) {
    if (e.from === nodeId) {
      markSkipped(e.to, edges, skipped);
    }
  }
}

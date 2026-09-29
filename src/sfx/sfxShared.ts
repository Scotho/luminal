// Shared helpers for the sfx/* category submodules.
// Keep this file small: only utilities used by multiple sfx category files
// (or widely enough to justify a single home) belong here.

/**
 * Schedule disconnect of a node chain after a one-shot sound completes.
 * Uses setTimeout since one-shot procedural sounds have known durations.
 */
export function scheduleDisconnect(nodes: AudioNode[], afterMs: number): void {
  setTimeout(() => {
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* expected: node already disconnected by teardown */ }
    }
  }, afterMs);
}

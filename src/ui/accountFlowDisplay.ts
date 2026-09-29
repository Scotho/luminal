/**
 * SPEC-92: Account FLOW display — updates topbar dropdown with banked/lifetime FLOW.
 * Called after profile refresh and match end.
 */

export function updateAccountFlowDisplay(banked: number, lifetime: number): void {
  const b = document.getElementById('usm-banked-flow');
  const l = document.getElementById('usm-lifetime-flow');
  if (b) b.textContent = banked.toLocaleString();
  if (l) l.textContent = lifetime.toLocaleString();
}

// ── Server Activity Indicator ────────────────────────────────────────────────
// Shows/hides the "SYNCING" activity indicator in the top bar.
// Multiple callers can show concurrently; the indicator only hides when all
// have called hideServerActivity().

let _count: number = 0;

export function showServerActivity(label: string = 'SYNCING'): void {
  _count++;
  const el: HTMLElement = document.getElementById('server-activity')!;
  document.getElementById('server-activity-label')!.textContent = label;
  el.classList.add('server-activity--active');
}

export function hideServerActivity(): void {
  _count = Math.max(0, _count - 1);
  if (_count === 0) {
    document.getElementById('server-activity')!.classList.remove('server-activity--active');
  }
}

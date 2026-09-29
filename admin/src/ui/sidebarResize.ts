// ── Sidebar Resize Handle ────────────────────────────────────────────────────
// Drag the vertical handle between sidebar and content to resize the sidebar.

const STORAGE_KEY = 'luminal-admin-sidebar-width';
const MIN_WIDTH = 160;
const MAX_WIDTH = 400;

export function initSidebarResize(): void {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sidebar-resize');
  if (!sidebar || !handle) return;

  // Restore saved width
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= MIN_WIDTH && w <= MAX_WIDTH) {
      sidebar.style.width = `${w}px`;
    }
  }

  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    sidebar.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(STORAGE_KEY, String(parseInt(sidebar.style.width, 10)));
  });
}

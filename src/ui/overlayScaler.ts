// ── Overlay Panel Auto-scaler ────────────────────────────────────────────────
// Scales overlay panels down when they would overflow the viewport on desktop.

function _autoScaleOverlays(): void {
  if (window.innerWidth <= 768) return;
  const PAD = 20; // px padding from viewport edges
  const TOP_BAR = 36; // top bar height
  document.querySelectorAll('.overlay-screen:not(.hidden)').forEach((overlay: Element) => {
    const content: HTMLElement | null = overlay.querySelector('.content') as HTMLElement | null;
    if (!content) return;
    content.style.transform = '';
    const rect: DOMRect = content.getBoundingClientRect();
    const availW = window.innerWidth - PAD * 2;
    const availH = window.innerHeight - TOP_BAR - PAD;
    const scaleX = rect.width > availW ? availW / rect.width : 1;
    const scaleY = rect.height > availH ? availH / rect.height : 1;
    const scale = Math.min(scaleX, scaleY, 1);
    if (scale < 1) {
      content.style.transform = `scale(${scale.toFixed(3)})`;
    }
  });
}

export function initOverlayScaler(): void {
  window.addEventListener('resize', _autoScaleOverlays);
  // Run after any overlay toggle via MutationObserver on class changes
  new MutationObserver(() => requestAnimationFrame(_autoScaleOverlays))
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

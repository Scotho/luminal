import { TOUCH_ENABLED } from '../input';

export function initTooltips(): void {
  // ── Custom Tooltip State ─────────────────────────────────
  const _tooltip: HTMLElement | null = document.getElementById('ui-tooltip');
  let _tipTimer: ReturnType<typeof setTimeout> | null = null;
  let _tipSource: HTMLElement | null = null; // currently-hovered element with data-tip
  let _tipObserver: MutationObserver | null = null;

  // Live-update tooltip text when data-tip attribute changes while tooltip is open
  function _startTipObserver(el: HTMLElement): void {
    _stopTipObserver();
    _tipSource = el;
    _tipObserver = new MutationObserver(() => {
      const text: string | null = el.getAttribute('data-tip');
      if (text && _tooltip!.classList.contains('tooltip--visible')) _tooltip!.textContent = text;
    });
    _tipObserver.observe(el, { attributes: true, attributeFilter: ['data-tip'] });
  }
  function _stopTipObserver(): void {
    if (_tipObserver) { _tipObserver.disconnect(); _tipObserver = null; }
    _tipSource = null;
  }

  function _showTooltipFor(el: HTMLElement): void {
    if (!_tooltip) return;
    const tipText: string | null = el.getAttribute('data-tip');
    if (!tipText) return;
    clearTimeout(_tipTimer!);
    _startTipObserver(el);
    _tooltip.textContent = tipText;
    // Position tooltip relative to element
    const r: DOMRect = el.getBoundingClientRect();
    const pos: string = el.getAttribute('data-tip-pos') || 'above';
    _tooltip.style.left = `${r.left + r.width / 2}px`;
    _tooltip.style.transform = 'translateX(-50%) scale(1)';
    if (pos === 'below') {
      _tooltip.style.top = `${r.bottom + 8}px`;
    } else {
      // Try above first, flip to below if it would go off-screen
      _tooltip.classList.add('tooltip--visible');
      const th: number = _tooltip.offsetHeight;
      _tooltip.classList.remove('tooltip--visible');
      const aboveY: number = r.top - th - 8;
      if (aboveY < 4) {
        _tooltip.style.top = `${r.bottom + 8}px`; // flip below
      } else {
        _tooltip.style.top = `${aboveY}px`;
      }
    }
    // Clamp horizontally to viewport
    _tooltip.classList.add('tooltip--visible');
    const tr: DOMRect = _tooltip.getBoundingClientRect();
    if (tr.left < 8) _tooltip.style.left = `${8 + tr.width / 2}px`;
    if (tr.right > window.innerWidth - 8) _tooltip.style.left = `${window.innerWidth - 8 - tr.width / 2}px`;
    // Clamp vertically too
    if (tr.top < 4) _tooltip.style.top = '4px';
    if (tr.bottom > window.innerHeight - 4) _tooltip.style.top = `${window.innerHeight - 4 - tr.height}px`;
  }
  function _hideTooltip(): void {
    _stopTipObserver();
    if (_tooltip) _tooltip.classList.remove('tooltip--visible');
  }

  if (!TOUCH_ENABLED) {
    // Desktop: show on hover, hide on leave
    document.addEventListener('pointerenter', (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (!e.target || !(e.target as HTMLElement).closest) return;
      const el: HTMLElement | null = (e.target as HTMLElement).closest('[data-tip]');
      if (!el) return;
      _showTooltipFor(el);
    }, true);
    document.addEventListener('pointerleave', (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (!e.target || !(e.target as HTMLElement).closest || !(e.target as HTMLElement).closest('[data-tip]') || !_tooltip) return;
      _stopTipObserver();
      _tipTimer = setTimeout(() => _tooltip!.classList.remove('tooltip--visible'), 80);
    }, true);
  }

  // Touch: tap to show, tap outside to dismiss
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (!e.target || !(e.target as HTMLElement).closest) return;
    const el: HTMLElement | null = (e.target as HTMLElement).closest('[data-tip]');
    if (el) {
      // Tapped a tooltip element — toggle it
      if (_tipSource === el && _tooltip?.classList.contains('tooltip--visible')) {
        _hideTooltip();
      } else {
        _showTooltipFor(el);
      }
    } else if (_tooltip?.classList.contains('tooltip--visible')) {
      // Tapped outside — dismiss
      _hideTooltip();
    }
  }, true);
}

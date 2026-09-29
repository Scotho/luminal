// ── Drag-to-scroll for desktop carousels ────────────────
// Adds mouse-based drag scrolling with grab/grabbing cursor.

export function initDragScroll(el: HTMLElement): () => void {
  let isDown = false;
  let startX = 0;
  let scrollStart = 0;
  let hasMoved = false;
  let pointerId = -1;
  const elastic = createElasticController(el);

  function onPointerDown(e: PointerEvent): void {
    // Only primary button, skip touch (handled natively)
    if (e.button !== 0 || e.pointerType === 'touch') return;
    isDown = true;
    hasMoved = false;
    startX = e.clientX;
    scrollStart = el.scrollLeft;
    pointerId = e.pointerId;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!isDown) return;
    const dx = e.clientX - startX;
    if (!hasMoved && Math.abs(dx) > 8) {
      hasMoved = true;
      // Capture pointer only once a real drag begins — avoids blocking
      // text selection and normal click interactions on desktop.
      el.setPointerCapture(pointerId);
      el.classList.add('drag-scrolling');
      elastic.setHeld('x', true);
    }
    if (!hasMoved) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const desiredScroll = scrollStart - dx;
    const clampedScroll = clamp(desiredScroll, 0, maxScroll);
    el.scrollLeft = clampedScroll;

    if (desiredScroll !== clampedScroll) {
      elastic.setOffset(-rubberBand(desiredScroll - clampedScroll), 0);
    } else if (Math.abs(elastic.offsetX) > 0.01) {
      elastic.setOffset(elastic.offsetX * 0.55, 0);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!isDown) return;
    isDown = false;
    if (hasMoved) {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('drag-scrolling');
      elastic.release();
    }
  }

  // Suppress click on cards after a drag so we don't accidentally select
  function onClickCapture(e: MouseEvent): void {
    if (hasMoved) {
      e.stopPropagation();
      e.preventDefault();
      hasMoved = false;
    }
  }

  el.classList.add('drag-scroll');
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('click', onClickCapture, true);

  // Return cleanup function
  return () => {
    el.classList.remove('drag-scroll', 'drag-scrolling');
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('click', onClickCapture, true);
    elastic.destroy();
  };
}
type ScrollAxis = 'x' | 'y' | 'both';

interface ElasticScrollOptions {
  axis?: ScrollAxis;
}

const EDGE_EPSILON = 0.5;
const MAX_EDGE_OFFSET = 30;
const EDGE_RETURN_EASING = 0.24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rubberBand(distance: number, max = MAX_EDGE_OFFSET): number {
  if (distance === 0) return 0;
  const magnitude = Math.abs(distance);
  const eased = max * (1 - 1 / (magnitude * 0.045 + 1));
  return Math.sign(distance) * Math.min(max, eased);
}

function shouldHandleStart(position: number): boolean {
  return position <= EDGE_EPSILON;
}

function shouldHandleEnd(position: number, max: number): boolean {
  return position >= max - EDGE_EPSILON;
}

function createElasticController(el: HTMLElement) {
  let offsetX = 0;
  let offsetY = 0;
  let heldX = false;
  let heldY = false;
  let raf = 0;

  function applyOffset(): void {
    if (Math.abs(offsetX) < 0.01 && Math.abs(offsetY) < 0.01) {
      el.style.removeProperty('translate');
      return;
    }
    el.style.setProperty('translate', `${offsetX.toFixed(2)}px ${offsetY.toFixed(2)}px`);
  }

  function step(): void {
    raf = 0;

    if (!heldX) {
      offsetX += (0 - offsetX) * EDGE_RETURN_EASING;
      if (Math.abs(offsetX) < 0.2) {
        offsetX = 0;
      }
    }

    if (!heldY) {
      offsetY += (0 - offsetY) * EDGE_RETURN_EASING;
      if (Math.abs(offsetY) < 0.2) {
        offsetY = 0;
      }
    }

    applyOffset();
    if (heldX || heldY || offsetX !== 0 || offsetY !== 0) {
      raf = requestAnimationFrame(step);
    }
  }

  function ensureAnimating(): void {
    if (!raf) raf = requestAnimationFrame(step);
  }

  return {
    get offsetX(): number { return offsetX; },
    get offsetY(): number { return offsetY; },
    setHeld(axis: 'x' | 'y', held: boolean): void {
      if (axis === 'x') {
        heldX = held;
      } else {
        heldY = held;
      }
      ensureAnimating();
    },
    setOffset(x: number, y: number): void {
      offsetX = clamp(x, -MAX_EDGE_OFFSET, MAX_EDGE_OFFSET);
      offsetY = clamp(y, -MAX_EDGE_OFFSET, MAX_EDGE_OFFSET);
      applyOffset();
      ensureAnimating();
    },
    addOffset(dx: number, dy: number): void {
      offsetX = clamp(offsetX + dx, -MAX_EDGE_OFFSET, MAX_EDGE_OFFSET);
      offsetY = clamp(offsetY + dy, -MAX_EDGE_OFFSET, MAX_EDGE_OFFSET);
      applyOffset();
      ensureAnimating();
    },
    release(): void {
      heldX = false;
      heldY = false;
      ensureAnimating();
    },
    destroy(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      offsetX = 0;
      offsetY = 0;
      el.style.removeProperty('translate');
    },
  };
}

export function initElasticScroll(el: HTMLElement, options: ElasticScrollOptions = {}): () => void {
  const axis = options.axis ?? 'both';
  const elastic = createElasticController(el);
  let touchId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  function onWheel(e: WheelEvent): void {
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);

    // Remap vertical wheel → horizontal scroll for horizontal-only carousels
    if (axis === 'x' && !horizontal && maxX > 0) {
      e.preventDefault();
      const atStart = shouldHandleStart(el.scrollLeft);
      const atEnd = shouldHandleEnd(el.scrollLeft, maxX);
      if ((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0)) {
        elastic.addOffset(-rubberBand(e.deltaY * 0.35), 0);
      } else {
        el.scrollBy({ left: e.deltaY, behavior: 'smooth' });
      }
      return;
    }

    if (axis !== 'y' && horizontal && maxX > 0) {
      const atStart = shouldHandleStart(el.scrollLeft);
      const atEnd = shouldHandleEnd(el.scrollLeft, maxX);
      if ((atStart && e.deltaX < 0) || (atEnd && e.deltaX > 0)) {
        e.preventDefault();
        elastic.addOffset(-rubberBand(e.deltaX * 0.35), 0);
      }
    }

    if (axis !== 'x' && (!horizontal || axis === 'y') && maxY > 0) {
      const atStart = shouldHandleStart(el.scrollTop);
      const atEnd = shouldHandleEnd(el.scrollTop, maxY);
      if ((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0)) {
        e.preventDefault();
        elastic.addOffset(0, -rubberBand(e.deltaY * 0.35));
      }
    }
  }

  function onTouchStart(e: TouchEvent): void {
    const touch = e.changedTouches[0];
    if (!touch) return;
    touchId = touch.identifier;
    lastX = touch.clientX;
    lastY = touch.clientY;
  }

  function onTouchMove(e: TouchEvent): void {
    if (touchId == null) return;
    const touch = Array.from(e.touches).find((t) => t.identifier === touchId);
    if (!touch) return;

    const dx = touch.clientX - lastX;
    const dy = touch.clientY - lastY;
    lastX = touch.clientX;
    lastY = touch.clientY;

    let handled = false;
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxY = Math.max(0, el.scrollHeight - el.clientHeight);

    if (axis !== 'y' && maxX > 0 && (Math.abs(dx) >= Math.abs(dy) || Math.abs(elastic.offsetX) > 0.01)) {
      const atStart = shouldHandleStart(el.scrollLeft);
      const atEnd = shouldHandleEnd(el.scrollLeft, maxX);
      if ((atStart && dx > 0) || (atEnd && dx < 0) || Math.abs(elastic.offsetX) > 0.01) {
        elastic.setHeld('x', true);
        elastic.addOffset(dx * 0.45, 0);
        handled = true;
      }
    }

    if (axis !== 'x' && maxY > 0 && !handled && (Math.abs(dy) >= Math.abs(dx) || Math.abs(elastic.offsetY) > 0.01)) {
      const atStart = shouldHandleStart(el.scrollTop);
      const atEnd = shouldHandleEnd(el.scrollTop, maxY);
      if ((atStart && dy > 0) || (atEnd && dy < 0) || Math.abs(elastic.offsetY) > 0.01) {
        elastic.setHeld('y', true);
        elastic.addOffset(0, dy * 0.45);
      }
    }

  }

  function onTouchEnd(): void {
    touchId = null;
    elastic.release();
  }

  el.addEventListener('wheel', onWheel, { passive: false });

  // Skip touch-based elastic on touch devices — native scroll +
  // CSS overscroll-behavior: contain handles edge-bounce already.
  // These handlers apply CSS translate to the container which moves
  // the whole panel instead of scrolling content within it.
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (!isTouch) {
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  return () => {
    el.removeEventListener('wheel', onWheel);
    if (!isTouch) {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    }
    elastic.destroy();
  };
}

export function revealScrollItem(
  container: HTMLElement,
  item: HTMLElement,
  axis: 'x' | 'y' = 'x',
  behavior: ScrollBehavior = 'smooth',
): void {
  if (axis === 'x') {
    const itemStart = item.offsetLeft;
    const itemEnd = itemStart + item.offsetWidth;
    const viewStart = container.scrollLeft;
    const viewEnd = viewStart + container.clientWidth;

    if (itemStart < viewStart) {
      container.scrollTo({ left: itemStart, behavior });
    } else if (itemEnd > viewEnd) {
      container.scrollTo({ left: itemEnd - container.clientWidth, behavior });
    }
    return;
  }

  const itemStart = item.offsetTop;
  const itemEnd = itemStart + item.offsetHeight;
  const viewStart = container.scrollTop;
  const viewEnd = viewStart + container.clientHeight;

  if (itemStart < viewStart) {
    container.scrollTo({ top: itemStart, behavior });
  } else if (itemEnd > viewEnd) {
    container.scrollTo({ top: itemEnd - container.clientHeight, behavior });
  }
}

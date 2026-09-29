/**
 * shimmerAnimation.ts
 *
 * Claude Code–style shimmer text effect: a color wave sweeping across text.
 * Pure DOM + CSS, no external dependencies.
 */

export interface ShimmerOptions {
  baseColor: string;
  shimmerColor: string;
  speed: 'requesting' | 'responding';
  stalledColor?: string;
}

export interface ShimmerController {
  updateText(text: string): void;
  updateTokenTime(): void;
  setSpeed(speed: 'requesting' | 'responding'): void;
  destroy(): void;
}

// Speed modes: ms per position step
const SPEED_MS: Record<'requesting' | 'responding', number> = {
  requesting: 50,
  responding: 200,
};

const STALL_THRESHOLD_MS = 3000;
const STALL_FADE_MS = 2000;

/**
 * Create a shimmer animation inside `container` with the given `text`.
 * Returns a controller to update text, reset stall state, change speed, or destroy.
 */
export function createShimmer(
  container: HTMLElement,
  text: string,
  options: ShimmerOptions
): ShimmerController {
  const { baseColor, shimmerColor, stalledColor = 'rgb(212, 82, 52)' } = options;

  // Position of shimmer sweep (0 → 1 → loops back)
  let position = 0;
  let lastTokenTime = Date.now();
  let stalled = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let stallCheckId: ReturnType<typeof setInterval> | null = null;

  // Create the span element
  const span = document.createElement('span');
  span.className = 'cc-shimmer';
  span.textContent = text;
  applyGradient();
  container.appendChild(span);

  // Start the sweep interval
  startInterval(options.speed);
  startStallCheck();

  // ── Gradient painting ─────────────────────────────────

  function applyGradient(): void {
    const pct = Math.round(position * 100);
    // Gradient: base → shimmer at sweep pos → base
    // We create a tight shimmer band (±8%) centered at `pct`
    const lo = Math.max(0, pct - 8);
    const hi = Math.min(100, pct + 8);
    const grad = [
      `${baseColor} 0%`,
      `${baseColor} ${lo}%`,
      `${shimmerColor} ${pct}%`,
      `${baseColor} ${hi}%`,
      `${baseColor} 100%`,
    ].join(', ');

    span.style.background = `linear-gradient(90deg, ${grad})`;
    span.style.backgroundClip = 'text';
    span.style.webkitBackgroundClip = 'text';
    span.style.webkitTextFillColor = 'transparent';
    span.style.display = 'inline-block';
  }

  // ── Interval management ───────────────────────────────

  function startInterval(speed: 'requesting' | 'responding'): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
    }
    intervalId = setInterval(() => {
      position = (position + 0.02) % 1.2; // sweep past 100% so shimmer exits cleanly
      if (position > 1) position = -0.1;   // reset before re-entry
      applyGradient();
    }, SPEED_MS[speed]);
  }

  // ── Stall detection ───────────────────────────────────

  function startStallCheck(): void {
    if (stallCheckId !== null) {
      clearInterval(stallCheckId);
    }
    stallCheckId = setInterval(() => {
      const elapsed = Date.now() - lastTokenTime;
      if (elapsed >= STALL_THRESHOLD_MS) {
        const fadeElapsed = elapsed - STALL_THRESHOLD_MS;
        const intensity = Math.min(1, fadeElapsed / STALL_FADE_MS);
        span.classList.add('cc-shimmer--stalled');
        span.style.setProperty('--stalled-intensity', String(intensity.toFixed(3)));
        stalled = true;

        // Blend in the stalled color at `intensity`
        const blend = blendColors(baseColor, stalledColor, intensity);
        const shimBlend = blendColors(shimmerColor, stalledColor, intensity);
        const pct = Math.round(position * 100);
        const lo = Math.max(0, pct - 8);
        const hi = Math.min(100, pct + 8);
        const grad = [
          `${blend} 0%`,
          `${blend} ${lo}%`,
          `${shimBlend} ${pct}%`,
          `${blend} ${hi}%`,
          `${blend} 100%`,
        ].join(', ');
        span.style.background = `linear-gradient(90deg, ${grad})`;
      }
    }, 100);
  }

  function clearStall(): void {
    stalled = false;
    span.classList.remove('cc-shimmer--stalled');
    span.style.removeProperty('--stalled-intensity');
  }

  // ── Color blending helper ─────────────────────────────

  function parseRgb(color: string): [number, number, number] {
    const m = color.match(/\d+/g);
    if (!m || m.length < 3) return [0, 0, 0];
    return [parseInt(m[0]), parseInt(m[1]), parseInt(m[2])];
  }

  function blendColors(from: string, to: string, t: number): string {
    const [r1, g1, b1] = parseRgb(from);
    const [r2, g2, b2] = parseRgb(to);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // ── Controller ────────────────────────────────────────

  return {
    updateText(newText: string): void {
      span.textContent = newText;
      applyGradient();
    },

    updateTokenTime(): void {
      lastTokenTime = Date.now();
      if (stalled) {
        clearStall();
        applyGradient();
      }
    },

    setSpeed(speed: 'requesting' | 'responding'): void {
      startInterval(speed);
    },

    destroy(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (stallCheckId !== null) {
        clearInterval(stallCheckId);
        stallCheckId = null;
      }
      if (span.parentNode) {
        span.parentNode.removeChild(span);
      }
    },
  };
}

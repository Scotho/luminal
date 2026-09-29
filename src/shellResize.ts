/**
 * shellResize — auto-sizes the SVG shell to fit menu-shell content.
 *
 * The shell has three visual layers that must stay in sync:
 *   0. Fill SVG   (.menu-shell-outline) — background + micro-grid
 *   1. Glass div  (.shell-glass)        — frosted backdrop-filter + scanlines
 *   2. Stroke SVG (.menu-shell-strokes) — rails + guide lines
 *
 * Fixed geometry (never changes):
 *   Top-left chamfer, top edge, top-right tab angle (y ≤ 36 in SVG coords)
 *
 * Dynamic geometry (derived from content):
 *   tabBottom — aligns with CTA (.menu-primary) bottom edge
 *   bottom   — derived from last in-flow content element (.menu-list)
 */

// ── Fixed constants (SVG viewBox coordinates) ───────────
const TAB_X = 534;
const BODY_X = 474;
const DIAG_H = 88;
const BR_CHAMFER_H = 24;
const BR_CHAMFER_V = 26;
const BL_CHAMFER = 14;
const GUIDE_TOP_Y = 102;
const GUIDE_BOTTOM_PAD = 36;

// Coordinate-system offsets
const SVG_TOP = 14;       // SVG element top relative to .menu-shell
const GLASS_TOP = 6;      // glass element top relative to .menu-shell
const GLASS_TO_SVG = SVG_TOP - GLASS_TOP; // add to SVG-y to get glass-y

// Rail stroke sits 2 px outside the body fill edge
const RAIL_DX = 2;

// Padding below last in-flow content element before bottom chamfer
const BOTTOM_PAD = 10;

// ── Path builders ───────────────────────────────────────

function bodyPath(tb: number, de: number, b: number): string {
  return `M 0,6 L 14,-8 L 490,-8 L ${TAB_X},36`
    + ` L ${TAB_X},${tb}`
    + ` L ${BODY_X},${de}`
    + ` L ${BODY_X},${b - BR_CHAMFER_V}`
    + ` L ${BODY_X - BR_CHAMFER_H},${b}`
    + ` L ${BL_CHAMFER},${b}`
    + ` L 0,${b - BL_CHAMFER}`
    + ' Z';
}

function rightRail(tb: number, de: number, b: number): string {
  const rx = BODY_X + RAIL_DX;
  return `M ${TAB_X},38`
    + ` L ${TAB_X},${tb + RAIL_DX}`
    + ` L ${rx},${de}`
    + ` L ${rx},${b - BR_CHAMFER_V}`
    + ` L ${rx - BR_CHAMFER_H},${b}`;
}

function leftRail(b: number): string {
  return `M 0,50 L 0,${b - BL_CHAMFER} L ${BL_CHAMFER},${b}`;
}

function leftGuide(b: number): string {
  return `M 20,${GUIDE_TOP_Y} L 20,${b - GUIDE_BOTTOM_PAD}`;
}

function glassClip(tb: number, de: number, b: number): string {
  const g = (y: number) => y + GLASS_TO_SVG;
  return `polygon(`
    + `0px ${g(6)}px,14px ${g(-8)}px,490px ${g(-8)}px,${TAB_X}px ${g(36)}px,`
    + `${TAB_X}px ${g(tb)}px,${BODY_X}px ${g(de)}px,`
    + `${BODY_X}px ${g(b - BR_CHAMFER_V)}px,${BODY_X - BR_CHAMFER_H}px ${g(b)}px,`
    + `${BL_CHAMFER}px ${g(b)}px,0px ${g(b - BL_CHAMFER)}px)`;
}

// ── Public init ─────────────────────────────────────────

export function initShellResize(): void {
  const _shell = document.querySelector('.menu-shell') as HTMLElement | null;
  if (!_shell) return;
  const _fillSvg = _shell.querySelector('.menu-shell-outline') as SVGSVGElement | null;
  const _strokeSvg = _shell.querySelector('.menu-shell-strokes') as SVGSVGElement | null;
  const _glass = _shell.querySelector('.shell-glass') as HTMLElement | null;
  if (!_fillSvg || !_strokeSvg || !_glass) return;
  // Reassign to non-nullable consts (guard above ensures non-null)
  const shell = _shell;
  const fillSvg = _fillSvg;
  const strokeSvg = _strokeSvg;
  const glass = _glass;

  const fillPaths = fillSvg.querySelectorAll<SVGPathElement>('path');
  const strokePathEls = strokeSvg.querySelectorAll<SVGPathElement>('path');
  const cta = shell.querySelector('.menu-primary') as HTMLElement | null;
  const nav = shell.querySelector('.menu-list') as HTMLElement | null;
  let _lastD = '';

  function resize(): void {
    if (!shell.offsetHeight) return;

    // Tab straight section ends where the CTA begins — the diagonal then
    // runs parallel alongside the CTA's right-edge slant, maintaining the
    // same ~24 px horizontal gap as the subplate-to-border spacing.
    const tabBottom = cta
      ? cta.offsetTop - SVG_TOP
      : 129;
    const diagEnd = tabBottom + (cta ? cta.offsetHeight : DIAG_H);

    // Measure bottom of last in-flow content (avoids scrollHeight feedback
    // from absolutely-positioned SVG/glass layers)
    const contentBottom = nav
      ? nav.offsetTop + nav.offsetHeight
      : shell.clientHeight - SVG_TOP;
    const bottom = contentBottom - SVG_TOP + BOTTOM_PAD;
    const viewBoxH = bottom + 8;

    // Fill SVG
    const d = bodyPath(tabBottom, diagEnd, bottom);
    if (d === _lastD) return; // no geometry change
    _lastD = d;
    fillSvg.setAttribute('viewBox', `0 0 540 ${viewBoxH}`);
    fillSvg.style.height = `${viewBoxH}px`;
    fillPaths.forEach(p => p.setAttribute('d', d));

    // Glass
    glass.style.height = `${bottom + GLASS_TO_SVG}px`;
    glass.style.clipPath = glassClip(tabBottom, diagEnd, bottom);

    // Stroke SVG
    strokeSvg.setAttribute('viewBox', `0 0 540 ${viewBoxH}`);
    strokeSvg.style.height = `${viewBoxH}px`;
    if (strokePathEls[0]) strokePathEls[0].setAttribute('d', leftGuide(bottom));
    if (strokePathEls[1]) strokePathEls[1].setAttribute('d', rightRail(tabBottom, diagEnd, bottom));
    if (strokePathEls[2]) strokePathEls[2].setAttribute('d', leftRail(bottom));
  }

  const ro = new ResizeObserver(resize);
  ro.observe(shell);
  resize();
}

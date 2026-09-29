// src/e2e/browser/helpers/viewports.ts
// Viewport presets used across browser E2E tests and the inspect.js script.

export interface Viewport {
  label: string;
  width: number;
  height: number;
}

/** Named viewport presets. */
export const VIEWPORTS: Record<string, Viewport> = {
  desktop:   { label: 'desktop',   width: 1920, height: 1080 },
  phone:     { label: 'phone',     width: 390,  height: 844 },
  tablet:    { label: 'tablet',    width: 768,  height: 1024 },
  landscape: { label: 'landscape', width: 844,  height: 390 },
};

/** All viewports iterated by overlay-containment tests. */
export const ALL_VIEWPORTS: Viewport[] = Object.values(VIEWPORTS);

/** Height in pixels of the fixed top bar (used for containment assertions). */
export const TOPBAR_HEIGHT = 40;

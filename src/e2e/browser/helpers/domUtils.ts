// src/e2e/browser/helpers/domUtils.ts
// DOM inspection utilities for browser E2E tests.

import type { Page } from 'playwright';

export interface ElementBounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/** Get bounding rect for a CSS selector, or null if not found. */
export async function getBounds(page: Page, selector: string): Promise<ElementBounds | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
  }, selector);
}

/** Returns true if the document body has a horizontal scrollbar. */
export async function hasHorizontalScrollbar(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/** Get a single computed CSS property for a selector. */
export async function getComputedProp(page: Page, selector: string, prop: string): Promise<string> {
  return page.evaluate(([sel, p]) => {
    const el = document.querySelector(sel as string);
    if (!el) return '';
    return getComputedStyle(el).getPropertyValue(p as string);
  }, [selector, prop] as [string, string]);
}

/** Get the current viewport size from within the page. */
export async function getViewportSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

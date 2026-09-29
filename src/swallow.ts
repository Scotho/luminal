/** Swallow errors silently – returns a rejection handler for .catch() chains.
 *  Usage: `el.play().catch(swallow('audio'))` */
export function swallow(_label: string): (reason: unknown) => void {
  return () => {};
}

/** Log a warning only in development builds. */
export function warnDev(...args: unknown[]): void {
  if (import.meta.env?.DEV) {
    console.warn('[DEV]', ...args);
  }
}

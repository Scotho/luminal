// ── Netcode Debug Logger ──────────────────────────────────
// Conditional console logging for netcode diagnostics.
//
// ON by default on localhost. Off in production.
// Toggle at runtime:  window.NETCODE_DEBUG = true / false
// Or call:            netDebugOn() / netDebugOff()
import { ENABLE_LOCAL_TOOLS } from './buildFlags';
import { infoLocal } from './localDiagnostics';

const IS_LOCAL: boolean =
  ENABLE_LOCAL_TOOLS &&
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

// Expose toggle functions on window for console access
declare global {
  interface Window {
    NETCODE_DEBUG?: boolean;
    netDebugOn?: () => void;
    netDebugOff?: () => void;
  }
}

export interface NetLogEntry {
  level: 'log' | 'warn' | 'info' | 'error';
  tag: string;
  args: unknown[];
  ts: number;
}

let _captureBuffer: NetLogEntry[] | null = null;
let _captureMax = 10_000;

const TAG_RE = /^\[(\w[\w-]*)\]/;
function extractTag(args: unknown[]): string {
  if (args.length > 0 && typeof args[0] === 'string') {
    const m = args[0].match(TAG_RE);
    if (m) return m[1];
  }
  return 'general';
}

function capture(level: NetLogEntry['level'], args: unknown[]): void {
  if (_captureBuffer === null) return;
  _captureBuffer.push({ level, tag: extractTag(args), args: [...args], ts: Date.now() });
  if (_captureBuffer.length > _captureMax) _captureBuffer.shift();
}

// ts-prune-ignore-next
export function startCapture(max?: number): void {
  _captureMax = max ?? 10_000;
  _captureBuffer = [];
}
// ts-prune-ignore-next
export function drainCapture(): NetLogEntry[] {
  const buf = _captureBuffer ?? [];
  _captureBuffer = _captureBuffer !== null ? [] : null;
  return buf;
}
// ts-prune-ignore-next
export function stopCapture(): void {
  _captureBuffer = null;
}

function isEnabled(): boolean {
  if (typeof window !== 'undefined' && window.NETCODE_DEBUG !== undefined) {
    return window.NETCODE_DEBUG;
  }
  return IS_LOCAL;
}

if (typeof window !== 'undefined' && ENABLE_LOCAL_TOOLS) {
  window.netDebugOn = () => { window.NETCODE_DEBUG = true; infoLocal('[NET] debug logging ON'); };
  window.netDebugOff = () => { window.NETCODE_DEBUG = false; infoLocal('[NET] debug logging OFF'); };
}

// ── Logging functions ────────────────────────────────────
// net.log / net.warn — suppressed when debug is off
// net.error — always shown (errors are never suppressed)

export const net = {
  log(...args: unknown[]): void {
    capture('log', args);
    if (isEnabled()) console.log('[NET]', ...args);
  },
  warn(...args: unknown[]): void {
    capture('warn', args);
    if (isEnabled()) console.warn('[NET]', ...args);
  },
  info(...args: unknown[]): void {
    capture('info', args);
    if (isEnabled()) console.info('[NET]', ...args);
  },
  group(...args: unknown[]): void {
    if (isEnabled()) console.group('[NET]', ...args);
  },
  groupEnd(): void {
    if (isEnabled()) console.groupEnd();
  },
  error(...args: unknown[]): void {
    capture('error', args);
    console.error('[NET]', ...args);
  },
};

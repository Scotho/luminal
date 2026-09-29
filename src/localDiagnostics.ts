import { ENABLE_DIAGNOSTIC_LOGS } from './buildFlags';

export function logLocal(...args: unknown[]): void {
  if (ENABLE_DIAGNOSTIC_LOGS) console.log(...args);
}

export function infoLocal(...args: unknown[]): void {
  if (ENABLE_DIAGNOSTIC_LOGS) console.info(...args);
}

export function warnLocal(...args: unknown[]): void {
  if (ENABLE_DIAGNOSTIC_LOGS) console.warn(...args);
}

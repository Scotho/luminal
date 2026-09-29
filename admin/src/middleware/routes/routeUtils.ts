import type { ServerResponse } from 'http';

/** Write a JSON response with the given status and data. */
export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Extract a query parameter from a URL string. Returns '' if missing. */
export function param(url: string, name: string): string {
  return new URL(url, 'http://localhost').searchParams.get(name) ?? '';
}

/** Check if a path contains directory traversal patterns. */
export function hasTraversal(path: string): boolean {
  return path.includes('..');
}

/** Return an error message string safe for client consumption (no stack traces). */
export function safeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

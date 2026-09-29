import { describe, it, expect } from 'vitest';
import { json, param, hasTraversal, safeError } from '../middleware/routes/routeUtils';

// ── json() ─────────────────────────────────────────────────

describe('json', () => {
  function mockRes() {
    let headStatus = 0;
    let headHeaders: Record<string, string> = {};
    let body = '';
    return {
      writeHead(status: number, headers: Record<string, string>) {
        headStatus = status;
        headHeaders = headers;
      },
      end(data: string) {
        body = data;
      },
      get status() { return headStatus; },
      get headers() { return headHeaders; },
      get body() { return body; },
    };
  }

  it('writes status and JSON content-type header', () => {
    const res = mockRes();
    json(res as any, 200, { ok: true });
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
  });

  it('serializes data as JSON string', () => {
    const res = mockRes();
    json(res as any, 400, { error: 'bad' });
    expect(res.body).toBe('{"error":"bad"}');
  });

  it('handles non-200 status codes', () => {
    const res = mockRes();
    json(res as any, 500, { error: 'internal' });
    expect(res.status).toBe(500);
  });
});

// ── param() ────────────────────────────────────────────────

describe('param', () => {
  it('extracts a query parameter by name', () => {
    expect(param('/__admin_git/diff?staged=true&file=app.ts', 'staged')).toBe('true');
    expect(param('/__admin_git/diff?staged=true&file=app.ts', 'file')).toBe('app.ts');
  });

  it('returns empty string when parameter is missing', () => {
    expect(param('/__admin_git/diff?staged=true', 'file')).toBe('');
  });

  it('returns empty string for a URL with no query string', () => {
    expect(param('/__admin_git/status', 'branch')).toBe('');
  });

  it('handles encoded characters', () => {
    expect(param('/__admin?name=hello%20world', 'name')).toBe('hello world');
  });
});

// ── hasTraversal() ─────────────────────────────────────────

describe('hasTraversal', () => {
  it('returns true when path contains ..', () => {
    expect(hasTraversal('../etc/passwd')).toBe(true);
    expect(hasTraversal('foo/../../bar')).toBe(true);
  });

  it('returns false for clean paths', () => {
    expect(hasTraversal('src/index.ts')).toBe(false);
    expect(hasTraversal('admin/routes/file.ts')).toBe(false);
  });

  it('returns false for single dots', () => {
    expect(hasTraversal('./src/index.ts')).toBe(false);
  });
});

// ── safeError() ────────────────────────────────────────────

describe('safeError', () => {
  it('extracts message from Error instances', () => {
    expect(safeError(new Error('something broke'))).toBe('something broke');
  });

  it('converts non-Error values to string', () => {
    expect(safeError('raw string')).toBe('raw string');
    expect(safeError(42)).toBe('42');
    expect(safeError(null)).toBe('null');
    expect(safeError(undefined)).toBe('undefined');
  });

  it('does not leak stack traces from Error objects', () => {
    const err = new Error('oops');
    const result = safeError(err);
    expect(result).toBe('oops');
    expect(result).not.toContain('at ');
  });
});

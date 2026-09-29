// ── module-map tests ──────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { buildImportGraph } from '../module-map.js';

// ---------------------------------------------------------------------------
// buildImportGraph — importedBy computation
// ---------------------------------------------------------------------------

describe('buildImportGraph — importedBy', () => {
  it('adds importer to imported module importedBy list', () => {
    const files = [
      { path: 'src/a.ts', imports: ['src/b.ts'], exports: [], loc: 10 },
      { path: 'src/b.ts', imports: [], exports: ['doB'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/b.ts'].importedBy).toContain('src/a.ts');
    expect(result.modules['src/a.ts'].importedBy).toHaveLength(0);
  });

  it('handles multiple importers for a single module', () => {
    const files = [
      { path: 'src/a.ts', imports: ['src/shared.ts'], exports: [], loc: 8 },
      { path: 'src/b.ts', imports: ['src/shared.ts'], exports: [], loc: 6 },
      { path: 'src/shared.ts', imports: [], exports: ['util'], loc: 20 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/shared.ts'].importedBy).toHaveLength(2);
    expect(result.modules['src/shared.ts'].importedBy).toContain('src/a.ts');
    expect(result.modules['src/shared.ts'].importedBy).toContain('src/b.ts');
  });

  it('initialises importedBy as empty for modules with no dependents', () => {
    const files = [
      { path: 'src/root.ts', imports: ['src/leaf.ts'], exports: [], loc: 5 },
      { path: 'src/leaf.ts', imports: [], exports: ['x'], loc: 3 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/root.ts'].importedBy).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildImportGraph — blast radius
// ---------------------------------------------------------------------------

describe('buildImportGraph — blastRadius', () => {
  it('computes blast radius as count of transitive dependents', () => {
    // a → b → c
    // changing c affects both b and a, so c.blastRadius = 2
    const files = [
      { path: 'src/a.ts', imports: ['src/b.ts'], exports: [], loc: 5 },
      { path: 'src/b.ts', imports: ['src/c.ts'], exports: [], loc: 5 },
      { path: 'src/c.ts', imports: [], exports: ['doC'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/c.ts'].blastRadius).toBe(2);
    expect(result.modules['src/b.ts'].blastRadius).toBe(1);
    expect(result.modules['src/a.ts'].blastRadius).toBe(0);
  });

  it('counts each dependent once for diamond dependency', () => {
    // a → b, a → c, b → d, c → d
    // d.blastRadius = 3 (b, c, a are all transitive dependents)
    const files = [
      { path: 'src/a.ts', imports: ['src/b.ts', 'src/c.ts'], exports: [], loc: 5 },
      { path: 'src/b.ts', imports: ['src/d.ts'], exports: [], loc: 5 },
      { path: 'src/c.ts', imports: ['src/d.ts'], exports: [], loc: 5 },
      { path: 'src/d.ts', imports: [], exports: ['doD'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/d.ts'].blastRadius).toBe(3);
  });

  it('assigns blastRadius 0 for top-level modules with no dependents', () => {
    const files = [
      { path: 'src/main.ts', imports: ['src/utils.ts'], exports: [], loc: 10 },
      { path: 'src/utils.ts', imports: [], exports: ['helper'], loc: 8 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/main.ts'].blastRadius).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildImportGraph — tier assignment
// ---------------------------------------------------------------------------

describe('buildImportGraph — tiers', () => {
  it('assigns tier 0 to leaf modules with no imports', () => {
    const files = [
      { path: 'src/leaf.ts', imports: [], exports: ['x'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/leaf.ts'].tier).toBe(0);
  });

  it('assigns tier 1 to modules that only import leaves', () => {
    const files = [
      { path: 'src/mid.ts', imports: ['src/leaf.ts'], exports: [], loc: 8 },
      { path: 'src/leaf.ts', imports: [], exports: ['x'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/mid.ts'].tier).toBe(1);
    expect(result.modules['src/leaf.ts'].tier).toBe(0);
  });

  it('assigns tier = max depth from any leaf (chain of 3)', () => {
    // a → b → c
    // c is leaf (tier 0), b imports c (tier 1), a imports b (tier 2)
    const files = [
      { path: 'src/a.ts', imports: ['src/b.ts'], exports: [], loc: 5 },
      { path: 'src/b.ts', imports: ['src/c.ts'], exports: [], loc: 5 },
      { path: 'src/c.ts', imports: [], exports: ['doC'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/c.ts'].tier).toBe(0);
    expect(result.modules['src/b.ts'].tier).toBe(1);
    expect(result.modules['src/a.ts'].tier).toBe(2);
  });

  it('takes max tier when module imports at multiple depths', () => {
    // root imports mid (tier 1) and leaf (tier 0)
    // root tier should be 2 (1 + 1 from mid)
    const files = [
      { path: 'src/root.ts', imports: ['src/mid.ts', 'src/leaf.ts'], exports: [], loc: 5 },
      { path: 'src/mid.ts', imports: ['src/leaf.ts'], exports: [], loc: 5 },
      { path: 'src/leaf.ts', imports: [], exports: ['x'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/root.ts'].tier).toBe(2);
    expect(result.modules['src/mid.ts'].tier).toBe(1);
    expect(result.modules['src/leaf.ts'].tier).toBe(0);
  });

  it('groups modules into the tiers record', () => {
    const files = [
      { path: 'src/a.ts', imports: ['src/b.ts'], exports: [], loc: 5 },
      { path: 'src/b.ts', imports: [], exports: ['x'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.tiers[0]).toContain('src/b.ts');
    expect(result.tiers[1]).toContain('src/a.ts');
  });
});

// ---------------------------------------------------------------------------
// buildImportGraph — circular imports
// ---------------------------------------------------------------------------

describe('buildImportGraph — circular imports', () => {
  it('handles a direct circular import without infinite loop', () => {
    // a → b → a (cycle)
    const files = [
      { path: 'src/a.ts', imports: ['src/b.ts'], exports: ['doA'], loc: 5 },
      { path: 'src/b.ts', imports: ['src/a.ts'], exports: ['doB'], loc: 5 },
    ];

    // Should not throw or hang
    expect(() => buildImportGraph(files)).not.toThrow();

    const result = buildImportGraph(files);

    // Both modules must have a finite tier
    expect(typeof result.modules['src/a.ts'].tier).toBe('number');
    expect(typeof result.modules['src/b.ts'].tier).toBe('number');
    expect(isFinite(result.modules['src/a.ts'].tier)).toBe(true);
    expect(isFinite(result.modules['src/b.ts'].tier)).toBe(true);
  });

  it('handles a 3-node cycle without infinite loop', () => {
    const files = [
      { path: 'src/x.ts', imports: ['src/y.ts'], exports: [], loc: 3 },
      { path: 'src/y.ts', imports: ['src/z.ts'], exports: [], loc: 3 },
      { path: 'src/z.ts', imports: ['src/x.ts'], exports: [], loc: 3 },
    ];

    expect(() => buildImportGraph(files)).not.toThrow();

    const result = buildImportGraph(files);

    // All in cycle get tier 0 (cycle detected, returns 0)
    for (const path of ['src/x.ts', 'src/y.ts', 'src/z.ts']) {
      expect(isFinite(result.modules[path].tier)).toBe(true);
    }
  });

  it('preserves import/export data even in circular modules', () => {
    const files = [
      { path: 'src/a.ts', imports: ['src/b.ts'], exports: ['doA'], loc: 5 },
      { path: 'src/b.ts', imports: ['src/a.ts'], exports: ['doB'], loc: 5 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/a.ts'].imports).toEqual(['src/b.ts']);
    expect(result.modules['src/a.ts'].exports).toEqual(['doA']);
    expect(result.modules['src/b.ts'].imports).toEqual(['src/a.ts']);
    expect(result.modules['src/b.ts'].exports).toEqual(['doB']);
  });
});

// ---------------------------------------------------------------------------
// buildImportGraph — output shape
// ---------------------------------------------------------------------------

describe('buildImportGraph — output shape', () => {
  it('includes a generated ISO timestamp', () => {
    const result = buildImportGraph([]);
    expect(typeof result.generated).toBe('string');
    expect(() => new Date(result.generated)).not.toThrow();
  });

  it('preserves loc and exports from FileInfo', () => {
    const files = [
      { path: 'src/mod.ts', imports: [], exports: ['foo', 'bar'], loc: 42 },
    ];

    const result = buildImportGraph(files);

    expect(result.modules['src/mod.ts'].loc).toBe(42);
    expect(result.modules['src/mod.ts'].exports).toEqual(['foo', 'bar']);
  });

  it('returns empty modules and tiers for empty input', () => {
    const result = buildImportGraph([]);
    expect(result.modules).toEqual({});
    expect(result.tiers).toEqual({});
  });
});

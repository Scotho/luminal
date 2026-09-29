/**
 * module-map.ts
 *
 * Analyzes the TypeScript source tree to build an import dependency graph.
 *
 * Usage:
 *   npx tsx admin/scripts/module-map.ts [--file src/player.ts]
 */

import { existsSync } from 'fs';
import { resolve, relative } from 'path';
import ts from 'typescript';
import type { ModuleMap, ModuleInfo } from '../src/types.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Absolute path to the worktree root (two levels up from admin/scripts/). */
const ROOT = (() => {
  const url = new URL('../../', import.meta.url);
  let p = url.pathname;
  // On Windows, strip the leading slash before the drive letter: /C:/... → C:/...
  p = p.replace(/^\/([A-Z]:)/, '$1');
  // Remove trailing slash
  return p.replace(/\/$/, '');
})();

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Pre-parsed information about a single source file. */
export interface FileInfo {
  path: string;      // relative to ROOT, forward slashes
  imports: string[];  // relative paths of imported modules (relative to ROOT)
  exports: string[];  // named export identifiers
  loc: number;        // non-empty, non-comment line count
}

// ---------------------------------------------------------------------------
// Core graph builder (pure function — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Builds a ModuleMap from pre-parsed FileInfo entries.
 *
 * Steps:
 * 1. Initialize all modules
 * 2. Build reverse edges (importedBy)
 * 3. Compute tiers (max import-chain depth from any leaf)
 * 4. Compute blast radius (BFS over importedBy)
 * 5. Group into tier record
 */
export function buildImportGraph(files: FileInfo[]): ModuleMap {
  const modules: Record<string, ModuleInfo> = {};

  // Step 1: Initialize all modules
  for (const file of files) {
    modules[file.path] = {
      tier: 0,
      imports: file.imports,
      importedBy: [],
      blastRadius: 0,
      loc: file.loc,
      exports: file.exports,
    };
  }

  // Step 2: Build reverse edges
  for (const file of files) {
    for (const imp of file.imports) {
      if (modules[imp]) {
        modules[imp].importedBy.push(file.path);
      }
    }
  }

  // Step 3: Compute tiers
  // tier = max depth of import chain from any leaf
  // Leaf modules (no imports) = tier 0
  // Use memoised recursion with a "visiting" set to detect cycles
  const tierCache = new Map<string, number>();

  function computeTier(path: string, visiting: Set<string>): number {
    // Cycle detection: if we're already computing this node, return 0
    if (visiting.has(path)) return 0;

    // Return cached result if available
    const cached = tierCache.get(path);
    if (cached !== undefined) return cached;

    const mod = modules[path];
    if (!mod || mod.imports.length === 0) {
      tierCache.set(path, 0);
      return 0;
    }

    visiting.add(path);

    let maxImportTier = -1;
    for (const imp of mod.imports) {
      if (modules[imp]) {
        const t = computeTier(imp, visiting);
        if (t > maxImportTier) maxImportTier = t;
      }
    }

    visiting.delete(path);

    const tier = maxImportTier < 0 ? 0 : maxImportTier + 1;
    tierCache.set(path, tier);
    return tier;
  }

  for (const file of files) {
    modules[file.path].tier = computeTier(file.path, new Set<string>());
  }

  // Step 4: Compute blast radius (BFS over importedBy graph)
  for (const file of files) {
    const visited = new Set<string>();
    const queue: string[] = [file.path];
    visited.add(file.path);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const mod = modules[current];
      if (!mod) continue;

      for (const dependent of mod.importedBy) {
        if (!visited.has(dependent)) {
          visited.add(dependent);
          queue.push(dependent);
        }
      }
    }

    // Blast radius = number of transitive dependents (exclude the module itself)
    modules[file.path].blastRadius = visited.size - 1;
  }

  // Step 5: Group modules into tiers record
  const tiers: Record<number, string[]> = {};
  for (const file of files) {
    const t = modules[file.path].tier;
    if (!tiers[t]) tiers[t] = [];
    tiers[t].push(file.path);
  }

  return {
    modules,
    tiers,
    generated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// LOC counting
// ---------------------------------------------------------------------------

/**
 * Counts non-empty lines that don't start with //, /*, or *.
 */
function countLoc(sourceText: string): number {
  let count = 0;
  for (const line of sourceText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Import resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a relative import specifier to a project-relative path.
 * Returns null if the import is not relative or cannot be resolved.
 */
function resolveImport(fromFile: string, importSpecifier: string): string | null {
  // Only resolve relative imports
  if (!importSpecifier.startsWith('.')) return null;

  const fromDir = resolve(ROOT, fromFile, '..');
  const resolved = resolve(fromDir, importSpecifier);

  // Try candidates
  const candidates = [
    resolved + '.ts',
    resolved + '/index.ts',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // Convert to ROOT-relative path with forward slashes
      const rel = relative(ROOT, candidate).replace(/\\/g, '/');
      return rel;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// TS compiler-based file analyzer
// ---------------------------------------------------------------------------

/**
 * Uses the TS compiler API to analyze real source files and produce FileInfo[].
 * Optionally filters to a single file path.
 */
function analyzeSourceFiles(filteredFiles: string[], program: ts.Program): FileInfo[] {
  const checker = program.getTypeChecker();
  const result: FileInfo[] = [];

  for (const absPath of filteredFiles) {
    const relPath = relative(ROOT, absPath).replace(/\\/g, '/');
    const sourceFile = program.getSourceFile(absPath);
    if (!sourceFile) continue;

    const imports: string[] = [];
    const exports: string[] = [];
    const loc = countLoc(sourceFile.text);

    // Collect imports
    for (const stmt of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const specifier = stmt.moduleSpecifier.text;
        const resolved = resolveImport(relPath, specifier);
        if (resolved && !imports.includes(resolved)) {
          imports.push(resolved);
        }
      }
    }

    // Collect named exports via type checker
    const sourceSymbol = checker.getSymbolAtLocation(sourceFile);
    if (sourceSymbol) {
      const exportSymbols = checker.getExportsOfModule(sourceSymbol);
      for (const sym of exportSymbols) {
        exports.push(sym.getName());
      }
    }

    result.push({ path: relPath, imports, exports, loc });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Uses the TS compiler API to analyze real files, then calls buildImportGraph.
 * Optionally accepts a single file path to analyze in isolation.
 */
export async function generateModuleMap(singleFile?: string): Promise<ModuleMap> {
  // Read tsconfig.json from ROOT
  const tsconfigPath = resolve(ROOT, 'tsconfig.json');
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(`Failed to read tsconfig.json: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    ROOT,
  );

  // Filter to src/**/*.ts, excluding .test., /e2e/, .d.ts
  const filteredFiles = parsed.fileNames.filter(f => {
    const norm = f.replace(/\\/g, '/');
    if (!norm.includes('/src/')) return false;
    if (norm.endsWith('.d.ts')) return false;
    if (norm.includes('.test.')) return false;
    if (norm.includes('/e2e/')) return false;
    return true;
  });

  // Create TS program
  const program = ts.createProgram(filteredFiles, parsed.options);

  // Analyze files
  const fileInfos = analyzeSourceFiles(filteredFiles, program);

  // Build graph
  const moduleMap = buildImportGraph(fileInfos);

  // If --file flag, filter to single module
  if (singleFile) {
    const normalised = singleFile.replace(/\\/g, '/');
    const info = moduleMap.modules[normalised];
    if (!info) {
      throw new Error(`Module not found in map: ${singleFile}`);
    }
    // Return a minimal map with just that module
    return {
      modules: { [normalised]: info },
      tiers: { [info.tier]: [normalised] },
      generated: moduleMap.generated,
    };
  }

  return moduleMap;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = (() => {
  try {
    const scriptUrl = new URL(import.meta.url);
    let scriptPath = scriptUrl.pathname.replace(/^\/([A-Z]:)/, '$1');
    scriptPath = scriptPath.replace(/\\/g, '/');
    const argv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
    return argv1.endsWith(scriptPath) || argv1.includes('module-map');
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const singleFile = fileIdx !== -1 ? args[fileIdx + 1] : undefined;

  generateModuleMap(singleFile)
    .then(map => {
      process.stdout.write(JSON.stringify(map, null, 2) + '\n');
    })
    .catch(err => {
      console.error('module-map error:', err);
      process.exit(1);
    });
}

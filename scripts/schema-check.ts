// scripts/schema-check.ts
// CLI tool to validate current RTDB emulator data against a schema version.
//
// Usage:
//   npx tsx scripts/schema-check.ts [--version v1.0.8]

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RTDB_URL = 'http://localhost:9000';
const NS = 'luminal-game-default-rtdb';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldDef {
  type?: string;
  values?: (string | number)[];
  min?: number;
  max?: number;
  maxLength?: number;
  required?: boolean;
}

interface NodeDef {
  description?: string;
  type?: string;
  values?: (string | number)[];
  fields?: Record<string, FieldDef>;
  children?: Record<string, NodeDef>;
}

interface RtdbSchema {
  version: string;
  rootPaths: Record<string, NodeDef>;
}

interface Manifest {
  current: string;
}

// ---------------------------------------------------------------------------
// Colored log helpers
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function dim(msg: string): string { return `${c.gray}${msg}${c.reset}`; }
function warn(msg: string): void  { console.log(`  ${c.yellow}!${c.reset} ${msg}`); }

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { version: string | null } {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf('--version');
  const version = vIdx !== -1 ? (args[vIdx + 1] ?? null) : null;
  return { version };
}

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function loadManifest(): Manifest {
  const p = path.join(PROJECT_ROOT, 'data', 'schemas', 'manifest.json');
  return JSON.parse(readFileSync(p, 'utf-8')) as Manifest;
}

function loadSchema(version: string): RtdbSchema {
  const p = path.join(PROJECT_ROOT, 'data', 'schemas', version, 'rtdb-schema.json');
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as RtdbSchema;
  } catch {
    console.error(`${c.red}Cannot load schema at ${p}${c.reset}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// RTDB fetch
// ---------------------------------------------------------------------------

async function fetchPath(rtdbPath: string): Promise<unknown> {
  const url = `${RTDB_URL}/${rtdbPath}.json?ns=${NS}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json() as unknown;
  } catch (err) {
    console.error(`${c.red}Failed to fetch ${url}: ${String(err)}${c.reset}`);
    console.error(`${c.red}Ensure the RTDB emulator is running on port 9000.${c.reset}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

function validateField(
  fieldPath: string,
  value: unknown,
  def: FieldDef,
  errors: string[],
): void {
  if (value === undefined || value === null) {
    if (def.required) {
      errors.push(`${fieldPath}: required field is missing`);
    }
    return;
  }

  const baseType = def.type?.replace('[]', '');

  if (def.type?.endsWith('[]')) {
    // Array-like: stored as object map or actual array
    const entries = Array.isArray(value)
      ? value
      : Object.values(value as Record<string, unknown>);

    if (def.maxLength !== undefined && entries.length > def.maxLength) {
      errors.push(
        `${fieldPath}: length ${entries.length} exceeds maxLength ${def.maxLength}`,
      );
    }
    for (const entry of entries) {
      if (baseType === 'string' && typeof entry !== 'string') {
        errors.push(`${fieldPath}[]: expected string, got ${typeof entry}`);
      } else if (baseType === 'number' && typeof entry !== 'number') {
        errors.push(`${fieldPath}[]: expected number, got ${typeof entry}`);
      }
    }
    return;
  }

  if (def.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${fieldPath}: expected boolean, got ${typeof value}`);
    return;
  }

  if (def.type === 'number') {
    if (typeof value !== 'number') {
      errors.push(`${fieldPath}: expected number, got ${typeof value}`);
      return;
    }
    if (def.min !== undefined && value < def.min) {
      errors.push(`${fieldPath}: ${value} below min ${def.min}`);
    }
    if (def.max !== undefined && value > def.max) {
      errors.push(`${fieldPath}: ${value} above max ${def.max}`);
    }
    if (def.values !== undefined && !def.values.includes(value)) {
      errors.push(
        `${fieldPath}: ${value} not in allowed values [${def.values.join(', ')}]`,
      );
    }
    return;
  }

  if (def.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${fieldPath}: expected string, got ${typeof value}`);
      return;
    }
    if (def.values !== undefined && !def.values.includes(value)) {
      errors.push(
        `${fieldPath}: "${value}" not in allowed values [${def.values.join(', ')}]`,
      );
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Node validation
// ---------------------------------------------------------------------------

function validateFields(
  basePath: string,
  data: Record<string, unknown>,
  fields: Record<string, FieldDef>,
  errors: string[],
): void {
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    const value = data[fieldName];
    validateField(`${basePath}.${fieldName}`, value, fieldDef, errors);
  }
}

function validateNode(
  entryPath: string,
  data: unknown,
  nodeDef: NodeDef,
  errors: string[],
): void {
  if (data === null || data === undefined || typeof data !== 'object') {
    return;
  }
  const dataObj = data as Record<string, unknown>;

  if (nodeDef.fields) {
    validateFields(entryPath, dataObj, nodeDef.fields, errors);
  }

  if (nodeDef.children) {
    for (const [childKey, childDef] of Object.entries(nodeDef.children)) {
      // Skip children with no fields and no children (description-only nodes)
      if (!childDef.fields && !childDef.children) continue;

      if (childKey.includes('{')) {
        // Dynamic key — iterate all present children
        for (const [dynKey, dynValue] of Object.entries(dataObj)) {
          validateNode(`${entryPath}/${dynKey}`, dynValue, childDef, errors);
        }
      } else {
        // Static key
        if (childKey in dataObj) {
          validateNode(`${entryPath}/${childKey}`, dataObj[childKey], childDef, errors);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Root-path validation
// ---------------------------------------------------------------------------

async function validateRootPath(
  pathPattern: string,
  nodeDef: NodeDef,
  errors: string[],
): Promise<{ rootKey: string; entryCount: number }> {
  // Extract root key (first segment)
  const rootKey = pathPattern.split('/')[0];
  const data = await fetchPath(rootKey);

  if (data === null || data === undefined) {
    return { rootKey, entryCount: 0 };
  }

  const dataObj = data as Record<string, unknown>;
  const entries = Object.entries(dataObj);
  const entryCount = entries.length;

  const isDynamic = pathPattern.includes('{');

  if (isDynamic) {
    // e.g. "matches/{matchId}" — iterate each top-level entry
    for (const [entryId, entryData] of entries) {
      validateNode(`${rootKey}/${entryId}`, entryData, nodeDef, errors);
    }
  } else {
    // e.g. "globalStats" — validate the root object itself
    validateNode(rootKey, data, nodeDef, errors);
  }

  return { rootKey, entryCount };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { version: versionArg } = parseArgs();

  const manifest = loadManifest();
  const version = versionArg ?? manifest.current;

  const schema = loadSchema(version);

  console.log(`\n${c.bold}Validating against schema ${c.cyan}${version}${c.reset}${c.bold}...${c.reset}\n`);

  const errors: string[] = [];
  // Track printed root keys to avoid duplicates (multiple patterns share the same root)
  const seenRoots = new Map<string, number>();

  for (const [pathPattern, nodeDef] of Object.entries(schema.rootPaths)) {
    const rootKey = pathPattern.split('/')[0];

    if (seenRoots.has(rootKey)) {
      // Already validated this root; skip silently
      continue;
    }

    const pathErrors: string[] = [];
    const { entryCount } = await validateRootPath(pathPattern, nodeDef, pathErrors);

    seenRoots.set(rootKey, entryCount);
    errors.push(...pathErrors);

    const countLabel =
      entryCount === 0
        ? `${dim('0 entries')} ${c.gray}(OK)${c.reset}`
        : `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`;

    console.log(`  ${c.cyan}${rootKey}${c.reset}: ${countLabel}`);

    for (const e of pathErrors) {
      warn(e);
    }
  }

  console.log('');

  if (errors.length === 0) {
    console.log(`${c.green}${c.bold}PASS${c.reset}: 0 validation error(s)\n`);
    process.exit(0);
  } else {
    console.log(`${c.red}${c.bold}FAIL${c.reset}: ${errors.length} validation error(s)\n`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(`${c.red}Unexpected error: ${String(err)}${c.reset}`);
  process.exit(1);
});

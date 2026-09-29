import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'data');
const SPECS_DIR = join(__dirname, '..', '..', 'docs', 'superpowers', 'specs');

function readJson<T>(name: string): T {
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) return ([] as unknown) as T;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(name: string, data: unknown): void {
  writeFileSync(join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

// ── 1. Migrate tasks ──────────────────────────────────

interface Task {
  id: string;
  ref?: string;
  refs?: string[];
  tag: string;
  prompt: string;
  source: string;
  status: 'pending' | 'done';
  priority: number;
  created: string;
  modified?: string;
  completed?: string;
  parentId?: string;
  children?: string[];
}

const tasks: Task[] = readJson<Task[]>('tasks.json');
tasks.sort((a, b) => a.created.localeCompare(b.created));

let taskCounter = 1;
let qaCounter = 1;
const taskRefMap = new Map<string, string>(); // old id → ref

for (const task of tasks) {
  if (task.tag === 'test-coverage') {
    task.ref = `QA-${qaCounter++}`;
  } else {
    task.ref = `TASK-${taskCounter++}`;
  }
  taskRefMap.set(task.id, task.ref);
}

writeJson('tasks.json', tasks);
console.log(`Migrated ${taskCounter - 1} tasks (TASK-1..TASK-${taskCounter - 1})`);
console.log(`Migrated ${qaCounter - 1} QA items (QA-1..QA-${qaCounter - 1})`);

// ── 2. Migrate specs ──────────────────────────────────

if (existsSync(SPECS_DIR)) {
  const specFiles = readdirSync(SPECS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('SPEC-'))
    .sort();

  let specCounter = 1;

  for (const file of specFiles) {
    const ref = `SPEC-${specCounter++}`;
    // Strip date prefix: 2026-04-03-chassis-menu-wrapper-design.md → chassis-menu-wrapper-design.md
    const nameWithoutDate = file.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const newName = `${ref}-${nameWithoutDate}`;
    const oldPath = join(SPECS_DIR, file);
    const newPath = join(SPECS_DIR, newName);
    renameSync(oldPath, newPath);
  }

  console.log(`Migrated ${specCounter - 1} specs (SPEC-1..SPEC-${specCounter - 1})`);

  // Write spec counter
  const counters = {
    TASK: taskCounter,
    BUG: 1,
    QA: qaCounter,
    SPEC: specCounter,
  };
  writeJson('counters.json', counters);
  console.log(`Initialized counters: ${JSON.stringify(counters)}`);
} else {
  console.log('Specs directory not found, skipping spec migration');
  writeJson('counters.json', { TASK: taskCounter, BUG: 1, QA: qaCounter, SPEC: 1 });
}

// ── 3. Migrate sessions ──────────────────────────────

interface Session {
  id: string;
  summary: string;
  refs?: string[];
  taskIds?: string[];
  notes: { ts: string; text: string }[];
  [key: string]: unknown;
}

const sessions: Session[] = readJson<Session[]>('sessions.json');
let matched = 0;

for (const session of sessions) {
  // Convert old taskIds to refs
  if (session.taskIds && session.taskIds.length > 0) {
    const resolvedRefs = session.taskIds
      .map(id => taskRefMap.get(id))
      .filter((r): r is string => r != null);
    if (resolvedRefs.length > 0) {
      session.refs = resolvedRefs;
      // Prefix summary if not already
      if (!/^(TASK|BUG|QA|SPEC)-\d+/.test(session.summary)) {
        session.summary = `${resolvedRefs[0]}: ${session.summary}`;
      }
      matched++;
    } else {
      session.refs = [];
    }
    delete session.taskIds;
    continue;
  }

  // Try to match by keyword overlap between summary and task prompts
  if (!session.refs || session.refs.length === 0) {
    const summaryLower = session.summary.toLowerCase();
    const matchedRefs: string[] = [];

    for (const task of tasks) {
      const promptWords = task.prompt.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const matchCount = promptWords.filter(w => summaryLower.includes(w)).length;
      if (matchCount >= 3 && task.ref) {
        matchedRefs.push(task.ref);
      }
    }

    if (matchedRefs.length > 0) {
      session.refs = matchedRefs;
      if (!/^(TASK|BUG|QA|SPEC)-\d+/.test(session.summary)) {
        session.summary = `${matchedRefs[0]}: ${session.summary}`;
      }
      matched++;
    } else {
      session.refs = [];
    }
  }

  // Clean up any remaining taskIds
  delete session.taskIds;
}

writeJson('sessions.json', sessions);
console.log(`Matched ${matched}/${sessions.length} sessions to task refs`);

console.log('\nMigration complete.');

import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (f.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk('src');
const asAnyRe = /\bas\s+any\b/g;
const nonTest = [];
const test = [];

const isTest = (f) => {
  const n = f.replace(/\\/g, '/');
  return /\.test\.ts$/.test(n) || /\/__tests__\//.test(n) || /\/e2e\//.test(n);
};

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.match(asAnyRe) || [];
  if (!matches.length) continue;
  const key = f.replace(/\\/g, '/');
  (isTest(f) ? test : nonTest).push({ file: key, count: matches.length });
}

nonTest.sort((a, b) => b.count - a.count);
test.sort((a, b) => b.count - a.count);

console.log('=== NON-TEST as any ===');
for (const r of nonTest) console.log('  ' + r.count + ' ' + r.file);
console.log('TOTAL NON-TEST:', nonTest.reduce((a, b) => a + b.count, 0), 'in', nonTest.length, 'files');
console.log();
console.log('=== TEST as any (top 10) ===');
for (const r of test.slice(0, 10)) console.log('  ' + r.count + ' ' + r.file);
console.log('TOTAL TEST:', test.reduce((a, b) => a + b.count, 0), 'in', test.length, 'files');

// File sizes
console.log('\n=== Files >500 LOC (src only, excluding test) ===');
const sized = files.map(f => {
  const lines = fs.readFileSync(f, 'utf8').split('\n').length;
  return { file: f.replace(/\\/g, '/'), lines };
}).filter(r => r.lines > 500 && !isTest(r.file));
sized.sort((a, b) => b.lines - a.lines);
for (const r of sized) {
  const tag = r.lines > 800 ? ' [CRITICAL]' : '';
  console.log('  ' + r.lines + ' ' + r.file + tag);
}

// Function length audit - naive but useful
console.log('\n=== Functions >80 lines (approximate, src only) ===');
const longFns = [];
for (const f of files) {
  if (isTest(f)) continue;
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  // Match function declarations / methods / arrow functions with braces
  const fnRe = /^(\s*)(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:private|public|protected|static)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]*)?)\s*\{/gm;
  // Simpler: find lines with `function X(` or `X() {` then count braces
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\s*)(?:export\s+)?(?:async\s+)?(function\s+(\w+)|(?:private\s+|public\s+|protected\s+|static\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{)/);
    if (!m) continue;
    const name = m[3] || m[4];
    if (!name || ['if', 'for', 'while', 'switch', 'catch', 'else', 'return', 'const', 'let', 'var'].includes(name)) continue;
    // Count braces from this line
    let depth = 0;
    let started = false;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      for (const c of l) {
        if (c === '{') { depth++; started = true; }
        else if (c === '}') { depth--; }
      }
      if (started && depth === 0) { end = j; break; }
    }
    const len = end - i + 1;
    if (len > 80) {
      longFns.push({ file: f.replace(/\\/g, '/'), line: i + 1, name, length: len });
    }
  }
}
longFns.sort((a, b) => b.length - a.length);
for (const fn of longFns) {
  console.log('  ' + fn.length + 'L ' + fn.file + ':' + fn.line + ' ' + fn.name);
}
console.log('TOTAL LONG FUNCTIONS:', longFns.length);

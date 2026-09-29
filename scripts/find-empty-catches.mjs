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

// True empty catches - matches balanced braces accurately
function findEmpty(content) {
  const out = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    // Walk to find matching brace
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < content.length && depth > 0) {
      const c = content[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    const body = content.slice(start, i);
    // Truly empty: only whitespace
    const stripped = body.replace(/\s+/g, '');
    const commentOnly = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
    if (stripped === '') {
      out.push({ line: content.slice(0, m.index).split('\n').length, kind: 'empty' });
    } else if (commentOnly === '') {
      out.push({ line: content.slice(0, m.index).split('\n').length, kind: 'comment-only' });
    }
  }
  return out;
}

const files = walk('src');
const results = [];
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const hits = findEmpty(content);
  for (const h of hits) {
    results.push({ file: f.replace(/\\/g, '/'), ...h });
  }
}

const empty = results.filter(r => r.kind === 'empty');
const commentOnly = results.filter(r => r.kind === 'comment-only');
console.log('EMPTY CATCHES:', empty.length);
for (const e of empty) console.log(' ', e.file + ':' + e.line);
console.log('COMMENT-ONLY CATCHES:', commentOnly.length);
for (const e of commentOnly) console.log(' ', e.file + ':' + e.line);

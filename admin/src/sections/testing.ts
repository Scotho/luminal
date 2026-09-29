// ── Testing Ground Section ────────────────────────────────────────────────────
// Shows active test environments, WIP test files, and quick-run buttons.

import { icon } from '../ui/icons';
import { escapeHtml } from '../ui/render';
import { TEST_CATALOG, CONFIG_LABELS, type TestSuite } from './testRunnerHelpers';

interface TestEnv { name: string; config: string; description: string; paths: string[] }
interface WipFile { path: string; mtime: string }

const TEST_ENVIRONMENTS: TestEnv[] = [
  { name: 'Unit (Vitest)', config: 'unit', description: 'Core simulation, networking, audio, UI, game systems', paths: ['src/core/*.test.ts', 'src/net/*.test.ts', 'src/ui/__tests__/*.test.ts'] },
  { name: 'E2E Headless', config: 'e2e', description: 'Bot-driven headless scenarios with loopback transport', paths: ['src/e2e/__tests__/*.test.ts'] },
  { name: 'Browser (Playwright)', config: 'browser', description: 'UI overlay containment, layout validation across viewports', paths: ['src/e2e/browser/*.test.ts'] },
  { name: 'Online Emulator', config: 'online', description: 'Two-browser lobby, disconnect, vehicle/map selection via Firebase emulators', paths: ['src/e2e/browser/online-emulator/*.test.ts'] },
  { name: 'Smoke Tests', config: 'smoke', description: 'Critical-path smoke runs — lobby match, wall death, AI victory, friend flows', paths: ['src/e2e/browser/online-smoke/*.test.ts'] },
  { name: 'Admin Panel', config: 'admin', description: 'Dashboard sections, middleware, UI components, API routes', paths: ['admin/src/__tests__/*.test.ts'] },
  { name: 'Relay Server', config: 'relay', description: 'Auth, rate limiting, room management for the relay server', paths: ['relay/src/*.test.ts'] },
];

let _container: HTMLElement | null = null;
let _wipFiles: WipFile[] = [];
let _runningConfig: string | null = null;

// ── Render ────────────────────────────────────────────────────────────────────

export function renderTesting(container: HTMLElement): void {
  _container = container;
  container.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = 'Testing Ground';
  container.appendChild(h2);
  void loadWipFiles().then(() => renderContent());
}

function renderContent(): void {
  if (!_container) return;
  _container.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = 'Testing Ground';
  _container.appendChild(h2);

  appendSection(_container, 'Test Environments', renderEnvironments());
  appendSection(_container, 'WIP Test Files', renderWipFiles());
  appendSection(_container, 'Test Catalog', renderCatalog());
}

function appendSection(parent: HTMLElement, title: string, content: HTMLElement): void {
  const wrap = mk('div', 'margin-bottom:20px;');
  const h = mk('h3', 'font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-dim);margin:0 0 10px 0;');
  h.textContent = title;
  wrap.appendChild(h);
  wrap.appendChild(content);
  parent.appendChild(wrap);
}

function renderEnvironments(): HTMLElement {
  const grid = mk('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;');
  for (const env of TEST_ENVIRONMENTS) {
    const card = mk('div', 'background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md, 8px);padding:14px 16px;transition:border-color 0.15s;');
    card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--accent)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--border)'; });

    const row = mk('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;');
    const left = mk('div', 'display:flex;align-items:center;gap:8px;');
    const badge = mk('span', 'display:inline-block;background:var(--accent-dim, rgba(99,102,241,0.15));color:var(--accent);font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:2px 8px;border-radius:10px;font-family:var(--font-mono);');
    badge.textContent = CONFIG_LABELS[env.config] ?? env.config;
    const name = mk('span', 'font-weight:600;font-size:13px;color:var(--text);');
    name.textContent = env.name;
    left.append(badge, name);
    row.appendChild(left);

    const runBtn = mk('button', 'display:flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--accent);border-radius:var(--r-sm, 4px);color:var(--accent);cursor:pointer;font-size:10px;font-weight:600;padding:4px 10px;transition:all 0.15s;font-family:var(--font-display);letter-spacing:0.5px;');
    runBtn.innerHTML = `${icon('play', 11)} Run`;
    runBtn.addEventListener('mouseenter', () => { runBtn.style.background = 'var(--accent)'; runBtn.style.color = 'var(--bg, #000)'; });
    runBtn.addEventListener('mouseleave', () => { runBtn.style.background = 'transparent'; runBtn.style.color = 'var(--accent)'; });
    runBtn.addEventListener('click', () => void runTests(env.config, runBtn));
    row.appendChild(runBtn);
    card.appendChild(row);

    const desc = mk('div', 'font-size:11px;color:var(--text-dim);margin-bottom:8px;line-height:1.4;');
    desc.textContent = env.description;
    card.appendChild(desc);

    const paths = mk('div', 'font-size:10px;color:var(--text-quiet);font-family:var(--font-mono);');
    paths.textContent = env.paths.join(', ');
    card.appendChild(paths);
    grid.appendChild(card);
  }
  return grid;
}

function renderWipFiles(): HTMLElement {
  const wrap = mk('div', '');
  if (_wipFiles.length === 0) {
    const empty = mk('div', 'color:var(--text-dim);font-size:12px;padding:12px 0;');
    empty.textContent = 'No recently modified test files found.';
    wrap.appendChild(empty);
    wrap.appendChild(makeActionBtn('Scan for WIP files', 'refresh-cw', async () => { await loadWipFiles(); renderContent(); }));
    return wrap;
  }

  const list = mk('div', 'display:flex;flex-direction:column;gap:4px;');
  for (const file of _wipFiles) {
    const row = mk('div', 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-radius:var(--r-sm, 4px);transition:background 0.1s;');
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

    const pathEl = mk('span', 'font-family:var(--font-mono);font-size:11px;');
    pathEl.textContent = file.path;
    const meta = mk('span', 'color:var(--text-dim);font-size:10px;');
    meta.textContent = file.mtime;
    const viewBtn = makeActionBtn('View', 'eye', () => {
      document.dispatchEvent(new CustomEvent('file-browser:attach', { detail: { path: file.path, name: file.path.split('/').pop() } }));
    });
    viewBtn.style.fontSize = '10px';
    viewBtn.style.padding = '2px 6px';
    row.append(pathEl, meta, viewBtn);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  wrap.appendChild(makeActionBtn('Refresh', 'refresh-cw', async () => { await loadWipFiles(); renderContent(); }));
  return wrap;
}

function renderCatalog(): HTMLElement {
  const wrap = mk('div', '');
  const groups = new Map<string, TestSuite[]>();
  for (const s of TEST_CATALOG) { const g = groups.get(s.group) ?? []; g.push(s); groups.set(s.group, g); }

  for (const [group, suites] of groups) {
    const gEl = mk('div', 'margin-bottom:12px;');
    const gHead = mk('div', 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:6px;padding:4px 0;border-bottom:1px solid var(--border);');
    gHead.textContent = group;
    gEl.appendChild(gHead);

    const row = mk('div', 'display:flex;flex-wrap:wrap;gap:6px;');
    for (const suite of suites) {
      const chip = mk('button', 'display:inline-flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm, 4px);color:var(--text);cursor:pointer;font-size:11px;padding:4px 10px;transition:all 0.15s;font-family:var(--font-display);');
      chip.title = `${suite.description}\n${suite.file}`;
      chip.innerHTML = `${icon('play', 10)} ${escapeHtml(suite.name)}`;
      chip.addEventListener('mouseenter', () => { chip.style.borderColor = 'var(--accent)'; chip.style.background = 'var(--accent-dim, rgba(99,102,241,0.12))'; });
      chip.addEventListener('mouseleave', () => { chip.style.borderColor = 'var(--border)'; chip.style.background = 'var(--surface)'; });
      chip.addEventListener('click', () => void runTests(suite.config, chip));
      row.appendChild(chip);
    }
    gEl.appendChild(row);
    wrap.appendChild(gEl);
  }
  return wrap;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function runTests(config: string, btn: HTMLElement): Promise<void> {
  if (_runningConfig) return;
  _runningConfig = config;
  const origHtml = btn.innerHTML;
  btn.innerHTML = `${icon('loader', 11)} Running...`;
  btn.style.opacity = '0.6';
  btn.style.pointerEvents = 'none';

  try {
    const res = await fetch(`/__admin_exec/test?config=${encodeURIComponent(config)}`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = await res.json() as { ok: boolean; agentId: string };
    const es = new EventSource('/__admin_exec/stream?agent=' + encodeURIComponent(body.agentId));
    let passed = 0, failed = 0;

    es.addEventListener('stdout', (ev: MessageEvent) => {
      let line: string;
      try { line = (JSON.parse((ev as MessageEvent<string>).data) as { line: string }).line; }
      catch { line = (ev as MessageEvent<string>).data; }
      if (line.includes('\u2713') || line.includes('PASS')) passed++;
      if (line.includes('\u2717') || line.includes('FAIL')) failed++;
      btn.innerHTML = `${icon('loader', 11)} ${passed}P / ${failed}F`;
    });
    es.addEventListener('exit', () => {
      es.close();
      _runningConfig = null;
      const color = failed > 0 ? 'var(--red)' : 'var(--green)';
      btn.innerHTML = `<span style="color:${color}">${failed > 0 ? '\u2717' : '\u2713'} ${passed}P / ${failed}F</span>`;
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
      setTimeout(() => { btn.innerHTML = origHtml; }, 5000);
    });
    es.addEventListener('error', () => { es.close(); resetBtn(btn, origHtml); });
  } catch (err) {
    resetBtn(btn, origHtml);
    alert(`Failed to start tests: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function resetBtn(btn: HTMLElement, html: string): void {
  _runningConfig = null;
  btn.innerHTML = html;
  btn.style.opacity = '1';
  btn.style.pointerEvents = '';
}

async function loadWipFiles(): Promise<void> {
  try {
    const res = await fetch('/__admin_exec/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'git', args: ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD~20', '--', '*.test.ts'] }),
    });
    if (!res.ok) { _wipFiles = []; return; }
    const body = await res.json() as { ok: boolean; agentId: string };
    const lines = await collectStream(body.agentId);
    _wipFiles = lines.filter(l => l.trim().endsWith('.test.ts')).slice(0, 25).map(p => ({ path: p.trim(), mtime: 'recent' }));
  } catch { _wipFiles = []; }
}

function collectStream(agentId: string): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const es = new EventSource('/__admin_exec/stream?agent=' + encodeURIComponent(agentId));
    es.addEventListener('stdout', (ev: MessageEvent) => {
      try { lines.push((JSON.parse((ev as MessageEvent<string>).data) as { line: string }).line); }
      catch { lines.push((ev as MessageEvent<string>).data); }
    });
    es.addEventListener('exit', () => { es.close(); resolve(lines); });
    es.addEventListener('error', () => { es.close(); resolve(lines); });
    setTimeout(() => { es.close(); resolve(lines); }, 10_000);
  });
}

// ── Helpers ──────────────────────────────────────────��────────────────────────

function mk(tag: string, style: string): HTMLElement {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  return e;
}

function makeActionBtn(label: string, iconName: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.innerHTML = `${icon(iconName, 11)} ${escapeHtml(label)}`;
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--border);border-radius:var(--r-sm, 4px);color:var(--text);cursor:pointer;font-size:11px;padding:4px 10px;transition:border-color 0.15s,background 0.15s;';
  btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--accent)'; btn.style.background = 'var(--surface)'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border)'; btn.style.background = 'transparent'; });
  btn.addEventListener('click', () => void onClick());
  return btn;
}

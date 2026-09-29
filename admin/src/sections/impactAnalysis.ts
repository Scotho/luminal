// ── Change Impact Analysis ───────────────────────────────────────────────────
// Visualises module dependency graph from admin/data/module-map.json.

import { icon } from '../ui/icons';
import { escapeHtml } from '../ui/render';
import type { ModuleMap, ModuleInfo } from '../types';

let _moduleMap: ModuleMap | null = null;
let _container: HTMLElement | null = null;
let _selectedModule: string | null = null;
let _abortController: AbortController | null = null;

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadModuleMap(): Promise<ModuleMap | null> {
  try {
    const res = await fetch('/data/module-map.json');
    if (!res.ok) return null;
    return (await res.json()) as ModuleMap;
  } catch { return null; }
}

// ── BFS Transitive Dependents ────────────────────────────────────────────────

function transitiveDepBFS(
  startModule: string,
  modules: Record<string, ModuleInfo>,
): string[] {
  const visited = new Set<string>();
  const queue = [startModule];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const info = modules[current];
    if (!info) continue;
    for (const dep of info.importedBy) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...visited];
}

// ── Fuzzy Search ─────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  // simple subsequence match
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 100;
  if (t.includes(q)) return 50 + (q.length / t.length) * 30;
  return q.length;
}

// ── Impact Score ─────────────────────────────────────────────────────────────

function impactColor(blastRadius: number): string {
  if (blastRadius > 30) return 'var(--red-bright, #d45234)';
  if (blastRadius > 10) return 'var(--orange, #e8a832)';
  return 'var(--green, #3ddc84)';
}

function impactLabel(blastRadius: number): string {
  if (blastRadius > 30) return 'HIGH';
  if (blastRadius > 10) return 'MEDIUM';
  return 'LOW';
}

// ── Render Helpers ───────────────────────────────────────────────────────────

function fileLink(path: string): string {
  return `<a href="#" class="impact-file-link" data-module="${escapeHtml(path)}" style="color:var(--accent); text-decoration:none; font-family:var(--font-mono); font-size:12px; cursor:pointer;">${escapeHtml(path)}</a>`;
}

function badge(text: string, bg: string): string {
  return `<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; letter-spacing:0.5px; background:${bg}; color:#000;">${escapeHtml(text)}</span>`;
}

function card(title: string, content: string): string {
  return `<div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md, 8px); padding:14px 16px; margin-bottom:12px;">
    <div style="font-family:var(--font-display); font-size:10px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--text-dim); margin-bottom:8px;">${title}</div>
    ${content}
  </div>`;
}

// ── Autocomplete Dropdown ────────────────────────────────────────────────────

function renderAutocomplete(
  input: HTMLInputElement,
  dropdown: HTMLElement,
  modules: Record<string, ModuleInfo>,
): void {
  const query = input.value.trim();
  if (!query) { dropdown.style.display = 'none'; return; }

  const keys = Object.keys(modules);
  const matches = keys
    .filter(k => fuzzyMatch(query, k))
    .sort((a, b) => fuzzyScore(query, b) - fuzzyScore(query, a))
    .slice(0, 15);

  if (matches.length === 0) { dropdown.style.display = 'none'; return; }

  dropdown.innerHTML = matches.map(m => {
    const info = modules[m];
    const color = impactColor(info.blastRadius);
    return `<div class="impact-ac-item" data-module="${escapeHtml(m)}" style="padding:6px 12px; cursor:pointer; display:flex; align-items:center; gap:8px; font-family:var(--font-mono); font-size:12px; border-bottom:1px solid var(--border);">
      <span style="width:8px; height:8px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
      <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(m)}</span>
      <span style="color:var(--text-dim); font-size:10px;">T${info.tier}</span>
    </div>`;
  }).join('');
  dropdown.style.display = 'block';
}

// ── Module Detail ────────────────────────────────────────────────────────────

function renderModuleDetail(
  resultsEl: HTMLElement,
  modulePath: string,
  modules: Record<string, ModuleInfo>,
): void {
  const info = modules[modulePath];
  if (!info) {
    resultsEl.innerHTML = `<p style="color:var(--text-dim);">Module not found: ${escapeHtml(modulePath)}</p>`;
    return;
  }

  _selectedModule = modulePath;
  const color = impactColor(info.blastRadius);
  const label = impactLabel(info.blastRadius);

  // File info card
  const infoCard = card('File Info', `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px;">
      <div><span style="color:var(--text-dim); font-size:11px;">Path</span><br><span style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(modulePath)}</span></div>
      <div><span style="color:var(--text-dim); font-size:11px;">Tier</span><br><span style="font-size:18px; font-weight:700;">${info.tier}</span></div>
      <div><span style="color:var(--text-dim); font-size:11px;">LOC</span><br><span style="font-size:18px; font-weight:700;">${info.loc}</span></div>
      <div><span style="color:var(--text-dim); font-size:11px;">Exports</span><br><span style="font-size:18px; font-weight:700;">${info.exports.length}</span></div>
      <div><span style="color:var(--text-dim); font-size:11px;">Blast Radius</span><br><span style="font-size:18px; font-weight:700; color:${color};">${info.blastRadius}</span> ${badge(label, color)}</div>
    </div>
  `);

  // Direct imports
  const importsHtml = info.imports.length > 0
    ? info.imports.map(i => `<div style="padding:3px 0;">${fileLink(i)}</div>`).join('')
    : '<span style="color:var(--text-dim); font-size:12px;">None</span>';
  const importsCard = card(`Direct Imports (${info.imports.length})`, importsHtml);

  // Direct dependents sorted by blast radius
  const directDeps = [...info.importedBy]
    .map(d => ({ path: d, info: modules[d] }))
    .filter(d => d.info)
    .sort((a, b) => b.info.blastRadius - a.info.blastRadius);
  const depsHtml = directDeps.length > 0
    ? directDeps.map(d => {
      const dc = impactColor(d.info.blastRadius);
      return `<div style="padding:3px 0; display:flex; align-items:center; gap:8px;">
        ${fileLink(d.path)}
        <span style="color:${dc}; font-size:10px; font-weight:700;">BR:${d.info.blastRadius}</span>
      </div>`;
    }).join('')
    : '<span style="color:var(--text-dim); font-size:12px;">None — leaf module</span>';
  const depsCard = card(`Direct Dependents (${directDeps.length})`, depsHtml);

  // Transitive dependents
  const transitive = transitiveDepBFS(modulePath, modules);
  const transitiveHtml = transitive.length > 0
    ? `<div style="font-size:12px; color:var(--text-dim); margin-bottom:6px;">${transitive.length} module${transitive.length === 1 ? '' : 's'} affected downstream</div>`
      + transitive.slice(0, 50).map(t => `<div style="padding:2px 0;">${fileLink(t)}</div>`).join('')
      + (transitive.length > 50 ? `<div style="color:var(--text-dim); font-size:11px; margin-top:4px;">...and ${transitive.length - 50} more</div>` : '')
    : '<span style="color:var(--text-dim); font-size:12px;">No transitive dependents</span>';
  const transitiveCard = card(`Transitive Dependents (${transitive.length})`, transitiveHtml);

  // Test coverage — find test files in dependency chain
  const allDeps = new Set([modulePath, ...transitive]);
  const testFiles = [...allDeps].filter(d => d.includes('.test.') || d.includes('.spec.'));
  // Also check if any module has a corresponding test file
  const relatedTests: string[] = [];
  for (const dep of allDeps) {
    const testVariants = [
      dep.replace(/\.ts$/, '.test.ts'),
      dep.replace(/\.ts$/, '.spec.ts'),
      dep.replace(/\/([^/]+)\.ts$/, '/__tests__/$1.test.ts'),
    ];
    for (const tv of testVariants) {
      if (modules[tv] && !testFiles.includes(tv) && !relatedTests.includes(tv)) {
        relatedTests.push(tv);
      }
    }
  }
  const allTests = [...testFiles, ...relatedTests];
  const testHtml = allTests.length > 0
    ? allTests.map(t => `<div style="padding:2px 0;">${fileLink(t)}</div>`).join('')
    : '<span style="color:var(--text-dim); font-size:12px;">No test files found in dependency chain</span>';
  const testCard = card(`Test Coverage (${allTests.length} files)`, testHtml);

  // Exports list
  const exportsHtml = info.exports.length > 0
    ? `<div style="display:flex; flex-wrap:wrap; gap:4px;">${info.exports.map(e =>
      `<code style="font-family:var(--font-mono); font-size:11px; background:var(--border); padding:2px 6px; border-radius:4px;">${escapeHtml(e)}</code>`
    ).join('')}</div>`
    : '<span style="color:var(--text-dim); font-size:12px;">No exports</span>';
  const exportsCard = card(`Exports (${info.exports.length})`, exportsHtml);

  resultsEl.innerHTML = infoCard + importsCard + depsCard + transitiveCard + testCard + exportsCard;

  // Wire clickable file links
  resultsEl.querySelectorAll<HTMLElement>('.impact-file-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const mod = link.dataset.module;
      if (mod && modules[mod]) {
        const input = _container?.querySelector<HTMLInputElement>('#impact-search');
        if (input) input.value = mod;
        renderModuleDetail(resultsEl, mod, modules);
      }
    });
  });
}

// ── Summary Stats ────────────────────────────────────────────────────────────

function renderSummary(modules: Record<string, ModuleInfo>, generated: string): string {
  const keys = Object.keys(modules);
  const total = keys.length;
  const high = keys.filter(k => modules[k].blastRadius > 30).length;
  const medium = keys.filter(k => modules[k].blastRadius > 10 && modules[k].blastRadius <= 30).length;
  const low = keys.filter(k => modules[k].blastRadius <= 10).length;
  const totalLoc = keys.reduce((sum, k) => sum + modules[k].loc, 0);

  return `<div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; font-size:12px; color:var(--text-dim);">
    <span>${total} modules</span>
    <span>${totalLoc.toLocaleString()} LOC</span>
    <span style="color:var(--red-bright, #d45234);">${high} high risk</span>
    <span style="color:var(--orange, #e8a832);">${medium} medium</span>
    <span style="color:var(--green, #3ddc84);">${low} low</span>
    <span>Generated: ${escapeHtml(generated)}</span>
  </div>`;
}

// ── Main Render ──────────────────────────────────────────────────────────────

export async function renderImpactAnalysis(container: HTMLElement): Promise<void> {
  // Clean up previous listeners to avoid stacking
  _abortController?.abort();
  _abortController = new AbortController();
  const { signal } = _abortController;

  _container = container;
  _moduleMap = await loadModuleMap();

  if (!_moduleMap) {
    container.innerHTML = `<h2>${icon('git-branch', 18)} Change Impact Analysis</h2>
      <p style="color:var(--text-dim); margin-top:12px;">Module map not found. Run: <code style="font-family:var(--font-mono); background:var(--surface); padding:2px 6px; border-radius:4px;">npx tsx admin/scripts/module-map.ts</code></p>`;
    return;
  }

  const modules = _moduleMap.modules;

  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
      <h2 style="margin:0;">${icon('git-branch', 18)} Change Impact Analysis</h2>
      <button id="impact-refresh" style="background:none; border:1px solid var(--border); border-radius:var(--r-sm, 4px); color:var(--accent); cursor:pointer; padding:4px 8px; font-size:12px;" title="Refresh module map">${icon('refresh-cw', 14)}</button>
    </div>
    ${renderSummary(modules, _moduleMap.generated)}
    <div style="position:relative; margin-bottom:16px;">
      <input id="impact-search" type="text" placeholder="Search module path..." autocomplete="off"
        style="width:100%; max-width:500px; padding:8px 12px; font-family:var(--font-mono); font-size:13px; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-sm, 4px); color:var(--text-main, #e0e0e0); outline:none; box-sizing:border-box;" />
      <div id="impact-autocomplete" style="display:none; position:absolute; top:100%; left:0; width:100%; max-width:500px; max-height:300px; overflow-y:auto; background:var(--surface); border:1px solid var(--border); border-radius:0 0 var(--r-sm, 4px) var(--r-sm, 4px); z-index:10;"></div>
    </div>
    <div id="impact-results"></div>
  `;

  const input = container.querySelector<HTMLInputElement>('#impact-search')!;
  const dropdown = container.querySelector<HTMLElement>('#impact-autocomplete')!;
  const resultsEl = container.querySelector<HTMLElement>('#impact-results')!;

  // Search input
  input.addEventListener('input', () => {
    renderAutocomplete(input, dropdown, modules);
  });

  // Autocomplete item click
  dropdown.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.impact-ac-item');
    if (item?.dataset.module) {
      input.value = item.dataset.module;
      dropdown.style.display = 'none';
      renderModuleDetail(resultsEl, item.dataset.module, modules);
    }
  });

  // Enter key selects first autocomplete match
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = dropdown.querySelector<HTMLElement>('.impact-ac-item');
      if (first?.dataset.module) {
        input.value = first.dataset.module;
        dropdown.style.display = 'none';
        renderModuleDetail(resultsEl, first.dataset.module, modules);
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  // Close dropdown on outside click (cleaned up on re-render via AbortController)
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target as Node)) {
      dropdown.style.display = 'none';
    }
  }, { signal });

  // Refresh button
  container.querySelector('#impact-refresh')?.addEventListener('click', async () => {
    await renderImpactAnalysis(container);
  });

  // If a module was previously selected, re-select it
  if (_selectedModule && modules[_selectedModule]) {
    input.value = _selectedModule;
    renderModuleDetail(resultsEl, _selectedModule, modules);
  }
}

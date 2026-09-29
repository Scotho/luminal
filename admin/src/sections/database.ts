// admin/src/sections/database.ts — Database viewer with RTDB tree and Firestore browser.

import { rtdb, db } from '../firebase';
import { ref, get, remove, query, limitToFirst } from 'firebase/database';
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { escapeHtml } from '../ui/render';
import { getEnvironment, getConfig } from '../envSwitcher';
import { icon } from '../ui/icons';

// ── Constants ────────────────────────────────────────────────────────────────

type Tab = 'rtdb' | 'firestore';

const RTDB_ROOTS = [
  'status', 'lobbies', 'matches', 'queuePresence',
  'globalStats', 'debugReports', 'drawings', 'invites', 'users',
];

const FIRESTORE_COLLECTIONS = [
  'users', 'usernames', 'queue', 'chat', 'friendRequests', 'friends',
];

const MAX_CHILDREN = 100;
const MAX_STRING_LEN = 80;

// ── Helpers ──────────────────────────────────────────────────────────────────

function colorValue(val: unknown): string {
  if (val === null || val === undefined) return `<span style="color:var(--text-dim);">null</span>`;
  if (typeof val === 'string') {
    const display = val.length > MAX_STRING_LEN ? val.slice(0, MAX_STRING_LEN) + '\u2026' : val;
    return `<span style="color:#22c55e;">"${escapeHtml(display)}"</span>`;
  }
  if (typeof val === 'number') return `<span style="color:#a78bfa;">${val}</span>`;
  if (typeof val === 'boolean') return `<span style="color:#67e8f9;">${val}</span>`;
  return `<span style="color:var(--text-dim);">${escapeHtml(String(val))}</span>`;
}

function isLeaf(val: unknown): boolean {
  return val === null || val === undefined || typeof val !== 'object';
}

function childCount(val: unknown): number {
  if (val === null || val === undefined || typeof val !== 'object') return 0;
  return Object.keys(val as Record<string, unknown>).length;
}

// ── Main Export ──────────────────────────────────────────────────────────────

export function renderDatabase(container: HTMLElement): () => void {
  let activeTab: Tab = 'rtdb';
  const expanded = new Set<string>();
  let treeData: Record<string, unknown> = {};
  let loading = false;
  let statusText = '';

  // ── Render Shell ─────────────────────────────────────────────────────────

  function renderShell(): void {
    const env = getEnvironment();
    const config = getConfig();
    const isLocal = env === 'local';

    container.innerHTML = `
      <h2>${icon('database', 18)} Database</h2>

      <!-- Tab bar -->
      <div id="db-tabs" style="display:flex; gap:4px; margin-bottom:12px;">
        <button data-tab="rtdb" style="
          padding:6px 16px; border:1px solid var(--border); border-radius:4px;
          background:${activeTab === 'rtdb' ? 'var(--accent)' : 'var(--bg-card)'};
          color:${activeTab === 'rtdb' ? '#000' : 'var(--text)'};
          font-weight:${activeTab === 'rtdb' ? '700' : '400'};
          cursor:pointer; font-size:12px; font-family:inherit; transition:all 0.15s;
        ">RTDB</button>
        <button data-tab="firestore" style="
          padding:6px 16px; border:1px solid var(--border); border-radius:4px;
          background:${activeTab === 'firestore' ? 'var(--accent)' : 'var(--bg-card)'};
          color:${activeTab === 'firestore' ? '#000' : 'var(--text)'};
          font-weight:${activeTab === 'firestore' ? '700' : '400'};
          cursor:pointer; font-size:12px; font-family:inherit; transition:all 0.15s;
        ">Firestore</button>
      </div>

      <!-- Toolbar -->
      <div id="db-toolbar" style="
        display:flex; align-items:center; gap:8px; margin-bottom:12px;
        padding:8px 12px; background:var(--bg-card); border:1px solid var(--border);
        border-radius:4px;
      ">
        <button id="db-refresh" style="
          padding:4px 12px; border:1px solid var(--border); border-radius:3px;
          background:var(--bg-card); color:var(--text); cursor:pointer;
          font-size:11px; font-family:inherit; transition:all 0.15s;
        ">Refresh</button>
        ${isLocal ? `
          <button id="db-seed" style="
            padding:4px 12px; border:1px solid var(--border); border-radius:3px;
            background:var(--bg-card); color:#22c55e; cursor:pointer;
            font-size:11px; font-family:inherit; transition:all 0.15s;
          ">Seed</button>
          <button id="db-reset" style="
            padding:4px 12px; border:1px solid var(--border); border-radius:3px;
            background:var(--bg-card); color:var(--red); cursor:pointer;
            font-size:11px; font-family:inherit; transition:all 0.15s;
          ">Reset</button>
        ` : ''}
        <span id="db-status" style="flex:1; font-size:11px; color:var(--text-dim); text-align:right;">${escapeHtml(statusText)}</span>
        <span style="font-size:10px; color:var(--text-dim); letter-spacing:0.5px;">${config.label}</span>
      </div>

      <!-- Tree area -->
      <div id="db-tree" style="
        background:var(--bg-card); border:1px solid var(--border); border-radius:4px;
        padding:12px; min-height:200px; max-height:70vh; overflow-y:auto;
        font-family:var(--font-mono, 'Fira Code', monospace); font-size:12px;
        line-height:1.6;
      ">
        ${loading ? '<div style="color:var(--text-dim); padding:20px; text-align:center;">Loading...</div>' : ''}
      </div>
    `;

    wireEvents();
  }

  // ── Wire Events ──────────────────────────────────────────────────────────

  function wireEvents(): void {
    // Tab clicks
    container.querySelectorAll<HTMLButtonElement>('#db-tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab as Tab;
        expanded.clear();
        treeData = {};
        renderShell();
        fetchData();
      });
    });

    // Refresh
    container.querySelector('#db-refresh')?.addEventListener('click', () => fetchData());

    // Seed (local only)
    container.querySelector('#db-seed')?.addEventListener('click', () => runSeed());

    // Reset (local only)
    container.querySelector('#db-reset')?.addEventListener('click', () => runReset());

    // Tree click delegation
    const treeEl = container.querySelector('#db-tree');
    treeEl?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Expand/collapse toggle
      const toggle = target.closest('[data-toggle-path]') as HTMLElement | null;
      if (toggle) {
        const path = toggle.dataset.togglePath!;
        if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
        renderTree();
        return;
      }

      // Copy JSON action
      const copyBtn = target.closest('[data-copy-path]') as HTMLElement | null;
      if (copyBtn) {
        const path = copyBtn.dataset.copyPath!;
        const val = getValueAtPath(path);
        navigator.clipboard.writeText(JSON.stringify(val, null, 2)).then(() => {
          setStatus('Copied to clipboard');
        }).catch(() => {
          setStatus('Copy failed');
        });
        return;
      }

      // Delete action
      const delBtn = target.closest('[data-delete-path]') as HTMLElement | null;
      if (delBtn) {
        const path = delBtn.dataset.deletePath!;
        handleDelete(path);
        return;
      }

      // Refresh single node
      const refreshBtn = target.closest('[data-refresh-path]') as HTMLElement | null;
      if (refreshBtn) {
        const path = refreshBtn.dataset.refreshPath!;
        refreshNode(path);
        return;
      }
    });
  }

  // ── Status ───────────────────────────────────────────────────────────────

  function setStatus(msg: string): void {
    statusText = msg;
    const el = container.querySelector('#db-status');
    if (el) el.textContent = msg;
  }

  // ── Data Fetching ────────────────────────────────────────────────────────

  async function fetchData(): Promise<void> {
    loading = true;
    renderTree();
    treeData = {};

    try {
      if (activeTab === 'rtdb') {
        const results = await Promise.allSettled(
          RTDB_ROOTS.map(async (path) => {
            const q = query(ref(rtdb, path), limitToFirst(MAX_CHILDREN));
            const snap = await get(q);
            return { path, data: snap.exists() ? snap.val() : null };
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') {
            treeData[r.value.path] = r.value.data;
          } else {
            treeData[(r as PromiseRejectedResult).reason?.path ?? 'error'] = null;
          }
        }
      } else {
        const results = await Promise.allSettled(
          FIRESTORE_COLLECTIONS.map(async (name) => {
            const snap = await getDocs(collection(db, name));
            const docs: Record<string, unknown> = {};
            snap.forEach(d => { docs[d.id] = d.data(); });
            return { name, docs };
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') {
            treeData[r.value.name] = r.value.docs;
          }
        }
      }
      setStatus(`Loaded ${Object.keys(treeData).length} roots at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    }

    loading = false;
    renderTree();
  }

  async function refreshNode(path: string): Promise<void> {
    const rootKey = path.split('/')[0];
    try {
      if (activeTab === 'rtdb') {
        const snap = await get(ref(rtdb, path));
        // Update the tree data at the correct nesting level
        if (path === rootKey) {
          treeData[rootKey] = snap.exists() ? snap.val() : null;
        } else {
          // For nested paths, update root
          const rootSnap = await get(ref(rtdb, rootKey));
          treeData[rootKey] = rootSnap.exists() ? rootSnap.val() : null;
        }
      } else {
        const snap = await getDocs(collection(db, rootKey));
        const docs: Record<string, unknown> = {};
        snap.forEach(d => { docs[d.id] = d.data(); });
        treeData[rootKey] = docs;
      }
      setStatus(`Refreshed ${path}`);
    } catch (err) {
      setStatus(`Refresh failed: ${String(err)}`);
    }
    renderTree();
  }

  // ── Path Helpers ─────────────────────────────────────────────────────────

  function getValueAtPath(path: string): unknown {
    const parts = path.split('/');
    let current: unknown = treeData;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(path: string): Promise<void> {
    const env = getEnvironment();
    let confirmed: boolean;

    if (env === 'live') {
      confirmed = confirm(`DELETE "${path}" from LIVE database? This cannot be undone.`);
    } else {
      confirmed = confirm(`Delete "${path}" from ${env.toUpperCase()} database?`);
    }

    if (!confirmed) return;

    try {
      if (activeTab === 'rtdb') {
        await remove(ref(rtdb, path));
      } else {
        // For Firestore: path is "collection/docId"
        const parts = path.split('/');
        if (parts.length >= 2) {
          await deleteDoc(doc(db, parts[0], parts[1]));
        }
      }
      setStatus(`Deleted ${path}`);
      // Remove from local tree and re-render
      const rootKey = path.split('/')[0];
      await refreshNode(rootKey);
    } catch (err) {
      setStatus(`Delete failed: ${String(err)}`);
    }
  }

  // ── Seed & Reset (LOCAL only) ────────────────────────────────────────────

  async function runSeed(): Promise<void> {
    setStatus('Seeding...');
    try {
      const res = await fetch('http://localhost:5175/__admin_exec/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'npx tsx scripts/seed.ts' }),
      });
      if (!res.ok) throw new Error(`Seed failed: ${res.status}`);
      setStatus('Seed complete');
      await fetchData();
    } catch (err) {
      setStatus(`Seed error: ${String(err)}`);
    }
  }

  async function runReset(): Promise<void> {
    if (!confirm('Reset all local emulator data? This will clear Auth, Firestore, and RTDB, then re-seed.')) return;

    setStatus('Resetting emulators...');
    try {
      // Delete all data from emulators
      const projectId = getConfig().projectId;
      await Promise.all([
        fetch(`http://localhost:9099/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' }),
        fetch(`http://localhost:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' }),
        fetch(`http://localhost:9000/.json`, { method: 'DELETE' }),
      ]);
      setStatus('Emulators cleared, seeding...');
      await runSeed();
    } catch (err) {
      setStatus(`Reset error: ${String(err)}`);
    }
  }

  // ── Tree Rendering ───────────────────────────────────────────────────────

  function renderTree(): void {
    const treeEl = container.querySelector('#db-tree');
    if (!treeEl) return;

    if (loading) {
      treeEl.innerHTML = '<div style="color:var(--text-dim); padding:20px; text-align:center;">Loading...</div>';
      return;
    }

    const keys = Object.keys(treeData);
    if (keys.length === 0) {
      treeEl.innerHTML = '<div style="color:var(--text-dim); padding:20px; text-align:center;">No data. Click Refresh to load.</div>';
      return;
    }

    treeEl.innerHTML = keys.map(key => renderNode(key, key, treeData[key], 0)).join('');
  }

  function renderNode(key: string, path: string, val: unknown, depth: number): string {
    const indent = depth * 16;
    const env = getEnvironment();
    const showDelete = env !== 'live'; // Hide delete on LIVE for safety
    const hoverActions = `
      <span class="db-actions" style="
        display:none; margin-left:8px; gap:4px;
      ">
        <span data-copy-path="${escapeHtml(path)}" title="Copy JSON" style="cursor:pointer; color:var(--text-dim); font-size:10px; padding:1px 4px; border:1px solid var(--border); border-radius:2px;">copy</span>
        ${showDelete ? `<span data-delete-path="${escapeHtml(path)}" title="Delete" style="cursor:pointer; color:var(--red); font-size:10px; padding:1px 4px; border:1px solid var(--border); border-radius:2px;">del</span>` : ''}
        <span data-refresh-path="${escapeHtml(path)}" title="Refresh" style="cursor:pointer; color:var(--text-dim); font-size:10px; padding:1px 4px; border:1px solid var(--border); border-radius:2px;">ref</span>
      </span>
    `;

    if (isLeaf(val)) {
      return `
        <div class="db-row" style="padding:2px 0 2px ${indent}px; display:flex; align-items:center;"
             onmouseover="this.querySelector('.db-actions').style.display='inline-flex'"
             onmouseout="this.querySelector('.db-actions').style.display='none'">
          <span style="width:16px; display:inline-block;"></span>
          <span style="color:var(--text); margin-right:6px;">${escapeHtml(key)}:</span>
          ${colorValue(val)}
          ${hoverActions}
        </div>
      `;
    }

    // Object / array node
    const isExpanded = expanded.has(path);
    const count = childCount(val);
    const chevron = isExpanded ? '\u25BC' : '\u25B6';

    let childrenHtml = '';
    if (isExpanded) {
      const entries = Object.entries(val as Record<string, unknown>);
      const limited = entries.slice(0, MAX_CHILDREN);
      childrenHtml = limited.map(([k, v]) => renderNode(k, `${path}/${k}`, v, depth + 1)).join('');
      if (entries.length > MAX_CHILDREN) {
        childrenHtml += `<div style="padding:2px 0 2px ${(depth + 1) * 16}px; color:var(--text-dim); font-style:italic;">... and ${entries.length - MAX_CHILDREN} more</div>`;
      }
    }

    return `
      <div class="db-row" style="padding:2px 0 2px ${indent}px; display:flex; align-items:center;"
           onmouseover="this.querySelector('.db-actions').style.display='inline-flex'"
           onmouseout="this.querySelector('.db-actions').style.display='none'">
        <span data-toggle-path="${escapeHtml(path)}" style="
          cursor:pointer; width:16px; display:inline-block; text-align:center;
          font-size:9px; color:var(--text-dim); user-select:none;
        ">${chevron}</span>
        <span data-toggle-path="${escapeHtml(path)}" style="cursor:pointer; color:var(--text); margin-right:6px;">${escapeHtml(key)}</span>
        <span style="color:var(--text-dim); font-size:11px;">(${count})</span>
        ${hoverActions}
      </div>
      ${childrenHtml}
    `;
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  renderShell();
  fetchData();

  // Return cleanup
  return () => {
    expanded.clear();
    treeData = {};
    container.innerHTML = '';
  };
}

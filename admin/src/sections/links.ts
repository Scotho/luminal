import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';

interface LinkItem {
  id: string;
  label: string;
  url: string;
  group: string;
  icon?: string;
}

interface LinksState {
  links: LinkItem[];
}

const DEFAULT_LINKS: LinkItem[] = [
  // ── Services ──
  { id: 'firebase-console', label: 'Firebase Console', url: 'https://console.firebase.google.com/u/0/', group: 'Services', icon: '🔥' },
  { id: 'github-repo', label: 'GitHub Repo', url: 'https://github.com/Scotho/luminal', group: 'Services', icon: '🐙' },
  { id: 'claude-usage', label: 'Claude Usage', url: 'https://claude.ai/settings/usage', group: 'Services', icon: '🤖' },
  { id: 'azure-entra', label: 'Azure Entra (App Creds)', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Credentials/appId/a1c14c22-304d-4933-80a8-dbf05d1a5eca/isMSAApp~/false', group: 'Services', icon: '🔐' },

  // ── Environments ──
  { id: 'live-site', label: 'Luminal Live', url: 'https://luminal.live/', group: 'Environments', icon: '🌐' },
  { id: 'test-site', label: 'Luminal Test', url: 'https://luminal-test.web.app/', group: 'Environments', icon: '🧪' },
  { id: 'firebase-hosting', label: 'Firebase Hosting (Live)', url: 'https://luminal-game.web.app', group: 'Environments', icon: '🏠' },
  { id: 'local-game', label: 'Local Dev Server', url: 'http://localhost:5173', group: 'Environments', icon: '💻' },
  { id: 'local-admin', label: 'Admin Dashboard', url: 'http://localhost:5175', group: 'Environments', icon: '📊' },
  { id: 'local-preview', label: 'Static Preview', url: 'http://localhost:5174', group: 'Environments', icon: '👁' },

  // ── Firebase ──
  { id: 'rtdb', label: 'Realtime Database', url: 'https://console.firebase.google.com/u/0/project/luminal-game/database/luminal-game-default-rtdb/data', group: 'Firebase', icon: '📡' },
  { id: 'firestore', label: 'Firestore', url: 'https://console.firebase.google.com/u/0/project/luminal-game/firestore', group: 'Firebase', icon: '🗃' },
  { id: 'functions', label: 'Cloud Functions', url: 'https://console.firebase.google.com/u/0/project/luminal-game/functions', group: 'Firebase', icon: '⚡' },
  { id: 'auth', label: 'Authentication', url: 'https://console.firebase.google.com/u/0/project/luminal-game/authentication', group: 'Firebase', icon: '👤' },
  { id: 'hosting', label: 'Hosting', url: 'https://console.firebase.google.com/u/0/project/luminal-game/hosting', group: 'Firebase', icon: '🚀' },
  { id: 'storage', label: 'Storage', url: 'https://console.firebase.google.com/u/0/project/luminal-game/storage', group: 'Firebase', icon: '📦' },
  { id: 'analytics', label: 'Analytics', url: 'https://console.firebase.google.com/u/0/project/luminal-game/analytics', group: 'Firebase', icon: '📈' },
  { id: 'app-check', label: 'App Check', url: 'https://console.firebase.google.com/u/0/project/luminal-game/appcheck', group: 'Firebase', icon: '🛡' },

  // ── Design & Dev Tools ──
  { id: '21st-dev', label: '21st.dev', url: 'https://21st.dev/', group: 'Tools', icon: '🎨' },
  { id: 'codepen', label: 'CodePen', url: 'https://codepen.io/', group: 'Tools', icon: '✏' },

  // ── Infrastructure ──
  { id: 'relay-server', label: 'Relay Server (Cloud Run)', url: 'https://console.cloud.google.com/run/detail/us-central1/luminal-relay/metrics?project=luminal-game', group: 'Infrastructure', icon: '🔌' },
  { id: 'github-actions', label: 'GitHub Actions', url: 'https://github.com/Scotho/luminal/actions', group: 'Infrastructure', icon: '⚙' },
  { id: 'github-pulls', label: 'Pull Requests', url: 'https://github.com/Scotho/luminal/pulls', group: 'Infrastructure', icon: '🔀' },
  { id: 'github-issues', label: 'Issues', url: 'https://github.com/Scotho/luminal/issues', group: 'Infrastructure', icon: '📋' },

  // ── Docs ──
  { id: 'claude-code-docs', label: 'Claude Code Docs', url: 'https://docs.anthropic.com/en/docs/claude-code', group: 'Docs', icon: '📖' },
  { id: 'firebase-docs', label: 'Firebase Docs', url: 'https://firebase.google.com/docs', group: 'Docs', icon: '📖' },
  { id: 'threejs-docs', label: 'Three.js Docs', url: 'https://threejs.org/docs/', group: 'Docs', icon: '📖' },
  { id: 'vite-docs', label: 'Vite Docs', url: 'https://vite.dev/guide/', group: 'Docs', icon: '📖' },
  { id: 'vitest-docs', label: 'Vitest Docs', url: 'https://vitest.dev/guide/', group: 'Docs', icon: '📖' },

  // ── Assets ──
  { id: 'google-fonts', label: 'Orbitron + Rajdhani (Google Fonts)', url: 'https://fonts.google.com/share?selection.family=Orbitron:wght@400;700;900|Rajdhani:wght@400;600;700', group: 'Assets', icon: '🔤' },
];

// ── Persistence ─────────────────────────────────────────────────────────────

async function loadLinks(): Promise<LinkItem[]> {
  try {
    const resp = await fetch('/data/links.json');
    if (!resp.ok) throw new Error('not found');
    const data = (await resp.json()) as LinksState;
    return data.links;
  } catch {
    // First load — seed with defaults and save
    await saveLinks(DEFAULT_LINKS);
    return [...DEFAULT_LINKS];
  }
}

async function saveLinks(links: LinkItem[]): Promise<void> {
  const state: LinksState = { links };
  await fetch('/__admin_save?file=links.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state, null, 2),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getGroups(links: LinkItem[]): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const link of links) {
    if (!seen.has(link.group)) {
      seen.add(link.group);
      groups.push(link.group);
    }
  }
  return groups;
}

function generateId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderLinkRow(link: LinkItem): string {
  const hostname = escapeHtml(getHostname(link.url));
  const icon = link.icon ?? '🔗';
  return `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="link-row" style="display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid var(--border); border-radius:4px; margin-bottom:4px; text-decoration:none; color:var(--text); transition:border-color 0.15s; font-size:12px;">
  <span style="font-size:16px;">${icon}</span>
  <span style="font-weight:700; flex:1;">${escapeHtml(link.label)}</span>
  <span style="color:var(--text-dim); font-family:var(--font-mono); font-size:10px;">${hostname}</span>
  <button class="link-delete" data-link-id="${escapeHtml(link.id)}" style="background:transparent; border:1px solid var(--border); border-radius:4px; color:var(--text-dim); cursor:pointer; font-size:14px; line-height:1; padding:2px 6px; transition:color 0.15s, border-color 0.15s;" title="Remove">&times;</button>
</a>`;
}

function renderGroupHeader(groupName: string): string {
  return `<div style="font-family:var(--font-display); font-size:10px; font-weight:900; letter-spacing:3px; text-transform:uppercase; color:var(--text-heading); padding:12px 0 6px; margin-top:8px;">
  ${escapeHtml(groupName)}
</div>`;
}

function renderGroupedLinks(links: LinkItem[]): string {
  const groups = getGroups(links);
  let html = '';
  for (const group of groups) {
    const groupLinks = links.filter(l => l.group === group);
    if (groupLinks.length === 0) continue;
    html += renderGroupHeader(group);
    for (const link of groupLinks) {
      html += renderLinkRow(link);
    }
  }
  return html;
}

function renderAddForm(existingGroups: string[]): string {
  const options = existingGroups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  return `<div id="links-add-form" style="display:none; padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--surface);">
  <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
    <div style="flex:1; min-width:140px;">
      <label style="font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim); display:block; margin-bottom:4px;">Label</label>
      <input id="link-label" placeholder="My Link" style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--bg); color:var(--text); font-size:12px;" />
    </div>
    <div style="flex:2; min-width:200px;">
      <label style="font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim); display:block; margin-bottom:4px;">URL</label>
      <input id="link-url" placeholder="https://..." style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--bg); color:var(--text); font-size:12px;" />
    </div>
    <div style="min-width:140px;">
      <label style="font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim); display:block; margin-bottom:4px;">Group</label>
      <select id="link-group" style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--bg); color:var(--text); font-size:12px;">
        ${options}
        <option value="__new__">New Group...</option>
      </select>
    </div>
    <div style="min-width:80px;">
      <label style="font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim); display:block; margin-bottom:4px;">Icon</label>
      <input id="link-icon" placeholder="🔗" maxlength="4" style="width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--bg); color:var(--text); font-size:12px; text-align:center;" />
    </div>
    <button id="link-save" class="admin-btn admin-btn--small" style="height:32px;">Save</button>
    <button id="link-cancel" class="admin-btn admin-btn--small" style="height:32px; background:transparent; border:1px solid var(--border); color:var(--text-dim);">Cancel</button>
  </div>
  <input id="link-new-group" placeholder="New group name..." style="display:none; margin-top:8px; width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--bg); color:var(--text); font-size:12px;" />
</div>`;
}

// ── Main Export ──────────────────────────────────────────────────────────────

export async function renderLinks(container: HTMLElement): Promise<void> {
  let links = await loadLinks();

  function render(): void {
    const groups = getGroups(links);
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <h2>${icon('link', 18)} Links</h2>
          <button id="links-add-btn" class="admin-btn admin-btn--small">+ Add Link</button>
        </div>
        ${renderAddForm(groups)}
        <div id="links-groups">
          ${renderGroupedLinks(links)}
        </div>
      </div>
    `;
    wireEvents();
  }

  function wireEvents(): void {
    // Toggle add form
    const addBtn = container.querySelector('#links-add-btn') as HTMLButtonElement | null;
    const addForm = container.querySelector('#links-add-form') as HTMLElement | null;
    const cancelBtn = container.querySelector('#link-cancel') as HTMLButtonElement | null;

    addBtn?.addEventListener('click', () => {
      if (addForm) addForm.style.display = addForm.style.display === 'none' ? 'block' : 'none';
    });
    cancelBtn?.addEventListener('click', () => {
      if (addForm) addForm.style.display = 'none';
    });

    // Group select: show/hide new group input
    const groupSelect = container.querySelector('#link-group') as HTMLSelectElement | null;
    const newGroupInput = container.querySelector('#link-new-group') as HTMLInputElement | null;
    groupSelect?.addEventListener('change', () => {
      if (newGroupInput) {
        newGroupInput.style.display = groupSelect.value === '__new__' ? 'block' : 'none';
      }
    });

    // Save new link
    const saveBtn = container.querySelector('#link-save') as HTMLButtonElement | null;
    saveBtn?.addEventListener('click', async () => {
      const labelInput = container.querySelector('#link-label') as HTMLInputElement;
      const urlInput = container.querySelector('#link-url') as HTMLInputElement;
      const iconInput = container.querySelector('#link-icon') as HTMLInputElement;
      const label = labelInput?.value.trim();
      const url = urlInput?.value.trim();
      const icon = iconInput?.value.trim() || undefined;

      if (!label || !url) return;

      let group: string;
      if (groupSelect?.value === '__new__') {
        group = newGroupInput?.value.trim() ?? '';
        if (!group) return;
      } else {
        group = groupSelect?.value ?? 'Uncategorized';
      }

      const newLink: LinkItem = { id: generateId(label), label, url, group, icon };
      links.push(newLink);
      await saveLinks(links);
      render();
    });

    // Delete link
    container.querySelectorAll<HTMLButtonElement>('.link-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const linkId = btn.dataset.linkId;
        if (!linkId) return;
        const link = links.find(l => l.id === linkId);
        if (!link || !confirm(`Remove "${link.label}"?`)) return;
        links = links.filter(l => l.id !== linkId);
        await saveLinks(links);
        render();
      });
    });

    // Hover effects on link rows
    container.querySelectorAll<HTMLElement>('.link-row').forEach(row => {
      row.addEventListener('mouseenter', () => { row.style.borderColor = 'var(--accent)'; });
      row.addEventListener('mouseleave', () => { row.style.borderColor = 'var(--border)'; });
    });

    // Hover effects on delete buttons
    container.querySelectorAll<HTMLButtonElement>('.link-delete').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--red)'; btn.style.borderColor = 'var(--red)'; });
      btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--text-dim)'; btn.style.borderColor = 'var(--border)'; });
    });
  }

  render();
}

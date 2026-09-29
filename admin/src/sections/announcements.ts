// admin/src/sections/announcements.ts — Announcement / MOTD management
import { rtdb } from '../firebase';
import { ref, onValue, set, push, remove } from 'firebase/database';
import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import { auth } from '../firebase';

// ── Types ───────────────────────────────────────────────

interface Announcement {
  id: string;
  text: string;
  type: 'info' | 'warning' | 'maintenance' | 'update';
  priority: number;
  active: boolean;
  startAt: number;
  endAt: number;
  createdBy: string;
  createdAt: number;
}

type AnnouncementType = Announcement['type'];

const ANNOUNCEMENT_TYPES: AnnouncementType[] = ['info', 'warning', 'maintenance', 'update'];

const TYPE_COLORS: Record<AnnouncementType, string> = {
  info: 'var(--accent)',
  warning: 'var(--orange, #e8a735)',
  maintenance: 'var(--red)',
  update: 'var(--green)',
};

const TYPE_LABELS: Record<AnnouncementType, string> = {
  info: 'Info',
  warning: 'Warning',
  maintenance: 'Maintenance',
  update: 'Update',
};

// ── State ───────────────────────────────────────────────

let _announcements: Announcement[] = [];
let _unsub: (() => void) | null = null;
let _showForm = false;

// ── Section entry point ─────────────────────────────────

export async function renderAnnouncements(container: HTMLElement): Promise<void> {
  _showForm = false;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('bell', 18)} Announcements</h2>
      <div style="display:flex;gap:8px;">
        <button id="ann-new-btn" class="admin-btn admin-btn--small">+ New</button>
        <button id="ann-refresh-btn" class="refresh-btn">Refresh</button>
      </div>
    </div>
    <div id="ann-form-wrap"></div>
    <div id="ann-list"><p style="color:var(--text-dim);">Loading...</p></div>
    <div id="ann-preview-wrap"></div>
  `;

  // Subscribe to RTDB
  const annRef = ref(rtdb, 'announcements');
  _unsub?.();
  _unsub = onValue(annRef, (snap) => {
    const val = snap.val() as Record<string, Partial<Announcement>> | null;
    _announcements = [];
    if (val) {
      for (const [id, entry] of Object.entries(val)) {
        _announcements.push({
          id,
          text: entry.text ?? '',
          type: (entry.type as AnnouncementType) ?? 'info',
          priority: entry.priority ?? 99,
          active: entry.active ?? false,
          startAt: entry.startAt ?? 0,
          endAt: entry.endAt ?? 0,
          createdBy: entry.createdBy ?? 'unknown',
          createdAt: entry.createdAt ?? 0,
        });
      }
    }
    _announcements.sort((a, b) => a.priority - b.priority);
    renderList();
  });

  container.querySelector('#ann-refresh-btn')?.addEventListener('click', () => {
    renderAnnouncements(container);
  });

  container.querySelector('#ann-new-btn')?.addEventListener('click', () => {
    _showForm = !_showForm;
    renderForm();
  });
}

// ── Form ────────────────────────────────────────────────

function renderForm(): void {
  const wrap = document.getElementById('ann-form-wrap');
  if (!wrap) return;

  if (!_showForm) {
    wrap.innerHTML = '';
    return;
  }

  const now = new Date();
  const localISO = toLocalDatetimeString(now);

  wrap.innerHTML = `
    <div class="ann-form" style="border:1px solid var(--border);border-radius:6px;padding:16px;margin-bottom:16px;background:var(--surface-dim);">
      <div style="font-size:11px;font-family:var(--font-display);letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px;">NEW ANNOUNCEMENT</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <label style="font-size:11px;color:var(--text-dim);">Text</label>
          <textarea id="ann-form-text" rows="3" style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px;border-radius:4px;resize:vertical;" placeholder="Enter announcement text..."></textarea>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div>
            <label style="font-size:11px;color:var(--text-dim);">Type</label>
            <select id="ann-form-type" style="background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:12px;padding:4px 8px;border-radius:4px;">
              ${ANNOUNCEMENT_TYPES.map(t => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-dim);">Priority</label>
            <input id="ann-form-priority" type="number" min="1" max="99" value="5" style="width:60px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:12px;padding:4px 8px;border-radius:4px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-dim);">Start</label>
            <input id="ann-form-start" type="datetime-local" value="${escapeHtml(localISO)}" style="background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:12px;padding:4px 8px;border-radius:4px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-dim);">End (empty = no expiry)</label>
            <input id="ann-form-end" type="datetime-local" style="background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:12px;padding:4px 8px;border-radius:4px;" />
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button id="ann-form-save" class="admin-btn admin-btn--small" style="background:var(--green);color:var(--bg);">Create</button>
          <button id="ann-form-cancel" class="admin-btn admin-btn--small">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('ann-form-cancel')?.addEventListener('click', () => {
    _showForm = false;
    renderForm();
  });

  document.getElementById('ann-form-save')?.addEventListener('click', async () => {
    const text = (document.getElementById('ann-form-text') as HTMLTextAreaElement)?.value.trim();
    if (!text) return;

    const type = (document.getElementById('ann-form-type') as HTMLSelectElement)?.value as AnnouncementType;
    const priority = parseInt((document.getElementById('ann-form-priority') as HTMLInputElement)?.value, 10) || 5;
    const startVal = (document.getElementById('ann-form-start') as HTMLInputElement)?.value;
    const endVal = (document.getElementById('ann-form-end') as HTMLInputElement)?.value;

    const startAt = startVal ? new Date(startVal).getTime() : Date.now();
    const endAt = endVal ? new Date(endVal).getTime() : 0;

    const annRef = ref(rtdb, 'announcements');
    const newRef = push(annRef);
    await set(newRef, {
      text,
      type,
      priority,
      active: true,
      startAt,
      endAt,
      createdBy: auth.currentUser?.uid ?? 'admin',
      createdAt: Date.now(),
    });

    _showForm = false;
    renderForm();
  });
}

// ── List ────────────────────────────────────────────────

function renderList(): void {
  const listEl = document.getElementById('ann-list');
  if (!listEl) return;

  if (_announcements.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-dim);">No announcements. Click + New to create one.</p>';
    return;
  }

  const now = Date.now();

  listEl.innerHTML = _announcements.map(ann => {
    const isLive = ann.active && ann.startAt <= now && (ann.endAt === 0 || ann.endAt > now);
    const statusColor = isLive ? 'var(--green)' : (ann.active ? 'var(--orange, #e8a735)' : 'var(--text-quiet)');
    const statusText = isLive ? 'LIVE' : (ann.active ? 'SCHEDULED' : 'INACTIVE');
    const typeColor = TYPE_COLORS[ann.type] ?? 'var(--text-dim)';
    const created = ann.createdAt ? new Date(ann.createdAt).toLocaleDateString() : '';
    const startStr = ann.startAt ? new Date(ann.startAt).toLocaleString() : 'now';
    const endStr = ann.endAt ? new Date(ann.endAt).toLocaleString() : 'no expiry';

    return `
      <div class="ann-row" style="border:1px solid var(--border);border-left:3px solid ${statusColor};border-radius:6px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="background:${typeColor};color:var(--bg);font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;text-transform:uppercase;">${escapeHtml(TYPE_LABELS[ann.type])}</span>
            <span style="background:${statusColor};color:var(--bg);font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;">${statusText}</span>
            <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-dim);">P${ann.priority}</span>
          </div>
          <div style="font-size:13px;color:var(--text);margin-bottom:4px;">${escapeHtml(ann.text)}</div>
          <div style="font-size:10px;color:var(--text-quiet);">
            ${escapeHtml(startStr)} &mdash; ${escapeHtml(endStr)} &middot; Created ${escapeHtml(created)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <button class="ann-toggle admin-btn admin-btn--small" data-ann-id="${escapeHtml(ann.id)}" data-active="${ann.active}" style="font-size:10px;">
            ${ann.active ? 'Deactivate' : 'Activate'}
          </button>
          <button class="ann-preview-btn admin-btn admin-btn--small" data-ann-id="${escapeHtml(ann.id)}" style="font-size:10px;">
            Preview
          </button>
          <button class="ann-delete admin-btn admin-btn--small" data-ann-id="${escapeHtml(ann.id)}" style="font-size:10px;color:var(--red);">
            Delete
          </button>
        </div>
      </div>
    `;
  }).join('');

  wireListEvents(listEl);
}

function wireListEvents(listEl: HTMLElement): void {
  // Toggle active
  listEl.querySelectorAll<HTMLButtonElement>('.ann-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.annId;
      if (!id) return;
      const currentActive = btn.dataset.active === 'true';
      btn.textContent = '...';
      await set(ref(rtdb, `announcements/${id}/active`), !currentActive);
    });
  });

  // Delete
  listEl.querySelectorAll<HTMLButtonElement>('.ann-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.annId;
      if (!id) return;
      if (!confirm('Delete this announcement?')) return;
      await remove(ref(rtdb, `announcements/${id}`));
    });
  });

  // Preview
  listEl.querySelectorAll<HTMLButtonElement>('.ann-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.annId;
      if (!id) return;
      const ann = _announcements.find(a => a.id === id);
      if (ann) renderPreview(ann);
    });
  });
}

// ── Preview ─────────────────────────────────────────────

function renderPreview(ann: Announcement): void {
  const wrap = document.getElementById('ann-preview-wrap');
  if (!wrap) return;

  const typeLabel = TYPE_LABELS[ann.type] ?? 'ANNOUNCEMENT';

  wrap.innerHTML = `
    <div style="margin-top:16px;border:1px solid var(--border);border-radius:8px;padding:16px;background:rgba(0,0,0,0.3);">
      <div style="font-size:11px;font-family:var(--font-display);letter-spacing:1.5px;color:var(--text-dim);margin-bottom:8px;">IN-GAME PREVIEW</div>
      <div style="
        max-width:300px;
        background:linear-gradient(135deg, rgba(20,25,40,0.95), rgba(15,18,30,0.9));
        border:1px solid rgba(100,200,255,0.08);
        border-radius:8px;
        padding:12px 16px;
        font-family:'Rajdhani',sans-serif;
        position:relative;
        overflow:hidden;
      ">
        <div style="font-family:'Orbitron',monospace;font-size:11px;letter-spacing:3px;color:rgba(255,100,80,0.55);margin-bottom:8px;">${escapeHtml(typeLabel.toUpperCase())}</div>
        <div style="color:rgba(255,255,255,0.5);font-size:13px;line-height:1.5;">${escapeHtml(ann.text)}</div>
        <span style="position:absolute;top:6px;right:8px;color:rgba(255,255,255,0.2);font-size:14px;cursor:default;">&times;</span>
      </div>
      <button id="ann-preview-close" class="admin-btn admin-btn--small" style="margin-top:8px;">Close Preview</button>
    </div>
  `;

  document.getElementById('ann-preview-close')?.addEventListener('click', () => {
    wrap.innerHTML = '';
  });
}

// ── Cleanup ─────────────────────────────────────────────

export function cleanupAnnouncements(): void {
  _unsub?.();
  _unsub = null;
}

// ── Helpers ─────────────────────────────────────────────

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// admin/src/sections/chatModeration.ts — Chat moderation: queue, filters, deletion history
import { rtdb } from '../firebase';
import { ref, onValue, remove, update, get, push, set } from 'firebase/database';
import { escapeHtml, ago } from '../ui/render';
import { icon } from '../ui/icons';
import { auth } from '../firebase';

interface FlaggedMessage {
  id: string;
  uid: string;
  username: string;
  text: string;
  ts: number;
  reason: string;
  channel: string;
}

interface ChatFilter {
  id: string;
  pattern: string;
  type: 'word' | 'regex';
  action: 'flag' | 'block' | 'mute';
  enabled: boolean;
  createdBy: string;
  createdAt: number;
}

interface DeletionRecord {
  id: string;
  msgId: string;
  uid: string;
  username: string;
  text: string;
  reason: string;
  channel: string;
  deletedBy: string;
  deletedAt: number;
}

let _unsub: (() => void) | null = null;
let _filterUnsub: (() => void) | null = null;
let _activeTab: 'queue' | 'filters' | 'history' = 'queue';

export function renderChatModeration(container: HTMLElement): () => void {
  _unsub?.();
  _filterUnsub?.();

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('users', 18)} Chat Moderation</h2>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:16px;" id="chat-mod-tabs">
      <button class="filter-btn ${_activeTab === 'queue' ? 'active' : ''}" data-tab="queue">Queue</button>
      <button class="filter-btn ${_activeTab === 'filters' ? 'active' : ''}" data-tab="filters">Filters</button>
      <button class="filter-btn ${_activeTab === 'history' ? 'active' : ''}" data-tab="history">Deletion History</button>
    </div>
    <div id="chat-mod-content"></div>
  `;

  // Tab switching
  container.querySelector('#chat-mod-tabs')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.filter-btn') as HTMLElement;
    if (!btn?.dataset.tab) return;
    _activeTab = btn.dataset.tab as typeof _activeTab;
    container.querySelectorAll('#chat-mod-tabs .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderActiveTab();
  });

  function renderActiveTab(): void {
    switch (_activeTab) {
      case 'queue': startQueueListener(); break;
      case 'filters': renderFilters(); break;
      case 'history': renderHistory(); break;
    }
  }

  // ── Queue tab ──────────────────────────────────────────

  function startQueueListener(): void {
    _unsub?.();
    const content = document.getElementById('chat-mod-content')!;
    content.innerHTML = '<p style="color:var(--text-dim);">Listening for flagged messages...</p>';

    const modRef = ref(rtdb, 'moderation/chat');
    _unsub = onValue(modRef, (snap) => {
      const val = snap.val() as Record<string, Omit<FlaggedMessage, 'id'>> | null;
      const messages: FlaggedMessage[] = val
        ? Object.entries(val).map(([id, m]) => ({ id, ...m })).sort((a, b) => b.ts - a.ts)
        : [];
      renderQueue(content, messages);
    });
  }

  function renderQueue(el: HTMLElement, messages: FlaggedMessage[]): void {
    if (messages.length === 0) {
      el.innerHTML = '<div style="color:var(--green);font-size:12px;padding:20px;text-align:center;">Queue empty — no flagged messages</div>';
      return;
    }

    el.innerHTML = messages.map(m => `
      <div class="chat-mod-card" data-msg-id="${escapeHtml(m.id)}" style="
        background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;
        padding:10px 14px;margin-bottom:6px;
      ">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-weight:700;font-size:12px;">${escapeHtml(m.username)}</span>
          <span style="color:var(--text-dim);font-size:10px;">${ago(m.ts)} · ${escapeHtml(m.channel)}</span>
        </div>
        <div style="font-size:13px;margin-bottom:6px;padding:6px 8px;background:var(--bg-surface);border-radius:3px;">${escapeHtml(m.text)}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:10px;color:var(--orange);">Reason: ${escapeHtml(m.reason)}</span>
          <div style="display:flex;gap:6px;">
            <button class="admin-btn admin-btn--small chat-mod-approve" data-id="${escapeHtml(m.id)}">Approve</button>
            <button class="admin-btn admin-btn--small admin-btn--danger chat-mod-delete" data-id="${escapeHtml(m.id)}" data-uid="${escapeHtml(m.uid)}" data-username="${escapeHtml(m.username)}" data-text="${escapeHtml(m.text)}" data-reason="${escapeHtml(m.reason)}" data-channel="${escapeHtml(m.channel)}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');

    el.querySelectorAll<HTMLElement>('.chat-mod-approve').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (id) remove(ref(rtdb, `moderation/chat/${id}`));
      });
    });

    el.querySelectorAll<HTMLElement>('.chat-mod-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;

        const adminEmail = auth.currentUser?.email ?? 'unknown';

        // Record deletion in history
        const record: Omit<DeletionRecord, 'id'> = {
          msgId: id,
          uid: btn.dataset.uid ?? '',
          username: btn.dataset.username ?? '',
          text: btn.dataset.text ?? '',
          reason: btn.dataset.reason ?? '',
          channel: btn.dataset.channel ?? '',
          deletedBy: adminEmail,
          deletedAt: Date.now(),
        };

        await push(ref(rtdb, 'moderation/deletionHistory'), record);

        // Remove from queue + mark deleted in chat
        remove(ref(rtdb, `moderation/chat/${id}`));
        update(ref(rtdb, `chat/messages/${id}`), { deleted: true, deletedBy: adminEmail, deletedAt: Date.now() });
      });
    });
  }

  // ── Filters tab ────────────────────────────────────────

  async function renderFilters(): Promise<void> {
    const content = document.getElementById('chat-mod-content')!;
    _unsub?.();

    let filters: ChatFilter[] = [];
    try {
      const snap = await get(ref(rtdb, 'moderation/filters'));
      const val = snap.val() as Record<string, Omit<ChatFilter, 'id'>> | null;
      if (val) filters = Object.entries(val).map(([id, f]) => ({ id, ...f }));
    } catch (err) {
      console.warn('[chatModeration] Failed to load filters:', err);
    }

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="color:var(--text-dim);font-size:11px;">${filters.length} active filters</span>
        <button id="chat-filter-add" class="admin-btn admin-btn--small">+ Add Filter</button>
      </div>
      <div id="chat-filter-list">
        ${filters.length > 0 ? filters.map(renderFilterRow).join('') : '<p style="color:var(--text-dim);font-size:12px;">No filters configured. Add word or regex patterns to auto-flag messages.</p>'}
      </div>
    `;

    // Add filter
    content.querySelector('#chat-filter-add')?.addEventListener('click', async () => {
      const pattern = window.prompt('Filter pattern (word or regex):');
      if (!pattern?.trim()) return;
      const type = window.prompt('Type (word/regex):', 'word') as 'word' | 'regex';
      const action = window.prompt('Action (flag/block/mute):', 'flag') as 'flag' | 'block' | 'mute';

      const newFilter: Omit<ChatFilter, 'id'> = {
        pattern: pattern.trim(),
        type: type || 'word',
        action: action || 'flag',
        enabled: true,
        createdBy: auth.currentUser?.email ?? 'unknown',
        createdAt: Date.now(),
      };

      await push(ref(rtdb, 'moderation/filters'), newFilter);
      renderFilters();
    });

    // Toggle + delete buttons
    content.querySelectorAll<HTMLElement>('.chat-filter-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const enabled = btn.dataset.enabled === 'true';
        if (id) {
          await update(ref(rtdb, `moderation/filters/${id}`), { enabled: !enabled });
          renderFilters();
        }
      });
    });

    content.querySelectorAll<HTMLElement>('.chat-filter-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (id && confirm('Delete this filter?')) {
          await set(ref(rtdb, `moderation/filters/${id}`), null);
          renderFilters();
        }
      });
    });
  }

  function renderFilterRow(f: ChatFilter): string {
    const actionColors: Record<string, string> = { flag: 'var(--yellow)', block: 'var(--red-bright)', mute: 'var(--text-quiet)' };
    const color = actionColors[f.action] ?? 'var(--text-dim)';
    const enabledColor = f.enabled ? 'var(--green)' : 'var(--text-quiet)';

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;margin-bottom:4px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${enabledColor};flex-shrink:0;"></span>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;">${escapeHtml(f.pattern)}</div>
          <div style="font-size:10px;color:var(--text-dim);">
            <span style="color:${color};text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">${f.action}</span>
            · ${f.type} · by ${escapeHtml(f.createdBy)} · ${ago(f.createdAt)}
          </div>
        </div>
        <button class="admin-btn admin-btn--small chat-filter-toggle" data-id="${f.id}" data-enabled="${f.enabled}">${f.enabled ? 'Disable' : 'Enable'}</button>
        <button class="admin-btn admin-btn--small admin-btn--danger chat-filter-delete" data-id="${f.id}">&times;</button>
      </div>
    `;
  }

  // ── History tab ────────────────────────────────────────

  async function renderHistory(): Promise<void> {
    const content = document.getElementById('chat-mod-content')!;
    _unsub?.();

    let records: DeletionRecord[] = [];
    try {
      const snap = await get(ref(rtdb, 'moderation/deletionHistory'));
      const val = snap.val() as Record<string, Omit<DeletionRecord, 'id'>> | null;
      if (val) records = Object.entries(val).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.deletedAt - a.deletedAt);
    } catch (err) {
      console.warn('[chatModeration] Failed to load deletion history:', err);
    }

    content.innerHTML = `
      <div style="margin-bottom:8px;color:var(--text-dim);font-size:11px;">${records.length} deleted messages on record</div>
      <div id="chat-history-list">
        ${records.length > 0 ? records.slice(0, 100).map(r => {
          const date = new Date(r.deletedAt);
          const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          return `
            <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:8px 12px;margin-bottom:4px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-weight:700;font-size:12px;">${escapeHtml(r.username)} <span style="color:var(--text-quiet);font-size:10px;font-family:var(--font-mono);">${escapeHtml(r.uid.slice(0, 12))}</span></span>
                <span style="font-size:10px;color:var(--text-quiet);">${dateStr}</span>
              </div>
              <div style="font-size:12px;padding:4px 8px;background:var(--bg-surface);border-radius:3px;margin-bottom:4px;text-decoration:line-through;color:var(--text-dim);">${escapeHtml(r.text)}</div>
              <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);">
                <span>Reason: <span style="color:var(--orange);">${escapeHtml(r.reason)}</span> · ${escapeHtml(r.channel)}</span>
                <span>Deleted by: <strong style="color:var(--accent);">${escapeHtml(r.deletedBy)}</strong></span>
              </div>
            </div>
          `;
        }).join('') : '<p style="color:var(--text-dim);font-size:12px;">No deletions recorded yet.</p>'}
      </div>
    `;
  }

  // Start with active tab
  renderActiveTab();

  return () => {
    _unsub?.(); _unsub = null;
    _filterUnsub?.(); _filterUnsub = null;
  };
}

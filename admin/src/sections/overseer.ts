// admin/src/sections/overseer.ts — Full Overseer admin UI section
import { escapeHtml, ago } from '../ui/render';
import { icon } from '../ui/icons';
import type {
  DomainConfig, StandingOrder, OverseerConfig,
  OverseerState, OverseerLogEntry,
} from '../middleware/overseer/types';

/* ── Constants ───────────────────────────────────────────────────────────── */

const DOMAIN_LABELS: Record<string, string> = {
  'bugs': 'Bugs',
  'tests': 'Tests',
  'server-health': 'Server Health',
  'perf': 'Performance',
  'player-activity': 'Player Activity',
  'deploy': 'Deploy',
  'stale-tasks': 'Stale Tasks',
};

const ALL_DOMAINS = [
  'bugs', 'tests', 'server-health', 'perf',
  'player-activity', 'deploy', 'stale-tasks',
];

const ACTION_ICONS: Record<string, string> = {
  'detected': '\u{1F50D}',
  'incident-created': '\u{1F4CB}',
  'discord-sent': '\u{1F4AC}',
  'claude-dispatched': '\u{1F916}',
  'claude-completed': '\u2705',
  'auto-fixed': '\u{1F527}',
  'escalated': '\u2B06\uFE0F',
  'order-applied': '\u{1F4CC}',
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function humanInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function claudeDispatchesThisHour(dispatches: OverseerState['claudeDispatches']): number {
  const hourAgo = Date.now() - 3_600_000;
  return dispatches.filter(d => d.ts > hourAgo).length;
}

function uniformMode(config: OverseerConfig): string | null {
  const modes = ALL_DOMAINS.map(d => config.domains[d]?.mode);
  const first = modes[0];
  return modes.every(m => m === first) ? (first ?? null) : null;
}

/* ── API calls ───────────────────────────────────────────────────────────── */

const BASE = '/__admin_overseer';
const jsonHeaders = { 'Content-Type': 'application/json' };
const fetchJson = async <T>(url: string): Promise<T> => (await fetch(url)).json();
const fetchConfig = (): Promise<OverseerConfig> => fetchJson(`${BASE}/config`);
const fetchState = (): Promise<OverseerState> => fetchJson(`${BASE}/state`);
const fetchLog = (limit = 50): Promise<OverseerLogEntry[]> => fetchJson(`${BASE}/log?limit=${limit}`);

async function patchConfig(patch: Record<string, unknown>): Promise<void> {
  await fetch(`${BASE}/config`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(patch) });
}
const postStart = (): Promise<void> => fetch(`${BASE}/start`, { method: 'POST' }).then(() => {});
const postStop = (): Promise<void> => fetch(`${BASE}/stop`, { method: 'POST' }).then(() => {});

async function postOrder(text: string, domains: string[] | 'all'): Promise<void> {
  await fetch(`${BASE}/orders`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ text, domains }) });
}
async function patchOrder(id: string, text: string, domains: string[] | 'all'): Promise<void> {
  await fetch(`${BASE}/orders/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ text, domains }) });
}
async function deleteOrder(id: string): Promise<void> {
  await fetch(`${BASE}/orders/${id}`, { method: 'DELETE' });
}

/* ── Render: Master Bar ──────────────────────────────────────────────────── */

function renderMasterBar(config: OverseerConfig, state: OverseerState): string {
  const running = state.running;
  const dotColor = running ? 'var(--green)' : 'var(--text-quiet)';
  const label = running ? 'OVERSEER ACTIVE' : 'OVERSEER STOPPED';
  const uniform = uniformMode(config);

  const modeBtn = (mode: string, labelText: string): string => {
    const active = uniform === mode;
    const bg = active ? 'background:var(--accent);color:var(--bg);' : '';
    return `<button class="admin-btn admin-btn--small overseer-master-mode" data-mode="${mode}" style="${bg}">${labelText}</button>`;
  };

  const enabledCount = ALL_DOMAINS.filter(d => config.domains[d]?.enabled).length;
  const orderCount = config.standingOrders.length;
  const dispHour = claudeDispatchesThisHour(state.claudeDispatches);
  const maxHour = config.claude.maxDispatchesPerHour;

  return `
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dotColor};"></span>
          <span style="font-family:var(--font-display);font-size:13px;font-weight:700;letter-spacing:1px;">${label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          ${modeBtn('watch', 'Watch All')}
          ${modeBtn('advise', 'Advise All')}
          ${modeBtn('act', 'Act All')}
        </div>
        <button id="overseer-toggle" class="admin-btn admin-btn--small${running ? ' admin-btn--danger' : ''}" style="min-width:60px;">
          ${running ? 'Stop' : 'Start'}
        </button>
      </div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:6px;">
        ${enabledCount}/7 domains &middot; ${orderCount} standing orders &middot; Claude: ${dispHour}/${maxHour} hr
      </div>
    </div>
  `;
}

/* ── Render: Domain Cards ────────────────────────────────────────────────── */

function renderDomainCard(domain: string, dc: DomainConfig, lastTick: number | undefined): string {
  const label = DOMAIN_LABELS[domain] ?? domain;
  const dimStyle = dc.enabled ? '' : 'opacity:0.4;';
  const statusColor = 'var(--green)'; // default green until we track last status

  const modeBtn = (mode: string): string => {
    const active = dc.mode === mode;
    const bg = active ? 'background:var(--accent);color:var(--bg);' : '';
    return `<button class="admin-btn admin-btn--small overseer-mode" data-domain="${domain}" data-mode="${mode}" style="${bg}">${mode.charAt(0).toUpperCase() + mode.slice(1)}</button>`;
  };

  const interval = humanInterval(dc.pollIntervalMs);
  const lastCheck = lastTick ? ago(lastTick) : 'never';

  return `
    <div class="overseer-domain-card" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 14px;${dimStyle}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
          <span style="font-size:13px;font-weight:700;">${escapeHtml(label)}</span>
        </div>
        <button class="admin-btn admin-btn--small overseer-domain-toggle" data-domain="${domain}" style="font-size:9px;padding:2px 8px;">
          ${dc.enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:6px;">
        ${modeBtn('watch')}
        ${modeBtn('advise')}
        ${modeBtn('act')}
      </div>
      <div style="font-size:10px;color:var(--text-dim);">
        Poll: ${interval} &middot; Last: ${lastCheck}
      </div>
    </div>
  `;
}

function renderDomainGrid(config: OverseerConfig, state: OverseerState): string {
  const cards = ALL_DOMAINS.map(d =>
    renderDomainCard(d, config.domains[d], state.lastTick[d]),
  ).join('');
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      ${cards}
    </div>
  `;
}

/* ── Render: Standing Orders ─────────────────────────────────────────────── */

const PILL_ON = 'background:var(--accent);color:var(--bg);';
const PILL_OFF = 'border:1px solid var(--border);color:var(--text-dim);';
const PILL_BASE = 'display:inline-block;font-size:9px;padding:2px 6px;border-radius:3px;margin:1px;';

function renderPills(selected: string[] | 'all', editable = false, idPrefix = ''): string {
  const isAll = selected === 'all';
  const selectedSet = isAll ? new Set(ALL_DOMAINS) : new Set(selected);
  const cls = editable ? 'overseer-edit-pill' : 'overseer-pill';
  const cursor = editable ? 'cursor:pointer;' : 'cursor:default;';
  const extra = editable ? ` data-prefix="${idPrefix}"` : '';
  const allActive = isAll || ALL_DOMAINS.every(d => selectedSet.has(d));
  const allPill = `<span class="${cls}" data-pill="all"${extra} style="${PILL_BASE}${cursor}${allActive ? PILL_ON : PILL_OFF}">All</span>`;
  const pills = ALL_DOMAINS.map(d => {
    const on = selectedSet.has(d);
    return `<span class="${cls}" data-pill="${d}"${extra} style="${PILL_BASE}${cursor}${on ? PILL_ON : PILL_OFF}">${DOMAIN_LABELS[d] ?? d}</span>`;
  }).join('');
  return allPill + pills;
}

function renderOrderCard(order: StandingOrder): string {
  const ageText = ago(order.createdAt);
  return `
    <div class="overseer-order" data-order-id="${order.id}" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 14px;margin-bottom:6px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;margin-bottom:4px;">${escapeHtml(order.text)}</div>
          <div style="margin-bottom:4px;">${renderPills(order.domains)}</div>
          <div style="font-size:10px;color:var(--text-quiet);">${ageText}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="admin-btn admin-btn--small overseer-order-edit" data-order-id="${order.id}">Edit</button>
          <button class="admin-btn admin-btn--small admin-btn--danger overseer-order-remove" data-order-id="${order.id}">&times;</button>
        </div>
      </div>
    </div>
  `;
}

function renderOrderEditCard(order: StandingOrder | null, idPrefix: string): string {
  const text = order ? escapeHtml(order.text) : '';
  const domains = order ? order.domains : 'all';
  const orderId = order ? order.id : '';
  return `
    <div class="overseer-order-edit-card" data-order-id="${orderId}" style="background:var(--bg-panel);border:1px solid var(--accent);border-radius:var(--r-sm);padding:10px 14px;margin-bottom:6px;">
      <textarea id="${idPrefix}-text" style="width:100%;min-height:48px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:6px;font-family:var(--font-body);font-size:12px;resize:vertical;box-sizing:border-box;">${text}</textarea>
      <div style="margin:6px 0;" id="${idPrefix}-pills">${renderPills(domains, true, idPrefix)}</div>
      <div style="display:flex;gap:4px;">
        <button class="admin-btn admin-btn--small overseer-order-save" data-order-id="${orderId}" data-prefix="${idPrefix}">Save</button>
        <button class="admin-btn admin-btn--small overseer-order-cancel">Cancel</button>
      </div>
    </div>
  `;
}

function renderStandingOrdersTab(orders: StandingOrder[]): string {
  const list = orders.map(o => renderOrderCard(o)).join('');
  return `
    <div>
      <button id="overseer-add-order" class="admin-btn admin-btn--small" style="margin-bottom:8px;">+ Add Order</button>
      <div id="overseer-order-insert"></div>
      <div id="overseer-orders-list">
        ${list || '<p style="color:var(--text-dim);font-size:11px;">No standing orders.</p>'}
      </div>
    </div>
  `;
}

/* ── Render: Activity Feed ───────────────────────────────────────────────── */

function renderActivityFeed(log: OverseerLogEntry[]): string {
  if (log.length === 0) {
    return '<p style="color:var(--text-dim);font-size:11px;">No activity yet.</p>';
  }
  const entries = log.map(entry => {
    const actionIcon = ACTION_ICONS[entry.action] ?? '\u{1F4CB}';
    const time = ago(entry.ts);
    const refLink = entry.ref
      ? ` <span style="color:var(--accent);cursor:pointer;" class="overseer-ref-link" data-ref="${escapeHtml(entry.ref)}">${escapeHtml(entry.ref)}</span>`
      : '';
    return `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="flex-shrink:0;">${actionIcon}</span>
        <span style="font-size:10px;color:var(--text-quiet);min-width:48px;">${time}</span>
        <span style="font-size:10px;color:var(--accent);font-family:var(--font-mono);min-width:72px;">[${escapeHtml(entry.domain)}]</span>
        <span style="font-size:11px;flex:1;">${escapeHtml(entry.summary)}${refLink}</span>
      </div>
    `;
  }).join('');
  return `<div>${entries}</div>`;
}

/* ── Render: Tabbed Panel ────────────────────────────────────────────────── */

function renderTabbedPanel(config: OverseerConfig, log: OverseerLogEntry[]): string {
  return `
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden;">
      <div style="display:flex;border-bottom:1px solid var(--border);">
        <button class="overseer-tab admin-btn" data-tab="orders" style="flex:1;border:none;border-radius:0;border-bottom:2px solid var(--accent);font-weight:700;">Standing Orders</button>
        <button class="overseer-tab admin-btn" data-tab="activity" style="flex:1;border:none;border-radius:0;border-bottom:2px solid transparent;color:var(--text-dim);">Activity</button>
      </div>
      <div style="padding:12px 14px;">
        <div id="overseer-tab-orders">${renderStandingOrdersTab(config.standingOrders)}</div>
        <div id="overseer-tab-activity" style="display:none;">${renderActivityFeed(log)}</div>
      </div>
    </div>
  `;
}

/* ── Main render + wiring ────────────────────────────────────────────────── */

export async function renderOverseer(container: HTMLElement): Promise<void> {
  let config: OverseerConfig;
  let state: OverseerState;
  let log: OverseerLogEntry[];

  try {
    [config, state, log] = await Promise.all([
      fetchConfig(),
      fetchState(),
      fetchLog(),
    ]);
  } catch (err) {
    container.innerHTML = `<h2>${icon('shield', 18)} Overseer</h2><p style="color:var(--red-bright);">Failed to load overseer data.</p>`;
    console.warn('[overseer] fetch error:', err);
    return;
  }

  container.innerHTML = `
    <h2 style="margin-bottom:12px;">${icon('shield', 18)} Overseer</h2>
    ${renderMasterBar(config, state)}
    ${renderDomainGrid(config, state)}
    ${renderTabbedPanel(config, log)}
  `;

  wireEvents(container, config);
}

function wireEvents(container: HTMLElement, config: OverseerConfig): void {
  // ── Start / Stop toggle ───────────────────────────────────────────────
  container.querySelector('#overseer-toggle')?.addEventListener('click', async () => {
    const stateNow = await fetchState();
    if (stateNow.running) {
      await postStop();
    } else {
      await postStart();
    }
    await renderOverseer(container);
  });

  // ── Master mode buttons (Watch All / Advise All / Act All) ────────────
  container.querySelectorAll<HTMLElement>('.overseer-master-mode').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      if (!mode) return;
      const domainPatch: Record<string, { mode: string }> = {};
      for (const d of ALL_DOMAINS) {
        domainPatch[d] = { mode };
      }
      await patchConfig({ domains: domainPatch });
      await renderOverseer(container);
    });
  });

  // ── Domain mode buttons ───────────────────────────────────────────────
  container.querySelectorAll<HTMLElement>('.overseer-mode').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const mode = btn.dataset.mode;
      if (!domain || !mode) return;
      await patchConfig({ domains: { [domain]: { mode } } });
      await renderOverseer(container);
    });
  });

  // ── Domain ON/OFF toggle ──────────────────────────────────────────────
  container.querySelectorAll<HTMLElement>('.overseer-domain-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      if (!domain) return;
      const current = config.domains[domain]?.enabled ?? true;
      await patchConfig({ domains: { [domain]: { enabled: !current } } });
      await renderOverseer(container);
    });
  });

  // ── Tab switching ─────────────────────────────────────────────────────
  container.querySelectorAll<HTMLElement>('.overseer-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      const ordersPanel = container.querySelector<HTMLElement>('#overseer-tab-orders');
      const activityPanel = container.querySelector<HTMLElement>('#overseer-tab-activity');
      const tabs = container.querySelectorAll<HTMLElement>('.overseer-tab');
      tabs.forEach(t => {
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--text-dim)';
        t.style.fontWeight = '400';
      });
      tab.style.borderBottomColor = 'var(--accent)';
      tab.style.color = '';
      tab.style.fontWeight = '700';
      if (ordersPanel) ordersPanel.style.display = target === 'orders' ? '' : 'none';
      if (activityPanel) activityPanel.style.display = target === 'activity' ? '' : 'none';
    });
  });

  // ── Add Order ─────────────────────────────────────────────────────────
  container.querySelector('#overseer-add-order')?.addEventListener('click', () => {
    const insert = container.querySelector('#overseer-order-insert');
    if (!insert || insert.children.length > 0) return;
    insert.innerHTML = renderOrderEditCard(null, 'new-order');
    wireOrderEditCard(container, insert, config, null);
  });

  // ── Edit existing orders ──────────────────────────────────────────────
  container.querySelectorAll<HTMLElement>('.overseer-order-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.orderId;
      const order = config.standingOrders.find(o => o.id === orderId);
      if (!order) return;
      const card = btn.closest('.overseer-order') as HTMLElement | null;
      if (!card) return;
      card.innerHTML = renderOrderEditCard(order, `edit-${orderId}`).replace(/<div class="overseer-order-edit-card"[^>]*>/, '').replace(/<\/div>\s*$/, '');
      // Re-wrap: just replace the whole card content
      card.outerHTML = renderOrderEditCard(order, `edit-${orderId}`);
      wireOrderEditCard(container, container, config, order);
    });
  });

  // ── Remove orders ─────────────────────────────────────────────────────
  container.querySelectorAll<HTMLElement>('.overseer-order-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.orderId;
      if (!orderId) return;
      await deleteOrder(orderId);
      await renderOverseer(container);
    });
  });
}

function wireOrderEditCard(
  container: HTMLElement,
  _scope: HTMLElement | Element,
  config: OverseerConfig,
  order: StandingOrder | null,
): void {
  const prefix = order ? `edit-${order.id}` : 'new-order';
  const pillsContainer = container.querySelector(`#${CSS.escape(prefix)}-pills`);

  // Track selected domains
  const selectedDomains = new Set<string>(
    order ? (order.domains === 'all' ? ALL_DOMAINS : order.domains) : ALL_DOMAINS,
  );
  let isAll = order ? order.domains === 'all' : true;

  // Wire pill toggles
  pillsContainer?.querySelectorAll<HTMLElement>('.overseer-edit-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const pillDomain = pill.dataset.pill;
      if (!pillDomain) return;
      if (pillDomain === 'all') {
        isAll = !isAll;
        if (isAll) {
          ALL_DOMAINS.forEach(d => selectedDomains.add(d));
        } else {
          selectedDomains.clear();
        }
      } else {
        if (selectedDomains.has(pillDomain)) {
          selectedDomains.delete(pillDomain);
          isAll = false;
        } else {
          selectedDomains.add(pillDomain);
          isAll = ALL_DOMAINS.every(d => selectedDomains.has(d));
        }
      }
      // Re-render pills
      if (pillsContainer) {
        const domains: string[] | 'all' = isAll ? 'all' : [...selectedDomains];
        pillsContainer.innerHTML = renderPills(domains, true, prefix);
        // Re-wire after re-render
        wireOrderEditCard(container, _scope, config, order);
      }
    });
  });

  // Save
  container.querySelector(`.overseer-order-save[data-prefix="${CSS.escape(prefix)}"]`)
    ?.addEventListener('click', async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>(`#${CSS.escape(prefix)}-text`);
      const text = textarea?.value?.trim();
      if (!text) return;
      const domains: string[] | 'all' = isAll ? 'all' : [...selectedDomains];
      if (order) {
        await patchOrder(order.id, text, domains);
      } else {
        await postOrder(text, domains);
      }
      await renderOverseer(container);
    });

  // Cancel
  container.querySelectorAll('.overseer-order-cancel').forEach(btn => {
    btn.addEventListener('click', async () => {
      await renderOverseer(container);
    });
  });
}

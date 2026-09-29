// admin/src/sections/featureFlags.ts — Feature flag management
import { rtdb } from '../firebase';
import { ref, onValue, set, get } from 'firebase/database';
import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import { getEnvironment } from '../envSwitcher';

interface FeatureFlag {
  name: string;
  description: string;
  enabled: boolean;
  rolloutPct?: number;
  targetUids?: string[];
  updatedAt?: number;
  updatedBy?: string;
}

const DEFAULT_FLAGS: Array<{ name: string; description: string }> = [
  { name: 'ranked_mode', description: 'Enable ranked matchmaking queue' },
  { name: 'cosmetic_shop', description: 'Show cosmetic shop in main menu' },
  { name: 'party_system', description: 'Enable party/group features' },
  { name: 'spectator_mode', description: 'Allow spectating active matches' },
  { name: 'replay_system', description: 'Enable match replay recording' },
  { name: 'chat_system', description: 'Enable in-game text chat' },
  { name: 'friend_invites', description: 'Allow sending friend invites' },
  { name: 'maintenance_mode', description: 'Show maintenance screen to all players' },
  { name: 'debug_overlay', description: 'Show debug info overlay in game' },
  { name: 'new_physics', description: 'Use updated physics engine' },
];

let _container: HTMLElement | null = null;
let _flags: Record<string, FeatureFlag> = {};
let _unsub: (() => void) | null = null;

export async function renderFeatureFlags(container: HTMLElement): Promise<void> {
  _container = container;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('zap', 18)} Feature Flags</h2>
      <div style="display:flex;gap:8px;">
        <button id="ff-add-btn" class="admin-btn admin-btn--small">+ New Flag</button>
        <button id="ff-refresh-btn" class="refresh-btn">Refresh</button>
      </div>
    </div>
    <p style="color:var(--text-dim);font-size:11px;margin-bottom:16px;">
      Environment: <strong style="color:var(--accent);">${getEnvironment().toUpperCase()}</strong> — flags are per-environment
    </p>
    <div id="ff-list"><p style="color:var(--text-dim);">Loading...</p></div>
  `;

  // Subscribe to feature flags in RTDB
  const flagsRef = ref(rtdb, 'config/featureFlags');
  _unsub?.();
  _unsub = onValue(flagsRef, (snap) => {
    const val = snap.val() as Record<string, Partial<FeatureFlag>> | null;
    _flags = {};

    // Initialize from defaults
    for (const def of DEFAULT_FLAGS) {
      _flags[def.name] = {
        name: def.name,
        description: def.description,
        enabled: false,
        ...(val?.[def.name] ?? {}),
      };
    }

    // Include any custom flags from DB
    if (val) {
      for (const [name, flag] of Object.entries(val)) {
        if (!_flags[name]) {
          _flags[name] = {
            name,
            description: flag.description ?? '',
            enabled: flag.enabled ?? false,
            rolloutPct: flag.rolloutPct,
            targetUids: flag.targetUids,
            updatedAt: flag.updatedAt,
            updatedBy: flag.updatedBy,
          };
        }
      }
    }

    renderFlagList();
  });

  container.querySelector('#ff-refresh-btn')?.addEventListener('click', () => renderFeatureFlags(container));

  container.querySelector('#ff-add-btn')?.addEventListener('click', () => {
    const name = window.prompt('Flag name (snake_case):');
    if (!name?.trim()) return;
    const desc = window.prompt('Description:') ?? '';
    const flagName = name.trim().replace(/\s+/g, '_').toLowerCase();
    set(ref(rtdb, `config/featureFlags/${flagName}`), {
      name: flagName,
      description: desc,
      enabled: false,
      updatedAt: Date.now(),
    });
  });
}

function renderFlagList(): void {
  const listEl = document.getElementById('ff-list');
  if (!listEl) return;

  const flags = Object.values(_flags).sort((a, b) => a.name.localeCompare(b.name));

  if (flags.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-dim);">No feature flags configured</p>';
    return;
  }

  listEl.innerHTML = flags.map(flag => {
    const toggleColor = flag.enabled ? 'var(--green)' : 'var(--text-quiet)';
    const toggleBg = flag.enabled ? 'rgba(60,255,60,0.15)' : 'rgba(128,164,174,0.1)';
    const hasPct = flag.rolloutPct != null && flag.rolloutPct < 100;
    const hasTargets = (flag.targetUids?.length ?? 0) > 0;
    const statusText = flag.enabled
      ? (hasPct ? `${flag.rolloutPct}%` : 'ON')
      : 'OFF';
    const updatedText = flag.updatedAt ? `Updated ${new Date(flag.updatedAt).toLocaleDateString()}` : '';
    const pctVal = flag.rolloutPct ?? 100;
    const uidsVal = flag.targetUids?.join(', ') ?? '';

    return `
      <div class="ff-row" data-flag="${escapeHtml(flag.name)}" style="flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;font-family:var(--font-mono);">${escapeHtml(flag.name)}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${escapeHtml(flag.description)}</div>
          ${updatedText ? `<div style="font-size:9px;color:var(--text-quiet);margin-top:2px;">${updatedText}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${hasTargets ? `<span title="User targeting active" style="color:var(--accent);font-size:14px;">${icon('users', 14)}</span>` : ''}
          <button class="ff-toggle" data-flag="${escapeHtml(flag.name)}" data-enabled="${flag.enabled}" style="
            display:inline-flex;align-items:center;gap:6px;
            padding:4px 12px;border-radius:2px;cursor:pointer;
            background:${toggleBg};border:1px solid ${toggleColor};
            color:${toggleColor};font-family:var(--font-display);
            font-size:9px;font-weight:700;letter-spacing:1.5px;
            transition:all 0.15s;
          ">${statusText}</button>
          <button class="ff-delete" data-flag="${escapeHtml(flag.name)}" style="
            background:none;border:1px solid transparent;color:var(--text-quiet);
            cursor:pointer;font-size:14px;padding:4px 8px;border-radius:2px;
            transition:all 0.15s;
          " title="Delete flag">&times;</button>
        </div>
        ${flag.enabled ? `
        <div class="ff-details" style="width:100%;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:9px;font-family:var(--font-display);letter-spacing:1.5px;color:var(--text-dim);min-width:70px;">ROLLOUT %</label>
            <input type="range" class="ff-pct-slider" data-flag="${escapeHtml(flag.name)}" min="0" max="100" value="${pctVal}" style="flex:1;accent-color:var(--accent);height:4px;" />
            <span class="ff-pct-label" style="font-size:11px;font-family:var(--font-mono);color:var(--accent);min-width:36px;text-align:right;">${pctVal}%</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:9px;font-family:var(--font-display);letter-spacing:1.5px;color:var(--text-dim);min-width:70px;">TARGET UIDS</label>
            <input type="text" class="ff-uids-input" data-flag="${escapeHtml(flag.name)}" value="${escapeHtml(uidsVal)}" placeholder="uid1, uid2, ..." style="
              flex:1;background:var(--surface);border:1px solid var(--border);
              color:var(--text);font-family:var(--font-mono);font-size:11px;
              padding:3px 6px;border-radius:2px;
            " />
          </div>
        </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Wire toggle buttons
  listEl.querySelectorAll<HTMLElement>('.ff-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const flagName = btn.dataset.flag;
      const currentEnabled = btn.dataset.enabled === 'true';
      if (!flagName) return;
      btn.textContent = '...';
      await set(ref(rtdb, `config/featureFlags/${flagName}/enabled`), !currentEnabled);
      await set(ref(rtdb, `config/featureFlags/${flagName}/updatedAt`), Date.now());
    });
  });

  // Wire delete buttons
  listEl.querySelectorAll<HTMLElement>('.ff-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const flagName = btn.dataset.flag;
      if (!flagName) return;
      if (!confirm(`Delete flag "${flagName}"?`)) return;
      await set(ref(rtdb, `config/featureFlags/${flagName}`), null);
    });
  });

  // Wire rollout percentage sliders
  listEl.querySelectorAll<HTMLInputElement>('.ff-pct-slider').forEach(slider => {
    const label = slider.parentElement?.querySelector('.ff-pct-label');
    slider.addEventListener('input', () => {
      if (label) label.textContent = `${slider.value}%`;
    });
    slider.addEventListener('change', async () => {
      const flagName = slider.dataset.flag;
      if (!flagName) return;
      const pct = parseInt(slider.value, 10);
      await set(ref(rtdb, `config/featureFlags/${flagName}/rolloutPct`), pct);
      await set(ref(rtdb, `config/featureFlags/${flagName}/updatedAt`), Date.now());
    });
  });

  // Wire target UIDs inputs
  listEl.querySelectorAll<HTMLInputElement>('.ff-uids-input').forEach(input => {
    input.addEventListener('change', async () => {
      const flagName = input.dataset.flag;
      if (!flagName) return;
      const uids = input.value
        .split(',')
        .map(u => u.trim())
        .filter(u => u.length > 0);
      await set(ref(rtdb, `config/featureFlags/${flagName}/targetUids`), uids.length > 0 ? uids : null);
      await set(ref(rtdb, `config/featureFlags/${flagName}/updatedAt`), Date.now());
    });
  });
}

export function cleanupFeatureFlags(): void {
  _unsub?.();
  _unsub = null;
}

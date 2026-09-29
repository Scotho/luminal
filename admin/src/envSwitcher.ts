// admin/src/envSwitcher.ts — Split DB / Game Server environment selectors

import { icon } from './ui/icons';
import { getServiceStatus, onServiceStatusChanged } from './ui/statusBanner';

export type Environment = 'local' | 'test' | 'live';

const LEGACY_KEY = 'luminal-admin-environment';
const DB_STORAGE_KEY = 'luminal-admin-db-env';
const GAME_STORAGE_KEY = 'luminal-admin-game-env';

export interface EnvironmentConfig {
  label: string;
  projectId: string;
  databaseURL: string;
  firestoreHost?: string;
  authHost?: string;
  isEmulator: boolean;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  local: {
    label: 'LOCAL',
    projectId: 'luminal-game',
    databaseURL: 'http://localhost:9000',
    firestoreHost: 'localhost:8080',
    authHost: 'http://localhost:9099',
    isEmulator: true,
  },
  test: {
    label: 'TEST',
    projectId: 'luminal-game',
    databaseURL: 'https://luminal-game-default-rtdb.firebaseio.com',
    isEmulator: false,
  },
  live: {
    label: 'LIVE',
    projectId: 'luminal-game',
    databaseURL: 'https://luminal-game-default-rtdb.firebaseio.com',
    isEmulator: false,
  },
};

const ENV_COLORS: Record<Environment, string> = {
  local: '#22c55e',
  test: '#f59e0b',
  live: '#ef4444',
};

// ── DB Environment ──────────────────────────────────────

export function getDbEnvironment(): Environment {
  const stored = localStorage.getItem(DB_STORAGE_KEY);
  if (stored && stored in ENVIRONMENTS) return stored as Environment;
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && legacy in ENVIRONMENTS) return legacy as Environment;
  return 'live';
}

export function setDbEnvironment(env: Environment): void {
  localStorage.setItem(DB_STORAGE_KEY, env);
}

// ── Game Server Environment ─────────────────────────────

export function getGameEnvironment(): Environment {
  const stored = localStorage.getItem(GAME_STORAGE_KEY);
  if (stored && stored in ENVIRONMENTS) return stored as Environment;
  return 'local';
}

export function setGameEnvironment(env: Environment): void {
  localStorage.setItem(GAME_STORAGE_KEY, env);
}

// ── Backward compat aliases ─────────────────────────────

export function getEnvironment(): Environment {
  return getDbEnvironment();
}

export function setEnvironment(env: Environment): void {
  setDbEnvironment(env);
}

export function getConfig(): EnvironmentConfig {
  return ENVIRONMENTS[getEnvironment()];
}

// ── Shared dropdown renderer ────────────────────────────

/** Map environment name to its service status key. */
const ENV_STATUS_KEY: Record<Environment, string> = {
  local: 'local',
  test: 'test',
  live: 'live',
};

function renderEnvDropdown(current: Environment): string {
  const envs: Environment[] = ['local', 'test', 'live'];
  const items = envs.map(env => {
    const color = ENV_COLORS[env];
    const isActive = env === current;
    const svc = getServiceStatus(ENV_STATUS_KEY[env]);
    const DOT_COLORS: Record<string, string> = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red-bright,#d45234)', dim: 'var(--text-quiet)' };
    const dotColor = DOT_COLORS[svc.color] ?? DOT_COLORS.dim;
    return `
      <div class="env-option" data-env="${env}" style="
        display:flex;align-items:center;gap:6px;
        padding:6px 10px;cursor:pointer;
        background:${isActive ? `${color}18` : 'transparent'};
        border-left:2px solid ${isActive ? color : 'transparent'};
        transition:background 0.1s, border-color 0.1s;
      " onmouseover="if(!${isActive})this.style.background='rgba(255,255,255,0.04)'"
         onmouseout="this.style.background='${isActive ? `${color}18` : 'transparent'}'">
        <span style="font-weight:${isActive ? '700' : '400'};font-size:11px;flex:1;color:${color};">${ENVIRONMENTS[env].label}</span>
        <span style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--text-dim);font-family:var(--font-display);text-transform:uppercase;letter-spacing:0.5px;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor};box-shadow:0 0 3px ${dotColor};"></span>
          ${svc.text.replace(/^(LIVE|TEST|LOCAL)\s*/, '')}
        </span>
      </div>
    `;
  }).join('');

  return `
    <div class="env-split-dropdown" style="
      position:absolute;top:100%;left:0;margin-top:4px;
      background:var(--bg-card,#1a1a2e);border:1px solid var(--border,#333);
      border-radius:4px;min-width:180px;z-index:1000;
      box-shadow:0 4px 12px rgba(0,0,0,0.4);overflow:hidden;
    ">
      ${items}
    </div>
  `;
}

// ── Selector factory ────────────────────────────────────

// Global registry: only one dropdown open at a time (shared with serverDropdowns)
const _openDropdownClosers: Array<() => void> = [];

export function closeAllDropdowns(): void {
  for (const close of _openDropdownClosers) close();
  _openDropdownClosers.length = 0;
}

export function registerDropdownCloser(fn: () => void): void {
  _openDropdownClosers.push(fn);
}

function createSelector(
  container: HTMLElement,
  iconName: string,
  title: string,
  btnId: string,
  getEnv: () => Environment,
  setEnv: (env: Environment) => void,
  onChange: () => void,
): () => void {
  let dropdownOpen = false;

  function closeThis(): void {
    if (dropdownOpen) {
      dropdownOpen = false;
      render();
    }
  }

  function render(): void {
    const current = getEnv();
    const color = ENV_COLORS[current];
    container.innerHTML = `
      <button id="${btnId}" class="env-split-btn" title="${title}">
        ${icon(iconName, 14)}
        <span class="env-split-label" style="color:${color};">${ENVIRONMENTS[current].label}</span>
        <span class="env-split-caret">\u25BE</span>
      </button>
      ${dropdownOpen ? renderEnvDropdown(current) : ''}
    `;
  }

  function handleClick(e: MouseEvent): void {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const option = target.closest('.env-option') as HTMLElement | null;
    if (option) {
      const env = option.dataset.env as Environment;
      if (env && env !== getEnv()) {
        setEnv(env);
        dropdownOpen = false;
        render();
        onChange();
      } else {
        dropdownOpen = false;
        render();
      }
      return;
    }
    if (target.closest(`#${btnId}`)) {
      const wasOpen = dropdownOpen;
      closeAllDropdowns();
      if (!wasOpen) {
        dropdownOpen = true;
        _openDropdownClosers.push(closeThis);
      }
      render();
    }
  }

  function handleDocClick(e: MouseEvent): void {
    if (!dropdownOpen) return;
    if (!container.contains(e.target as HTMLElement)) {
      dropdownOpen = false;
      render();
    }
  }

  container.addEventListener('click', handleClick);
  document.addEventListener('click', handleDocClick);
  render();

  // Re-render dropdown when service status changes (keeps status dots current)
  const statusUnsub = onServiceStatusChanged(() => {
    if (dropdownOpen) render();
  });

  return () => {
    container.removeEventListener('click', handleClick);
    document.removeEventListener('click', handleDocClick);
    statusUnsub();
  };
}

// ── Public API ──────────────────────────────────────────

export function renderDbSelector(container: HTMLElement, onChange: () => void): () => void {
  return createSelector(container, 'database', 'Database environment', 'db-env-badge', getDbEnvironment, setDbEnvironment, onChange);
}

export function renderGameSelector(container: HTMLElement, onChange: () => void): () => void {
  return createSelector(container, 'gamepad-2', 'Game server environment', 'game-env-badge', getGameEnvironment, setGameEnvironment, onChange);
}

// Keep old export for any remaining callers
export function renderEnvIndicator(container: HTMLElement, onChange: () => void): () => void {
  return renderDbSelector(container, onChange);
}

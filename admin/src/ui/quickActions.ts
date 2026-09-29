// admin/src/ui/quickActions.ts — Floating action button for common operations
import { icon } from './icons';

let _fab: HTMLElement | null = null;
let _menu: HTMLElement | null = null;
let _open = false;

interface QuickAction {
  label: string;
  iconName: string;
  action: () => void;
}

function getActions(): QuickAction[] {
  return [
    {
      label: 'Run Unit Tests',
      iconName: 'play',
      action: () => {
        fetch('/__admin_exec/test?config=unit', { method: 'POST' }).catch(() => {});
      },
    },
    {
      label: 'Git Status',
      iconName: 'git-branch',
      action: async () => {
        try {
          const res = await fetch('/__admin_git/status');
          const data = await res.json();
          const msg = `Branch: ${data.branch}\nAhead: ${data.ahead ?? 0}\nBehind: ${data.behind ?? 0}\nModified: ${(data.unstaged ?? []).length}`;
          alert(msg);
        } catch { alert('Failed to get git status'); }
      },
    },
    {
      label: 'Deploy Check',
      iconName: 'rocket',
      action: async () => {
        try {
          const res = await fetch('/__admin_deploy/status');
          const data = await res.json();
          alert(data.status ?? 'No active deployment');
        } catch { alert('No deployment info available'); }
      },
    },
    {
      label: 'Backup Data',
      iconName: 'download',
      action: async () => {
        try {
          const res = await fetch('/__admin_data/backup', { method: 'POST' });
          const data = await res.json();
          alert(data.message ?? 'Backup created');
        } catch { alert('Backup endpoint not available'); }
      },
    },
  ];
}

function toggleMenu(): void {
  if (_open) closeMenu();
  else openMenu();
}

function openMenu(): void {
  if (_menu) return;
  _open = true;
  _fab?.classList.add('open');

  _menu = document.createElement('div');
  _menu.className = 'quick-actions-menu';

  const actions = getActions();
  for (const act of actions) {
    const item = document.createElement('button');
    item.className = 'quick-actions-item';
    item.innerHTML = `${icon(act.iconName, 14)} ${act.label}`;
    item.addEventListener('click', () => {
      closeMenu();
      act.action();
    });
    _menu.appendChild(item);
  }

  const shell = document.getElementById('app-shell') ?? document.body;
  shell.appendChild(_menu);
}

function closeMenu(): void {
  _open = false;
  _fab?.classList.remove('open');
  _menu?.remove();
  _menu = null;
}

export function initQuickActions(): void {
  _fab = document.createElement('button');
  _fab.className = 'quick-actions-fab';
  _fab.innerHTML = '+';
  _fab.title = 'Quick Actions';
  _fab.addEventListener('click', toggleMenu);

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (_open && _fab && _menu && !_fab.contains(e.target as Node) && !_menu.contains(e.target as Node)) {
      closeMenu();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _open) closeMenu();
  });

  const shell = document.getElementById('app-shell') ?? document.body;
  shell.appendChild(_fab);
}

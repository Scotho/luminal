import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileIcon, escapeText, renderBreadcrumb, showContextMenu } from '../sections/fileBrowserTree';
import type { FsEntry } from '../sections/fileBrowserTree';
import { renderPreview, fetchFileContent } from '../sections/fileBrowserPreview';

// ── escapeText ────────────────────────────────────────────────────────────────

describe('escapeText', () => {
  it('escapes HTML entities', () => {
    const result = escapeText('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('returns plain text unchanged', () => {
    expect(escapeText('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeText('')).toBe('');
  });

  it('escapes ampersands and quotes', () => {
    const result = escapeText('a & b "c"');
    expect(result).toContain('&amp;');
  });
});

// ── fileIcon ──────────────────────────────────────────────────────────────────

describe('fileIcon', () => {
  it('returns TS label for .ts files', () => {
    const html = fileIcon('.ts');
    expect(html).toContain('TS');
    expect(html).toContain('#3178c6');
  });

  it('returns JS label for .js files', () => {
    const html = fileIcon('.js');
    expect(html).toContain('JS');
    expect(html).toContain('#f7df1e');
  });

  it('returns HT label for .html files', () => {
    const html = fileIcon('.html');
    expect(html).toContain('HT');
    expect(html).toContain('#e34c26');
  });

  it('returns MD label for .md files', () => {
    const html = fileIcon('.md');
    expect(html).toContain('MD');
    expect(html).toContain('#519aba');
  });

  it('returns FL label for unknown extensions', () => {
    const html = fileIcon('.xyz');
    expect(html).toContain('FL');
    expect(html).toContain('var(--text-dim)');
  });

  it('is case-insensitive for known extensions', () => {
    // The FILE_ICONS map uses lowercase keys; the function lowercases input
    const html = fileIcon('.TS');
    // fileIcon lowercases the ext before lookup
    expect(html).toContain('TS');
  });
});

// ── renderBreadcrumb ──────────────────────────────────────────────────────────

describe('renderBreadcrumb', () => {
  it('renders root-only breadcrumb for "." path', () => {
    const onNavigate = vi.fn();
    const el = renderBreadcrumb('.', onNavigate);
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('root');
  });

  it('renders path segments as buttons', () => {
    const onNavigate = vi.fn();
    const el = renderBreadcrumb('src/sections/fileBrowser', onNavigate);
    const buttons = el.querySelectorAll('button');
    // root + src + sections + fileBrowser
    expect(buttons.length).toBe(4);
    expect(buttons[0].textContent).toBe('root');
    expect(buttons[1].textContent).toBe('src');
    expect(buttons[2].textContent).toBe('sections');
    expect(buttons[3].textContent).toBe('fileBrowser');
  });

  it('navigates to root on root click', () => {
    const onNavigate = vi.fn();
    const el = renderBreadcrumb('src/test', onNavigate);
    const rootBtn = el.querySelectorAll('button')[0];
    rootBtn.click();
    expect(onNavigate).toHaveBeenCalledWith('.');
  });

  it('navigates to accumulated path on segment click', () => {
    const onNavigate = vi.fn();
    const el = renderBreadcrumb('src/sections/git', onNavigate);
    const buttons = el.querySelectorAll('button');
    // Click 'sections' (index 2) — should navigate to 'src/sections'
    buttons[2].click();
    expect(onNavigate).toHaveBeenCalledWith('src/sections');
  });

  it('inserts separator spans between segments', () => {
    const el = renderBreadcrumb('a/b', vi.fn());
    const separators = el.querySelectorAll('span');
    // Two separators: between root and 'a', between 'a' and 'b'
    expect(separators.length).toBe(2);
  });

  it('normalizes backslashes to forward slashes', () => {
    const onNavigate = vi.fn();
    const el = renderBreadcrumb('src\\sections\\git', onNavigate);
    const buttons = el.querySelectorAll('button');
    // root + src + sections + git
    expect(buttons.length).toBe(4);
  });
});

// ── showContextMenu ───────────────────────────────────────────────────────────

describe('showContextMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates a context menu in the DOM', () => {
    showContextMenu(100, 200, [
      { label: 'Open', action: vi.fn() },
      { label: 'Delete', action: vi.fn() },
    ]);
    const menu = document.getElementById('fb-context-menu');
    expect(menu).toBeTruthy();
    expect(menu!.children.length).toBe(2);
    expect(menu!.children[0].textContent).toBe('Open');
    expect(menu!.children[1].textContent).toBe('Delete');
  });

  it('creates the menu as a fixed-position element', () => {
    showContextMenu(150, 250, [{ label: 'Test', action: vi.fn() }]);
    const menu = document.getElementById('fb-context-menu');
    expect(menu).toBeTruthy();
    // The menu is appended to document.body and has z-index for overlay
    expect(menu!.parentElement).toBe(document.body);
  });

  it('calls item action on click and removes menu', () => {
    const action = vi.fn();
    showContextMenu(0, 0, [{ label: 'Run', action }]);
    const menu = document.getElementById('fb-context-menu');
    const item = menu!.children[0] as HTMLElement;
    item.click();
    expect(action).toHaveBeenCalledOnce();
    // Menu should be removed after click
    expect(document.getElementById('fb-context-menu')).toBeNull();
  });

  it('replaces previous context menu when opening a new one', () => {
    showContextMenu(0, 0, [{ label: 'First', action: vi.fn() }]);
    showContextMenu(0, 0, [{ label: 'Second', action: vi.fn() }]);
    const menus = document.querySelectorAll('#fb-context-menu');
    expect(menus.length).toBe(1);
    expect(menus[0].children[0].textContent).toBe('Second');
  });
});

// ── renderPreview ─────────────────────────────────────────────────────────────

describe('renderPreview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders a close button that invokes onClose', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onClose = vi.fn();

    renderPreview(container, 'src/main.ts', 'main.ts', '.ts', onClose);

    const closeBtn = container.querySelector('button');
    expect(closeBtn).toBeTruthy();
    expect(closeBtn!.textContent).toContain('Close');
    closeBtn!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows "No preview available" for unknown extensions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderPreview(container, 'data.bin', 'data.bin', '.bin', vi.fn());

    expect(container.textContent).toContain('No preview available');
    expect(container.textContent).toContain('data.bin');
  });

  it('renders an image element for image extensions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderPreview(container, 'logo.png', 'logo.png', '.png', vi.fn());

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.src).toContain('logo.png');
  });

  it('displays file path in the header', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderPreview(container, 'src/components/App.tsx', 'App.tsx', '.tsx', vi.fn());

    expect(container.textContent).toContain('src/components/App.tsx');
  });
});

// ── fetchFileContent ──────────────────────────────────────────────────────────

describe('fetchFileContent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns file content on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('console.log("hello");'),
    }));

    const content = await fetchFileContent('src/main.ts');
    expect(content).toBe('console.log("hello");');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve(''),
    }));

    await expect(fetchFileContent('missing.ts')).rejects.toThrow('Failed to read');
  });
});

// ── fileBrowser module ────────────────────────────────────────────────────────

describe('fileBrowser module', () => {
  it('can be imported without error', async () => {
    const mod = await import('../sections/fileBrowser');
    expect(mod).toBeDefined();
    expect(typeof mod.renderFileBrowser).toBe('function');
  });
});

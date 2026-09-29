import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the character-select audio / preview hooks so we can assert the
// lifecycle without booting the real showroom renderer.
const mockEnter = vi.fn();
const mockExit = vi.fn();
vi.mock('../characterSelectUI', () => ({
  onCharacterSelectEnter: (...args: unknown[]) => mockEnter(...args),
  onCharacterSelectExit: (...args: unknown[]) => mockExit(...args),
}));

// Import after the mock so resultLoadoutEmbed picks up the stubbed hooks.
const {
  showLoadoutInResultScreen,
  hideLoadoutInResultScreen,
  isLoadoutEmbeddedInResult,
  _resetForTesting,
} = await import('../resultLoadoutEmbed');

// ── DOM scaffold ─────────────────────────────────────────────

function setupDom(): {
  overlay: HTMLElement;
  content: HTMLElement;
  sibling: HTMLElement;
  mount: HTMLElement;
} {
  // Purge the setupDom.ts-loaded index.html body so we control the DOM.
  document.body.innerHTML = '';

  // Character-select overlay with a `.content` child AND a sibling node
  // placed AFTER `.content` so the restore-on-hide path has a concrete
  // `nextSibling` to compare against.
  const overlay = document.createElement('div');
  overlay.id = 'character-select-overlay';
  overlay.className = 'overlay-screen hidden';

  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  overlay.appendChild(vignette);

  const content = document.createElement('div');
  content.className = 'content';
  content.innerHTML = '<div class="cs-layout"><div class="cs-showroom"></div></div>';
  overlay.appendChild(content);

  // A sibling *after* .content so we can verify restore puts .content back
  // in front of it (important for exact DOM order).
  const sibling = document.createElement('div');
  sibling.className = 'cs-after-content-sentinel';
  overlay.appendChild(sibling);

  // Result screen + mount.
  const result = document.createElement('div');
  result.id = 'result';
  const mount = document.createElement('div');
  mount.id = 'result-loadout-mount';
  mount.className = 'result-loadout-mount hidden';
  result.appendChild(mount);

  document.body.appendChild(overlay);
  document.body.appendChild(result);

  return { overlay, content, sibling, mount };
}

// ── Tests ────────────────────────────────────────────────────

describe('resultLoadoutEmbed', () => {
  beforeEach(() => {
    mockEnter.mockClear();
    mockExit.mockClear();
    _resetForTesting();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    _resetForTesting();
  });

  it('showLoadoutInResultScreen reparents .content into #result-loadout-mount', () => {
    const { content, mount } = setupDom();
    expect(content.parentElement?.id).toBe('character-select-overlay');

    showLoadoutInResultScreen();

    expect(content.parentElement).toBe(mount);
    expect(mount.classList.contains('hidden')).toBe(false);
    expect(isLoadoutEmbeddedInResult()).toBe(true);
  });

  it('show calls onCharacterSelectEnter to resume showroom audio/preview', () => {
    setupDom();

    showLoadoutInResultScreen();

    expect(mockEnter).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('hideLoadoutInResultScreen restores .content to original parent and position', () => {
    const { overlay, content, sibling, mount } = setupDom();

    showLoadoutInResultScreen();
    expect(content.parentElement).toBe(mount);

    hideLoadoutInResultScreen();

    expect(content.parentElement).toBe(overlay);
    // Must be restored BEFORE the sentinel sibling so DOM order is preserved.
    expect(content.nextSibling).toBe(sibling);
    expect(mount.classList.contains('hidden')).toBe(true);
    expect(isLoadoutEmbeddedInResult()).toBe(false);
  });

  it('hide calls onCharacterSelectExit to stop showroom audio', () => {
    setupDom();

    showLoadoutInResultScreen();
    mockEnter.mockClear();
    hideLoadoutInResultScreen();

    expect(mockExit).toHaveBeenCalledTimes(1);
  });

  it('show is idempotent — second call with no hide in between is a no-op', () => {
    const { mount } = setupDom();

    showLoadoutInResultScreen();
    expect(mockEnter).toHaveBeenCalledTimes(1);
    const contentAfterFirst = mount.firstElementChild;

    showLoadoutInResultScreen();
    expect(mockEnter).toHaveBeenCalledTimes(1); // not re-entered
    expect(mount.firstElementChild).toBe(contentAfterFirst);
    expect(isLoadoutEmbeddedInResult()).toBe(true);
  });

  it('hide is idempotent — safe to call when not embedded', () => {
    setupDom();

    expect(() => hideLoadoutInResultScreen()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();

    // After a show/hide cycle, a second hide is still safe.
    showLoadoutInResultScreen();
    hideLoadoutInResultScreen();
    mockExit.mockClear();
    hideLoadoutInResultScreen();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('show → hide → show cycle works across multiple result screens', () => {
    const { overlay, content, mount } = setupDom();

    showLoadoutInResultScreen();
    expect(content.parentElement).toBe(mount);

    hideLoadoutInResultScreen();
    expect(content.parentElement).toBe(overlay);

    showLoadoutInResultScreen();
    expect(content.parentElement).toBe(mount);
    expect(mockEnter).toHaveBeenCalledTimes(2);
    expect(mockExit).toHaveBeenCalledTimes(1);
  });

  it('noop gracefully if overlay or mount is missing', () => {
    // Only create the mount — no character-select overlay at all.
    document.body.innerHTML = '';
    const result = document.createElement('div');
    result.id = 'result';
    const mount = document.createElement('div');
    mount.id = 'result-loadout-mount';
    mount.className = 'result-loadout-mount hidden';
    result.appendChild(mount);
    document.body.appendChild(result);

    expect(() => showLoadoutInResultScreen()).not.toThrow();
    expect(isLoadoutEmbeddedInResult()).toBe(false);
    expect(mockEnter).not.toHaveBeenCalled();
  });
});

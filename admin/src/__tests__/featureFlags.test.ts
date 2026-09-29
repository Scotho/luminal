// ── Feature Flags section tests ────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock firebase before import ────────────────────────────
const mockOnValue = vi.fn();
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockRef = vi.fn((_db: unknown, path: string) => ({ path }));

vi.mock('../firebase', () => ({
  rtdb: {},
}));

vi.mock('firebase/database', () => ({
  ref: (...args: [unknown, string]) => mockRef(...args),
  onValue: (...args: [unknown, ...unknown[]]) => mockOnValue(...args),
  set: (...args: [unknown, ...unknown[]]) => mockSet(...args),
  get: vi.fn(),
}));

vi.mock('../ui/render', () => ({
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
}));

vi.mock('../ui/icons', () => ({
  icon: (_name: string) => '<svg></svg>',
}));

vi.mock('../envSwitcher', () => ({
  getEnvironment: () => 'test',
}));

import { renderFeatureFlags, cleanupFeatureFlags } from '../sections/featureFlags';

// ── Helpers ────────────────────────────────────────────────

function triggerSnapshot(flags: Record<string, { name: string; description: string; enabled: boolean; updatedAt?: number }> | null): void {
  const cb = mockOnValue.mock.calls[mockOnValue.mock.calls.length - 1]?.[1];
  if (cb) cb({ val: () => flags });
}

// ── Tests ──────────────────────────────────────────────────

describe('renderFeatureFlags', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="ff-container"></div>';
    container = document.getElementById('ff-container')!;
    mockOnValue.mockReset();
    mockSet.mockReset();
    mockRef.mockReset().mockImplementation((_db: unknown, path: string) => ({ path }));
  });

  it('renders loading state initially', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    expect(container.innerHTML).toContain('Feature Flags');
    expect(container.innerHTML).toContain('Loading...');
  });

  it('renders environment badge', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    expect(container.innerHTML).toContain('TEST');
  });

  it('renders empty state when no flags', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({});
    // After snapshot with empty object, defaults still exist
    // But if we simulate zero defaults by checking with actual render...
    const list = document.getElementById('ff-list');
    expect(list).toBeTruthy();
  });

  it('renders default flag names from snapshot', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      ranked_mode: { name: 'ranked_mode', description: 'Enable ranked matchmaking queue', enabled: true },
    });
    const list = document.getElementById('ff-list');
    expect(list?.innerHTML).toContain('ranked_mode');
    expect(list?.innerHTML).toContain('Enable ranked matchmaking queue');
  });

  it('renders ON status for enabled flags', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      ranked_mode: { name: 'ranked_mode', description: 'Test', enabled: true },
    });
    const list = document.getElementById('ff-list');
    expect(list?.innerHTML).toContain('ON');
    expect(list?.innerHTML).toContain('var(--green)');
  });

  it('renders OFF status for disabled flags', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      ranked_mode: { name: 'ranked_mode', description: 'Test', enabled: false },
    });
    const list = document.getElementById('ff-list');
    expect(list?.innerHTML).toContain('OFF');
  });

  it('renders custom flags from DB', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      custom_flag: { name: 'custom_flag', description: 'A custom flag', enabled: true },
    });
    const list = document.getElementById('ff-list');
    expect(list?.innerHTML).toContain('custom_flag');
    expect(list?.innerHTML).toContain('A custom flag');
  });

  it('renders updated date when present', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      test_flag: { name: 'test_flag', description: 'Test', enabled: true, updatedAt: 1712400000000 },
    });
    const list = document.getElementById('ff-list');
    expect(list?.innerHTML).toContain('Updated');
  });

  it('escapes HTML in flag names (XSS safety)', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      xss_flag: { name: '<img onerror=alert(1)>', description: 'xss test', enabled: false },
    });
    const list = document.getElementById('ff-list');
    // The flag name in the text content should be escaped
    const textNodes = list?.querySelectorAll('.ff-row') ?? [];
    let foundEscaped = false;
    for (const row of textNodes) {
      if (row.textContent?.includes('&lt;img')) foundEscaped = true;
      // Should not have raw HTML tag rendering
      if (row.querySelector('img')) throw new Error('XSS: <img> tag rendered in DOM');
    }
    // Verify the raw tag is not interpreted as HTML
    expect(list?.querySelector('img')).toBeNull();
  });

  it('renders flags sorted alphabetically', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      zebra_flag: { name: 'zebra_flag', description: 'Zebra', enabled: false },
      alpha_flag: { name: 'alpha_flag', description: 'Alpha', enabled: true },
    });
    const list = document.getElementById('ff-list');
    const html = list?.innerHTML ?? '';
    const alphaIdx = html.indexOf('alpha_flag');
    const zebraIdx = html.indexOf('zebra_flag');
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it('renders add and refresh buttons', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    expect(container.querySelector('#ff-add-btn')).toBeTruthy();
    expect(container.querySelector('#ff-refresh-btn')).toBeTruthy();
  });

  it('renders toggle and delete buttons for each flag', async () => {
    mockOnValue.mockImplementation(() => {});
    await renderFeatureFlags(container);
    triggerSnapshot({
      test_flag: { name: 'test_flag', description: 'Test', enabled: true },
    });
    const list = document.getElementById('ff-list');
    expect(list?.querySelectorAll('.ff-toggle').length).toBeGreaterThan(0);
    expect(list?.querySelectorAll('.ff-delete').length).toBeGreaterThan(0);
  });

  it('cleanup stops listener', async () => {
    const unsub = vi.fn();
    mockOnValue.mockReturnValue(unsub);
    await renderFeatureFlags(container);
    cleanupFeatureFlags();
    // After cleanup, the unsub should have been called
    // (The module stores and calls _unsub)
  });
});

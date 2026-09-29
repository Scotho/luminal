// ── Settings Store tests ───────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

// We need to reimport the module fresh each time because of the _settings cache.
// Use vi.resetModules() + dynamic import.

describe('settingsStore', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    storage = mockLocalStorage();
    storage.clear();
  });

  async function getModule() {
    return await import('../settingsStore');
  }

  it('loadSettings returns defaults when localStorage is empty', async () => {
    const { loadSettings } = await getModule();
    const settings = loadSettings();
    expect(settings.autoRefreshEnabled).toBe(true);
    expect(settings.autoRefreshIntervalMs).toBe(300000);
    expect(settings.claudeTimeoutMin).toBe(30);
    expect(settings.maxConcurrentAgents).toBe(3);
    expect(settings.toastDurationMs).toBe(4000);
    expect(settings.suppressToastsDuringChat).toBe(true);
    expect(settings.defaultSection).toBe('live');
    expect(settings.fontFamily).toBe('default');
    expect(settings.ccTarget).toBe('cc');
  });

  it('loadSettings merges stored values with defaults', async () => {
    storage.set('luminal-admin-settings', JSON.stringify({
      autoRefreshEnabled: false,
      claudeTimeoutMin: 60,
    }));
    const { loadSettings } = await getModule();
    const settings = loadSettings();
    expect(settings.autoRefreshEnabled).toBe(false);
    expect(settings.claudeTimeoutMin).toBe(60);
    // Other values remain at defaults
    expect(settings.maxConcurrentAgents).toBe(3);
    expect(settings.defaultSection).toBe('live');
  });

  it('loadSettings returns defaults on corrupt JSON', async () => {
    storage.set('luminal-admin-settings', 'not-json{{{');
    const { loadSettings } = await getModule();
    const settings = loadSettings();
    expect(settings.autoRefreshEnabled).toBe(true);
    expect(settings.defaultSection).toBe('live');
  });

  it('loadSettings caches result and returns same object', async () => {
    const { loadSettings } = await getModule();
    const a = loadSettings();
    const b = loadSettings();
    expect(a).toBe(b);
  });

  it('saveSettings persists to localStorage', async () => {
    const { loadSettings, saveSettings } = await getModule();
    loadSettings(); // initialize
    saveSettings({ autoRefreshEnabled: false });
    const stored = storage.get('luminal-admin-settings');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.autoRefreshEnabled).toBe(false);
  });

  it('saveSettings merges into existing settings', async () => {
    const { loadSettings, saveSettings } = await getModule();
    loadSettings();
    saveSettings({ claudeTimeoutMin: 10 });
    saveSettings({ maxConcurrentAgents: 5 });
    const stored = JSON.parse(storage.get('luminal-admin-settings')!);
    expect(stored.claudeTimeoutMin).toBe(10);
    expect(stored.maxConcurrentAgents).toBe(5);
  });

  it('saveSettings notifies listeners', async () => {
    const { loadSettings, saveSettings, onSettingsChange } = await getModule();
    loadSettings();
    const cb = vi.fn();
    onSettingsChange(cb);
    saveSettings({ fontFamily: 'mono' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onSettingsChange returns unsubscribe function', async () => {
    const { loadSettings, saveSettings, onSettingsChange } = await getModule();
    loadSettings();
    const cb = vi.fn();
    const unsub = onSettingsChange(cb);
    unsub();
    saveSettings({ fontFamily: 'mono' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('getSetting returns individual setting value', async () => {
    const { getSetting } = await getModule();
    expect(getSetting('defaultSection')).toBe('live');
    expect(getSetting('ccTarget')).toBe('cc');
  });

  it('getSetting reflects updates after saveSettings', async () => {
    const { getSetting, saveSettings } = await getModule();
    expect(getSetting('ccTarget')).toBe('cc');
    saveSettings({ ccTarget: 'aider' });
    expect(getSetting('ccTarget')).toBe('aider');
  });

  it('saveSettings handles multiple updates in sequence', async () => {
    const { loadSettings, saveSettings, getSetting } = await getModule();
    loadSettings();
    saveSettings({ toastDurationMs: 2000 });
    saveSettings({ toastDurationMs: 8000 });
    expect(getSetting('toastDurationMs')).toBe(8000);
  });
});

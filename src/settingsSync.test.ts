// ── settingsSync unit tests ───────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// ── Mock Firebase modules BEFORE importing settingsSync ───
const mockUpdateDoc = vi.fn(() => Promise.resolve());
const mockDoc = vi.fn((_db: unknown, _col: string, id: string) => ({ __id: id }));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

vi.mock('./firebase', () => ({
  db: { __db: true },
  auth: { currentUser: null },
}));

vi.mock('./events', () => ({
  EVT_SETTINGS_RESTORED: 'luminal-settings-restored',
}));

vi.mock('./netLog', () => ({
  net: { log: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('./swallow', () => ({
  warnDev: vi.fn(),
}));

import {
  initSettingsSync,
  stopSettingsSync,
  notifySettingChanged,
  _resetForTesting,
} from './settingsSync';

// ── Helpers ──────────────────────────────────────────────

const SENTINEL_KEY = 'luminal-gfx-preset';
const DEBOUNCE_MS = 5_000;

function fillLocalStorage(): void {
  localStorage.setItem(SENTINEL_KEY, 'high');
}

function emptyLocalStorage(): void {
  localStorage.clear();
}

// ── Setup / Teardown ─────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  emptyLocalStorage();
  _resetForTesting();
});

afterEach(() => {
  vi.useRealTimers();
  emptyLocalStorage();
  _resetForTesting();
});

// ── Init / Stop lifecycle ─────────────────────────────────

describe('initSettingsSync', () => {
  it('enables sync and stores uid', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    // After init, notifySettingChanged should schedule an upload (sync is enabled)
    notifySettingChanged();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
  });

  it('registers beforeunload listener', () => {
    fillLocalStorage();
    const addSpy = vi.spyOn(window, 'addEventListener');
    initSettingsSync('uid-abc');
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('applies cachedSettings and dispatches EVT_SETTINGS_RESTORED when localStorage is empty', () => {
    const cachedSettings = { vehicle: 'bike', color: '#ff0000' };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    initSettingsSync('uid-abc', cachedSettings);

    expect(localStorage.getItem('luminal-vehicle')).toBe('bike');
    expect(localStorage.getItem('luminal-color')).toBe('#ff0000');
    expect(dispatchSpy).toHaveBeenCalledOnce();
    const event = (dispatchSpy as Mock).mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('luminal-settings-restored');
  });

  it('does not apply cachedSettings when localStorage already has data', () => {
    fillLocalStorage();
    const cachedSettings = { vehicle: 'bike' };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    initSettingsSync('uid-abc', cachedSettings);

    // Should not apply settings or dispatch event
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('does not apply empty cachedSettings object', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    initSettingsSync('uid-abc', {});
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('does not apply null cachedSettings', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    initSettingsSync('uid-abc', null);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('schedules a backup upload when localStorage has data', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
  });
});

describe('stopSettingsSync', () => {
  it('disables sync so subsequent notifySettingChanged calls do nothing', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    stopSettingsSync();
    notifySettingChanged();
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('removes beforeunload listener', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    stopSettingsSync();
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('cancels any pending upload timer', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    notifySettingChanged(); // schedules timer
    stopSettingsSync();     // should cancel it
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('can be called safely before init without throwing', () => {
    expect(() => stopSettingsSync()).not.toThrow();
  });
});

// ── Debounced upload ──────────────────────────────────────

describe('notifySettingChanged (debounce)', () => {
  it('does not upload before debounce delay elapses', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    // Clear the backup upload timer from init
    vi.clearAllTimers();
    mockUpdateDoc.mockClear();

    notifySettingChanged();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('uploads once after the debounce delay', async () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    vi.clearAllTimers();
    mockUpdateDoc.mockClear();

    notifySettingChanged();
    await vi.runAllTimersAsync();
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
  });

  it('resets the debounce timer on repeated calls', async () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    vi.clearAllTimers();
    mockUpdateDoc.mockClear();

    notifySettingChanged();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    notifySettingChanged(); // resets timer
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    // Still not fired — the second call reset the countdown
    expect(mockUpdateDoc).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
  });

  it('passes uid to updateDoc', async () => {
    fillLocalStorage();
    initSettingsSync('uid-xyz');
    vi.clearAllTimers();
    mockUpdateDoc.mockClear();

    notifySettingChanged();
    await vi.runAllTimersAsync();
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'users', 'uid-xyz');
  });

  it('does nothing when not syncing', () => {
    notifySettingChanged();
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ── beforeunload flush ────────────────────────────────────

describe('beforeunload flush', () => {
  it('flushes pending upload via fetch on beforeunload', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response());
    fillLocalStorage();
    initSettingsSync('uid-abc');
    vi.clearAllTimers();

    notifySettingChanged(); // pending timer

    window.dispatchEvent(new Event('beforeunload'));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = (fetchSpy as Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('uid-abc');
    expect(opts.method).toBe('PATCH');
    expect(opts.keepalive).toBe(true);
    fetchSpy.mockRestore();
  });

  it('does not fetch on beforeunload after stopSettingsSync', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response());
    fillLocalStorage();
    initSettingsSync('uid-abc');
    stopSettingsSync();
    // stopSettingsSync flushes once; clear that so we only assert on beforeunload
    fetchSpy.mockClear();

    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ── _resetForTesting ──────────────────────────────────────

describe('_resetForTesting', () => {
  it('cancels pending timers so no upload fires after reset', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    vi.clearAllTimers();
    mockUpdateDoc.mockClear();

    notifySettingChanged();
    _resetForTesting();
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('disables sync so notifySettingChanged does nothing after reset', () => {
    fillLocalStorage();
    initSettingsSync('uid-abc');
    _resetForTesting();
    notifySettingChanged();
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('removes beforeunload listener so flush does not fire after reset', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response());
    fillLocalStorage();
    initSettingsSync('uid-abc');
    _resetForTesting();

    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('can be called multiple times without throwing', () => {
    expect(() => {
      _resetForTesting();
      _resetForTesting();
      _resetForTesting();
    }).not.toThrow();
  });
});

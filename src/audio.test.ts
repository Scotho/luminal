import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock dependencies before importing audio.ts ─────────
vi.mock('./settingsSync', () => ({
  notifySettingChanged: vi.fn(),
}));
vi.mock('./swallow', () => ({
  swallow: vi.fn(() => () => {}),
}));

// ── Stub MediaMetadata (not available in jsdom) ────────
vi.stubGlobal('MediaMetadata', class MediaMetadata {
  title = ''; artist = ''; album = ''; artwork: unknown[] = [];
  constructor(init?: Record<string, unknown>) { Object.assign(this, init); }
});

// ── Mock AudioContext ───────────────────────────────────
const mockGainNode = () => ({
  gain: {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  },
  connect: vi.fn(),
});
const mockAnalyser = () => ({
  fftSize: 0,
  smoothingTimeConstant: 0,
  frequencyBinCount: 128,
  getByteFrequencyData: vi.fn(),
  connect: vi.fn(),
});
const mockFilter = () => ({
  type: '',
  frequency: {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  },
  Q: { value: 0 },
  connect: vi.fn(),
});
const mockMediaSource = () => ({ connect: vi.fn() });

const mockCtx = {
  currentTime: 0,
  state: 'running',
  resume: vi.fn(),
  destination: {},
  sampleRate: 44100,
  createGain: vi.fn(() => mockGainNode()),
  createAnalyser: vi.fn(() => mockAnalyser()),
  createBiquadFilter: vi.fn(() => mockFilter()),
  createMediaElementSource: vi.fn(() => mockMediaSource()),
};

const MockAudioContextCtor = vi.fn(function MockAudioContext() { return mockCtx; });
vi.stubGlobal('AudioContext', MockAudioContextCtor);
vi.stubGlobal('webkitAudioContext', MockAudioContextCtor);

// ── Mock Audio element constructor ──────────────────────
vi.stubGlobal('Audio', vi.fn(function MockAudio() {
  return {
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    paused: true,
    ended: false,
    loop: false,
    volume: 1,
    currentTime: 0,
    duration: 0,
    crossOrigin: '',
    src: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}));

// ── Stub navigator.mediaSession ─────────────────────────
Object.defineProperty(navigator, 'mediaSession', {
  value: { setActionHandler: vi.fn(), metadata: null },
  writable: true,
  configurable: true,
});

// ── Import the module under test ────────────────────────
import {
  getPlaylistMode, setPlaylistMode,
  getDefaultTracks, getDisabledDefaults, toggleDefaultTrack, reorderDefaultTracks,
  getSynthwaveTracks, getDisabledSynthwave, toggleSynthwaveTrack, reorderSynthwaveTracks,
  getElectronicTracks, getDisabledElectronic, toggleElectronicTrack, reorderElectronicTracks,
  getAllLocalTracks, getDisabledAll, toggleAllTrack,
  getCustomPlaylist, getCustomMuted, toggleCustomMuted, reorderCustomPlaylist, removeCustomTrack,
  toggleShuffle, getShuffleMode, toggleRepeat, toggleMute, togglePause,
  setMusicVolume,
  isPaused, isPlaying,
  getCurrentDefaultIndex, getCurrentSynthwaveIndex, getCurrentElectronicIndex,
  getCurrentAllIndex, getCurrentCustomIndex,
  initAudio, getPlaybackPosition, seekTo,
  addCustomTrack,
} from './audio';

// ═════════════════════════════════════════════════════════
// Group 1: Default track management
// ═════════════════════════════════════════════════════════
describe('Default track management', () => {
  afterEach(() => {
    // Re-enable any tracks disabled during tests
    for (const idx of getDisabledDefaults()) toggleDefaultTrack(idx);
  });

  it('getDefaultTracks returns a non-empty track list with file and name', () => {
    const tracks = getDefaultTracks();
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks[0]).toHaveProperty('file');
    expect(tracks[0]).toHaveProperty('name');
  });

  it('toggleDefaultTrack disables a previously enabled track', () => {
    expect(getDisabledDefaults().has(0)).toBe(false);
    toggleDefaultTrack(0);
    expect(getDisabledDefaults().has(0)).toBe(true);
  });

  it('toggleDefaultTrack twice re-enables the track', () => {
    toggleDefaultTrack(1);
    toggleDefaultTrack(1);
    expect(getDisabledDefaults().has(1)).toBe(false);
  });

  it('toggleDefaultTrack persists disabled set to localStorage', () => {
    toggleDefaultTrack(2);
    const stored: number[] = JSON.parse(localStorage.getItem('luminal-disabled-defaults') || '[]');
    expect(stored).toContain(2);
  });

  it('reorderDefaultTracks swaps two tracks', () => {
    const tracks = getDefaultTracks();
    const firstName = tracks[0].name;
    const secondName = tracks[1].name;
    reorderDefaultTracks(0, 1);
    expect(getDefaultTracks()[0].name).toBe(secondName);
    expect(getDefaultTracks()[1].name).toBe(firstName);
    // Revert
    reorderDefaultTracks(1, 0);
  });

  it('reorderDefaultTracks preserves disabled state by file name', () => {
    toggleDefaultTrack(0); // disable index 0
    const disabledFile = getDefaultTracks()[0].file;
    reorderDefaultTracks(0, 2); // move to index 2
    // The file should now be disabled at index 2, not 0
    expect(getDisabledDefaults().has(0)).toBe(false);
    // Find where the track ended up
    const newIdx = getDefaultTracks().findIndex(t => t.file === disabledFile);
    expect(getDisabledDefaults().has(newIdx)).toBe(true);
    // Clean up
    toggleDefaultTrack(newIdx);
    reorderDefaultTracks(2, 0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 2: Synthwave track management
// ═════════════════════════════════════════════════════════
describe('Synthwave track management', () => {
  afterEach(() => {
    for (const idx of getDisabledSynthwave()) toggleSynthwaveTrack(idx);
  });

  it('getSynthwaveTracks returns a non-empty array', () => {
    const tracks = getSynthwaveTracks();
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks[0]).toHaveProperty('file');
    expect(tracks[0]).toHaveProperty('name');
  });

  it('toggleSynthwaveTrack disables a track', () => {
    expect(getDisabledSynthwave().has(0)).toBe(false);
    toggleSynthwaveTrack(0);
    expect(getDisabledSynthwave().has(0)).toBe(true);
  });

  it('toggleSynthwaveTrack twice re-enables', () => {
    toggleSynthwaveTrack(1);
    toggleSynthwaveTrack(1);
    expect(getDisabledSynthwave().has(1)).toBe(false);
  });

  it('toggleSynthwaveTrack persists to localStorage', () => {
    toggleSynthwaveTrack(0);
    const stored: number[] = JSON.parse(localStorage.getItem('luminal-disabled-synthwave') || '[]');
    expect(stored).toContain(0);
  });

  it('reorderSynthwaveTracks swaps two tracks', () => {
    const tracks = getSynthwaveTracks();
    const first = tracks[0].name;
    const second = tracks[1].name;
    reorderSynthwaveTracks(0, 1);
    expect(getSynthwaveTracks()[0].name).toBe(second);
    expect(getSynthwaveTracks()[1].name).toBe(first);
    // Revert
    reorderSynthwaveTracks(1, 0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 3: Electronic track management
// ═════════════════════════════════════════════════════════
describe('Electronic track management', () => {
  afterEach(() => {
    for (const idx of getDisabledElectronic()) toggleElectronicTrack(idx);
  });

  it('getElectronicTracks returns a non-empty array', () => {
    const tracks = getElectronicTracks();
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks[0]).toHaveProperty('file');
    expect(tracks[0]).toHaveProperty('name');
  });

  it('toggleElectronicTrack disables a track', () => {
    expect(getDisabledElectronic().has(0)).toBe(false);
    toggleElectronicTrack(0);
    expect(getDisabledElectronic().has(0)).toBe(true);
  });

  it('toggleElectronicTrack twice re-enables', () => {
    toggleElectronicTrack(1);
    toggleElectronicTrack(1);
    expect(getDisabledElectronic().has(1)).toBe(false);
  });

  it('toggleElectronicTrack persists to localStorage', () => {
    toggleElectronicTrack(0);
    const stored: number[] = JSON.parse(localStorage.getItem('luminal-disabled-electronic') || '[]');
    expect(stored).toContain(0);
  });

  it('reorderElectronicTracks swaps two tracks', () => {
    const tracks = getElectronicTracks();
    const first = tracks[0].name;
    const second = tracks[1].name;
    reorderElectronicTracks(0, 1);
    expect(getElectronicTracks()[0].name).toBe(second);
    expect(getElectronicTracks()[1].name).toBe(first);
    // Revert
    reorderElectronicTracks(1, 0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 4: ALL playlist track management
// ═════════════════════════════════════════════════════════
describe('ALL playlist track management', () => {
  afterEach(() => {
    for (const idx of getDisabledAll()) toggleAllTrack(idx);
  });

  it('getAllLocalTracks returns deduplicated union of all playlists', () => {
    const all = getAllLocalTracks();
    expect(all.length).toBeGreaterThan(0);
    const files = all.map(t => t.file);
    // No duplicates
    expect(new Set(files).size).toBe(files.length);
  });

  it('toggleAllTrack disables a track', () => {
    expect(getDisabledAll().has(0)).toBe(false);
    toggleAllTrack(0);
    expect(getDisabledAll().has(0)).toBe(true);
  });

  it('toggleAllTrack twice re-enables', () => {
    toggleAllTrack(1);
    toggleAllTrack(1);
    expect(getDisabledAll().has(1)).toBe(false);
  });

  it('toggleAllTrack persists to localStorage', () => {
    toggleAllTrack(0);
    const stored: number[] = JSON.parse(localStorage.getItem('luminal-disabled-all') || '[]');
    expect(stored).toContain(0);
  });
});

// ═════════════════════════════════════════════════════════
// Group 5: Custom playlist management
// ═════════════════════════════════════════════════════════
describe('Custom playlist management', () => {
  afterEach(() => {
    // Clear any muted entries
    for (const idx of getCustomMuted()) toggleCustomMuted(idx);
  });

  it('getCustomPlaylist returns an array', () => {
    expect(Array.isArray(getCustomPlaylist())).toBe(true);
  });

  it('toggleCustomMuted toggles mute state for an index', () => {
    expect(getCustomMuted().has(0)).toBe(false);
    toggleCustomMuted(0);
    expect(getCustomMuted().has(0)).toBe(true);
    toggleCustomMuted(0);
    expect(getCustomMuted().has(0)).toBe(false);
  });

  it('toggleCustomMuted persists to localStorage', () => {
    toggleCustomMuted(5);
    const stored: number[] = JSON.parse(localStorage.getItem('luminal-custom-muted') || '[]');
    expect(stored).toContain(5);
    toggleCustomMuted(5);
  });

  it('reorderCustomPlaylist preserves muted by track ID', async () => {
    // Add two tracks first
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Track A' }),
    } as Response));
    await addCustomTrack('https://www.youtube.com/watch?v=AAAAAAAAAAA');
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Track B' }),
    } as Response));
    await addCustomTrack('https://www.youtube.com/watch?v=BBBBBBBBBBB');

    const playlist = getCustomPlaylist();
    expect(playlist.length).toBeGreaterThanOrEqual(2);

    // Mute track at index 0
    toggleCustomMuted(0);
    expect(getCustomMuted().has(0)).toBe(true);

    const mutedTrackId = playlist[0].id;

    // Reorder: move index 0 to index 1
    reorderCustomPlaylist(0, 1);

    // The muted set should follow the track by ID
    const newIdx = getCustomPlaylist().findIndex(t => t.id === mutedTrackId);
    expect(getCustomMuted().has(newIdx)).toBe(true);

    // Clean up
    while (getCustomPlaylist().length > 0) removeCustomTrack(0);
    for (const idx of getCustomMuted()) toggleCustomMuted(idx);
  });

  it('removeCustomTrack shifts muted indices down', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'T1' }),
    } as Response));
    await addCustomTrack('https://www.youtube.com/watch?v=CCCCCCCCCCC');
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'T2' }),
    } as Response));
    await addCustomTrack('https://www.youtube.com/watch?v=DDDDDDDDDDD');
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'T3' }),
    } as Response));
    await addCustomTrack('https://www.youtube.com/watch?v=EEEEEEEEEEE');

    // Mute index 2
    toggleCustomMuted(2);
    expect(getCustomMuted().has(2)).toBe(true);

    // Remove index 0 — muted index 2 should shift to 1
    removeCustomTrack(0);
    expect(getCustomMuted().has(1)).toBe(true);
    expect(getCustomMuted().has(2)).toBe(false);

    // Clean up
    while (getCustomPlaylist().length > 0) removeCustomTrack(0);
    for (const idx of getCustomMuted()) toggleCustomMuted(idx);
  });

  it('removeCustomTrack does nothing for out-of-range index', () => {
    const before = getCustomPlaylist().length;
    removeCustomTrack(-1);
    removeCustomTrack(9999);
    expect(getCustomPlaylist().length).toBe(before);
  });
});

// ═════════════════════════════════════════════════════════
// Group 6: Shuffle and repeat
// ═════════════════════════════════════════════════════════
describe('Shuffle and repeat', () => {
  it('toggleShuffle returns the new state', () => {
    const before = getShuffleMode();
    const after = toggleShuffle();
    expect(after).toBe(!before);
    // Restore
    toggleShuffle();
  });

  it('toggleShuffle persists to localStorage', () => {
    const before = getShuffleMode();
    toggleShuffle();
    expect(localStorage.getItem('luminal-shuffle')).toBe(String(!before));
    // Restore
    toggleShuffle();
  });

  it('getShuffleMode returns a boolean', () => {
    expect(typeof getShuffleMode()).toBe('boolean');
  });

  it('toggleRepeat returns alternating boolean states', () => {
    const r1 = toggleRepeat();
    const r2 = toggleRepeat();
    expect(r1).not.toBe(r2);
  });
});

// ═════════════════════════════════════════════════════════
// Group 7: Volume and mute
// ═════════════════════════════════════════════════════════
describe('Volume and mute', () => {
  it('setMusicVolume does not throw for out-of-range values', () => {
    expect(() => setMusicVolume(-5)).not.toThrow();
    expect(() => setMusicVolume(2)).not.toThrow();
    expect(() => setMusicVolume(0.5)).not.toThrow();
  });

  it('toggleMute returns a boolean', () => {
    const result = toggleMute();
    expect(typeof result).toBe('boolean');
    // Restore
    toggleMute();
  });

  it('toggleMute alternates between muted and unmuted', () => {
    const first = toggleMute();
    const second = toggleMute();
    expect(first).not.toBe(second);
  });
});

// ═════════════════════════════════════════════════════════
// Group 8: Playlist mode
// ═════════════════════════════════════════════════════════
describe('Playlist mode', () => {
  afterEach(async () => {
    await setPlaylistMode('default');
  });

  it('getPlaylistMode returns one of the valid modes', () => {
    const mode = getPlaylistMode();
    expect(['default', 'custom', 'synthwave', 'electronic', 'all']).toContain(mode);
  });

  it('setPlaylistMode changes the current mode', async () => {
    await setPlaylistMode('synthwave');
    expect(getPlaylistMode()).toBe('synthwave');
  });

  it('setPlaylistMode persists to localStorage', async () => {
    await setPlaylistMode('electronic');
    expect(localStorage.getItem('luminal-playlist-mode')).toBe('electronic');
  });

  it('setPlaylistMode to each local mode works', async () => {
    for (const mode of ['default', 'synthwave', 'electronic', 'all'] as const) {
      await setPlaylistMode(mode);
      expect(getPlaylistMode()).toBe(mode);
    }
  });
});

// ═════════════════════════════════════════════════════════
// Group 9: State getters
// ═════════════════════════════════════════════════════════
describe('State getters', () => {
  it('getCurrentDefaultIndex returns a number', () => {
    expect(typeof getCurrentDefaultIndex()).toBe('number');
  });

  it('getCurrentSynthwaveIndex returns a number', () => {
    expect(typeof getCurrentSynthwaveIndex()).toBe('number');
  });

  it('getCurrentElectronicIndex returns a number', () => {
    expect(typeof getCurrentElectronicIndex()).toBe('number');
  });

  it('getCurrentAllIndex returns a number', () => {
    expect(typeof getCurrentAllIndex()).toBe('number');
  });

  it('getCurrentCustomIndex returns a number', () => {
    expect(typeof getCurrentCustomIndex()).toBe('number');
  });

  it('isPaused returns a boolean', () => {
    expect(typeof isPaused()).toBe('boolean');
  });

  it('isPlaying returns a boolean', () => {
    expect(typeof isPlaying()).toBe('boolean');
  });

  it('getPlaybackPosition returns {current, duration}', () => {
    const pos = getPlaybackPosition();
    expect(pos).toHaveProperty('current');
    expect(pos).toHaveProperty('duration');
    expect(typeof pos.current).toBe('number');
    expect(typeof pos.duration).toBe('number');
  });
});

// ═════════════════════════════════════════════════════════
// Group 10: initAudio
// ═════════════════════════════════════════════════════════
describe('initAudio', () => {
  it('creates AudioContext and audio graph components', () => {
    initAudio();
    expect(MockAudioContextCtor).toHaveBeenCalled();
    expect(mockCtx.createAnalyser).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
    expect(mockCtx.createMediaElementSource).toHaveBeenCalled();
  });

  it('is idempotent — second call does not recreate context', () => {
    const callCountBefore = MockAudioContextCtor.mock.calls.length;
    initAudio();
    initAudio();
    // Should only create one additional context (or reuse the one from the first call in this suite)
    expect(MockAudioContextCtor.mock.calls.length).toBe(callCountBefore);
  });
});

// ═════════════════════════════════════════════════════════
// Group 11: addCustomTrack (_extractVideoId indirectly)
// ═════════════════════════════════════════════════════════
describe('addCustomTrack', () => {
  afterEach(() => {
    // Remove all custom tracks to keep state clean
    while (getCustomPlaylist().length > 0) removeCustomTrack(0);
  });

  it('rejects an invalid URL', async () => {
    const result = await addCustomTrack('not-a-url');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid YouTube URL');
  });

  it('rejects a non-YouTube URL', async () => {
    const result = await addCustomTrack('https://example.com/video');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid YouTube URL');
  });

  it('accepts standard YouTube watch URL', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Test Video' }),
    } as Response));
    const result = await addCustomTrack('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.success).toBe(true);
    expect(result.title).toBe('Test Video');
    expect(getCustomPlaylist().some(t => t.id === 'dQw4w9WgXcQ')).toBe(true);
  });

  it('accepts youtu.be short URL', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Short URL Video' }),
    } as Response));
    const result = await addCustomTrack('https://youtu.be/abc12345678');
    expect(result.success).toBe(true);
    expect(result.title).toBe('Short URL Video');
  });

  it('accepts YouTube embed URL', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Embed Video' }),
    } as Response));
    const result = await addCustomTrack('https://www.youtube.com/embed/xyz98765432');
    expect(result.success).toBe(true);
    expect(getCustomPlaylist().some(t => t.id === 'xyz98765432')).toBe(true);
  });

  it('accepts YouTube shorts URL', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Shorts Video' }),
    } as Response));
    const result = await addCustomTrack('https://www.youtube.com/shorts/sss11111111');
    expect(result.success).toBe(true);
    expect(getCustomPlaylist().some(t => t.id === 'sss11111111')).toBe(true);
  });

  it('accepts YouTube live URL', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Live Video' }),
    } as Response));
    const result = await addCustomTrack('https://www.youtube.com/live/lll22222222');
    expect(result.success).toBe(true);
    expect(getCustomPlaylist().some(t => t.id === 'lll22222222')).toBe(true);
  });

  it('rejects duplicate video ID', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Original' }),
    } as Response));
    await addCustomTrack('https://www.youtube.com/watch?v=dup111111111');

    const result = await addCustomTrack('https://www.youtube.com/watch?v=dup111111111');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Already in playlist');
  });

  it('falls back to video ID as title when fetch fails', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network error')));
    const result = await addCustomTrack('https://www.youtube.com/watch?v=fa11back111');
    expect(result.success).toBe(true);
    expect(result.title).toBe('fa11back111');
  });

  it('persists added track to localStorage', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title: 'Persisted Track' }),
    } as Response));
    await addCustomTrack('https://www.youtube.com/watch?v=pers1st_sav');
    const stored = JSON.parse(localStorage.getItem('luminal-custom-playlist') || '[]');
    expect(stored.some((t: { id: string }) => t.id === 'pers1st_sav')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════
// Group 12: seekTo
// ═════════════════════════════════════════════════════════
describe('seekTo', () => {
  it('does not throw when no active element exists', () => {
    expect(() => seekTo(30)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════
// Group 13: togglePause
// ═════════════════════════════════════════════════════════
describe('togglePause', () => {
  it('returns a boolean (or false if no element)', () => {
    // With initAudio already called, we have mock decks
    const result = togglePause();
    expect(typeof result).toBe('boolean');
  });
});

// ═════════════════════════════════════════════════════════
// Group 14: notifySettingChanged integration
// ═════════════════════════════════════════════════════════
describe('notifySettingChanged integration', () => {
  it('toggleDefaultTrack calls notifySettingChanged', async () => {
    const { notifySettingChanged } = await import('./settingsSync');
    vi.mocked(notifySettingChanged).mockClear();
    toggleDefaultTrack(0);
    expect(notifySettingChanged).toHaveBeenCalled();
    // Restore
    toggleDefaultTrack(0);
  });

  it('toggleShuffle calls notifySettingChanged', async () => {
    const { notifySettingChanged } = await import('./settingsSync');
    vi.mocked(notifySettingChanged).mockClear();
    toggleShuffle();
    expect(notifySettingChanged).toHaveBeenCalled();
    toggleShuffle();
  });

  it('setPlaylistMode calls notifySettingChanged', async () => {
    const { notifySettingChanged } = await import('./settingsSync');
    vi.mocked(notifySettingChanged).mockClear();
    await setPlaylistMode('synthwave');
    expect(notifySettingChanged).toHaveBeenCalled();
    await setPlaylistMode('default');
  });
});

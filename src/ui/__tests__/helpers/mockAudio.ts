// ── Audio & SFX Mocks ──────────────────────────────────

import { vi } from 'vitest';

export function setupAudioMocks(): void {
  vi.mock('../../audio', () => ({
    initAudio: vi.fn(),
    startAudio: vi.fn(),
    togglePause: vi.fn(),
    toggleMute: vi.fn(),
    skipTrack: vi.fn(),
    prevTrack: vi.fn(),
    toggleRepeat: vi.fn(),
    toggleShuffle: vi.fn(),
    getShuffleMode: vi.fn(() => false),
    setMusicVolume: vi.fn(),
    getPlaylistMode: vi.fn(() => 'default'),
    setPlaylistMode: vi.fn(),
    getCustomPlaylist: vi.fn(() => []),
    addCustomTrack: vi.fn(() => ({ success: true })),
    removeCustomTrack: vi.fn(),
    reorderCustomPlaylist: vi.fn(),
    reorderDefaultTracks: vi.fn(),
    importYTPlaylist: vi.fn(() => Promise.resolve({ success: true, added: 0, total: 0 })),
    getDefaultTracks: vi.fn(() => []),
    getDisabledDefaults: vi.fn(() => new Set()),
    toggleDefaultTrack: vi.fn(),
    getCustomMuted: vi.fn(() => false),
    toggleCustomMuted: vi.fn(),
    playDefaultByIndex: vi.fn(),
    playCustomByIndex: vi.fn(),
    getCurrentDefaultIndex: vi.fn(() => -1),
    getCurrentCustomIndex: vi.fn(() => -1),
    isPaused: vi.fn(() => true),
    isPlaying: vi.fn(() => false),
    getBands: vi.fn(() => ({ bass: 0, energy: 0 })),
    onTrackChange: vi.fn(),
  }));

  vi.mock('../../sfx', () => ({
    setSfxVolume: vi.fn(),
    playHover: vi.fn(),
    playConfirm: vi.fn(),
    playTick: vi.fn(),
    playExplosion: vi.fn(),
    playCountdown: vi.fn(),
    playUiTab: vi.fn(),
    playNavigateBack: vi.fn(),
  }));
}

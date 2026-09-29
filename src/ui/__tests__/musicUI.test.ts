// ── Music UI Tests ──────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../audio', () => ({
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
  importYTPlaylist: vi.fn(),
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
  onTrackChange: vi.fn(),
  getSynthwaveTracks: vi.fn(() => []),
  getDisabledSynthwave: vi.fn(() => new Set()),
  toggleSynthwaveTrack: vi.fn(),
  reorderSynthwaveTracks: vi.fn(),
  playSynthwaveByIndex: vi.fn(),
  getCurrentSynthwaveIndex: vi.fn(() => -1),
  getElectronicTracks: vi.fn(() => []),
  getDisabledElectronic: vi.fn(() => new Set()),
  toggleElectronicTrack: vi.fn(),
  reorderElectronicTracks: vi.fn(),
  playElectronicByIndex: vi.fn(),
  getCurrentElectronicIndex: vi.fn(() => -1),
  getAllLocalTracks: vi.fn(() => []),
  getDisabledAll: vi.fn(() => new Set()),
  toggleAllTrack: vi.fn(),
  playAllByIndex: vi.fn(),
  getCurrentAllIndex: vi.fn(() => -1),
  getPlaybackPosition: vi.fn(() => ({ current: 0, duration: 0 })),
  seekTo: vi.fn(),
}));

vi.mock('../../sfx', () => ({ setSfxVolume: vi.fn(), playTick: vi.fn() }));
vi.mock('../../sfxAssets', () => ({}));

import { initMusicUI, _updateMusicOverlay, _switchMusicTab } from '../musicUI';

describe('Music UI', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('initializes without errors', () => {
      expect(() => initMusicUI({ ensureAudio: vi.fn(), navigateTo: vi.fn() })).not.toThrow();
    });
  });

  describe('music overlay DOM', () => {
    it('#music-overlay exists', () => {
      const el = document.getElementById('music-overlay')!;
      expect(el).toBeTruthy();
      expect(el.classList.contains('overlay-screen')).toBe(true);
    });

    it('has MUSIC title', () => {
      expect(document.getElementById('music-overlay')!.querySelector('.overlay-header-title')!.textContent).toBe('MUSIC');
    });

    it('has now-playing section', () => {
      expect(document.getElementById('music-np')).toBeTruthy();
      expect(document.getElementById('music-np-track')).toBeTruthy();
    });

    it('has playback controls', () => {
      expect(document.getElementById('music-prev')).toBeTruthy();
      expect(document.getElementById('music-playpause')).toBeTruthy();
      expect(document.getElementById('music-next')).toBeTruthy();
      expect(document.getElementById('music-repeat-btn')).toBeTruthy();
      expect(document.getElementById('music-shuffle-btn')).toBeTruthy();
      // mute button removed — redundant with dedicated audio sliders
    });

    it('has volume slider', () => {
      const slider = document.getElementById('music-vol-slider') as HTMLInputElement;
      expect(slider).toBeTruthy();
      expect(slider.type).toBe('range');
    });

    it('has playlist mode selector', () => {
      expect(document.getElementById('playlist-mode-left')).toBeTruthy();
      expect(document.getElementById('playlist-mode-right')).toBeTruthy();
      expect(document.getElementById('playlist-mode-label')).toBeTruthy();
      expect(document.getElementById('playlist-mode-label')!.textContent).toBe('DEFAULT TRACKS');
    });

    it('has default tracks list', () => {
      expect(document.getElementById('music-default-list')).toBeTruthy();
      expect(document.getElementById('music-default-editor')).toBeTruthy();
    });

    it('has synthwave playlist editor (hidden by default)', () => {
      const editor = document.getElementById('music-synthwave-editor')!;
      expect(editor).toBeTruthy();
      expect(editor.classList.contains('hidden')).toBe(true);
    });

    it('has custom playlist editor (hidden by default)', () => {
      const editor = document.getElementById('music-playlist-editor')!;
      expect(editor).toBeTruthy();
      expect(editor.classList.contains('hidden')).toBe(true);
    });

    it('has YouTube URL input', () => {
      const input = document.getElementById('music-yt-input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.placeholder).toContain('YouTube');
    });
  });

  describe('playlist mode switching', () => {
    it('_switchMusicTab shows default editor and hides others', () => {
      initMusicUI({ ensureAudio: vi.fn(), navigateTo: vi.fn() });
      _switchMusicTab('default');
      expect(document.getElementById('music-default-editor')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('music-synthwave-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-playlist-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-electronic-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-all-editor')!.classList.contains('hidden')).toBe(true);
    });

    it('_switchMusicTab shows synthwave editor and hides others', () => {
      initMusicUI({ ensureAudio: vi.fn(), navigateTo: vi.fn() });
      _switchMusicTab('synthwave');
      expect(document.getElementById('music-synthwave-editor')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('music-default-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-playlist-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-electronic-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-all-editor')!.classList.contains('hidden')).toBe(true);
    });

    it('_switchMusicTab shows custom editor and hides others', () => {
      initMusicUI({ ensureAudio: vi.fn(), navigateTo: vi.fn() });
      _switchMusicTab('custom');
      expect(document.getElementById('music-playlist-editor')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('music-default-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-synthwave-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-electronic-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-all-editor')!.classList.contains('hidden')).toBe(true);
    });
  });

  describe('new playlist tabs', () => {
    it('has ELECTRONIC editor (hidden by default)', () => {
      const editor = document.getElementById('music-electronic-editor')!;
      expect(editor).toBeTruthy();
      expect(editor.classList.contains('hidden')).toBe(true);
    });

    it('has ALL editor (hidden by default)', () => {
      const editor = document.getElementById('music-all-editor')!;
      expect(editor).toBeTruthy();
      expect(editor.classList.contains('hidden')).toBe(true);
    });

    it('_switchMusicTab shows electronic editor and hides others', () => {
      initMusicUI({ ensureAudio: vi.fn(), navigateTo: vi.fn() });
      _switchMusicTab('electronic');
      expect(document.getElementById('music-electronic-editor')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('music-default-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-synthwave-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-playlist-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-all-editor')!.classList.contains('hidden')).toBe(true);
    });

    it('_switchMusicTab shows all editor and hides others', () => {
      initMusicUI({ ensureAudio: vi.fn(), navigateTo: vi.fn() });
      _switchMusicTab('all');
      expect(document.getElementById('music-all-editor')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('music-default-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-synthwave-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-playlist-editor')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('music-electronic-editor')!.classList.contains('hidden')).toBe(true);
    });
  });

  describe('volume sliders', () => {
    it('has voice slider on music page', () => {
      const s = document.getElementById('music-voice-slider') as HTMLInputElement;
      expect(s).toBeTruthy();
      expect(s.type).toBe('range');
    });

    it('has sfx slider on music page', () => {
      const s = document.getElementById('music-sfx-slider') as HTMLInputElement;
      expect(s).toBeTruthy();
      expect(s.type).toBe('range');
    });

    it('has scrubber on music page', () => {
      const s = document.getElementById('music-scrubber') as HTMLInputElement;
      expect(s).toBeTruthy();
      expect(s.type).toBe('range');
    });

    it('has scrubber time display', () => {
      expect(document.getElementById('music-scrubber-time')).toBeTruthy();
    });
  });
});

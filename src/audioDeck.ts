// Music deck + playlist routing — extracted from audio.ts as part of TASK-240.
// Owns: dual-deck HTMLAudioElement state, crossfade/pre-buffer scheduling,
// local playlist management (default / synthwave / electronic / all), YouTube
// IFrame integration for the custom playlist, skip/prev/play routing, and the
// now-playing marquee display.
//
// audio.ts stays the top-level router: it creates the AudioContext, analyser,
// master GainNode and dampen bus, then calls initMusicDeck(ctx, analyser) here
// which builds and wires the decks into that bus. Public symbols are re-exported
// from audio.ts so consumers keep their existing import paths.

import { notifySettingChanged } from './settingsSync';
import { swallow } from './swallow';
import { EVT_SETTINGS_RESTORED } from './events';

interface DefaultTrack {
  file: string;
  name: string;
}

interface CustomTrack {
  id: string;
  title: string;
}

interface ImportResult {
  success: boolean;
  error?: string;
  added?: number;
  total?: number;
}

interface AddTrackResult {
  success: boolean;
  error?: string;
  title?: string;
}

export type PlaylistMode = 'default' | 'custom' | 'synthwave' | 'electronic' | 'all';

// Extend Window for webkitAudioContext and YT API
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    YT: Record<string, any>;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

// ── Dual-Deck Types ─────────────────────────────────────
type DeckId = 'A' | 'B';

interface DeckState {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  xfadeGain: GainNode;
  errorSkipCount: number;
  trackStartedPlaying: boolean;
  pendingErrorSkip: ReturnType<typeof setTimeout> | null;
  currentTrackSrc: string;
  ready: boolean; // canplaythrough fired for pre-buffered track
}

const PREBUFFER_THRESHOLD = 15; // seconds before track end to start pre-buffering
const CROSSFADE_DURATION = 1.5; // seconds for natural track transition
const SKIP_CROSSFADE_DURATION = 0.3; // seconds for manual skip/prev

// ── Module state (lifted from audio.ts) ─────────────────
let _audioCtx: AudioContext | null = null;
let _deckA: DeckState | null = null;
let _deckB: DeckState | null = null;
let _activeDeck: DeckId = 'A';
let _crossfading: boolean = false;
let _crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
let _muted: boolean = false;
let _musicVolume: number = 0.35;
let _repeat: boolean = false;
let _userPaused: boolean = false; // true when user intentionally paused
let _started: boolean = false;

function _getActiveDeck(): DeckState { return _activeDeck === 'A' ? _deckA! : _deckB!; }
function _getInactiveDeck(): DeckState { return _activeDeck === 'A' ? _deckB! : _deckA!; }

/** Get the active HTMLAudioElement (backwards compat for internal references). */
function _activeElement(): HTMLAudioElement | null {
  const deck = _activeDeck === 'A' ? _deckA : _deckB;
  return deck ? deck.element : null;
}

// ── Default Playlist ─────────────────────────────────────
const TRACKS: DefaultTrack[] = [
  { file: '/music/road runner - rommii.mp3', name: 'Road Runner (Rommii)' },
  { file: '/music/Start The Engine (Joris Delacroix).mp3', name: 'Start The Engine (Joris Delacroix)' },
  { file: '/music/rainbow dance - rommii.mp3', name: 'Rainbow Dance (Rommii)' },
  { file: '/music/angel boy - rommii.mp3', name: 'Angel Boy (Rommii)' },
  { file: '/music/shimmer shuffle -rommii.mp3', name: 'Shimmer Shuffle (Rommii)' },
  { file: '/music/valor.mp3', name: 'Valor' },
  { file: '/music/synthwave/Evening drive 1980 - 07. Freedom of the Night Ride.mp3', name: 'Freedom of the Night Ride' },
  { file: '/music/end.mp3', name: 'End' },
];
// Static lead-in: first 3 always play in order, rest are randomized at build time
const _LEAD_COUNT: number = 3;
let _disabledDefaults: Set<number> = new Set(JSON.parse(localStorage.getItem('luminal-disabled-defaults') || '[]'));
let _shuffleMode: boolean = localStorage.getItem('luminal-shuffle') === 'true';
let _shuffledOrder: number[] = _buildShuffledOrderFor(TRACKS, _disabledDefaults, _LEAD_COUNT);
let _orderIndex: number = 0;
let _trackIndex: number = _shuffledOrder[0];

// ── Synthwave Playlist (EnthusiastGuy) ──────────────────
const SYNTHWAVE_TRACKS: DefaultTrack[] = [
  { file: '/music/synthwave/Evening drive 1980 - 03. Endless Run Beneath Starry Skies.mp3', name: 'Endless Run Beneath Starry Skies' },
  { file: '/music/synthwave/Evening drive 1980 - 07. Freedom of the Night Ride.mp3', name: 'Freedom of the Night Ride' },
  { file: '/music/synthwave/Evening drive 1980 - 22. Drifting Past the Warning Signs.mp3', name: 'Drifting Past the Warning Signs' },
  { file: '/music/synthwave/Evening drive 1980 - 47. The Wind Knows My Name.mp3', name: 'The Wind Knows My Name' },
];
let _disabledSynthwave: Set<number> = new Set(JSON.parse(localStorage.getItem('luminal-disabled-synthwave') || '[]'));
let _synthwaveShuffledOrder: number[] = _buildShuffledOrderFor(SYNTHWAVE_TRACKS, _disabledSynthwave, 0);
let _synthwaveIndex: number = _synthwaveShuffledOrder.length > 0 ? _synthwaveShuffledOrder[0] : 0;

// ── Electronic Playlist (old DEFAULT tracks) ─────────────
const ELECTRONIC_TRACKS: DefaultTrack[] = [
  { file: '/music/road runner - rommii.mp3', name: 'Road Runner (Rommii)' },
  { file: '/music/Start The Engine (Joris Delacroix).mp3', name: 'Start The Engine (Joris Delacroix)' },
  { file: '/music/rainbow dance - rommii.mp3', name: 'Rainbow Dance (Rommii)' },
  { file: '/music/angel boy - rommii.mp3', name: 'Angel Boy (Rommii)' },
  { file: '/music/how do i let go - rommii.mp3', name: 'How Do I Let Go (Rommii)' },
  { file: '/music/run.mp3', name: 'Run' },
  { file: '/music/shimmer shuffle -rommii.mp3', name: 'Shimmer Shuffle (Rommii)' },
  { file: '/music/valor.mp3', name: 'Valor' },
];
const _ELECTRONIC_LEAD_COUNT: number = 3;
let _disabledElectronic: Set<number> = new Set(JSON.parse(localStorage.getItem('luminal-disabled-electronic') || '[]'));
let _electronicShuffledOrder: number[] = _buildShuffledOrderFor(ELECTRONIC_TRACKS, _disabledElectronic, _ELECTRONIC_LEAD_COUNT);
let _electronicIndex: number = _electronicShuffledOrder.length > 0 ? _electronicShuffledOrder[0] : 0;

// ── ALL Playlist (union of all local playlists, deduplicated) ──
const ALL_LOCAL_TRACKS: DefaultTrack[] = (() => {
  const seen = new Set<string>();
  const result: DefaultTrack[] = [];
  for (const list of [TRACKS, ELECTRONIC_TRACKS, SYNTHWAVE_TRACKS]) {
    for (const t of list) {
      if (!seen.has(t.file)) { seen.add(t.file); result.push(t); }
    }
  }
  return result;
})();
let _disabledAll: Set<number> = new Set(JSON.parse(localStorage.getItem('luminal-disabled-all') || '[]'));
let _allShuffledOrder: number[] = _buildShuffledOrderFor(ALL_LOCAL_TRACKS, _disabledAll, 0);
let _allIndex: number = _allShuffledOrder.length > 0 ? _allShuffledOrder[0] : 0;

// ── Custom YouTube Playlist ──────────────────────────────
let _playlistMode: PlaylistMode = (localStorage.getItem('luminal-playlist-mode') || 'default') as PlaylistMode;
let _customPlaylist: CustomTrack[] = JSON.parse(localStorage.getItem('luminal-custom-playlist') || '[]');
let _customMuted: Set<number> = new Set(JSON.parse(localStorage.getItem('luminal-custom-muted') || '[]'));
let _customIndex: number = 0;

let _ytPlayer: Record<string, any> | null = null;
let _ytReady: boolean = false;
let _ytApiLoading: boolean = false;
let _ytPlaying: boolean = false; // true when YT is actively playing

function _extractVideoId(url: string): string | null {
  const m: RegExpMatchArray | null = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function _loadYTApi(): Promise<void> {
  return new Promise((resolve: () => void) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    if (_ytApiLoading) {
      const check: ReturnType<typeof setInterval> = setInterval(() => {
        if (window.YT && window.YT.Player) { clearInterval(check); resolve(); }
      }, 100);
      return;
    }
    _ytApiLoading = true;
    const tag: HTMLScriptElement = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
}

function _initYTPlayer(): Promise<void> {
  return new Promise((resolve: () => void) => {
    if (_ytReady) { resolve(); return; }
    // Reuse existing container or create a new one
    let div = document.getElementById('yt-player') as HTMLDivElement | null;
    if (!div) {
      div = document.createElement('div');
      div.id = 'yt-player';
      div.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;opacity:0;';
      document.body.appendChild(div);
    }
    _ytPlayer = new window.YT.Player('yt-player', {
      width: 1, height: 1,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0 },
      events: {
        onReady: () => {
          _ytReady = true;
          _ytPlayer!.setVolume(_muted ? 0 : _musicVolume * 100);
          resolve();
        },
        onStateChange: (e: { data: number }) => {
          _ytPlaying = e.data === window.YT.PlayerState.PLAYING;
          if (e.data === window.YT.PlayerState.ENDED && (_playlistMode === 'custom' || _playlistMode === 'all')) {
            if (_repeat) { _ytPlayer!.seekTo(0, true); _ytPlayer!.playVideo(); }
            else skipTrack();
          }
        },
        onError: () => {
          if (_playlistMode === 'custom' && _customPlaylist.length > 0) skipTrack();
        },
      },
    });
  });
}

async function _ensureYT(): Promise<void> {
  await _loadYTApi();
  if (!_ytReady) await _initYTPlayer();
}

function _saveCustomPlaylist(): void {
  localStorage.setItem('luminal-custom-playlist', JSON.stringify(_customPlaylist));
  notifySettingChanged();
}

// ── Exports: Playlist Management ─────────────────────────
export function getPlaylistMode(): PlaylistMode { return _playlistMode; }

export async function setPlaylistMode(mode: PlaylistMode): Promise<void> {
  _playlistMode = mode;
  localStorage.setItem('luminal-playlist-mode', mode);
  notifySettingChanged();

  // ── Restart playlist to track 0 on every switch ────────
  if (mode === 'default') {
    _shuffledOrder = _buildShuffledOrderFor(TRACKS, _disabledDefaults, _LEAD_COUNT);
    _orderIndex = 0;
    if (_shuffledOrder.length > 0) _trackIndex = _shuffledOrder[0];
  } else if (mode === 'synthwave') {
    _synthwaveShuffledOrder = _buildShuffledOrderFor(SYNTHWAVE_TRACKS, _disabledSynthwave, 0);
    if (_synthwaveShuffledOrder.length > 0) _synthwaveIndex = _synthwaveShuffledOrder[0];
  } else if (mode === 'electronic') {
    _electronicShuffledOrder = _buildShuffledOrderFor(ELECTRONIC_TRACKS, _disabledElectronic, _ELECTRONIC_LEAD_COUNT);
    if (_electronicShuffledOrder.length > 0) _electronicIndex = _electronicShuffledOrder[0];
  } else if (mode === 'all') {
    _allShuffledOrder = _buildShuffledOrderFor(ALL_LOCAL_TRACKS, _disabledAll, 0);
    _allIndex = _allShuffledOrder.length > 0 ? _allShuffledOrder[0] : 0;
  }

  if (!_started) return;

  if (mode === 'custom') {
    const el = _activeElement();
    if (el && !el.paused) el.pause();
    await _ensureYT();
    if (_playlistMode !== 'custom' || _customPlaylist.length === 0) return;
    _customIndex = 0;
    _ytPlayer!.loadVideoById(_customPlaylist[0].id);
    _ytPlayer!.setVolume(_muted ? 0 : _musicVolume * 100);
    _updateTrackDisplay();
  } else {
    // Stop YouTube, resume local — hard-switch (no crossfade for mode changes)
    if (_ytPlayer && _ytReady) { try { _ytPlayer.setVolume(0); _ytPlayer.stopVideo(); } catch { /* expected: YT player torn down or not ready */ } }
    _ytPlaying = false;
    let url: string | undefined;
    if (mode === 'synthwave') url = SYNTHWAVE_TRACKS[_synthwaveIndex]?.file;
    else if (mode === 'electronic') url = ELECTRONIC_TRACKS[_electronicIndex]?.file;
    else if (mode === 'all') url = ALL_LOCAL_TRACKS[_allIndex]?.file;
    else url = TRACKS[_trackIndex]?.file;
    if (url) _hardSwitch(url);
    _updateTrackDisplay();
  }
}

export function getCustomPlaylist(): CustomTrack[] { return _customPlaylist; }

export async function addCustomTrack(url: string): Promise<AddTrackResult> {
  const id: string | null = _extractVideoId(url);
  if (!id) return { success: false, error: 'Invalid YouTube URL' };
  if (_customPlaylist.some((t: CustomTrack) => t.id === id)) return { success: false, error: 'Already in playlist' };

  // Fetch title from noembed (free, no API key)
  let title: string = id;
  try {
    const res: Response = await fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    const data: { title?: string } = await res.json();
    if (data.title) title = data.title;
  } catch { /* expected: noembed offline or CORS — fall back to video id */ }

  _customPlaylist.push({ id, title });
  _saveCustomPlaylist();
  return { success: true, title };
}

// Extract playlist ID from YouTube playlist URL
function _extractPlaylistId(url: string): string | null {
  const m: RegExpMatchArray | null = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Import an entire YouTube playlist using the YT IFrame player
export async function importYTPlaylist(url: string, onProgress?: (current: number, total: number, title: string) => void): Promise<ImportResult> {
  const listId: string | null = _extractPlaylistId(url);
  if (!listId) return { success: false, error: 'Invalid playlist URL' };

  await _ensureYT();

  return new Promise((resolve: (result: ImportResult) => void) => {
    // Create a temporary player to load the playlist
    const div: HTMLDivElement = document.createElement('div');
    div.id = 'yt-import-tmp';
    div.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
    document.body.appendChild(div);

    const tmpPlayer: Record<string, any> = new window.YT.Player('yt-import-tmp', {
      width: 1, height: 1,
      playerVars: { autoplay: 0, controls: 0, list: listId, listType: 'playlist' },
      events: {
        onReady: () => {
          // Give the playlist time to load
          let attempts: number = 0;
          const poll: ReturnType<typeof setInterval> = setInterval(() => {
            attempts++;
            let playlist: string[] | undefined;
            try { playlist = tmpPlayer.getPlaylist(); } catch { /* expected: playlist still loading, retry next tick */ }
            if (playlist && playlist.length > 0) {
              clearInterval(poll);
              _processImportedPlaylist(playlist, tmpPlayer, div, onProgress, resolve);
            } else if (attempts > 30) {
              clearInterval(poll);
              tmpPlayer.destroy();
              div.remove();
              resolve({ success: false, error: 'Could not load playlist' });
            }
          }, 500);
        },
        onError: () => {
          tmpPlayer.destroy();
          div.remove();
          resolve({ success: false, error: 'Failed to load playlist' });
        },
      },
    });
  });
}

async function _processImportedPlaylist(
  videoIds: string[],
  tmpPlayer: Record<string, any>,
  div: HTMLDivElement,
  onProgress: ((current: number, total: number, title: string) => void) | undefined,
  resolve: (result: ImportResult) => void
): Promise<void> {
  let added: number = 0;
  const total: number = videoIds.length;

  for (let i = 0; i < videoIds.length; i++) {
    const id: string = videoIds[i];
    if (_customPlaylist.some((t: CustomTrack) => t.id === id)) continue; // skip duplicates

    // Fetch title
    let title: string = id;
    try {
      const res: Response = await fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
      const data: { title?: string } = await res.json();
      if (data.title) title = data.title;
    } catch { /* expected: noembed offline or CORS — fall back to video id */ }

    _customPlaylist.push({ id, title });
    added++;
    if (onProgress) onProgress(i + 1, total, title);
  }

  _saveCustomPlaylist();
  tmpPlayer.destroy();
  div.remove();
  resolve({ success: true, added, total });
}

export function removeCustomTrack(index: number): void {
  if (index < 0 || index >= _customPlaylist.length) return;
  _customMuted.delete(index);
  // Shift muted indices down
  const newMuted: Set<number> = new Set();
  for (const i of _customMuted) { if (i > index) newMuted.add(i - 1); else newMuted.add(i); }
  _customMuted = newMuted;
  _saveCustomMuted();
  _customPlaylist.splice(index, 1);
  _saveCustomPlaylist();
  if (_customPlaylist.length === 0) {
    _customIndex = 0;
    // Auto-switch back to default when custom playlist is empty
    if (_playlistMode === 'custom') {
      if (_ytPlayer && _ytReady) { try { _ytPlayer.stopVideo(); } catch { /* expected: YT player already torn down */ } }
      _ytPlaying = false;
      _playlistMode = 'default';
      localStorage.setItem('luminal-playlist-mode', 'default');
      notifySettingChanged();
      const el = _activeElement();
      if (_started && el) el.play().catch(swallow('audio'));
      _updateTrackDisplay();
    }
  } else if (_customIndex >= _customPlaylist.length) {
    _customIndex = 0;
  }
}

export function getCustomMuted(): Set<number> { return _customMuted; }

export function toggleCustomMuted(index: number): void {
  if (_customMuted.has(index)) _customMuted.delete(index);
  else _customMuted.add(index);
  _saveCustomMuted();
}

function _saveCustomMuted(): void {
  localStorage.setItem('luminal-custom-muted', JSON.stringify([..._customMuted]));
  notifySettingChanged();
}

export function reorderCustomPlaylist(fromIdx: number, toIdx: number): void {
  // Collect muted IDs before reorder
  const mutedIds: Set<string> = new Set();
  for (const i of _customMuted) { if (_customPlaylist[i]) mutedIds.add(_customPlaylist[i].id); }
  const [item]: CustomTrack[] = _customPlaylist.splice(fromIdx, 1);
  _customPlaylist.splice(toIdx, 0, item);
  // Rebuild muted set with new indices
  _customMuted.clear();
  _customPlaylist.forEach((t: CustomTrack, i: number) => { if (mutedIds.has(t.id)) _customMuted.add(i); });
  // Keep _customIndex pointing at the same track that's currently playing
  if (_customIndex === fromIdx) {
    _customIndex = toIdx;
  } else if (fromIdx < _customIndex && toIdx >= _customIndex) {
    _customIndex--;
  } else if (fromIdx > _customIndex && toIdx <= _customIndex) {
    _customIndex++;
  }
  _saveCustomMuted();
  _saveCustomPlaylist();
}

// ── Default Track Disable/Enable ─────────────────────────
export function getDefaultTracks(): DefaultTrack[] { return TRACKS; }

export function getDisabledDefaults(): Set<number> { return _disabledDefaults; }

export function reorderDefaultTracks(fromIdx: number, toIdx: number): void {
  const r = _plReorderTracks(TRACKS, _disabledDefaults, _shuffledOrder, _trackIndex, fromIdx, toIdx, _LEAD_COUNT, 'luminal-disabled-defaults');
  _shuffledOrder = r.shuffledOrder;
  _trackIndex = r.currentIndex;
  _orderIndex = _shuffledOrder.indexOf(_trackIndex);
  if (_orderIndex < 0) _orderIndex = 0;
}

export function toggleDefaultTrack(index: number): void {
  const r = _plToggleTrack(_disabledDefaults, index, TRACKS, _LEAD_COUNT, 'luminal-disabled-defaults');
  _shuffledOrder = r.shuffledOrder;
  _orderIndex = 0;
  if (r.shuffledOrder.length > 0) _trackIndex = r.shuffledOrder[0];
}

// ── Synthwave Playlist Management ────────────────────────
export function getSynthwaveTracks(): DefaultTrack[] { return SYNTHWAVE_TRACKS; }

export function getDisabledSynthwave(): Set<number> { return _disabledSynthwave; }

export function getCurrentSynthwaveIndex(): number { return _synthwaveIndex; }

export function toggleSynthwaveTrack(index: number): void {
  const r = _plToggleTrack(_disabledSynthwave, index, SYNTHWAVE_TRACKS, 0, 'luminal-disabled-synthwave');
  _synthwaveShuffledOrder = r.shuffledOrder;
  _synthwaveIndex = r.currentIndex;
}

export function reorderSynthwaveTracks(fromIdx: number, toIdx: number): void {
  const r = _plReorderTracks(SYNTHWAVE_TRACKS, _disabledSynthwave, _synthwaveShuffledOrder, _synthwaveIndex, fromIdx, toIdx, 0, 'luminal-disabled-synthwave');
  _synthwaveShuffledOrder = r.shuffledOrder;
  _synthwaveIndex = r.currentIndex;
}

// ── Electronic Playlist Management ──────────────────────
export function getElectronicTracks(): DefaultTrack[] { return ELECTRONIC_TRACKS; }
export function getDisabledElectronic(): Set<number> { return _disabledElectronic; }
export function getCurrentElectronicIndex(): number { return _electronicIndex; }

export function toggleElectronicTrack(index: number): void {
  const r = _plToggleTrack(_disabledElectronic, index, ELECTRONIC_TRACKS, _ELECTRONIC_LEAD_COUNT, 'luminal-disabled-electronic');
  _electronicShuffledOrder = r.shuffledOrder;
  _electronicIndex = r.currentIndex;
}

export function reorderElectronicTracks(fromIdx: number, toIdx: number): void {
  const r = _plReorderTracks(ELECTRONIC_TRACKS, _disabledElectronic, _electronicShuffledOrder, _electronicIndex, fromIdx, toIdx, _ELECTRONIC_LEAD_COUNT, 'luminal-disabled-electronic');
  _electronicShuffledOrder = r.shuffledOrder;
  _electronicIndex = r.currentIndex;
}

export function playElectronicByIndex(index: number): void {
  if (index < 0 || index >= ELECTRONIC_TRACKS.length) return;
  if (_disabledElectronic.has(index)) return;
  _userPaused = false;
  _electronicIndex = index;
  if (_playlistMode !== 'electronic') { _playlistMode = 'electronic'; localStorage.setItem('luminal-playlist-mode', 'electronic'); notifySettingChanged(); }
  if (_ytPlayer && _ytReady) { try { _ytPlayer.stopVideo(); } catch { /* expected: YT player already torn down */ } }
  _ytPlaying = false;
  _playCurrentTrack();
}

// ── ALL Playlist Management ──────────────────────────────
export function getAllLocalTracks(): DefaultTrack[] { return ALL_LOCAL_TRACKS; }
export function getDisabledAll(): Set<number> { return _disabledAll; }
export function getCurrentAllIndex(): number { return _allIndex; }

export function toggleAllTrack(index: number): void {
  const r = _plToggleTrack(_disabledAll, index, ALL_LOCAL_TRACKS, 0, 'luminal-disabled-all');
  _allShuffledOrder = r.shuffledOrder;
  _allIndex = r.currentIndex;
}

export function playAllByIndex(index: number): void {
  _userPaused = false;
  const localLen: number = ALL_LOCAL_TRACKS.length;
  if (index < localLen) {
    if (_disabledAll.has(index)) return;
    _allIndex = index;
    if (_playlistMode !== 'all') { _playlistMode = 'all'; localStorage.setItem('luminal-playlist-mode', 'all'); notifySettingChanged(); }
    if (_ytPlayer && _ytReady) { try { _ytPlayer.setVolume(0); _ytPlayer.stopVideo(); } catch { /* expected: YT player already torn down */ } }
    _ytPlaying = false;
    _playCurrentTrackForAll();
  } else {
    const ytIdx: number = index - localLen;
    if (ytIdx < 0 || ytIdx >= _customPlaylist.length) return;
    if (_customMuted.has(ytIdx)) return;
    _allIndex = index;
    if (_playlistMode !== 'all') { _playlistMode = 'all'; localStorage.setItem('luminal-playlist-mode', 'all'); notifySettingChanged(); }
    const ael = _activeElement();
    if (ael && !ael.paused) ael.pause();
    _ensureYT().then(() => {
      _ytPlayer!.loadVideoById(_customPlaylist[ytIdx].id);
      _ytPlayer!.setVolume(_muted ? 0 : _musicVolume * 100);
      _updateTrackDisplay();
    });
  }
}

// ── Core Audio ───────────────────────────────────────────
function _buildShuffledOrderFor(tracks: DefaultTrack[], disabled: Set<number>, leadCount: number): number[] {
  const enabled: Set<number> = new Set();
  for (let i = 0; i < tracks.length; i++) {
    if (!disabled.has(i)) enabled.add(i);
  }
  if (enabled.size === 0) return [];
  // Lead tracks (first leadCount) that are still enabled, in order
  const lead: number[] = [];
  for (let i = 0; i < leadCount; i++) {
    if (enabled.has(i)) lead.push(i);
  }
  // Remaining enabled tracks
  const rest: number[] = [];
  for (const i of enabled) {
    if (i >= leadCount) rest.push(i);
  }
  // Fisher-Yates shuffle the rest
  for (let i = rest.length - 1; i > 0; i--) {
    const j: number = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...lead, ...rest];
}

// ── Shared Playlist Helpers (internal) ─────────────────
// Eliminates per-playlist copy-paste for toggle, reorder, nextEnabled, and advance.

function _plSaveDisabled(disabled: Set<number>, storageKey: string): void {
  localStorage.setItem(storageKey, JSON.stringify([...disabled]));
  notifySettingChanged();
}

function _plToggleTrack(
  disabled: Set<number>, index: number, tracks: DefaultTrack[], leadCount: number, storageKey: string,
): { shuffledOrder: number[]; currentIndex: number } {
  if (disabled.has(index)) disabled.delete(index);
  else disabled.add(index);
  _plSaveDisabled(disabled, storageKey);
  const shuffledOrder = _buildShuffledOrderFor(tracks, disabled, leadCount);
  const currentIndex = shuffledOrder.length > 0 ? shuffledOrder[0] : 0;
  return { shuffledOrder, currentIndex };
}

function _plReorderTracks(
  tracks: DefaultTrack[], disabled: Set<number>, shuffledOrder: number[],
  currentIndex: number, fromIdx: number, toIdx: number, leadCount: number, storageKey: string,
): { shuffledOrder: number[]; currentIndex: number } {
  const disabledFiles: Set<string> = new Set();
  for (const i of disabled) { if (tracks[i]) disabledFiles.add(tracks[i].file); }
  const playingFile: string | undefined = tracks[currentIndex]?.file;
  const [item]: DefaultTrack[] = tracks.splice(fromIdx, 1);
  tracks.splice(toIdx, 0, item);
  disabled.clear();
  tracks.forEach((t: DefaultTrack, i: number) => { if (disabledFiles.has(t.file)) disabled.add(i); });
  _plSaveDisabled(disabled, storageKey);
  let newIndex = currentIndex;
  if (playingFile) {
    const found: number = tracks.findIndex((t: DefaultTrack) => t.file === playingFile);
    if (found >= 0) newIndex = found;
  }
  let newOrder = shuffledOrder.map((idx: number) => {
    if (idx === fromIdx) return toIdx;
    if (fromIdx < toIdx && idx > fromIdx && idx <= toIdx) return idx - 1;
    if (fromIdx > toIdx && idx >= toIdx && idx < fromIdx) return idx + 1;
    return idx;
  });
  newOrder = newOrder.filter((i: number) => !disabled.has(i));
  if (newOrder.length === 0) newOrder = _buildShuffledOrderFor(tracks, disabled, leadCount);
  return { shuffledOrder: newOrder, currentIndex: newIndex };
}

function _plNextEnabled(tracks: { length: number }, disabled: Set<number>, from: number, dir: number): number {
  const len: number = tracks.length;
  for (let i = 1; i <= len; i++) {
    const idx: number = ((from + dir * i) % len + len) % len;
    if (!disabled.has(idx)) return idx;
  }
  return from;
}

function _advanceLocalPlaylist(
  shuffledOrder: number[], currentIndex: number, disabled: Set<number>,
  tracks: { length: number }, dir: number,
): number {
  if (_shuffleMode) {
    if (shuffledOrder.length === 0) return currentIndex;
    const pool: number[] = shuffledOrder.filter((i: number) => i !== currentIndex);
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : currentIndex;
  }
  return _plNextEnabled(tracks, disabled, currentIndex, dir);
}

// Track-change callback — UI modules register to sync now-playing highlights
let _onTrackChangeCb: (() => void) | null = null;
export function onTrackChange(cb: () => void): void { _onTrackChangeCb = cb; }

// Pause-change callback — UI modules register to sync play/pause button visuals
let _onPauseChangeCb: ((paused: boolean) => void) | null = null;
export function onPauseChange(cb: (paused: boolean) => void): void { _onPauseChangeCb = cb; }

// Gain-reset hook owned by audio.ts — togglePause() calls this when resuming
// local playback so the master GainNode ramps back to _musicVolume. Kept as an
// injected callback so audioDeck doesn't need a hard reference to the master bus.
let _onResumeGainReset: (() => void) | null = null;
export function setMusicGainResetHook(cb: () => void): void { _onResumeGainReset = cb; }

function _updateTrackDisplay(): void {
  const el: HTMLElement | null = document.querySelector('.track-name');
  if (!el) return;
  let title: string;
  if (_playlistMode === 'custom' && _customPlaylist.length > 0) {
    title = _customPlaylist[_customIndex].title;
  } else if (_playlistMode === 'synthwave' && SYNTHWAVE_TRACKS[_synthwaveIndex]) {
    title = SYNTHWAVE_TRACKS[_synthwaveIndex].name;
  } else if (_playlistMode === 'electronic' && ELECTRONIC_TRACKS[_electronicIndex]) {
    title = ELECTRONIC_TRACKS[_electronicIndex].name;
  } else if (_playlistMode === 'all') {
    const localLen: number = ALL_LOCAL_TRACKS.length;
    if (_allIndex < localLen && ALL_LOCAL_TRACKS[_allIndex]) {
      title = ALL_LOCAL_TRACKS[_allIndex].name;
    } else {
      const ytIdx: number = _allIndex - localLen;
      title = _customPlaylist[ytIdx]?.title ?? '—';
    }
  } else if (_trackIndex != null && TRACKS[_trackIndex]) {
    title = TRACKS[_trackIndex].name;
  } else {
    title = '—';
  }
  el.textContent = '';
  const span = document.createElement('span');
  span.className = 'track-name-inner';
  span.textContent = title;
  el.appendChild(span);
  // Enable scrolling marquee if text overflows
  requestAnimationFrame(() => {
    const inner: HTMLElement | null = el.querySelector('.track-name-inner');
    if (inner && inner.scrollWidth > el.clientWidth) {
      const cw: number = el.clientWidth;
      const tw: number = inner.scrollWidth;
      inner.style.setProperty('--scroll-start', `${cw}px`);
      inner.style.setProperty('--scroll-dist', `-${tw}px`);
      const dur: number = Math.max(6, (cw + tw) / 40);
      inner.style.setProperty('--scroll-dur', `${dur}s`);
      inner.classList.add('track-name-inner--scrolling');
      el.classList.add('track-name--scrolling');
    } else {
      el.classList.remove('track-name--scrolling');
    }
  });
  // Update browser media session metadata
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'LUMINAL' });
  }
  // Notify UI so playlist highlights stay in sync
  if (_onTrackChangeCb) _onTrackChangeCb();
}

// ── Dual-Deck Helpers ───────────────────────────────────

/** Determine the URL of the next track without advancing indices. */
function _getNextTrackUrl(): string | null {
  if (_playlistMode === 'custom') return null; // YT handled separately
  if (_playlistMode === 'electronic') {
    if (_shuffleMode) {
      if (_electronicShuffledOrder.length === 0) return null;
      const pool = _electronicShuffledOrder.filter((i: number) => i !== _electronicIndex);
      const idx = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : _electronicIndex;
      return ELECTRONIC_TRACKS[idx]?.file ?? null;
    }
    return ELECTRONIC_TRACKS[_nextEnabledElectronic(_electronicIndex, 1)]?.file ?? null;
  }
  if (_playlistMode === 'all') {
    if (_shuffleMode) {
      if (_allShuffledOrder.length === 0) return null;
      const pool = _allShuffledOrder.filter((i: number) => i !== _allIndex);
      const idx = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : _nextEnabledAll(_allIndex, 1);
      return idx < ALL_LOCAL_TRACKS.length ? ALL_LOCAL_TRACKS[idx]?.file ?? null : null;
    }
    const idx = _nextEnabledAll(_allIndex, 1);
    return idx < ALL_LOCAL_TRACKS.length ? ALL_LOCAL_TRACKS[idx]?.file ?? null : null;
  }
  if (_playlistMode === 'synthwave') {
    if (_shuffleMode) {
      if (_synthwaveShuffledOrder.length === 0) return null;
      const pool = _synthwaveShuffledOrder.filter((i: number) => i !== _synthwaveIndex);
      const idx = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : _synthwaveIndex;
      return SYNTHWAVE_TRACKS[idx]?.file ?? null;
    }
    return SYNTHWAVE_TRACKS[_nextEnabledSynthwave(_synthwaveIndex, 1)]?.file ?? null;
  }
  // default playlist
  if (_shuffleMode) {
    if (_shuffledOrder.length === 0) return null;
    const pool = _shuffledOrder.filter((i: number) => i !== _trackIndex);
    const idx = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : _trackIndex;
    return TRACKS[idx]?.file ?? null;
  }
  return TRACKS[_nextEnabledDefault(_trackIndex, 1)]?.file ?? null;
}

/** Start pre-buffering the next track on the inactive deck. */
function _preBuffer(): void {
  if (!_deckA || !_deckB) return;
  const active = _getActiveDeck();
  const inactive = _getInactiveDeck();
  const dur = active.element.duration;
  if (!dur || isNaN(dur)) return;
  const remaining = dur - active.element.currentTime;
  if (remaining > PREBUFFER_THRESHOLD || _repeat || _crossfading) return;
  if (inactive.ready) return; // already pre-buffered

  const nextUrl = _getNextTrackUrl();
  if (!nextUrl) return;
  inactive.element.src = nextUrl;
  inactive.ready = false;
  inactive.element.addEventListener('canplaythrough', () => {
    inactive.ready = true;
  }, { once: true });
}

/** Cancel any in-progress crossfade and reset gains. */
function _cancelCrossfade(): void {
  if (_crossfadeTimer) { clearTimeout(_crossfadeTimer); _crossfadeTimer = null; }
  _crossfading = false;
  if (!_deckA || !_deckB) return;
  const active = _getActiveDeck();
  const inactive = _getInactiveDeck();
  if (_audioCtx) {
    active.xfadeGain.gain.cancelScheduledValues(_audioCtx.currentTime);
    inactive.xfadeGain.gain.cancelScheduledValues(_audioCtx.currentTime);
  }
  active.xfadeGain.gain.value = 1.0;
  inactive.xfadeGain.gain.value = 0.0;
  inactive.element.pause();
}

/** Crossfade from active deck to inactive deck over the given duration. */
function _crossfadeTo(duration: number): void {
  if (!_audioCtx || !_deckA || !_deckB) return;
  const active = _getActiveDeck();
  const inactive = _getInactiveDeck();
  _crossfading = true;

  inactive.element.play().catch(swallow('audio'));
  const now = _audioCtx.currentTime;
  active.xfadeGain.gain.setValueAtTime(1.0, now);
  active.xfadeGain.gain.linearRampToValueAtTime(0.0, now + duration);
  inactive.xfadeGain.gain.setValueAtTime(0.0, now);
  inactive.xfadeGain.gain.linearRampToValueAtTime(1.0, now + duration);

  _crossfadeTimer = setTimeout(() => {
    _crossfading = false;
    _crossfadeTimer = null;
    active.element.pause();
    active.xfadeGain.gain.value = 0.0;
    inactive.xfadeGain.gain.value = 1.0;
    _activeDeck = _activeDeck === 'A' ? 'B' : 'A';
    active.ready = false;
    _startPreBufferListener();
    _updateTrackDisplay();
  }, duration * 1000);
}

/** Hard-switch to a track on the inactive deck (no crossfade). */
function _hardSwitch(url: string): void {
  if (!_deckA || !_deckB) return;
  if (_crossfading) _cancelCrossfade();
  const active = _getActiveDeck();
  const inactive = _getInactiveDeck();

  active.element.pause();
  active.xfadeGain.gain.value = 0.0;
  active.ready = false;

  inactive.element.src = url;
  inactive.xfadeGain.gain.value = 1.0;
  inactive.ready = false;
  inactive.element.play().catch(swallow('audio'));

  _activeDeck = _activeDeck === 'A' ? 'B' : 'A';
  _startPreBufferListener();
}

/** Move the timeupdate pre-buffer listener to the current active deck. */
function _startPreBufferListener(): void {
  if (!_deckA || !_deckB) return;
  // Remove from both, re-add to active
  _deckA.element.removeEventListener('timeupdate', _preBuffer);
  _deckB.element.removeEventListener('timeupdate', _preBuffer);
  _deckA.element.removeEventListener('timeupdate', _onTimeUpdate);
  _deckB.element.removeEventListener('timeupdate', _onTimeUpdate);
  _getActiveDeck().element.addEventListener('timeupdate', _preBuffer);
  _getActiveDeck().element.addEventListener('timeupdate', _onTimeUpdate);
}

/** Attach per-deck error recovery listeners. */
function _attachDeckListeners(deck: DeckState): void {
  deck.element.addEventListener('ended', (): void => {
    // Only handle ended on the active deck
    if (deck !== _getActiveDeck()) return;
    if (_playlistMode === 'custom') return;
    if (_playlistMode === 'all' && _allIndex >= ALL_LOCAL_TRACKS.length) return;
    if (_crossfading) return; // crossfade already handling transition
    if (_repeat) { deck.element.currentTime = 0; deck.element.play().catch(swallow('audio')); return; }
    // Graceful degradation: if inactive deck is ready, crossfade won't have started
    // (since it triggers from timeupdate, not ended). Hard-switch or wait.
    const inactive = _getInactiveDeck();
    if (inactive.ready) {
      // Inactive is buffered — hard-switch (crossfade window has passed)
      _activeDeck = _activeDeck === 'A' ? 'B' : 'A';
      inactive.xfadeGain.gain.value = 1.0;
      deck.xfadeGain.gain.value = 0.0;
      deck.ready = false;
      inactive.element.play().catch(swallow('audio'));
      _startPreBufferListener();
      _updateTrackDisplay();
    } else {
      // Wait for inactive to be ready, then start it
      const nextUrl = _getNextTrackUrl();
      if (!nextUrl) return;
      if (!inactive.element.src || !inactive.element.src.endsWith(nextUrl)) {
        inactive.element.src = nextUrl;
      }
      inactive.element.addEventListener('canplaythrough', () => {
        if (deck !== _getActiveDeck()) return; // deck already swapped
        _activeDeck = _activeDeck === 'A' ? 'B' : 'A';
        inactive.xfadeGain.gain.value = 1.0;
        deck.xfadeGain.gain.value = 0.0;
        deck.ready = false;
        inactive.element.play().catch(swallow('audio'));
        _startPreBufferListener();
        _updateTrackDisplay();
      }, { once: true });
    }
    // Advance the playlist index so the next track is correct
    _advanceIndex();
  });

  // Recovery: if audio stalls, try to resume (never skip)
  deck.element.addEventListener('stalled', (): void => {
    if (deck !== _getActiveDeck()) return;
    if (_started && !_muted && _playlistMode !== 'custom') {
      setTimeout(() => {
        if (deck.element.paused && !deck.element.ended) deck.element.play().catch(swallow('audio'));
      }, 1000);
    }
  });

  deck.element.addEventListener('error', (): void => {
    if (!_started || _playlistMode === 'custom') return;
    if (deck.element.src !== deck.currentTrackSrc) return;

    if (deck === _getActiveDeck()) {
      // Active deck error
      if (deck.trackStartedPlaying) {
        setTimeout(() => {
          if (deck.element.src === deck.currentTrackSrc && deck.element.paused && !deck.element.ended) {
            deck.element.play().catch(swallow('audio'));
          }
        }, 500);
      } else if (deck.errorSkipCount < _currentTrackListLength() && !deck.pendingErrorSkip) {
        deck.errorSkipCount++;
        deck.pendingErrorSkip = setTimeout(() => {
          deck.pendingErrorSkip = null;
          if (deck.element.src === deck.currentTrackSrc && !deck.trackStartedPlaying) {
            skipTrack();
          }
        }, 3000);
      }
    } else {
      // Inactive deck error during pre-buffer — silently retry next track
      deck.ready = false;
      const nextUrl = _getNextTrackUrl();
      if (nextUrl && nextUrl !== deck.element.src) {
        deck.element.src = nextUrl;
        deck.element.addEventListener('canplaythrough', () => { deck.ready = true; }, { once: true });
      }
    }
  });

  deck.element.addEventListener('playing', (): void => {
    deck.errorSkipCount = 0;
    deck.trackStartedPlaying = true;
    if (deck.pendingErrorSkip) { clearTimeout(deck.pendingErrorSkip); deck.pendingErrorSkip = null; }
  });

  deck.element.addEventListener('loadstart', (): void => {
    deck.trackStartedPlaying = false;
    deck.currentTrackSrc = deck.element.src;
    if (deck.pendingErrorSkip) { clearTimeout(deck.pendingErrorSkip); deck.pendingErrorSkip = null; }
  });
}

/** Get the length of the current playlist (for error skip limits). */
function _currentTrackListLength(): number {
  if (_playlistMode === 'synthwave') return SYNTHWAVE_TRACKS.length;
  if (_playlistMode === 'electronic') return ELECTRONIC_TRACKS.length;
  if (_playlistMode === 'all') return ALL_LOCAL_TRACKS.length;
  return TRACKS.length;
}

/** Advance the current playlist index forward by one (used after ended event). */
function _advanceIndex(): void {
  if (_playlistMode === 'electronic') {
    _electronicIndex = _advanceLocalPlaylist(_electronicShuffledOrder, _electronicIndex, _disabledElectronic, ELECTRONIC_TRACKS, 1);
  } else if (_playlistMode === 'all') {
    // "all" has special fallback to _nextEnabledAll (which spans local + YT tracks)
    if (_shuffleMode) {
      if (_allShuffledOrder.length === 0) return;
      const localPool = _allShuffledOrder.filter((i: number) => i !== _allIndex);
      _allIndex = localPool.length > 0 ? localPool[Math.floor(Math.random() * localPool.length)] : _nextEnabledAll(_allIndex, 1);
    } else {
      _allIndex = _nextEnabledAll(_allIndex, 1);
    }
  } else if (_playlistMode === 'synthwave') {
    _synthwaveIndex = _advanceLocalPlaylist(_synthwaveShuffledOrder, _synthwaveIndex, _disabledSynthwave, SYNTHWAVE_TRACKS, 1);
  } else {
    _trackIndex = _advanceLocalPlaylist(_shuffledOrder, _trackIndex, _disabledDefaults, TRACKS, 1);
  }
}

// ── Crossfade-aware pre-buffer trigger from timeupdate ──
// When active track nears end and inactive is ready, start the crossfade.
function _onTimeUpdate(): void {
  if (!_deckA || !_deckB || !_audioCtx) return;
  const active = _getActiveDeck();
  const dur = active.element.duration;
  if (!dur || isNaN(dur)) return;
  const remaining = dur - active.element.currentTime;

  // Trigger crossfade when within crossfade window and inactive is ready
  if (remaining <= CROSSFADE_DURATION && remaining > 0 && !_crossfading && !_repeat) {
    const inactive = _getInactiveDeck();
    if (inactive.ready) {
      _advanceIndex();
      _crossfadeTo(remaining); // use exact remaining time for seamless transition
    }
  }
}

/**
 * Build dual decks, wire them into the audio graph and pick an initial track.
 * Called from audio.ts::initAudio() after the AudioContext and analyser node
 * have been created. All decks feed their xfade gains into the provided
 * analyser so audio.ts keeps ownership of the frequency-analysis path.
 */
export function initMusicDeck(ctx: AudioContext, analyser: AnalyserNode): void {
  _audioCtx = ctx;

  let initialSrc = '';
  if (_playlistMode === 'synthwave' && _synthwaveShuffledOrder.length > 0) {
    initialSrc = SYNTHWAVE_TRACKS[_synthwaveIndex].file;
  } else if (_playlistMode === 'electronic' && _electronicShuffledOrder.length > 0) {
    initialSrc = ELECTRONIC_TRACKS[_electronicIndex].file;
  } else if (_playlistMode === 'all' && _allIndex < ALL_LOCAL_TRACKS.length && _allShuffledOrder.length > 0) {
    initialSrc = ALL_LOCAL_TRACKS[_allIndex].file;
  } else if (_shuffledOrder.length > 0) {
    initialSrc = TRACKS[_trackIndex].file;
  }

  // Create dual decks
  function _createDeck(src: string, initialGain: number): DeckState {
    const element = new Audio(src);
    element.loop = false;
    element.volume = 1.0;
    element.crossOrigin = 'anonymous';
    const source = ctx.createMediaElementSource(element);
    const xfadeGain = ctx.createGain();
    xfadeGain.gain.value = initialGain;
    source.connect(xfadeGain);
    return {
      element, source, xfadeGain,
      errorSkipCount: 0, trackStartedPlaying: false,
      pendingErrorSkip: null, currentTrackSrc: '', ready: false,
    };
  }

  _deckA = _createDeck(initialSrc, 1.0);
  _deckB = _createDeck('', 0.0);

  // Both xfade gains merge into the analyser
  _deckA.xfadeGain.connect(analyser);
  _deckB.xfadeGain.connect(analyser);

  // Attach per-deck listeners
  _attachDeckListeners(_deckA);
  _attachDeckListeners(_deckB);

  // Pre-buffer + crossfade trigger on active deck
  _getActiveDeck().element.addEventListener('timeupdate', _preBuffer);
  _getActiveDeck().element.addEventListener('timeupdate', _onTimeUpdate);

  _updateTrackDisplay();
}

/** Start the active deck (or YT player for custom mode). Called from audio.ts::startAudio(). */
export async function startMusicDeck(): Promise<void> {
  if (_started) return;
  if (_playlistMode === 'custom' && _customPlaylist.length > 0) {
    _started = true;
    await _ensureYT();
    _customIndex = 0;
    _ytPlayer!.loadVideoById(_customPlaylist[0].id);
    _ytPlayer!.setVolume(_muted ? 0 : _musicVolume * 100);
    _updateTrackDisplay();
  } else {
    _getActiveDeck().element.play().catch(swallow('audio'));
    _started = true;
  }
}

/** Apply the current master volume to the YT player (local deck volume is handled by the master GainNode in audio.ts). */
export function applyMusicVolume(volume: number, muted: boolean): void {
  _musicVolume = volume;
  _muted = muted;
  if (_ytPlayer && _ytReady) _ytPlayer.setVolume(_muted ? 0 : _musicVolume * 100);
}

/** Apply mute state to the YT player (the local deck mute is handled by the master GainNode). */
export function applyMusicMute(muted: boolean): void {
  _muted = muted;
  if (_ytPlayer && _ytReady) _ytPlayer.setVolume(_muted ? 0 : _musicVolume * 100);
}

export function toggleShuffle(): boolean {
  _shuffleMode = !_shuffleMode;
  localStorage.setItem('luminal-shuffle', String(_shuffleMode));
  notifySettingChanged();
  return _shuffleMode;
}
export function getShuffleMode(): boolean { return _shuffleMode; }

export function toggleRepeat(): boolean { _repeat = !_repeat; return _repeat; }

function _nextEnabledCustom(dir: number): number {
  const len: number = _customPlaylist.length;
  if (len === 0) return -1;
  // If all muted, just advance normally
  const allMuted: boolean = _customMuted.size >= len;
  if (_shuffleMode && !allMuted) {
    const pool: number[] = [];
    for (let i = 0; i < len; i++) { if (!_customMuted.has(i) && i !== _customIndex) pool.push(i); }
    if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
  }
  for (let step = 1; step <= len; step++) {
    const idx: number = ((_customIndex + dir * step) % len + len) % len;
    if (!_customMuted.has(idx) || allMuted) return idx;
  }
  return (_customIndex + dir + len) % len;
}

let _lastSkipTime: number = 0;
export function skipTrack(): void {
  // Debounce — ignore rapid-fire skips within 300ms
  const now: number = performance.now();
  if (now - _lastSkipTime < 300) return;
  _lastSkipTime = now;
  _userPaused = false;
  if (_playlistMode === 'custom' && _customPlaylist.length > 0) {
    _customIndex = _nextEnabledCustom(1);
    if (_ytPlayer && _ytReady) _ytPlayer.loadVideoById(_customPlaylist[_customIndex].id);
    _updateTrackDisplay();
    return;
  }
  if (_playlistMode === 'electronic') {
    _electronicIndex = _advanceLocalPlaylist(_electronicShuffledOrder, _electronicIndex, _disabledElectronic, ELECTRONIC_TRACKS, 1);
    _playCurrentTrack(); return;
  }
  if (_playlistMode === 'all') {
    // "all" has special fallback to _nextEnabledAll (which spans local + YT tracks)
    if (_shuffleMode) {
      if (_allShuffledOrder.length === 0) return;
      const localPool: number[] = _allShuffledOrder.filter((i: number) => i !== _allIndex);
      _allIndex = localPool.length > 0 ? localPool[Math.floor(Math.random() * localPool.length)] : _nextEnabledAll(_allIndex, 1);
    } else {
      _allIndex = _nextEnabledAll(_allIndex, 1);
    }
    _playCurrentTrackForAll(); return;
  }
  if (_playlistMode === 'synthwave') {
    _synthwaveIndex = _advanceLocalPlaylist(_synthwaveShuffledOrder, _synthwaveIndex, _disabledSynthwave, SYNTHWAVE_TRACKS, 1);
  } else {
    _trackIndex = _advanceLocalPlaylist(_shuffledOrder, _trackIndex, _disabledDefaults, TRACKS, 1);
  }
  _playCurrentTrack();
}

export function prevTrack(): void {
  _userPaused = false;
  if (_playlistMode === 'custom' && _customPlaylist.length > 0) {
    _customIndex = _nextEnabledCustom(-1);
    if (_ytPlayer && _ytReady) _ytPlayer.loadVideoById(_customPlaylist[_customIndex].id);
    _updateTrackDisplay();
    return;
  }
  if (_playlistMode === 'electronic') {
    _electronicIndex = _advanceLocalPlaylist(_electronicShuffledOrder, _electronicIndex, _disabledElectronic, ELECTRONIC_TRACKS, -1);
    _playCurrentTrack(); return;
  }
  if (_playlistMode === 'all') {
    // "all" has special fallback to _nextEnabledAll (which spans local + YT tracks)
    if (_shuffleMode) {
      if (_allShuffledOrder.length === 0) return;
      const localPool: number[] = _allShuffledOrder.filter((i: number) => i !== _allIndex);
      _allIndex = localPool.length > 0 ? localPool[Math.floor(Math.random() * localPool.length)] : _nextEnabledAll(_allIndex, -1);
    } else {
      _allIndex = _nextEnabledAll(_allIndex, -1);
    }
    _playCurrentTrackForAll(); return;
  }
  if (_playlistMode === 'synthwave') {
    _synthwaveIndex = _advanceLocalPlaylist(_synthwaveShuffledOrder, _synthwaveIndex, _disabledSynthwave, SYNTHWAVE_TRACKS, -1);
  } else {
    _trackIndex = _advanceLocalPlaylist(_shuffledOrder, _trackIndex, _disabledDefaults, TRACKS, -1);
  }
  _playCurrentTrack();
}

/** Walk TRACKS array by +1 or -1, skipping disabled, wrapping around. */
function _nextEnabledDefault(from: number, dir: number): number {
  return _plNextEnabled(TRACKS, _disabledDefaults, from, dir);
}

function _nextEnabledSynthwave(from: number, dir: number): number {
  return _plNextEnabled(SYNTHWAVE_TRACKS, _disabledSynthwave, from, dir);
}

function _nextEnabledElectronic(from: number, dir: number): number {
  return _plNextEnabled(ELECTRONIC_TRACKS, _disabledElectronic, from, dir);
}

function _nextEnabledAll(from: number, dir: number): number {
  const localLen: number = ALL_LOCAL_TRACKS.length;
  const ytLen: number = _customPlaylist.length;
  const total: number = localLen + ytLen;
  if (total === 0) return from;
  for (let i = 1; i <= total; i++) {
    const idx: number = ((from + dir * i) % total + total) % total;
    if (idx < localLen && !_disabledAll.has(idx)) return idx;
    if (idx >= localLen && !_customMuted.has(idx - localLen)) return idx;
  }
  return from;
}

async function _playCurrentTrackForAll(): Promise<void> {
  const localLen: number = ALL_LOCAL_TRACKS.length;
  if (_allIndex < localLen) {
    if (_ytPlayer && _ytReady) { try { _ytPlayer.setVolume(0); _ytPlayer.stopVideo(); } catch { /* expected: YT player already torn down */ } }
    _ytPlaying = false;
    const url = ALL_LOCAL_TRACKS[_allIndex].file;
    const inactive = _getInactiveDeck();
    if (inactive.ready && inactive.element.src.endsWith(url)) {
      _crossfadeTo(SKIP_CROSSFADE_DURATION);
    } else {
      _hardSwitch(url);
    }
  } else {
    const ytIdx: number = _allIndex - localLen;
    if (_customPlaylist[ytIdx]) {
      const activeEl = _getActiveDeck().element;
      if (!activeEl.paused) activeEl.pause();
      await _ensureYT();
      _ytPlayer!.loadVideoById(_customPlaylist[ytIdx].id);
      _ytPlayer!.setVolume(_muted ? 0 : _musicVolume * 100);
    } else {
      // Custom playlist entry missing — reset to first local track
      _allIndex = 0;
      _ytPlaying = false;
      if (_ytPlayer && _ytReady) { try { _ytPlayer.setVolume(0); _ytPlayer.stopVideo(); } catch { /* expected: YT player already torn down */ } }
      _hardSwitch(ALL_LOCAL_TRACKS[0].file);
    }
  }
  _updateTrackDisplay();
}

function _playCurrentTrack(): void {
  if (!_deckA || !_deckB) return;
  if (_playlistMode === 'all') {
    _playCurrentTrackForAll(); return; // async path, returns early
  }
  let url: string;
  if (_playlistMode === 'synthwave') {
    url = SYNTHWAVE_TRACKS[_synthwaveIndex].file;
  } else if (_playlistMode === 'electronic') {
    url = ELECTRONIC_TRACKS[_electronicIndex].file;
  } else {
    url = TRACKS[_trackIndex].file;
  }
  const inactive = _getInactiveDeck();
  if (inactive.ready && inactive.element.src.endsWith(url)) {
    _crossfadeTo(SKIP_CROSSFADE_DURATION);
  } else {
    _hardSwitch(url);
  }
  _updateTrackDisplay();
}

export function playDefaultByIndex(index: number): void {
  if (index < 0 || index >= TRACKS.length) return;
  if (_disabledDefaults.has(index)) return;
  _userPaused = false;
  _trackIndex = index;
  if (_playlistMode !== 'default') { _playlistMode = 'default'; localStorage.setItem('luminal-playlist-mode', 'default'); notifySettingChanged(); }
  // Stop YouTube if playing
  if (_ytPlayer && _ytReady) { try { _ytPlayer.stopVideo(); } catch { /* expected: YT player already torn down */ } }
  _ytPlaying = false;
  _playCurrentTrack();
}

export function playSynthwaveByIndex(index: number): void {
  if (index < 0 || index >= SYNTHWAVE_TRACKS.length) return;
  if (_disabledSynthwave.has(index)) return;
  _userPaused = false;
  _synthwaveIndex = index;
  if (_playlistMode !== 'synthwave') { _playlistMode = 'synthwave'; localStorage.setItem('luminal-playlist-mode', 'synthwave'); notifySettingChanged(); }
  if (_ytPlayer && _ytReady) { try { _ytPlayer.stopVideo(); } catch { /* expected: YT player already torn down */ } }
  _ytPlaying = false;
  _playCurrentTrack();
}

export async function playCustomByIndex(index: number): Promise<void> {
  if (index < 0 || index >= _customPlaylist.length) return;
  if (_customMuted.has(index)) return;
  _userPaused = false;
  _customIndex = index;
  if (_playlistMode !== 'custom') { _playlistMode = 'custom'; localStorage.setItem('luminal-playlist-mode', 'custom'); notifySettingChanged(); }
  // Pause local audio
  const activeEl = _activeElement();
  if (activeEl && !activeEl.paused) activeEl.pause();
  await _ensureYT();
  _ytPlayer!.loadVideoById(_customPlaylist[index].id);
  _ytPlayer!.setVolume(_muted ? 0 : _musicVolume * 100);
  _updateTrackDisplay();
}

export function isPlaying(): boolean { return _started; }
export function getCurrentDefaultIndex(): number { return _trackIndex; }
export function getCurrentCustomIndex(): number { return _customIndex; }
export function isPaused(): boolean { return _userPaused; }

/** True while YouTube IFrame playback is active (used by frequency-band simulator in audio.ts). */
export function isYTPlaying(): boolean { return _ytPlaying; }

export function togglePause(): boolean {
  let paused: boolean;
  const el = _activeElement();
  if (_playlistMode === 'custom' && _ytPlayer && _ytReady) {
    try {
      const st: number = _ytPlayer.getPlayerState();
      if (st === window.YT.PlayerState.PLAYING) { _userPaused = true; _ytPlayer.pauseVideo(); paused = true; }
      else { _userPaused = false; _ytPlayer.playVideo(); paused = false; }
    } catch { return false; }
  } else if (!el) {
    return false;
  } else if (el.paused) {
    _userPaused = false;
    el.play().catch(swallow('audio'));
    if (_onResumeGainReset) _onResumeGainReset();
    paused = false;
  } else {
    _userPaused = true;
    el.pause();
    paused = true;
  }
  if (_onPauseChangeCb) _onPauseChangeCb(paused);
  return paused;
}

export function getPlaybackPosition(): { current: number; duration: number } {
  const isYT: boolean = _playlistMode === 'custom' || (_playlistMode === 'all' && _allIndex >= ALL_LOCAL_TRACKS.length);
  if (isYT) {
    if (_ytPlayer && _ytReady) {
      try {
        const cur: number = _ytPlayer.getCurrentTime() as number;
        const dur: number = _ytPlayer.getDuration() as number;
        return { current: isNaN(cur) ? 0 : cur, duration: isNaN(dur) ? 0 : dur };
      } catch { return { current: 0, duration: 0 }; }
    }
    return { current: 0, duration: 0 };
  }
  const el = _activeElement();
  if (!el) return { current: 0, duration: 0 };
  return {
    current: el.currentTime,
    duration: isNaN(el.duration) ? 0 : el.duration,
  };
}

export function seekTo(t: number): void {
  const isYT: boolean = _playlistMode === 'custom' || (_playlistMode === 'all' && _allIndex >= ALL_LOCAL_TRACKS.length);
  if (isYT) {
    if (_ytPlayer && _ytReady) { try { _ytPlayer.seekTo(t, true); } catch { /* expected: YT player torn down mid-seek */ } }
    return;
  }
  const el = _activeElement();
  if (el) el.currentTime = t;
}

// ── Recovery hooks called from audio.ts interval + visibility listener ──

/** Tick called from the audio-recovery interval in audio.ts. */
export function musicDeckRecoveryTick(): void {
  if (!_started || _muted || _userPaused) return;
  // If default playlist and audio stopped unexpectedly, restart it
  const el = _activeElement();
  if (_playlistMode !== 'custom' && el && el.paused && !el.ended) {
    el.play().catch(swallow('audio'));
  }
}

/** Visibility-change handler called from audio.ts. */
export function musicDeckOnVisibility(): void {
  if (!_started || _userPaused) return;
  const el = _activeElement();
  if (_playlistMode !== 'custom' && el && el.paused && !el.ended) {
    el.play().catch(swallow('audio'));
  }
}

// Re-read audio settings when restored from server
window.addEventListener(EVT_SETTINGS_RESTORED, () => {
  _shuffleMode = localStorage.getItem('luminal-shuffle') === 'true';
  _disabledDefaults = new Set(JSON.parse(localStorage.getItem('luminal-disabled-defaults') || '[]'));
  _disabledSynthwave = new Set(JSON.parse(localStorage.getItem('luminal-disabled-synthwave') || '[]'));
  _disabledElectronic = new Set(JSON.parse(localStorage.getItem('luminal-disabled-electronic') || '[]'));
  _disabledAll = new Set(JSON.parse(localStorage.getItem('luminal-disabled-all') || '[]'));
  _playlistMode = (localStorage.getItem('luminal-playlist-mode') || 'default') as PlaylistMode;
  _customPlaylist = JSON.parse(localStorage.getItem('luminal-custom-playlist') || '[]');
  _customMuted = new Set(JSON.parse(localStorage.getItem('luminal-custom-muted') || '[]'));
  const savedVol = localStorage.getItem('luminal-vol-music');
  if (savedVol) _musicVolume = parseInt(savedVol) / 100;
});

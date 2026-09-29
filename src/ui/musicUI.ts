// ── Music UI ─────────────────────────────────────────────
import { togglePause, skipTrack, prevTrack, toggleRepeat, toggleShuffle, getShuffleMode, setMusicVolume, getPlaylistMode, setPlaylistMode, getCustomPlaylist, addCustomTrack, removeCustomTrack, reorderCustomPlaylist, reorderDefaultTracks, importYTPlaylist, getDefaultTracks, getDisabledDefaults, toggleDefaultTrack, getCustomMuted, toggleCustomMuted, playDefaultByIndex, playCustomByIndex, getCurrentDefaultIndex, getCurrentCustomIndex, isPaused, isPlaying, onTrackChange, getSynthwaveTracks, getDisabledSynthwave, toggleSynthwaveTrack, reorderSynthwaveTracks, playSynthwaveByIndex, getCurrentSynthwaveIndex, getElectronicTracks, getDisabledElectronic, toggleElectronicTrack, reorderElectronicTracks, playElectronicByIndex, getCurrentElectronicIndex, getAllLocalTracks, getDisabledAll, toggleAllTrack, playAllByIndex, getCurrentAllIndex, getPlaybackPosition, seekTo } from '../audio';
import { notifySettingChanged } from '../settingsSync';
import { setSfxVolume } from '../sfx';
import { ico, show, hide, toggleVisible } from './dom';
import { cycleIndex } from './controls';

// ── Types ────────────────────────────────────────────────
interface DefaultTrack {
  name: string;
  file?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface CustomTrack {
  title: string;
  id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface YTImportResult {
  success: boolean;
  error?: string;
  added?: number;
  total?: number;
}

interface AddTrackResult {
  success: boolean;
  error?: string;
}

interface MusicUIDeps {
  ensureAudio: () => void;
  navigateTo: (screen: string) => void;
}

type PlaylistMode = 'default' | 'custom' | 'synthwave' | 'electronic' | 'all';

// ── Injected deps (set via initMusicUI) ──────────────────
let _ensureAudio: () => void = () => {};
let _navigateTo: (screen: string) => void = () => {};

// ── Music Overlay ─────────────────────────────────────────
const musicNpTrack: HTMLElement = document.getElementById('music-np-track')!;
const musicPlaylistEditor: HTMLElement = document.getElementById('music-playlist-editor')!;
const musicDefaultEditor: HTMLElement = document.getElementById('music-default-editor')!;
const musicDefaultList: HTMLElement = document.getElementById('music-default-list')!;
const musicPlaylistList: HTMLElement = document.getElementById('music-playlist-list')!;
const musicYtInput: HTMLInputElement = document.getElementById('music-yt-input') as HTMLInputElement;
const musicYtError: HTMLElement = document.getElementById('music-yt-error')!;
const musicYtStatus: HTMLElement = document.getElementById('music-yt-status')!;
const musicSynthwaveEditor: HTMLElement = document.getElementById('music-synthwave-editor')!;
const musicSynthwaveList: HTMLElement = document.getElementById('music-synthwave-list')!;
const musicElectronicEditor: HTMLElement = document.getElementById('music-electronic-editor')!;
const musicElectronicList: HTMLElement = document.getElementById('music-electronic-list')!;
const musicAllEditor: HTMLElement = document.getElementById('music-all-editor')!;
const musicAllList: HTMLElement = document.getElementById('music-all-list')!;
const musicPlaylistModeLabel: HTMLElement = document.getElementById('playlist-mode-label')!;
const _playlistModes: PlaylistMode[] = ['default', 'electronic', 'synthwave', 'all', 'custom'];
const _playlistModeNames: Record<PlaylistMode, string> = {
  default: 'DEFAULT TRACKS',
  custom: 'YOUR PLAYLIST',
  electronic: 'ELECTRONIC',
  synthwave: 'SYNTHWAVE',
  all: 'ALL',
};

export function _updateMusicOverlay(): void {
  const trackEl: Element | null = document.querySelector('.track-name');
  const inner: Element | null = trackEl?.querySelector('.track-name-inner') ?? null;
  musicNpTrack.textContent = inner ? inner.textContent : (trackEl ? trackEl.textContent : '—');
  // Sync shuffle & repeat active states
  document.getElementById('music-shuffle-btn')?.classList.toggle('music-ctrl--active', getShuffleMode());
  // Sync playlist mode label
  musicPlaylistModeLabel.textContent = _playlistModeNames[getPlaylistMode() as PlaylistMode] || 'DEFAULT TRACKS';
}

export function _switchMusicTab(tab: PlaylistMode): void {
  toggleVisible(musicDefaultEditor, tab === 'default');
  toggleVisible(musicSynthwaveEditor, tab === 'synthwave');
  toggleVisible(musicPlaylistEditor, tab === 'custom');
  toggleVisible(musicElectronicEditor, tab === 'electronic');
  toggleVisible(musicAllEditor, tab === 'all');
  musicPlaylistModeLabel.textContent = _playlistModeNames[tab] || 'DEFAULT TRACKS';
}

function _renderLocalPlaylist(listEl: HTMLElement, tracks: DefaultTrack[], disabled: Set<number>, curIdx: number, modeKey: PlaylistMode, listType: 'default' | 'synthwave' | 'electronic'): void {
  const mode: string = getPlaylistMode();
  const playing: boolean = isPlaying();
  const paused: boolean = isPaused();
  listEl.innerHTML = tracks.map((t: DefaultTrack, i: number) => {
    const off: boolean = disabled.has(i);
    const isActive: boolean = playing && mode === modeKey && curIdx === i;
    const showPause: boolean = isActive && !paused;
    return `<div class="playlist-item${off ? ' playlist-item--default-disabled' : ''}${isActive ? ' playlist-item--now-playing' : ''}" data-idx="${i}"><span class="playlist-play-btn" data-idx="${i}" title="${showPause ? 'Pause' : 'Play'}">${showPause ? ico('pause') : ico('play')}</span><span class="playlist-item-title">${t.name}</span><span class="playlist-toggle ${off ? 'playlist-toggle--disabled' : 'playlist-toggle--enabled'}" data-idx="${i}">${off ? ico('vol-x') : ico('vol')}</span></div>`;
  }).join('');
  _initDragReorder(listEl, listType);
}

export function _renderDefaultPlaylist(): void {
  _renderLocalPlaylist(musicDefaultList, getDefaultTracks(), getDisabledDefaults(), getCurrentDefaultIndex(), 'default', 'default');
}

export function _renderSynthwavePlaylist(): void {
  _renderLocalPlaylist(musicSynthwaveList, getSynthwaveTracks(), getDisabledSynthwave(), getCurrentSynthwaveIndex(), 'synthwave', 'synthwave');
}

export function _renderElectronicPlaylist(): void {
  _renderLocalPlaylist(musicElectronicList, getElectronicTracks(), getDisabledElectronic(), getCurrentElectronicIndex(), 'electronic', 'electronic');
}

export function _renderAllPlaylist(): void {
  const localTracks = getAllLocalTracks();
  const disabled = getDisabledAll();
  const customTracks = getCustomPlaylist();
  const customMuted = getCustomMuted();
  const curIdx = getCurrentAllIndex();
  const mode = getPlaylistMode();
  const playing = isPlaying();
  const paused = isPaused();
  const localLen = localTracks.length;

  let html = localTracks.map((t: DefaultTrack, i: number) => {
    const off = disabled.has(i);
    const isActive = playing && mode === 'all' && curIdx === i;
    const showPause = isActive && !paused;
    return `<div class="playlist-item${off ? ' playlist-item--default-disabled' : ''}${isActive ? ' playlist-item--now-playing' : ''}" data-idx="${i}" data-list="all-local"><span class="playlist-play-btn" data-idx="${i}" data-list="all-local" title="${showPause ? 'Pause' : 'Play'}">${showPause ? ico('pause') : ico('play')}</span><span class="playlist-item-title">${t.name}</span><span class="playlist-toggle ${off ? 'playlist-toggle--disabled' : 'playlist-toggle--enabled'}" data-idx="${i}" data-list="all-local">${off ? ico('vol-x') : ico('vol')}</span></div>`;
  }).join('');

  html += customTracks.map((t: CustomTrack, i: number) => {
    const off = customMuted.has(i);
    const allIdx = localLen + i;
    const isActive = playing && mode === 'all' && curIdx === allIdx;
    const showPause = isActive && !paused;
    return `<div class="playlist-item${off ? ' playlist-item--default-disabled' : ''}${isActive ? ' playlist-item--now-playing' : ''}" data-idx="${allIdx}" data-list="all-yt"><span class="playlist-play-btn" data-idx="${allIdx}" data-list="all-yt" title="${showPause ? 'Pause' : 'Play'}">${showPause ? ico('pause') : ico('play')}</span><span class="playlist-item-title">${t.title}</span><span class="playlist-toggle ${off ? 'playlist-toggle--disabled' : 'playlist-toggle--enabled'}" data-idx="${i}" data-list="all-yt">${off ? ico('vol-x') : ico('vol')}</span></div>`;
  }).join('');

  musicAllList.innerHTML = html || '<div class="playlist-empty">NO TRACKS</div>';
}

export function _renderMusicPlaylist(): void {
  const tracks: CustomTrack[] = getCustomPlaylist();
  if (tracks.length === 0) {
    musicPlaylistList.innerHTML = '<div class="playlist-empty">NO TRACKS — PASTE A YOUTUBE URL ABOVE</div>';
    return;
  }
  const muted: Set<number> = getCustomMuted();
  const curIdx: number = getCurrentCustomIndex();
  const mode: string = getPlaylistMode();
  const playing: boolean = isPlaying();
  const paused: boolean = isPaused();
  musicPlaylistList.innerHTML = tracks.map((t: CustomTrack, i: number) => {
    const off: boolean = muted.has(i);
    const isActive: boolean = playing && mode === 'custom' && curIdx === i;
    const showPause: boolean = isActive && !paused;
    return `<div class="playlist-item${off ? ' playlist-item--default-disabled' : ''}${isActive ? ' playlist-item--now-playing' : ''}" data-idx="${i}"><span class="playlist-play-btn" data-idx="${i}" title="${showPause ? 'Pause' : 'Play'}">${showPause ? ico('pause') : ico('play')}</span><span class="playlist-item-title">${t.title}</span><a class="playlist-download" href="https://www.youtube.com/watch?v=${t.id}" target="_blank" rel="noopener" data-idx="${i}" data-tip="Open on YouTube">${ico('link')}</a><span class="playlist-toggle ${off ? 'playlist-toggle--disabled' : 'playlist-toggle--enabled'}" data-idx="${i}" data-list="custom">${off ? ico('vol-x') : ico('vol')}</span><span class="playlist-remove" data-idx="${i}">${ico('x')}</span></div>`;
  }).join('');
  _initDragReorder(musicPlaylistList, 'custom');
}

// ── Drag-to-Reorder ──────────────────────────────────────
type DragState = {
  dragItem: HTMLElement | null;
  placeholder: HTMLDivElement | null;
  grabOffsetY: number;
  itemH: number;
  dragItems: HTMLElement[];
  dragIdx: number;
  lastOverIdx: number;
};

function _isDragActionButton(target: HTMLElement): boolean {
  return !!(target.closest('.playlist-play-btn')
    || target.closest('.playlist-toggle')
    || target.closest('.playlist-remove')
    || target.closest('.playlist-download'));
}

function _handleDragStart(e: MouseEvent | TouchEvent, state: DragState, listEl: HTMLElement, onMove: (e: MouseEvent | TouchEvent) => void, onEnd: () => void): void {
  e.preventDefault();
  e.stopPropagation();
  state.dragItem = (e.target as HTMLElement).closest('.playlist-item') as HTMLElement | null;
  if (!state.dragItem) return;
  state.dragItems = Array.from(listEl.querySelectorAll('.playlist-item')) as HTMLElement[];
  state.dragIdx = state.dragItems.indexOf(state.dragItem);
  state.itemH = state.dragItem.offsetHeight;
  const clientY: number = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
  const rect: DOMRect = state.dragItem.getBoundingClientRect();
  state.grabOffsetY = clientY - rect.top;

  // Create placeholder
  state.placeholder = document.createElement('div');
  state.placeholder.className = 'playlist-drag-placeholder';
  state.placeholder.style.height = state.itemH + 'px';
  state.dragItem.parentNode!.insertBefore(state.placeholder, state.dragItem);

  // Float the drag item pinned to cursor
  state.dragItem.classList.add('playlist-item--dragging');
  state.dragItem.style.width = rect.width + 'px';
  state.dragItem.style.top = (clientY - state.grabOffsetY) + 'px';
  state.dragItem.style.left = rect.left + 'px';
  document.body.appendChild(state.dragItem);

  state.lastOverIdx = state.dragIdx;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

function _handleDragMove(e: MouseEvent | TouchEvent, state: DragState, listEl: HTMLElement): void {
  if (!state.dragItem) return;
  e.preventDefault();
  const clientY: number = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
  state.dragItem.style.top = (clientY - state.grabOffsetY) + 'px';

  // Determine drop position based on mouse position relative to list items
  const listItems: HTMLElement[] = Array.from(listEl.querySelectorAll('.playlist-item:not(.dragging)')) as HTMLElement[];
  let insertIdx: number = listItems.length;
  for (let i = 0; i < listItems.length; i++) {
    const r: DOMRect = listItems[i].getBoundingClientRect();
    const mid: number = r.top + r.height / 2;
    if (clientY < mid) { insertIdx = i; break; }
  }

  // Auto-scroll the list container
  const listRect: DOMRect = listEl.getBoundingClientRect();
  const scrollZone: number = 30;
  if (clientY < listRect.top + scrollZone) listEl.scrollTop -= 6;
  else if (clientY > listRect.bottom - scrollZone) listEl.scrollTop += 6;

  if (insertIdx !== state.lastOverIdx) {
    state.lastOverIdx = insertIdx;
    // Move placeholder
    if (insertIdx >= listItems.length) listEl.appendChild(state.placeholder!);
    else listEl.insertBefore(state.placeholder!, listItems[insertIdx]);
  }
}

function _applyReorder(listType: 'default' | 'custom' | 'synthwave' | 'electronic', dragIdx: number, newIdx: number): void {
  if (listType === 'default') {
    reorderDefaultTracks(dragIdx, newIdx);
  } else if (listType === 'synthwave') {
    reorderSynthwaveTracks(dragIdx, newIdx);
  } else if (listType === 'electronic') {
    reorderElectronicTracks(dragIdx, newIdx);
  } else {
    reorderCustomPlaylist(dragIdx, newIdx);
  }
}

function _rerenderList(listType: 'default' | 'custom' | 'synthwave' | 'electronic'): void {
  if (listType === 'default') _renderDefaultPlaylist();
  else if (listType === 'synthwave') _renderSynthwavePlaylist();
  else if (listType === 'electronic') _renderElectronicPlaylist();
  else _renderMusicPlaylist();
}

function _handleDragEnd(state: DragState, listEl: HTMLElement, listType: 'default' | 'custom' | 'synthwave' | 'electronic', onMove: (e: MouseEvent | TouchEvent) => void, onEnd: () => void): void {
  if (!state.dragItem) return;
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onEnd);
  document.removeEventListener('touchmove', onMove);
  document.removeEventListener('touchend', onEnd);

  // Compute new index: placeholder position among listEl children (excluding placeholder itself)
  const allChildren: Element[] = Array.from(listEl.children);
  const placeholderPos: number = allChildren.indexOf(state.placeholder!);
  // placeholderPos is the index in the reduced list (dragged item not present)
  // reorder functions do splice(from,1) then splice(to,0,item) — toIdx is in the reduced array
  let newIdx: number = placeholderPos;
  if (newIdx < 0) newIdx = 0;

  // Clean up DOM
  state.dragItem.classList.remove('playlist-item--dragging');
  state.dragItem.style.cssText = '';
  if (state.placeholder!.parentNode) state.placeholder!.parentNode.removeChild(state.placeholder!);

  // Apply reorder if changed
  if (newIdx !== state.dragIdx) _applyReorder(listType, state.dragIdx, newIdx);
  _rerenderList(listType);
  state.dragItem = null;
  state.placeholder = null;
}

function _initDragReorder(listEl: HTMLElement, listType: 'default' | 'custom' | 'synthwave' | 'electronic'): void {
  const state: DragState = {
    dragItem: null,
    placeholder: null,
    grabOffsetY: 0,
    itemH: 0,
    dragItems: [],
    dragIdx: -1,
    lastOverIdx: -1,
  };

  const onMove = (e: MouseEvent | TouchEvent): void => _handleDragMove(e, state, listEl);
  const onEnd = (): void => _handleDragEnd(state, listEl, listType, onMove, onEnd);
  const onStart = (e: MouseEvent | TouchEvent): void => _handleDragStart(e, state, listEl, onMove, onEnd);

  // Drag from anywhere on the item except action buttons on the right
  const items: Element[] = Array.from(listEl.querySelectorAll('.playlist-item'));
  items.forEach((item: Element) => {
    item.addEventListener('mousedown', (e: Event) => {
      if (_isDragActionButton(e.target as HTMLElement)) return;
      onStart(e as MouseEvent);
    });
    item.addEventListener('touchstart', (e: Event) => {
      if (_isDragActionButton(e.target as HTMLElement)) return;
      onStart(e as TouchEvent);
    }, { passive: false });
  });
}

// Music overlay volume sliders — synced with top bar and settings sliders
const _musicMasterSlider: HTMLInputElement = document.getElementById('music-master-slider') as HTMLInputElement;
_musicMasterSlider.value = String(parseFloat(localStorage.getItem('luminal-vol-master') ?? '100'));
const _musicVolSlider: HTMLInputElement = document.getElementById('music-vol-slider') as HTMLInputElement;
_musicVolSlider.value = String(parseFloat(localStorage.getItem('luminal-vol-music') ?? '35'));
const _musicSfxSlider: HTMLInputElement = document.getElementById('music-sfx-slider') as HTMLInputElement;
const _musicVoiceSlider: HTMLInputElement = document.getElementById('music-voice-slider') as HTMLInputElement;
const _musicScrubber: HTMLInputElement = document.getElementById('music-scrubber') as HTMLInputElement;
const _musicScrubberTime: HTMLElement = document.getElementById('music-scrubber-time')!;

// Load saved values
_musicSfxSlider.value = String(parseFloat(localStorage.getItem('luminal-vol-sfx') ?? '50'));
_musicVoiceSlider.value = String(parseFloat(localStorage.getItem('luminal-vol-voice') ?? '75'));

function _fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '—:——';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

let _scrubberDragging: boolean = false;
let _scrubberRaf: number = 0;

function _startScrubberLoop(): void {
  if (_scrubberRaf) return;
  function tick(): void {
    const overlay = document.getElementById('music-overlay');
    if (!overlay || overlay.classList.contains('hidden')) { _scrubberRaf = 0; return; }
    if (!_scrubberDragging) {
      const { current, duration } = getPlaybackPosition();
      if (duration > 0) {
        _musicScrubber.disabled = false;
        _musicScrubber.value = String(Math.round((current / duration) * 1000));
        _musicScrubberTime.textContent = `${_fmtTime(current)} / ${_fmtTime(duration)}`;
      } else {
        _musicScrubber.disabled = true;
        _musicScrubberTime.textContent = '—:—— / —:——';
      }
    }
    _scrubberRaf = requestAnimationFrame(tick);
  }
  _scrubberRaf = requestAnimationFrame(tick);
}

function _stopScrubberLoop(): void {
  if (_scrubberRaf) { cancelAnimationFrame(_scrubberRaf); _scrubberRaf = 0; }
}

function _musicVolSparkle(slider: HTMLInputElement): void {
  const row: HTMLElement | null = slider.closest('.music-vol-row');
  if (!row) return;
  const rect: DOMRect = slider.getBoundingClientRect();
  const pct: number = parseInt(slider.value) / 100;
  const thumbX: number = rect.left + pct * rect.width;
  const thumbY: number = rect.top + rect.height / 2;
  const rowRect: DOMRect = row.getBoundingClientRect();
  const count: number = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const spark: HTMLDivElement = document.createElement('div');
    spark.className = 'vol-sparkle';
    const hue: string = Math.random() > 0.5 ? '270,80%,75%' : '180,100%,60%';
    spark.style.background = `hsla(${hue},0.9)`;
    const sx: number = thumbX - rowRect.left;
    const sy: number = thumbY - rowRect.top;
    const angle: number = Math.random() * Math.PI * 2;
    const dist: number = 8 + Math.random() * 16;
    spark.style.setProperty('--sx', sx + 'px');
    spark.style.setProperty('--sy', sy + 'px');
    spark.style.setProperty('--ex', (sx + Math.cos(angle) * dist) + 'px');
    spark.style.setProperty('--ey', (sy + Math.sin(angle) * dist) + 'px');
    spark.style.left = '0'; spark.style.top = '0';
    row.style.position = 'relative';
    row.appendChild(spark);
    spark.addEventListener('animationend', () => spark.remove());
  }
}

// Playlist mode arrow selector
async function _cyclePlaylistMode(dir: -1 | 1): Promise<void> {
  const cur: string = getPlaylistMode();
  const idx: number = _playlistModes.indexOf(cur as PlaylistMode);
  const next: PlaylistMode = _playlistModes[cycleIndex(idx, dir, _playlistModes.length)];
  _switchMusicTab(next);
  await setPlaylistMode(next);
  _updateMusicOverlay();
}

// Auto-detect YouTube URL paste (no button needed)
async function _handleYtUrlInput(): Promise<void> {
  const url: string = musicYtInput.value.trim();
  // Only auto-trigger on valid YouTube URLs
  if (!url || !(/youtu\.?be/.test(url))) return;
  musicYtInput.classList.add('yt-url-input--loading');
  hide(musicYtError);
  hide(musicYtStatus);
  const isPlaylist: boolean = /[?&]list=/.test(url);
  if (isPlaylist) {
    musicYtStatus.textContent = 'LOADING PLAYLIST...';
    show(musicYtStatus);
    const result: YTImportResult = await importYTPlaylist(url, (cur: number, tot: number) => {
      musicYtStatus.textContent = `IMPORTING ${cur}/${tot}`;
      _renderMusicPlaylist();
    });
    musicYtInput.classList.remove('yt-url-input--loading');
    hide(musicYtStatus);
    if (result.success) {
      musicYtInput.value = '';
      _renderMusicPlaylist();
      musicYtStatus.textContent = `IMPORTED ${result.added} OF ${result.total} TRACKS`;
      show(musicYtStatus);
      setTimeout(() => hide(musicYtStatus), 4000);
    } else {
      musicYtError.textContent = result.error!;
      show(musicYtError);
      setTimeout(() => hide(musicYtError), 4000);
    }
  } else {
    const result: AddTrackResult = await addCustomTrack(url);
    musicYtInput.classList.remove('yt-url-input--loading');
    if (result.success) {
      musicYtInput.value = '';
      _renderMusicPlaylist();
      if (getCustomPlaylist().length === 1) { _ensureAudio(); await setPlaylistMode('custom'); _updateMusicOverlay(); }
    } else {
      musicYtError.textContent = result.error!;
      show(musicYtError);
      setTimeout(() => hide(musicYtError), 4000);
    }
  }
}

function _wireTrackChange(): void {
  // Re-render playlist highlights when track changes (skip, auto-advance, etc.)
  onTrackChange(() => {
    _updateMusicOverlay();
    // Only re-render lists if the music overlay is visible (avoid DOM thrashing)
    const musicOverlay: HTMLElement | null = document.getElementById('music-overlay');
    if (musicOverlay && !musicOverlay.classList.contains('hidden')) {
      _renderDefaultPlaylist();
      _renderSynthwavePlaylist();
      _renderElectronicPlaylist();
      _renderAllPlaylist();
      _renderMusicPlaylist();
    }
  });
}

function _wireTransportControls(): void {
  document.getElementById('btn-music')!.addEventListener('click', () => _navigateTo('music'));
  document.getElementById('music-prev')!.addEventListener('click', () => { _ensureAudio(); prevTrack(); setTimeout(_updateMusicOverlay, 100); });
  document.getElementById('music-next')!.addEventListener('click', () => { _ensureAudio(); skipTrack(); setTimeout(_updateMusicOverlay, 100); });
  document.getElementById('music-playpause')!.addEventListener('click', () => { _ensureAudio(); togglePause(); });
  document.getElementById('music-repeat-btn')!.addEventListener('click', () => {
    const active: boolean = toggleRepeat();
    document.getElementById('music-repeat-btn')!.classList.toggle('music-ctrl--active', active);
    document.getElementById('repeat-btn')!.classList.toggle('repeat-btn--active', active);
  });
  document.getElementById('music-shuffle-btn')!.addEventListener('click', () => {
    const active: boolean = toggleShuffle();
    document.getElementById('music-shuffle-btn')!.classList.toggle('music-ctrl--active', active);
    document.getElementById('shuffle-btn')!.classList.toggle('shuffle-btn--active', active);
  });
}

function _wireVolumeSliders(): void {
  _musicMasterSlider.addEventListener('input', (e: Event) => {
    e.stopPropagation();
    const masterVal: number = parseInt(_musicMasterSlider.value) / 100;
    const musicRaw: number = parseInt(_musicVolSlider.value) / 100;
    const sfxRaw: number = parseInt(_musicSfxSlider.value) / 100;
    setMusicVolume(musicRaw * masterVal);
    setSfxVolume(sfxRaw * masterVal);
    localStorage.setItem('luminal-vol-master', _musicMasterSlider.value);
    notifySettingChanged();
    const settingsMaster = document.getElementById('vol-master') as HTMLInputElement | null;
    if (settingsMaster) settingsMaster.value = _musicMasterSlider.value;
    const barSlider = document.getElementById('vol-bar-slider') as HTMLInputElement | null;
    if (barSlider) barSlider.value = _musicMasterSlider.value;
    _musicVolSparkle(_musicMasterSlider);
  });
  _musicMasterSlider.addEventListener('keydown', (e: Event) => e.stopPropagation());

  _musicVolSlider.addEventListener('input', (e: Event) => {
    e.stopPropagation();
    const musicRaw: number = parseInt((e.target as HTMLInputElement).value);
    const masterRaw: number = parseFloat(localStorage.getItem('luminal-vol-master') ?? '100');
    setMusicVolume((musicRaw / 100) * (masterRaw / 100));
    localStorage.setItem('luminal-vol-music', (e.target as HTMLInputElement).value);
    notifySettingChanged();
    // Sync other sliders
    const settingsSlider: HTMLInputElement | null = document.getElementById('vol-music') as HTMLInputElement | null;
    if (settingsSlider) settingsSlider.value = (e.target as HTMLInputElement).value;
    _musicVolSparkle(e.target as HTMLInputElement);
  });
  _musicVolSlider.addEventListener('keydown', (e: Event) => e.stopPropagation());

  _musicSfxSlider.addEventListener('input', (e: Event) => {
    e.stopPropagation();
    const sfxRaw: number = parseInt(_musicSfxSlider.value);
    const masterRaw: number = parseFloat(localStorage.getItem('luminal-vol-master') ?? '100');
    setSfxVolume((sfxRaw / 100) * (masterRaw / 100));
    localStorage.setItem('luminal-vol-sfx', String(sfxRaw));
    notifySettingChanged();
    const settingsSfx = document.getElementById('vol-sfx') as HTMLInputElement | null;
    if (settingsSfx) settingsSfx.value = String(sfxRaw);
    _musicVolSparkle(_musicSfxSlider);
  });
  _musicSfxSlider.addEventListener('keydown', (e: Event) => e.stopPropagation());

  _musicVoiceSlider.addEventListener('input', (e: Event) => {
    e.stopPropagation();
    localStorage.setItem('luminal-vol-voice', _musicVoiceSlider.value);
    notifySettingChanged();
    const settingsVoice = document.getElementById('vol-voice') as HTMLInputElement | null;
    if (settingsVoice) settingsVoice.value = _musicVoiceSlider.value;
    _musicVolSparkle(_musicVoiceSlider);
  });
  _musicVoiceSlider.addEventListener('keydown', (e: Event) => e.stopPropagation());
}

function _wireScrubber(): void {
  _musicScrubber.addEventListener('mousedown', () => { _scrubberDragging = true; });
  _musicScrubber.addEventListener('touchstart', () => { _scrubberDragging = true; }, { passive: true });
  _musicScrubber.addEventListener('input', () => {
    const { duration } = getPlaybackPosition();
    if (duration > 0) {
      const t: number = (parseInt(_musicScrubber.value) / 1000) * duration;
      _musicScrubberTime.textContent = `${_fmtTime(t)} / ${_fmtTime(duration)}`;
    }
  });
  _musicScrubber.addEventListener('change', () => {
    _scrubberDragging = false;
    const { duration } = getPlaybackPosition();
    if (duration > 0) seekTo((parseInt(_musicScrubber.value) / 1000) * duration);
  });
  _musicScrubber.addEventListener('mouseup', () => { _scrubberDragging = false; });
  _musicScrubber.addEventListener('touchend', () => { _scrubberDragging = false; });
  _musicScrubber.addEventListener('touchcancel', () => { _scrubberDragging = false; });
  _musicScrubber.addEventListener('keydown', (e: Event) => e.stopPropagation());
}

function _wirePlaylistModeAndYtInput(): void {
  document.getElementById('playlist-mode-left')!.addEventListener('click', () => _cyclePlaylistMode(-1));
  document.getElementById('playlist-mode-right')!.addEventListener('click', () => _cyclePlaylistMode(1));

  musicYtInput.addEventListener('paste', () => { setTimeout(_handleYtUrlInput, 50); });
  musicYtInput.addEventListener('keydown', (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Enter') _handleYtUrlInput(); });
}

function _wireCustomPlaylistList(): void {
  musicPlaylistList.addEventListener('click', async (e: Event) => {
    const playBtn: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-play-btn');
    if (playBtn) {
      const idx: number = parseInt(playBtn.dataset.idx!);
      _ensureAudio();
      const isActive: boolean = getPlaylistMode() === 'custom' && getCurrentCustomIndex() === idx;
      if (isActive) { togglePause(); } else { await playCustomByIndex(idx); }
      _renderMusicPlaylist(); _updateMusicOverlay();
      return;
    }
    const tog: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-toggle');
    if (tog) {
      toggleCustomMuted(parseInt(tog.dataset.idx!));
      _renderMusicPlaylist();
      return;
    }
    const rm: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-remove');
    if (rm) {
      removeCustomTrack(parseInt(rm.dataset.idx!));
      _renderMusicPlaylist();
      if (getCustomPlaylist().length === 0) { _updateMusicOverlay(); }
      return;
    }
  });
}

function _wireDefaultPlaylistList(): void {
  musicDefaultList.addEventListener('click', (e: Event) => {
    const playBtn: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-play-btn');
    if (playBtn) {
      const idx: number = parseInt(playBtn.dataset.idx!);
      _ensureAudio();
      const isActive: boolean = getPlaylistMode() === 'default' && getCurrentDefaultIndex() === idx;
      if (isActive) { togglePause(); } else { playDefaultByIndex(idx); }
      setTimeout(() => { _renderDefaultPlaylist(); _updateMusicOverlay(); }, 100);
      return;
    }
    const tog: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-toggle');
    if (tog) {
      toggleDefaultTrack(parseInt(tog.dataset.idx!));
      _renderDefaultPlaylist();
      return;
    }
  });
}

function _wireSynthwavePlaylistList(): void {
  musicSynthwaveList.addEventListener('click', (e: Event) => {
    const playBtn: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-play-btn');
    if (playBtn) {
      const idx: number = parseInt(playBtn.dataset.idx!);
      _ensureAudio();
      const isActive: boolean = getPlaylistMode() === 'synthwave' && getCurrentSynthwaveIndex() === idx;
      if (isActive) { togglePause(); } else { playSynthwaveByIndex(idx); }
      setTimeout(() => { _renderSynthwavePlaylist(); _updateMusicOverlay(); }, 100);
      return;
    }
    const tog: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-toggle');
    if (tog) {
      toggleSynthwaveTrack(parseInt(tog.dataset.idx!));
      _renderSynthwavePlaylist();
      return;
    }
  });
}

function _wireElectronicPlaylistList(): void {
  musicElectronicList.addEventListener('click', (e: Event) => {
    const playBtn: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-play-btn');
    if (playBtn) {
      const idx: number = parseInt(playBtn.dataset.idx!);
      _ensureAudio();
      const isActive: boolean = getPlaylistMode() === 'electronic' && getCurrentElectronicIndex() === idx;
      if (isActive) { togglePause(); } else { playElectronicByIndex(idx); }
      setTimeout(() => { _renderElectronicPlaylist(); _updateMusicOverlay(); }, 100);
      return;
    }
    const tog: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-toggle');
    if (tog) {
      toggleElectronicTrack(parseInt(tog.dataset.idx!));
      _renderElectronicPlaylist();
      return;
    }
  });
}

function _wireAllPlaylistList(): void {
  musicAllList.addEventListener('click', async (e: Event) => {
    const playBtn: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-play-btn');
    if (playBtn) {
      const idx: number = parseInt(playBtn.dataset.idx!);
      _ensureAudio();
      const isActive: boolean = getPlaylistMode() === 'all' && getCurrentAllIndex() === idx;
      if (isActive) { togglePause(); } else { await playAllByIndex(idx); }
      setTimeout(() => { _renderAllPlaylist(); _updateMusicOverlay(); }, 100);
      return;
    }
    const tog: HTMLElement | null = (e.target as HTMLElement).closest('.playlist-toggle');
    if (tog) {
      const list: string | undefined = tog.dataset.list;
      const idx: number = parseInt(tog.dataset.idx!);
      if (list === 'all-local') { toggleAllTrack(idx); }
      else { toggleCustomMuted(idx); }
      _renderAllPlaylist();
      return;
    }
  });
}

/**
 * Initialize all Music UI event listeners.
 */
export function initMusicUI(deps: MusicUIDeps): void {
  _ensureAudio = deps.ensureAudio;
  _navigateTo = deps.navigateTo;

  _wireTrackChange();
  _wireTransportControls();
  _wireVolumeSliders();
  _wireScrubber();
  _wirePlaylistModeAndYtInput();
  _wireCustomPlaylistList();
  _wireDefaultPlaylistList();
  _wireSynthwavePlaylistList();
  _wireElectronicPlaylistList();
  _wireAllPlaylistList();
}

export { _startScrubberLoop, _stopScrubberLoop };

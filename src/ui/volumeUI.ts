import { setMusicVolume, getPlaylistMode, setPlaylistMode, prevTrack, skipTrack, toggleMute } from '../audio';
import type { PlaylistMode } from '../audio';
import { setSfxVolume } from '../sfx';
import { notifySettingChanged } from '../settingsSync';
import { ico } from './dom';
import { _updateMusicOverlay } from './musicUI';

interface VolumeUIDeps {
  ensureAudio: () => void;
}

export function initVolumeUI(deps: VolumeUIDeps): void {
  const { ensureAudio } = deps;

  // Volume dropdown slider
  const _volSlider: HTMLInputElement = document.getElementById('vol-bar-slider') as HTMLInputElement;
  _volSlider.value = String(parseFloat(localStorage.getItem('luminal-vol-master') ?? '100'));
  function _volSparkle(slider: HTMLInputElement): void {
    const wrap: HTMLElement | null = slider.closest('#vol-dropdown-inner');
    if (!wrap) return;
    const rect: DOMRect = slider.getBoundingClientRect();
    const pct: number = 1 - parseInt(slider.value) / 100;
    const thumbY: number = rect.top + pct * rect.height;
    const thumbX: number = rect.left + rect.width / 2;
    const wrapRect: DOMRect = wrap.getBoundingClientRect();
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const spark: HTMLDivElement = document.createElement('div');
      spark.className = 'vol-sparkle';
      const hue: string = Math.random() > 0.5 ? '270,80%,75%' : '180,100%,60%';
      spark.style.background = `hsla(${hue},0.9)`;
      const sx: number = thumbX - wrapRect.left, sy: number = thumbY - wrapRect.top;
      const angle: number = Math.random() * Math.PI * 2, dist: number = 8 + Math.random() * 16;
      spark.style.setProperty('--sx', sx + 'px'); spark.style.setProperty('--sy', sy + 'px');
      spark.style.setProperty('--ex', (sx + Math.cos(angle) * dist) + 'px');
      spark.style.setProperty('--ey', (sy + Math.sin(angle) * dist) + 'px');
      spark.style.left = '0'; spark.style.top = '0';
      wrap.style.position = 'relative'; wrap.appendChild(spark);
      spark.addEventListener('animationend', () => spark.remove());
    }
  }
  _volSlider.addEventListener('input', (e: Event) => {
    e.stopPropagation();
    const target: HTMLInputElement = e.target as HTMLInputElement;
    const masterVal: number = parseInt(target.value) / 100;
    const musicRaw: number = Number((document.getElementById('vol-music') as HTMLInputElement)?.value ?? '35') / 100;
    const sfxRaw: number = Number((document.getElementById('vol-sfx') as HTMLInputElement)?.value ?? '50') / 100;
    setMusicVolume(musicRaw * masterVal);
    setSfxVolume(sfxRaw * masterVal);
    localStorage.setItem('luminal-vol-master', target.value);
    notifySettingChanged();
    const settingsMaster: HTMLInputElement | null = document.getElementById('vol-master') as HTMLInputElement | null;
    if (settingsMaster) settingsMaster.value = target.value;
    const musicMaster: HTMLInputElement | null = document.getElementById('music-master-slider') as HTMLInputElement | null;
    if (musicMaster) musicMaster.value = target.value;
    _volSparkle(target);
  });
  _volSlider.addEventListener('keydown', (e: KeyboardEvent) => e.stopPropagation());

  // Playlist dropdown
  const _plDropWrap: HTMLElement = document.getElementById('playlist-dropdown-wrap')!;
  const _plDropItems: HTMLElement = document.getElementById('playlist-drop-items')!;
  document.getElementById('playlist-drop-header')!.addEventListener('click', () => {
    document.getElementById('btn-music')?.click();
  });
  document.getElementById('btn-playlist-edit')!.addEventListener('click', (e: Event) => {
    e.stopPropagation(); document.getElementById('btn-music')?.click();
  });
  function _populatePlaylistDrop(): void {
    const current: string = getPlaylistMode();
    const html = `<div class="dropdown-item${current === 'default' ? ' active' : ''}" data-pl="default">DEFAULT</div>` +
      `<div class="dropdown-item${current === 'electronic' ? ' active' : ''}" data-pl="electronic">ELECTRONIC</div>` +
      `<div class="dropdown-item${current === 'synthwave' ? ' active' : ''}" data-pl="synthwave">SYNTHWAVE</div>` +
      `<div class="dropdown-item${current === 'all' ? ' active' : ''}" data-pl="all">ALL</div>` +
      `<div class="dropdown-item${current === 'custom' ? ' active' : ''}" data-pl="custom">YOUR PLAYLIST</div>`;
    _plDropItems.innerHTML = html;
    _plDropItems.querySelectorAll('.dropdown-item').forEach((item: Element) => {
      item.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        const pl = (item as HTMLElement).dataset.pl as PlaylistMode;
        ensureAudio(); await setPlaylistMode(pl); _updateMusicOverlay();
        // Update active states in dropdown
        _plDropItems.querySelectorAll('.dropdown-item').forEach((el: Element) => {
          el.classList.toggle('active', (el as HTMLElement).dataset.pl === pl);
        });
      });
    });
  }
  _plDropWrap.addEventListener('mouseenter', _populatePlaylistDrop);
  // Also populate on click-to-open so touch devices see items
  _plDropWrap.addEventListener('click', _populatePlaylistDrop);

  // Pause screen music controls
  document.getElementById('btn-pause-prev')!.addEventListener('click', () => { ensureAudio(); prevTrack(); });
  document.getElementById('btn-pause-skip')!.addEventListener('click', () => { ensureAudio(); skipTrack(); });
  document.getElementById('btn-pause-mute')!.addEventListener('click', (e: MouseEvent) => {
    const muted: boolean = toggleMute();
    (e.target as HTMLElement).innerHTML = muted ? ico('vol-x') : ico('vol');
  });
}

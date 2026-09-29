// ── Settings: Audio ─────────────────────────────────────
// Volume controls: master, music, SFX, voice sliders.

import { setMusicVolume } from '../../audio';
import { setSfxVolume, playUiBlip } from '../../sfx';
import { notifySettingChanged } from '../../settingsSync';

let _lastBlipTime = 0;
function _blipDebounced(): void {
  const now = performance.now();
  if (now - _lastBlipTime < 120) return;
  _lastBlipTime = now;
  playUiBlip();
}

// ── Init ─────────────────────────────────────────────────
export function initAudio(): void {
  const savedMaster: string | null = localStorage.getItem('luminal-vol-master');
  const savedMusic: string | null = localStorage.getItem('luminal-vol-music');
  const savedSfx: string | null = localStorage.getItem('luminal-vol-sfx');

  const masterSlider = document.getElementById('vol-master') as HTMLInputElement;
  const musicSlider = document.getElementById('vol-music') as HTMLInputElement;
  const sfxSlider = document.getElementById('vol-sfx') as HTMLInputElement;

  if (savedMaster !== null) masterSlider.value = savedMaster;
  if (savedMusic !== null) musicSlider.value = savedMusic;
  const sfxVal = savedSfx ?? '40';
  sfxSlider.value = sfxVal;

  // Apply volumes: effective = slider * master
  function applyVolumes(): void {
    const master: number = Number(masterSlider.value) / 100;
    const music: number = Number(musicSlider.value) / 100;
    const sfx: number = Number(sfxSlider.value) / 100;
    setMusicVolume(music * master);
    setSfxVolume(sfx * master);
  }
  applyVolumes();

  masterSlider.addEventListener('input', () => {
    applyVolumes();
    _blipDebounced();
    const musicMaster = document.getElementById('music-master-slider') as HTMLInputElement | null;
    if (musicMaster) musicMaster.value = masterSlider.value;
    const barSlider = document.getElementById('vol-bar-slider') as HTMLInputElement | null;
    if (barSlider) barSlider.value = masterSlider.value;
  });
  masterSlider.addEventListener('change', () => {
    localStorage.setItem('luminal-vol-master', masterSlider.value);
    notifySettingChanged();
  });

  musicSlider.addEventListener('input', () => {
    applyVolumes();
    _blipDebounced();
    const musicVolSlider: HTMLInputElement | null = document.getElementById('music-vol-slider') as HTMLInputElement | null;
    if (musicVolSlider) musicVolSlider.value = musicSlider.value;
  });
  sfxSlider.addEventListener('input', () => {
    applyVolumes();
    _blipDebounced();
    const musicSfx = document.getElementById('music-sfx-slider') as HTMLInputElement | null;
    if (musicSfx) musicSfx.value = sfxSlider.value;
  });
  musicSlider.addEventListener('change', () => { localStorage.setItem('luminal-vol-music', musicSlider.value); notifySettingChanged(); });
  sfxSlider.addEventListener('change', () => { localStorage.setItem('luminal-vol-sfx', sfxSlider.value); notifySettingChanged(); });

  // ── Voice Volume ─────────────────────────────────────────
  const voiceSlider = document.getElementById('vol-voice') as HTMLInputElement;
  const savedVoice: string | null = localStorage.getItem('luminal-vol-voice');
  if (savedVoice !== null) voiceSlider.value = savedVoice;

  voiceSlider.addEventListener('input', () => {
    _blipDebounced();
    const musicVoice = document.getElementById('music-voice-slider') as HTMLInputElement | null;
    if (musicVoice) musicVoice.value = voiceSlider.value;
  });
  voiceSlider.addEventListener('change', () => { localStorage.setItem('luminal-vol-voice', voiceSlider.value); notifySettingChanged(); });
}

// ── Restore (after server sync) ──────────────────────────
export function restoreAudio(): void {
  const savedMaster = localStorage.getItem('luminal-vol-master');
  if (savedMaster) (document.getElementById('vol-master') as HTMLInputElement).value = savedMaster;
  const savedVol = localStorage.getItem('luminal-vol-music');
  if (savedVol) (document.getElementById('vol-music') as HTMLInputElement).value = savedVol;
  const savedSfx = localStorage.getItem('luminal-vol-sfx');
  if (savedSfx) (document.getElementById('vol-sfx') as HTMLInputElement).value = savedSfx;
  const savedVoice = localStorage.getItem('luminal-vol-voice');
  if (savedVoice) (document.getElementById('vol-voice') as HTMLInputElement).value = savedVoice;
}

// ── Reset to Defaults ────────────────────────────────────
export function resetAudioDefaults(): void {
  localStorage.removeItem('luminal-vol-master');
  localStorage.removeItem('luminal-vol-music');
  localStorage.removeItem('luminal-vol-sfx');
  localStorage.removeItem('luminal-vol-voice');
}

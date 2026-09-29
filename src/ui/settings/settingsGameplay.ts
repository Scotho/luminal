// ── Settings: Gameplay ──────────────────────────────────
// Camera sliders, gamepad deadzone, line assist, auto submit, sync,
// top bar visibility, perf overlay toggles.

import { playTick } from '../../sfx';
import { setCameraFOV, setCameraDist, setCameraLerp, setShakeEnabled } from '../../scene';
import { getStickDeadzone, setStickDeadzone } from '../../gamepad';
import { notifySettingChanged } from '../../settingsSync';
import { setPerfFps, setPerfMem, setPerfPing, setPerfVram } from '../effects';
import { getLocalBool } from '../storage';
import { createToggle, createSlider } from '../controls';
import type { ToggleHandle } from '../controls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

export interface GameplayInitDeps {
  game: GameInstance;
  onLineAssist: (v: boolean) => void;
  onAutoSubmit: (v: boolean) => void;
  onSettingsSync: (v: boolean) => void;
  onTbVisible: (v: boolean) => void;
  onTbMusic: (v: boolean) => void;
  onTbOnline: (v: boolean) => void;
}

export interface GameplayHandles {
  lineAssistCtrl: ToggleHandle;
  autoSubmitCtrl: ToggleHandle;
  syncCtrl: ToggleHandle;
  tbVisCtrl: ToggleHandle;
  tbMusicCtrl: ToggleHandle;
  tbOnlineCtrl: ToggleHandle;
  perfFpsCtrl: ToggleHandle;
  perfMemCtrl: ToggleHandle;
  perfPingCtrl: ToggleHandle;
  perfVramCtrl: ToggleHandle;
  shakeCtrl: ToggleHandle | null;
  fovSlider: HTMLInputElement;
  distSlider: HTMLInputElement;
  stiffSlider: HTMLInputElement;
  applyTopBarVisibility: () => void;
}

// ── Init ─────────────────────────────────────────────────
export function initGameplay(deps: GameplayInitDeps): GameplayHandles {
  const { game, onLineAssist, onAutoSubmit, onSettingsSync, onTbVisible, onTbMusic, onTbOnline } = deps;

  // ── FOV Slider ─────────────────────────────────────────
  const fovSlider: HTMLInputElement = document.getElementById('cam-fov') as HTMLInputElement;
  const savedFov: string | null = localStorage.getItem('luminal-cam-fov');
  if (savedFov !== null) setCameraFOV(Number(savedFov));

  createSlider({
    el: fovSlider,
    storageKey: 'luminal-cam-fov',
    onInput(val) { setCameraFOV(val); game.enableDemoChaseCam(10); },
    onChange() { notifySettingChanged(); },
  });

  // ── Camera Distance Slider ─────────────────────────────
  const distSlider: HTMLInputElement = document.getElementById('cam-dist') as HTMLInputElement;
  const savedDist: string | null = localStorage.getItem('luminal-cam-dist');
  if (savedDist !== null) {
    // Clamp legacy saved values to the current slider range so the camera
    // and the slider agree after a max-zoom reduction.
    const clamped = Math.max(Number(distSlider.min), Math.min(Number(distSlider.max), Number(savedDist)));
    setCameraDist(clamped);
    if (clamped !== Number(savedDist)) {
      localStorage.setItem('luminal-cam-dist', String(clamped));
    }
  }

  createSlider({
    el: distSlider,
    storageKey: 'luminal-cam-dist',
    onInput(val) { setCameraDist(val); game.enableDemoChaseCam(10); },
    onChange() { notifySettingChanged(); },
  });

  // ── Camera Stiffness Slider ───────────────────────────────
  const stiffSlider: HTMLInputElement = document.getElementById('cam-stiffness') as HTMLInputElement;
  const savedStiff: string | null = localStorage.getItem('luminal-cam-stiffness');
  if (savedStiff !== null) setCameraLerp(Number(savedStiff));

  createSlider({
    el: stiffSlider,
    storageKey: 'luminal-cam-stiffness',
    onInput(val) { setCameraLerp(val); game.enableDemoChaseCam(10); },
    onChange() { notifySettingChanged(); },
  });

  // ── Camera Shake Toggle ───────────────────────────────────
  const shakeToggleEl: HTMLElement = document.getElementById('cam-shake-toggle') as HTMLElement;
  let shakeCtrl: ToggleHandle | null = null;
  if (shakeToggleEl) {
    shakeCtrl = createToggle({
      el: shakeToggleEl,
      storageKey: 'luminal-cam-shake',
      defaultVal: 'on',
      onChange(val) { setShakeEnabled(val === 'on'); notifySettingChanged(); },
    });
    setShakeEnabled(shakeCtrl.getValue() === 'on');
  }

  // ── Stick Deadzone Slider ───────────────────────────────
  const dzSlider: HTMLInputElement = document.getElementById('stick-deadzone') as HTMLInputElement;
  if (dzSlider) {
    dzSlider.value = String(Math.round(getStickDeadzone() * 100));
    createSlider({
      el: dzSlider,
      onInput(val) { setStickDeadzone(val / 100); },
      onChange() {},
    });
  }

  // ── Line Ride Assist Toggle ────────────────────────────
  const lineAssistCtrl = createToggle({
    el: document.getElementById('lineassist-toggle')!,
    storageKey: 'luminal-lineassist',
    defaultVal: 'on',
    onChange(val) {
      onLineAssist(val === 'on');
      notifySettingChanged();
    },
  });

  // ── Auto Submit Toggle ─────────────────────────────────
  const autoSubmitCtrl = createToggle({
    el: document.getElementById('autosubmit-toggle')!,
    storageKey: 'luminal-autosubmit',
    defaultVal: 'on',
    onChange(val) {
      onAutoSubmit(val === 'on');
      notifySettingChanged();
    },
  });

  // ── Settings Sync Toggle ──────────────────────────────
  const syncCtrl = createToggle({
    el: document.getElementById('settings-sync-toggle')!,
    storageKey: 'luminal-settings-sync',
    defaultVal: 'on',
    onChange(val) {
      onSettingsSync(val === 'on');
      playTick();
    },
  });

  // ── Top Bar Visibility Toggles ─────────────────────────
  let _tbVisible = getLocalBool('luminal-tb-visible', true);
  let _tbMusic = getLocalBool('luminal-tb-music', true);
  let _tbOnline = getLocalBool('luminal-tb-online', true);

  function applyTopBarVisibility(): void {
    const topBar = document.getElementById('auth-status');
    if (topBar) topBar.style.display = _tbVisible ? '' : 'none';
    document.body.classList.toggle('topbar-hidden', !_tbVisible);
    const audioRow = document.getElementById('np-audio-row');
    if (audioRow) audioRow.style.display = _tbMusic ? '' : 'none';
    const onlineEl = document.getElementById('players-online');
    if (onlineEl) onlineEl.style.display = _tbOnline ? '' : 'none';
  }

  const tbVisCtrl = createToggle({
    el: document.getElementById('tb-vis-toggle')!,
    storageKey: 'luminal-tb-visible',
    defaultVal: 'on',
    onChange(val) {
      _tbVisible = val === 'on';
      onTbVisible(_tbVisible);
      applyTopBarVisibility();
      playTick();
    },
  });

  const tbMusicCtrl = createToggle({
    el: document.getElementById('tb-music-toggle')!,
    storageKey: 'luminal-tb-music',
    defaultVal: 'on',
    onChange(val) {
      _tbMusic = val === 'on';
      onTbMusic(_tbMusic);
      applyTopBarVisibility();
      playTick();
    },
  });

  const tbOnlineCtrl = createToggle({
    el: document.getElementById('tb-online-toggle')!,
    storageKey: 'luminal-tb-online',
    defaultVal: 'on',
    onChange(val) {
      _tbOnline = val === 'on';
      onTbOnline(_tbOnline);
      applyTopBarVisibility();
      playTick();
    },
  });

  applyTopBarVisibility();

  // ── Performance Overlay Toggles ───────────────────────
  let perfFps = getLocalBool('luminal-perf-fps', false);
  let perfMem = getLocalBool('luminal-perf-mem', false);
  let perfPing = getLocalBool('luminal-perf-ping', false);
  let perfVram = getLocalBool('luminal-perf-vram', false);

  const perfFpsCtrl = createToggle({
    el: document.getElementById('perf-fps-toggle')!,
    storageKey: 'luminal-perf-fps',
    defaultVal: 'off',
    onChange(val) {
      perfFps = val === 'on';
      setPerfFps(perfFps);
      playTick();
    },
  });

  const perfMemCtrl = createToggle({
    el: document.getElementById('perf-mem-toggle')!,
    storageKey: 'luminal-perf-mem',
    defaultVal: 'off',
    onChange(val) {
      perfMem = val === 'on';
      setPerfMem(perfMem);
      playTick();
    },
  });

  const perfPingCtrl = createToggle({
    el: document.getElementById('perf-ping-toggle')!,
    storageKey: 'luminal-perf-ping',
    defaultVal: 'off',
    onChange(val) {
      perfPing = val === 'on';
      setPerfPing(perfPing);
      playTick();
    },
  });

  const perfVramCtrl = createToggle({
    el: document.getElementById('perf-vram-toggle')!,
    storageKey: 'luminal-perf-vram',
    defaultVal: 'off',
    onChange(val) {
      perfVram = val === 'on';
      setPerfVram(perfVram);
      playTick();
    },
  });

  return {
    lineAssistCtrl, autoSubmitCtrl, syncCtrl,
    tbVisCtrl, tbMusicCtrl, tbOnlineCtrl,
    perfFpsCtrl, perfMemCtrl, perfPingCtrl, perfVramCtrl,
    shakeCtrl,
    fovSlider, distSlider, stiffSlider,
    applyTopBarVisibility,
  };
}

// ── Restore (after server sync) ──────────────────────────
export function restoreGameplay(handles: GameplayHandles): void {
  const { fovSlider, distSlider, stiffSlider, shakeCtrl } = handles;

  const savedFov = localStorage.getItem('luminal-cam-fov');
  if (savedFov) { fovSlider.value = savedFov; setCameraFOV(Number(savedFov)); }
  const savedDist = localStorage.getItem('luminal-cam-dist');
  if (savedDist) {
    const clamped = Math.max(Number(distSlider.min), Math.min(Number(distSlider.max), Number(savedDist)));
    distSlider.value = String(clamped);
    setCameraDist(clamped);
    if (clamped !== Number(savedDist)) localStorage.setItem('luminal-cam-dist', String(clamped));
  }
  const savedStiff = localStorage.getItem('luminal-cam-stiffness');
  if (savedStiff) { stiffSlider.value = savedStiff; setCameraLerp(Number(savedStiff)); }
  const savedShake = localStorage.getItem('luminal-cam-shake');
  if (savedShake && shakeCtrl) { shakeCtrl.setValue(savedShake === '0' ? 'off' : 'on'); setShakeEnabled(savedShake !== '0'); }
}

// ── Reset to Defaults ────────────────────────────────────
export function resetGameplayDefaults(handles: GameplayHandles): void {
  const {
    lineAssistCtrl, autoSubmitCtrl, syncCtrl,
    tbVisCtrl, tbMusicCtrl, tbOnlineCtrl,
    perfFpsCtrl, perfMemCtrl, perfPingCtrl, perfVramCtrl,
    applyTopBarVisibility,
  } = handles;

  localStorage.removeItem('luminal-cam-fov');
  localStorage.removeItem('luminal-cam-dist');
  localStorage.removeItem('luminal-cam-stiffness');
  localStorage.removeItem('luminal-cam-shake');

  lineAssistCtrl.setValue('on');
  autoSubmitCtrl.setValue('on');
  syncCtrl.setValue('on');

  // Top bar: reset all to ON
  tbVisCtrl.setValue('on');
  tbMusicCtrl.setValue('on');
  tbOnlineCtrl.setValue('on');
  applyTopBarVisibility();

  // Reset perf overlay
  setPerfFps(false); setPerfMem(false); setPerfPing(false); setPerfVram(false);
  perfFpsCtrl.setValue('off');
  perfMemCtrl.setValue('off');
  perfPingCtrl.setValue('off');
  perfVramCtrl.setValue('off');
}

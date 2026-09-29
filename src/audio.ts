// Audio router — owns the AudioContext, master gain bus, frequency analyser
// and frequency-band extraction. All music deck + playlist + YouTube logic
// lives in ./audioDeck; the ambient (pause/menu) low-pass bed lives in
// ./audioAmbient. This file re-exports their public API so consumers can keep
// importing from './audio' as before.

import { swallow } from './swallow';
import {
  initMusicDeck,
  startMusicDeck,
  applyMusicVolume,
  applyMusicMute,
  isYTPlaying,
  setMusicGainResetHook,
  musicDeckRecoveryTick,
  musicDeckOnVisibility,
  skipTrack,
  prevTrack,
  togglePause,
} from './audioDeck';
import { initAmbientChain, setAmbientDampen } from './audioAmbient';

interface FrequencyBands {
  bass: number;
  lowMid: number;
  mid: number;
  upperMid: number;
  presence: number;
  brilliance: number;
  high: number;
  air: number;
  energy: number;
  kick: number;
}

// ── Audio bus state ─────────────────────────────────────
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;
let _gainNode: GainNode | null = null;
let _muted: boolean = false;
let _musicVolume: number = 0.35;

const BAND_COUNT: number = 8;
const bandRanges: [number, number][] = [];

export function setMusicVolume(v: number): void {
  _musicVolume = Math.max(0, Math.min(1, v));
  if (_gainNode && !_muted) _gainNode.gain.value = _musicVolume;
  applyMusicVolume(_musicVolume, _muted);
}

/** Engage muffled low-pass dampen effect (settings / pause menus). */
export function setMusicDampen(on: boolean): void {
  setAmbientDampen(on);
}

export function initAudio(): void {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;
  freqData = new Uint8Array(analyser.frequencyBinCount);

  const binCount: number = analyser.frequencyBinCount;
  const binWidth: number = audioCtx.sampleRate / analyser.fftSize;
  const bandFreqs: number[] = [0, 60, 150, 400, 1000, 2500, 5000, 10000, 20000];
  for (let i = 0; i < BAND_COUNT; i++) {
    const lo: number = Math.floor(bandFreqs[i] / binWidth);
    const hi: number = Math.min(Math.floor(bandFreqs[i + 1] / binWidth), binCount - 1);
    bandRanges.push([lo, hi]);
  }

  // Build decks + playlist wiring — audioDeck connects its xfade gains into
  // our analyser node so frequency analysis still sees the music signal.
  initMusicDeck(audioCtx, analyser);

  const gain: GainNode = audioCtx.createGain();
  gain.gain.value = _musicVolume;
  _gainNode = gain;

  analyser.connect(gain);
  // Ambient dampen bed splices between master gain and destination.
  initAmbientChain(audioCtx, gain);

  // togglePause() in audioDeck needs to reset master gain when resuming local
  // playback — register the callback now that _gainNode is live.
  setMusicGainResetHook(() => {
    if (_gainNode) _gainNode.gain.value = _musicVolume;
  });
}

export async function startAudio(): Promise<void> {
  if (!audioCtx) initAudio();
  if (audioCtx!.state === 'suspended') audioCtx!.resume();
  await startMusicDeck();
}

// ── Frequency Analysis ───────────────────────────────────
const _bands: Float32Array = new Float32Array(BAND_COUNT);
const _zeroBands: Float32Array = new Float32Array(BAND_COUNT);
const _simBands: Float32Array = new Float32Array(BAND_COUNT);

export function getFrequencyBands(): Float32Array {
  // When YouTube is playing, simulate gentle EQ animation
  if (isYTPlaying()) {
    const t: number = performance.now() / 1000;
    for (let b = 0; b < BAND_COUNT; b++) {
      _simBands[b] = 0.2 + 0.25 * Math.sin(t * (2.0 + b * 0.8) + b * 1.3) + 0.12 * Math.sin(t * (3.5 + b * 1.2) + b * 2.1);
    }
    return _simBands;
  }
  if (!analyser || !freqData) return _zeroBands;
  analyser.getByteFrequencyData(freqData);
  const bands: Float32Array = _bands;
  for (let b = 0; b < BAND_COUNT; b++) {
    const [lo, hi]: [number, number] = bandRanges[b];
    let sum: number = 0, count: number = 0;
    for (let i = lo; i <= hi; i++) { sum += freqData[i]; count++; }
    bands[b] = count > 0 ? ((sum / count) / 255) * 0.75 : 0;
  }
  return bands;
}

export function getBands(): FrequencyBands {
  const b: Float32Array = getFrequencyBands();
  return {
    bass: b[0], lowMid: b[1], mid: b[2], upperMid: b[3],
    presence: b[4], brilliance: b[5], high: b[6], air: b[7],
    energy: (b[0] * 0.4 + b[1] * 0.25 + b[2] * 0.2 + b[3] * 0.15),
    kick: Math.max(b[0], b[1] * 0.5),
  };
}

export function toggleMute(): boolean {
  _muted = !_muted;
  if (_gainNode) _gainNode.gain.value = _muted ? 0 : _musicVolume;
  applyMusicMute(_muted);
  return _muted;
}

// ── MediaSession API (keyboard media keys) ───────────────
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => togglePause());
  navigator.mediaSession.setActionHandler('pause', () => togglePause());
  navigator.mediaSession.setActionHandler('nexttrack', () => skipTrack());
  navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
}

// ── Audio recovery: keep AudioContext alive ───────────────
// Browsers suspend AudioContext after periods of silence or tab switches
setInterval((): void => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(swallow('audio'));
  }
  musicDeckRecoveryTick();
}, 3000);

// Resume audio when tab regains focus
document.addEventListener('visibilitychange', (): void => {
  if (document.hidden) return;
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(swallow('audio'));
  }
  musicDeckOnVisibility();
});

// ── Re-exports: preserve public API from audioDeck ───────
export type { PlaylistMode } from './audioDeck';
export {
  // Playlist mode
  getPlaylistMode,
  setPlaylistMode,
  // Custom YT playlist
  getCustomPlaylist,
  addCustomTrack,
  importYTPlaylist,
  removeCustomTrack,
  getCustomMuted,
  toggleCustomMuted,
  reorderCustomPlaylist,
  // Default
  getDefaultTracks,
  getDisabledDefaults,
  reorderDefaultTracks,
  toggleDefaultTrack,
  playDefaultByIndex,
  // Synthwave
  getSynthwaveTracks,
  getDisabledSynthwave,
  getCurrentSynthwaveIndex,
  toggleSynthwaveTrack,
  reorderSynthwaveTracks,
  playSynthwaveByIndex,
  // Electronic
  getElectronicTracks,
  getDisabledElectronic,
  getCurrentElectronicIndex,
  toggleElectronicTrack,
  reorderElectronicTracks,
  playElectronicByIndex,
  // All
  getAllLocalTracks,
  getDisabledAll,
  getCurrentAllIndex,
  toggleAllTrack,
  playAllByIndex,
  // Playback controls
  toggleShuffle,
  getShuffleMode,
  toggleRepeat,
  skipTrack,
  prevTrack,
  togglePause,
  playCustomByIndex,
  getPlaybackPosition,
  seekTo,
  // Callbacks
  onTrackChange,
  onPauseChange,
  // State getters
  isPlaying,
  getCurrentDefaultIndex,
  getCurrentCustomIndex,
  isPaused,
} from './audioDeck';

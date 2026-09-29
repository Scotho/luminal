// ── Keybinds UI (extracted from main.js) ────────────────
import { getBinds, setBind, resetBinds } from '../input';
import type { ActionName, Keybinds } from '../types/index';

interface KeybindsUIDeps {
  navigateTo: (screen: string) => void;
}

// ── KEY_DISPLAY lookup table ────────────────────────────
const KEY_DISPLAY: Record<string, string> = {
  KeyA:'A', KeyB:'B', KeyC:'C', KeyD:'D', KeyE:'E', KeyF:'F', KeyG:'G', KeyH:'H',
  KeyI:'I', KeyJ:'J', KeyK:'K', KeyL:'L', KeyM:'M', KeyN:'N', KeyO:'O', KeyP:'P',
  KeyQ:'Q', KeyR:'R', KeyS:'S', KeyT:'T', KeyU:'U', KeyV:'V', KeyW:'W', KeyX:'X',
  KeyY:'Y', KeyZ:'Z',
  Digit0:'0', Digit1:'1', Digit2:'2', Digit3:'3', Digit4:'4',
  Digit5:'5', Digit6:'6', Digit7:'7', Digit8:'8', Digit9:'9',
  ShiftLeft:'SHIFT', ShiftRight:'SHIFT', ControlLeft:'CTRL', ControlRight:'CTRL',
  AltLeft:'ALT', AltRight:'ALT', Space:'SPACE', Tab:'TAB',
  ArrowUp:'UP', ArrowDown:'DOWN', ArrowLeft:'LEFT', ArrowRight:'RIGHT',
  Backquote:'`', Minus:'-', Equal:'=', BracketLeft:'[', BracketRight:']',
  Backslash:'\\', Semicolon:';', Quote:"'", Comma:',', Period:'.', Slash:'/',
  Mouse0:'LMB', Mouse2:'RMB',
};

export function keyDisplayName(code: string): string {
  return KEY_DISPLAY[code] || code.replace('Key','').replace('Digit','');
}

// ── Refresh keybind labels ──────────────────────────────
export function refreshKeybindLabels(): void {
  const b: Keybinds = getBinds();
  const allActions: ActionName[] = ['left', 'right', 'accelerate', 'brake', 'dash', 'rPlayPause', 'rCamPrev', 'rCamNext', 'rSkipBack', 'rSkipFwd', 'rFineBack', 'rFineFwd', 'rToggleUI'];
  for (const action of allActions) {
    const keys: [string, string] = b[action] || ['', ''];
    const el1: HTMLElement | null = document.getElementById(`kb-${action}`);
    if (el1) el1.textContent = keys[0] ? keyDisplayName(keys[0]) : '—';
    const el2: HTMLElement | null = document.getElementById(`kb-${action}-2`);
    if (el2) el2.textContent = keys[1] ? keyDisplayName(keys[1]) : '—';
  }
}

// ── Keybind listening system ────────────────────────────
let listeningAction: string | null = null;
let listeningEl: HTMLElement | null = null;
let listeningSlot: number = 0;

function startListening(action: string, el: HTMLElement, slot: number): void {
  // Cancel previous
  if (listeningEl) listeningEl.classList.remove('keybind-key--listening');
  listeningAction = action;
  listeningEl = el;
  listeningSlot = slot;
  el.classList.add('keybind-key--listening');
  el.textContent = '...';
}

export function stopListening(): void {
  if (listeningEl) listeningEl.classList.remove('keybind-key--listening');
  listeningAction = null;
  listeningEl = null;
  listeningSlot = 0;
  refreshKeybindLabels();
}

// ── Capture handlers (keydown / mousedown) ──────────────
function _onKeydownCapture(e: KeyboardEvent): void {
  if (!listeningAction) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') { stopListening(); return; }
  setBind(listeningAction as ActionName, e.code, listeningSlot);
  stopListening();
}

function _onMousedownCapture(e: MouseEvent): void {
  if (!listeningAction) return;
  e.preventDefault();
  e.stopPropagation();
  const code: string | null = e.button === 0 ? 'Mouse0' : e.button === 2 ? 'Mouse2' : null;
  if (code) {
    setBind(listeningAction as ActionName, code, listeningSlot);
    stopListening();
  }
}

// ── Init ────────────────────────────────────────────────
export function initKeybindsUI(_deps: KeybindsUIDeps): void {
  // Capture handlers for keybind listening
  window.addEventListener('keydown', _onKeydownCapture, true);
  window.addEventListener('mousedown', _onMousedownCapture, true);

  // Keybind key click handlers
  document.querySelectorAll('.keybind-key:not(.readonly)').forEach((el: Element) => {
    el.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const action: string | undefined = (el.closest('.keybind-row') as HTMLElement)?.dataset.action;
      if (!action) return;
      const slot: number = parseInt((el as HTMLElement).dataset.slot || '0', 10);
      startListening(action, el as HTMLElement, slot);
    });
  });

  // Reset button
  document.getElementById('btn-keybinds-reset')?.addEventListener('click', () => {
    resetBinds();
    refreshKeybindLabels();
  });
}

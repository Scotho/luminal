import { TOUCH_ENABLED, getBinds } from '../input';
import { keyDisplayName } from './keybindsUI';
import { isGamepadConnected, getForceKeyboard, setForceKeyboard, getControllerFamily } from '../gamepad';
import type { ControllerFamily } from '../gamepad';

interface InputUIDeps {
  getCurrentScreen: () => string | null;
  getGameState: () => string;
}

let _deps: InputUIDeps;

// ── Input Scheme ─────────────────────────────────────────
const INPUT_OPTIONS: string[] = ['KEYBOARD', 'CONTROLLER'];
const inputLabel: HTMLElement = document.getElementById('input-label')!;
const inputLeftArrow: HTMLElement = document.getElementById('input-left')!;
const inputRightArrow: HTMLElement = document.getElementById('input-right')!;
const controlIcon: HTMLElement = document.getElementById('control-icon')!;
const controlsText: HTMLElement | null = document.getElementById('controls-text');

const GP_CONTROLS: string = '<span class="kbd">STICK</span> TURN &nbsp;&nbsp; <span class="kbd">X</span><span class="kbd-sep">/</span><span class="kbd">RT</span><span class="kbd-sep">/</span><span class="kbd">&#8593;</span> ACCEL &nbsp;&nbsp; <span class="kbd">&#8595;</span> DECEL &nbsp;&nbsp; <span class="kbd">A</span><span class="kbd-sep">/</span><span class="kbd">LT</span> BOOST &nbsp;&nbsp; <span class="kbd">B</span> BRAKE/DRIFT<br><span style="opacity:0.4;font-size:11px"><span class="kbd">SELECT</span> TOGGLE PLAYER</span>';
const TOUCH_CONTROLS: string = '<span class="kbd">TAP</span> LEFT/RIGHT &nbsp;&nbsp; <span class="kbd">SLIDE &#8593;</span> ACCEL &nbsp;&nbsp; <span class="kbd">SLIDE &#8595;</span> BRAKE &nbsp;&nbsp; <span class="kbd">TWO-TAP</span> BOOST';
let _lastControlsHtml: string = '';

// ── Gamepad Nav Hints ─────────────────────────────────────
const _gpHintsEl: HTMLElement | null = document.getElementById('gp-nav-hints');
let _lastGpHintsHtml: string = '';

export function initInputUI(deps: InputUIDeps): void {
  _deps = deps;

  inputLeftArrow.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    if (isUsingGamepad()) { setForceKeyboard(true); updateControlUI(); }
  });
  inputRightArrow.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    if (!isUsingGamepad() && isGamepadConnected()) { setForceKeyboard(false); updateControlUI(); }
  });

  // Click on KEYBOARD/CONTROLLER toggle at bottom of homepage
  document.getElementById('ci-keyboard')?.addEventListener('click', () => {
    if (isUsingGamepad()) { setForceKeyboard(true); updateControlUI(); }
  });
  document.getElementById('ci-controller')?.addEventListener('click', () => {
    if (!isUsingGamepad() && isGamepadConnected()) { setForceKeyboard(false); updateControlUI(); }
  });

  updateControlUI();
}

// Build keyboard controls text dynamically from current keybinds
export function buildKbControls(): string {
  const b = getBinds();
  // Filter mouse binds, convert to display names, sort shortest first
  const keys = (codes: [string, string]): string[] =>
    codes.filter(c => c && !c.startsWith('Mouse'))
         .map(c => keyDisplayName(c))
         .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const kbd = (names: string[]): string =>
    names.map(n => `<span class="kbd">${n}</span>`).join('<span class="kbd-sep">/</span>');

  const turn = kbd([b.left[0], b.right[0]].filter(Boolean).map(c => keyDisplayName(c)));
  const accel = kbd(keys(b.accelerate));
  const boost = kbd(keys(b.dash));

  // Split brake binds: slot 0 (SPACE) = BRAKE/DRIFT, slot 1 (S) = DECEL
  const brakeKeys = b.brake.filter(c => c && !c.startsWith('Mouse'));
  const mainBrake = brakeKeys[0] ? kbd([keyDisplayName(brakeKeys[0])]) : '';
  const decelKey = brakeKeys[1] ? kbd([keyDisplayName(brakeKeys[1])]) : '';

  let row1 = `${turn} TURN &nbsp;&nbsp; ${accel} ACCEL`;
  if (decelKey) row1 += ` &nbsp;&nbsp; ${decelKey} DECEL`;
  const row2Left = `${boost} BOOST`;
  const row2Right = mainBrake ? `${mainBrake} BRAKE/DRIFT` : '';
  const result = `<div class="controls-row">${row1}</div><div class="controls-row controls-row--split"><span>${row2Left}</span>${row2Right ? `<span>${row2Right}</span>` : ''}</div>`;
  return result;
}

export function isUsingGamepad(): boolean {
  return isGamepadConnected() && !getForceKeyboard();
}

export function updateInputSelector(): void {
  const gp: boolean = isUsingGamepad();
  const idx: number = gp ? 1 : 0;
  inputLabel.textContent = INPUT_OPTIONS[idx];

  // Disable left if already on keyboard, disable right if no controller
  inputLeftArrow.classList.toggle('setting-arrow--disabled', idx === 0);
  inputRightArrow.classList.toggle('setting-arrow--disabled', idx === 1 || !isGamepadConnected());
}

export function updateControlUI(): void {
  const gp: boolean = isUsingGamepad();
  const gpConnected: boolean = isGamepadConnected();
  updateInputSelector();

  const gameState = _deps.getGameState();

  // Control toggle at bottom — lit when device is available/in-use
  if (gameState === 'menu' || gameState === 'gameover' || gameState === 'paused') {
    controlIcon.classList.remove('hidden');
    const ciKb: HTMLElement | null = document.getElementById('ci-keyboard');
    const ciGp: HTMLElement | null = document.getElementById('ci-controller');
    const ciTouch: HTMLElement | null = document.getElementById('ci-touch');
    const kbPnum: HTMLElement | null = document.getElementById('ci-kb-pnum');
    const gpPnum: HTMLElement | null = document.getElementById('ci-gp-pnum');
    const touchSep: HTMLElement | null = document.querySelector('.ci-sep--touch');

    if (ciKb && ciGp) {
      ciKb.classList.toggle('ci-option--active', !TOUCH_ENABLED || gpConnected);
      ciGp.classList.toggle('ci-option--active', gpConnected);
      if (kbPnum) kbPnum.classList.toggle('hidden', !gpConnected);
      if (gpPnum) gpPnum.classList.toggle('hidden', !gpConnected);
    }
    if (ciTouch) {
      ciTouch.classList.toggle('ci-option--active', TOUCH_ENABLED);
    }
    if (touchSep) (touchSep as HTMLElement).style.display = '';
  } else {
    controlIcon.classList.add('hidden');
  }

  // Controls text — cached to avoid unnecessary DOM writes
  if (controlsText) {
    const html = (TOUCH_ENABLED && !gp) ? TOUCH_CONTROLS : gp ? GP_CONTROLS : buildKbControls();
    if (html !== _lastControlsHtml) {
      _lastControlsHtml = html;
      controlsText.innerHTML = html;
    }
  }

  // Gamepad nav hints (contextual button prompts)
  updateGpHints();
}

function _gpBtn(label: string): string {
  return `<span class="gp-btn">${label}</span>`;
}

/** Get display labels based on detected controller family */
function _gpLabels(): { a: string; b: string; x: string; y: string; lb: string; rb: string; lt: string; rt: string; start: string } {
  const fam: ControllerFamily = getControllerFamily();
  if (fam === 'playstation') return { a: '\u2A2F', b: '\u25CB', x: '\u25A1', y: '\u25B3', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'OPTIONS' };
  if (fam === 'switch') return { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', start: '+' };
  // xbox / generic
  return { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: 'MENU' };
}

/** Per-screen hint definitions */
function _getGpHints(screen: string | null): string {
  if (!screen) return '';
  const l = _gpLabels();
  const confirm = `<span class="gp-hint">${_gpBtn(l.a)} SELECT</span>`;
  const back = `<span class="gp-hint">${_gpBtn(l.b)} BACK</span>`;
  const nav = `<span class="gp-hint">${_gpBtn('\u2195')} NAVIGATE</span>`;
  const tabs = `<span class="gp-hint">${_gpBtn(l.lb)}${_gpBtn(l.rb)} TABS</span>`;

  switch (screen) {
    case 'main': return `${confirm} ${nav}`;
    case 'settings': return `${confirm} ${back} ${nav}`;
    case 'characterSelect': return `${confirm} ${back} ${nav}`;
    case 'online': return `${confirm} ${back}`;
    case 'queue': return `${confirm}`;
    case 'matchFound': return `${confirm}`;
    case 'login': return `${confirm} ${back} ${nav}`;
    case 'social': return `${confirm} ${back} ${tabs}`;
    case 'friends': return `${confirm} ${back}`;
    case 'lobby': return `${confirm} ${back}`;
    case 'gameover': return `${confirm} ${nav}`;
    case 'paused':
    case 'onlinePause': return `${confirm} ${nav}`;
    case 'replay': return `<span class="gp-hint">${_gpBtn(l.x)} PLAY/PAUSE</span> <span class="gp-hint">${_gpBtn(l.lb)}${_gpBtn(l.rb)} CAMERA</span> <span class="gp-hint">${_gpBtn(l.y)} TOGGLE UI</span>`;
    default: return `${confirm} ${back}`;
  }
}

export function updateGpHints(): void {
  if (!_gpHintsEl) return;
  const gameState = _deps.getGameState();
  if (!isUsingGamepad() || gameState === 'playing' || gameState === 'countdown') {
    if (!_gpHintsEl.classList.contains('hidden')) _gpHintsEl.classList.add('hidden');
    return;
  }
  const html = _getGpHints(_deps.getCurrentScreen());
  if (html !== _lastGpHintsHtml) {
    _lastGpHintsHtml = html;
    _gpHintsEl.innerHTML = html;
  }
  _gpHintsEl.classList.remove('hidden');
}

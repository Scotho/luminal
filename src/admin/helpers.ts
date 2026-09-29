// ── Admin Panel UI Helpers ──────────────────────────────
// Extracted from adminPanel.ts — shared helper functions used by all admin panel sections.

import { swallow } from '../swallow';

// ── Types ──────────────────────────────────────────────

export type AnyValues = Record<string, Record<string, number | string | boolean>>;

export interface AdminSliderEntry {
  key: string;
  section: string;
  initial: number;
  slider: HTMLInputElement;
  getValue: () => number;
}

export interface AdminColorEntry {
  key: string;
  section: string;
  initial: number;
  getValue: () => number;
}

export interface AdminToggleEntry {
  key: string;
  section: string;
  initial: boolean;
  input: HTMLInputElement;
  getValue: () => boolean;
}

export interface AdminPanelState {
  panel: HTMLDivElement | null;
  sliders: AdminSliderEntry[];
  colorPickers: AdminColorEntry[];
  toggles: AdminToggleEntry[];
  currentSectionBody: HTMLDivElement | null;
  sectionWrappers: HTMLDivElement[];
}

// ── Shared state ───────────────────────────────────────

let _state: AdminPanelState = {
  panel: null,
  sliders: [],
  colorPickers: [],
  toggles: [],
  currentSectionBody: null,
  sectionWrappers: [],
};

export function setHelperState(state: AdminPanelState): void {
  _state = state;
}

// ── Collapse state ─────────────────────────────────────

const DEFAULT_EXPANDED = new Set(['perf', 'scene', 'quickmix']);
const STORAGE_KEY = 'admin-panel-sections';

function loadCollapseState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    // ignore
  }
  return {};
}

function saveCollapseState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ── Append target ──────────────────────────────────────

export function getAppendTarget(): HTMLDivElement {
  return _state.currentSectionBody ?? _state.panel!;
}

// ── Collect / Reset ────────────────────────────────────

export function collectAllValues(): AnyValues {
  const out: AnyValues = {};
  for (const s of _state.sliders) {
    if (!out[s.section]) out[s.section] = {};
    out[s.section][s.key] = s.getValue();
  }
  for (const c of _state.colorPickers) {
    if (!out[c.section]) out[c.section] = {};
    out[c.section][c.key] = '#' + c.getValue().toString(16).padStart(6, '0');
  }
  for (const t of _state.toggles) {
    if (!out[t.section]) out[t.section] = {};
    out[t.section][t.key] = t.getValue();
  }
  return out;
}

export function collectDirtyValues(): AnyValues {
  const out: AnyValues = {};
  for (const s of _state.sliders) {
    if (Math.abs(s.getValue() - s.initial) > 0.001) {
      if (!out[s.section]) out[s.section] = {};
      out[s.section][s.key] = parseFloat(s.getValue().toFixed(4));
    }
  }
  for (const c of _state.colorPickers) {
    if (c.getValue() !== c.initial) {
      if (!out[c.section]) out[c.section] = {};
      out[c.section][c.key] = '#' + c.getValue().toString(16).padStart(6, '0');
    }
  }
  for (const t of _state.toggles) {
    if (t.getValue() !== t.initial) {
      if (!out[t.section]) out[t.section] = {};
      out[t.section][t.key] = t.getValue();
    }
  }
  return out;
}

export function resetAll(): void {
  for (const s of _state.sliders) {
    s.slider.value = String(s.initial);
    s.slider.dispatchEvent(new Event('input'));
  }
  for (const t of _state.toggles) {
    t.input.checked = t.initial;
    t.input.dispatchEvent(new Event('input'));
  }
}

// ── Expand / Collapse all sections ────────────────────

export function expandAllSections(): void {
  const state = loadCollapseState();
  for (const wrapper of _state.sectionWrappers) {
    const body = wrapper.querySelector('div:last-child') as HTMLDivElement | null;
    const chevron = wrapper.querySelector('span') as HTMLSpanElement | null;
    if (body) body.style.display = '';
    if (chevron) chevron.textContent = '\u25BE';
    const key = wrapper.dataset.sectionKey;
    if (key) state[key] = true;
  }
  saveCollapseState(state);
}

export function collapseAllSections(): void {
  const state = loadCollapseState();
  for (const wrapper of _state.sectionWrappers) {
    const body = wrapper.querySelector('div:last-child') as HTMLDivElement | null;
    const chevron = wrapper.querySelector('span') as HTMLSpanElement | null;
    if (body) body.style.display = 'none';
    if (chevron) chevron.textContent = '\u25B8';
    const key = wrapper.dataset.sectionKey;
    if (key) state[key] = false;
  }
  saveCollapseState(state);
}

// ── UI Builders ────────────────────────────────────────

export function addHeader(text: string, sectionKey?: string): void {
  // Close any previous section body
  _state.currentSectionBody = null;

  const collapseState = loadCollapseState();
  const key = sectionKey ?? text.toLowerCase().replace(/\s+/g, '-');
  const isExpanded = key in collapseState ? collapseState[key] : DEFAULT_EXPANDED.has(key);

  // Wrapper div holds both the header row and the collapsible body
  const wrapper = document.createElement('div');
  wrapper.dataset.sectionKey = key;
  _state.sectionWrappers.push(wrapper);

  // Header row
  const h = document.createElement('div');
  Object.assign(h.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: '12px', fontWeight: 'bold', color: '#49A2B2',
    borderBottom: '1px solid rgba(73,162,178,0.3)',
    padding: '8px 0 4px', marginTop: '12px', marginBottom: '0', letterSpacing: '2px',
    cursor: 'pointer', userSelect: 'none',
    borderRadius: '2px',
  });

  h.addEventListener('mouseenter', () => { h.style.background = 'rgba(73,162,178,0.06)'; });
  h.addEventListener('mouseleave', () => { h.style.background = ''; });

  // Left side: chevron + title
  const left = document.createElement('span');
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.gap = '6px';

  const chevron = document.createElement('span');
  chevron.textContent = isExpanded ? '\u25BE' : '\u25B8';
  Object.assign(chevron.style, { fontSize: '10px', lineHeight: '1', flexShrink: '0' });

  const title = document.createElement('span');
  title.textContent = text;

  left.appendChild(chevron);
  left.appendChild(title);
  h.appendChild(left);

  // Right side: copy + reset buttons (if sectionKey provided)
  if (sectionKey) {
    const right = document.createElement('span');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '2px';

    const copyBtn = document.createElement('span');
    copyBtn.textContent = '⎘';
    Object.assign(copyBtn.style, {
      cursor: 'pointer', fontSize: '14px', opacity: '0.5', padding: '0 4px',
      letterSpacing: '0', lineHeight: '1',
    });
    copyBtn.title = 'Copy section JSON';
    copyBtn.addEventListener('mouseenter', () => { copyBtn.style.opacity = '1'; });
    copyBtn.addEventListener('mouseleave', () => { copyBtn.style.opacity = '0.5'; });
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const all = collectAllValues();
      // Collect matching sections (roles.X → grouped under roles)
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(all)) {
        if (k === sectionKey || k.startsWith(sectionKey + '.')) {
          const sub = k.startsWith(sectionKey + '.') ? k.slice(sectionKey.length + 1) : null;
          if (sub) {
            if (!out[sectionKey]) out[sectionKey] = {} as Record<string, unknown>;
            (out[sectionKey] as Record<string, unknown>)[sub] = v;
          } else {
            Object.assign(out, { [k]: v });
          }
        }
      }
      const json = JSON.stringify(out, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '⎘'; }, 1000);
      }).catch(() => {
        console.log(`[${sectionKey}]`, json);
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '⎘'; }, 1000);
      });
    });
    right.appendChild(copyBtn);

    // Reset section button
    const resetBtn = document.createElement('span');
    resetBtn.textContent = '↺';
    Object.assign(resetBtn.style, {
      cursor: 'pointer', fontSize: '13px', opacity: '0.5', padding: '0 2px',
      letterSpacing: '0', lineHeight: '1',
    });
    resetBtn.title = 'Reset section to defaults';
    resetBtn.addEventListener('mouseenter', () => { resetBtn.style.opacity = '1'; });
    resetBtn.addEventListener('mouseleave', () => { resetBtn.style.opacity = '0.5'; });
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const s of _state.sliders) {
        if (s.section === sectionKey || s.section.startsWith(sectionKey + '.')) {
          s.slider.value = String(s.initial);
          s.slider.dispatchEvent(new Event('input'));
        }
      }
      for (const t of _state.toggles) {
        if (t.section === sectionKey || t.section.startsWith(sectionKey + '.')) {
          t.input.checked = t.initial;
          t.input.dispatchEvent(new Event('input'));
        }
      }
      resetBtn.textContent = '✓';
      setTimeout(() => { resetBtn.textContent = '↺'; }, 1000);
    });
    right.appendChild(resetBtn);

    h.appendChild(right);
  }

  // Collapsible body div
  const body = document.createElement('div');
  body.style.display = isExpanded ? '' : 'none';
  body.style.marginBottom = '6px';

  // Toggle collapse on header click
  h.addEventListener('click', () => {
    const expanded = body.style.display !== 'none';
    body.style.display = expanded ? 'none' : '';
    chevron.textContent = expanded ? '\u25B8' : '\u25BE';

    const cs = loadCollapseState();
    cs[key] = !expanded;
    saveCollapseState(cs);
  });

  wrapper.appendChild(h);
  wrapper.appendChild(body);
  _state.panel!.appendChild(wrapper);

  // Route subsequent appends into the body
  _state.currentSectionBody = body;
}

export function addSubHeader(text: string): void {
  const h = document.createElement('div');
  Object.assign(h.style, {
    fontSize: '10px', fontWeight: 'bold', color: '#3a8a98',
    padding: '6px 0 2px', marginTop: '4px', letterSpacing: '1px',
    borderBottom: '1px solid rgba(73,162,178,0.12)',
  });
  h.textContent = text;
  getAppendTarget().appendChild(h);
}

export function addLabel(text: string): void {
  const l = document.createElement('div');
  l.textContent = text;
  l.style.padding = '4px 0';
  l.style.color = '#666';
  getAppendTarget().appendChild(l);
}

export function makeCopyIcon(getValue: () => string): HTMLSpanElement {
  const btn = document.createElement('span');
  btn.textContent = '⎘';
  Object.assign(btn.style, {
    cursor: 'pointer', fontSize: '12px', opacity: '0.3', padding: '0 2px',
    flexShrink: '0', lineHeight: '1', userSelect: 'none',
  });
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.8'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.3'; });
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(getValue()).catch(swallow('admin'));
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '⎘'; }, 800);
  });
  return btn;
}

export function addSlider(label: string, initial: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' });

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.width = '80px';
  lbl.style.flexShrink = '0';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(initial);
  Object.assign(slider.style, { flex: '1', accentColor: '#49A2B2', height: '14px' });

  const val = document.createElement('span');
  val.textContent = initial.toFixed(2);
  val.style.width = '36px';
  val.style.textAlign = 'right';
  val.style.fontSize = '10px';

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    val.textContent = v.toFixed(2);
    onChange(v);
  });

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(val);
  getAppendTarget().appendChild(row);
  return slider;
}

export function trackSlider(section: string, key: string, slider: HTMLInputElement): void {
  const initial = parseFloat(slider.value);
  _state.sliders.push({ key, section, initial, slider, getValue: () => parseFloat(slider.value) });
  const row = slider.parentElement;
  if (row) row.appendChild(makeCopyIcon(() => `"${section}": { "${key}": ${parseFloat(slider.value).toFixed(4)} }`));
}

export function addToggle(label: string, initial: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' });

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.width = '80px';
  lbl.style.flexShrink = '0';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  Object.assign(input.style, { accentColor: '#49A2B2' });

  const val = document.createElement('span');
  val.textContent = initial ? 'on' : 'off';
  val.style.width = '36px';
  val.style.textAlign = 'right';
  val.style.fontSize = '10px';

  input.addEventListener('input', () => {
    val.textContent = input.checked ? 'on' : 'off';
    onChange(input.checked);
  });

  row.appendChild(lbl);
  row.appendChild(input);
  row.appendChild(val);
  getAppendTarget().appendChild(row);
  return input;
}

export function trackToggle(section: string, key: string, input: HTMLInputElement): void {
  const initial = input.checked;
  _state.toggles.push({ key, section, initial, input, getValue: () => input.checked });
  const row = input.parentElement;
  if (row) row.appendChild(makeCopyIcon(() => `"${section}": { "${key}": ${input.checked} }`));
}

export function addColorPicker(label: string, initialHex: number, onChange: (hex: number) => void): { picker: HTMLInputElement } {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' });

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.width = '80px';
  lbl.style.flexShrink = '0';

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = '#' + initialHex.toString(16).padStart(6, '0');
  Object.assign(picker.style, { width: '40px', height: '20px', border: 'none', background: 'none', cursor: 'pointer', padding: '0' });

  const hexLabel = document.createElement('span');
  hexLabel.textContent = picker.value;
  hexLabel.style.fontSize = '10px';

  picker.addEventListener('input', () => {
    const hex = parseInt(picker.value.slice(1), 16);
    hexLabel.textContent = picker.value;
    onChange(hex);
  });

  row.appendChild(lbl);
  row.appendChild(picker);
  row.appendChild(hexLabel);
  getAppendTarget().appendChild(row);
  return { picker };
}

export function trackColorPicker(section: string, key: string, initialHex: number, picker: HTMLInputElement): void {
  _state.colorPickers.push({ key, section, initial: initialHex, getValue: () => parseInt(picker.value.slice(1), 16) });
  const row = picker.parentElement;
  if (row) row.appendChild(makeCopyIcon(() => `"${section}": { "${key}": "${picker.value}" }`));
}

export function addBtn(text: string, color: string, onClick: () => void): void {
  const btn = document.createElement('div');
  btn.textContent = text;
  btn.dataset.label = text;
  Object.assign(btn.style, {
    marginTop: '8px', padding: '8px', textAlign: 'center', cursor: 'pointer',
    color, border: `1px solid ${color}33`,
  });
  btn.addEventListener('click', onClick);
  _state.panel!.appendChild(btn);
}

let _flashTimeout: ReturnType<typeof setTimeout> | null = null;
export function flashBtn(label: string, msg: string): void {
  const btn = _state.panel?.querySelector(`[data-label="${label}"]`) as HTMLElement | null;
  if (!btn) return;
  btn.textContent = msg;
  if (_flashTimeout) clearTimeout(_flashTimeout);
  _flashTimeout = setTimeout(() => { btn.textContent = label; }, 1500);
}

export function copyToClipboard(json: string, label: string): void {
  navigator.clipboard.writeText(json).then(() => {
    flashBtn(label, 'Copied!');
  }).catch(() => {
    console.log('Admin export:\n', json);
    flashBtn(label, 'Logged to console');
  });
}

export function applyImportedValues(data: AnyValues): void {
  let applied = 0;
  for (const [section, entries] of Object.entries(data)) {
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      // Match sliders
      const slider = _state.sliders.find(s => s.section === section && s.key === key);
      if (slider && typeof value === 'number') {
        slider.slider.value = String(value);
        slider.slider.dispatchEvent(new Event('input'));
        applied++;
        continue;
      }
      // Match toggles
      const toggle = _state.toggles.find(t => t.section === section && t.key === key);
      if (toggle && typeof value === 'boolean') {
        toggle.input.checked = value;
        toggle.input.dispatchEvent(new Event('input'));
        applied++;
        continue;
      }
      // Match color pickers (hex string like "#0a1b2c")
      const cp = _state.colorPickers.find(c => c.section === section && c.key === key);
      if (cp && typeof value === 'string' && value.startsWith('#')) {
        // Find the corresponding picker input in the panel
        const allInputs = _state.panel?.querySelectorAll('input[type="color"]');
        if (allInputs) {
          const idx = _state.colorPickers.indexOf(cp);
          const pickerEl = allInputs[idx] as HTMLInputElement | undefined;
          if (pickerEl) {
            pickerEl.value = value;
            pickerEl.dispatchEvent(new Event('input'));
            applied++;
          }
        }
        continue;
      }
    }
  }
  flashBtn('[IMPORT JSON]', applied ? `Applied ${applied}` : '(no matches)');
}

export function importFromClipboard(): void {
  navigator.clipboard.readText().then((text) => {
    try {
      const data = JSON.parse(text) as AnyValues;
      applyImportedValues(data);
    } catch {
      flashBtn('[IMPORT JSON]', 'Invalid JSON');
    }
  }).catch(() => {
    // Clipboard read denied — fall back to prompt
    const text = window.prompt('Paste admin JSON:');
    if (!text) return;
    try {
      const data = JSON.parse(text) as AnyValues;
      applyImportedValues(data);
    } catch {
      flashBtn('[IMPORT JSON]', 'Invalid JSON');
    }
  });
}

export function addMiniActionRow(actions: Array<{ label: string; color: string; onClick: () => void }>): void {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    padding: '2px 0 6px',
  });
  actions.forEach(({ label, color, onClick }) => {
    const btn = document.createElement('span');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '2px 6px',
      cursor: 'pointer',
      fontSize: '10px',
      letterSpacing: '1px',
      color,
      border: `1px solid ${color}33`,
      background: 'rgba(255,255,255,0.02)',
    });
    btn.addEventListener('click', onClick);
    row.appendChild(btn);
  });
  getAppendTarget().appendChild(row);
}

export function addGroupDivider(label?: string): void {
  const row = document.createElement('div');
  row.dataset.groupDivider = 'true';
  if (label) {
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      margin: '10px 0 4px',
    });
    const line1 = document.createElement('span');
    Object.assign(line1.style, {
      flex: '0 0 8px', borderTop: '1px solid rgba(73,162,178,0.25)', display: 'block',
    });
    const lbl = document.createElement('span');
    lbl.textContent = label;
    Object.assign(lbl.style, {
      fontSize: '9px', letterSpacing: '2px', color: 'rgba(73,162,178,0.5)',
      fontWeight: 'bold', whiteSpace: 'nowrap',
    });
    const line2 = document.createElement('span');
    Object.assign(line2.style, {
      flex: '1', borderTop: '1px solid rgba(73,162,178,0.25)', display: 'block',
    });
    row.appendChild(line1);
    row.appendChild(lbl);
    row.appendChild(line2);
  } else {
    Object.assign(row.style, {
      borderTop: '1px solid rgba(73,162,178,0.15)',
      margin: '8px 0',
    });
  }
  _state.panel!.appendChild(row);
  _state.currentSectionBody = null;
}

export function closeSectionBody(): void {
  _state.currentSectionBody = null;
}

// ── Search / filter ────────────────────────────────────

export function buildSearchInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search sections…';
  Object.assign(input.style, {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(73,162,178,0.3)',
    color: '#ccc',
    fontSize: '11px',
    padding: '4px 6px',
    marginBottom: '6px',
    outline: 'none',
  });

  // Track per-section expanded state before a search so we can restore it
  const preSearchState: Record<string, boolean> = {};
  let hasPreSearch = false;

  input.addEventListener('input', () => {
    filterSections(input.value.trim(), preSearchState, (captured) => {
      if (!hasPreSearch) {
        Object.assign(preSearchState, captured);
        hasPreSearch = true;
      }
    });
    if (!input.value.trim()) {
      hasPreSearch = false;
    }
  });

  return input;
}

function filterSections(
  query: string,
  preSearchState: Record<string, boolean>,
  onCapture: (state: Record<string, boolean>) => void,
): void {
  const lower = query.toLowerCase();
  const isClearing = lower === '';

  // Capture pre-search state before first filter
  if (!isClearing) {
    const captured: Record<string, boolean> = {};
    for (const wrapper of _state.sectionWrappers) {
      const key = wrapper.dataset.sectionKey ?? '';
      const body = wrapper.querySelector(':scope > div:last-child') as HTMLDivElement | null;
      if (body) captured[key] = body.style.display !== 'none';
    }
    onCapture(captured);
  }

  for (const wrapper of _state.sectionWrappers) {
    const key = wrapper.dataset.sectionKey ?? '';
    const body = wrapper.querySelector(':scope > div:last-child') as HTMLDivElement | null;
    const header = wrapper.querySelector(':scope > div:first-child') as HTMLDivElement | null;
    const chevron = header?.querySelector('span') as HTMLSpanElement | null;

    if (isClearing) {
      // Restore pre-search state
      wrapper.style.display = '';
      if (body) {
        const wasExpanded = preSearchState[key] ?? DEFAULT_EXPANDED.has(key);
        body.style.display = wasExpanded ? '' : 'none';
        if (chevron) chevron.textContent = wasExpanded ? '\u25BE' : '\u25B8';
      }
    } else {
      const matches = key.toLowerCase().includes(lower) ||
        (wrapper.textContent ?? '').toLowerCase().includes(lower);
      wrapper.style.display = matches ? '' : 'none';
      if (matches && body) {
        body.style.display = '';
        if (chevron) chevron.textContent = '\u25BE';
      }
    }
  }
}

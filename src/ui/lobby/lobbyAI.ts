// ── Lobby AI slot management ──────────────────────────────
// Handles AI creation, removal, color/vehicle cycling, and server sync.
// Extracted from lobbyUI.ts; all state access goes through LobbyContext.

import type { LobbyContext } from './lobbyContext';
import type { VehicleType } from '../../types/index';
import { AI_NAMES, COLOR_KEYS, COLOR_MAP, LOBBY_SIZE_OPTIONS, MAX_LOBBY_SIZE, _swallow } from './lobbyContext';
import { updateLobbyAis, updateLobbySettings } from '../../lobby';
import { getGuestList } from '../../types/index';

// ── Name / color pickers ─────────────────────────────────
export function pickAiName(usedNames: Set<string>): string {
  const available = AI_NAMES.filter(n => !usedNames.has(n));
  if (available.length === 0) {
    const base = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
    let name = base;
    for (let i = 2; usedNames.has(name); i++) name = `${base}-${i}`;
    return name;
  }
  return available[Math.floor(Math.random() * available.length)];
}

export function pickAiColor(usedColors: Set<string>): string {
  const available = COLOR_KEYS.filter(c => !usedColors.has(c));
  if (available.length === 0) return COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
  return available[Math.floor(Math.random() * available.length)];
}

// ── AI slot selection (color picker + vehicle grid target) ──
export function selectAiSlot(slotIndex: number | null, ctx: LobbyContext): void {
  ctx.setSelectedAiSlot(slotIndex);

  // Highlight selected AI row in party HUD (both social clones: dropdown + overlay)
  document.querySelectorAll('[data-social-slot="party-members"] .party-member--ai').forEach(row => {
    row.classList.remove('party-member--editing');
  });
  if (slotIndex !== null) {
    const ai = ctx.getAiSlots().get(slotIndex);
    if (ai) {
      const rows = document.querySelectorAll('[data-social-slot="party-members"] .party-member--ai');
      for (const row of rows) {
        const name = row.querySelector('.party-member-name');
        if (name && name.textContent?.includes(ai.name)) {
          row.classList.add('party-member--editing');
        }
      }
    }
  }

  // Update selected state on lobby cards
  document.querySelectorAll('#lobby-players-col .lobby-card').forEach(card => {
    const el = card as HTMLElement;
    if (el.dataset.slot === String(slotIndex)) {
      el.classList.add('lobby-card--selected');
    } else {
      el.classList.remove('lobby-card--selected');
    }
  });

  // Re-render color picker and vehicle grid to reflect selection
  const data = ctx.getLastLobbyData();
  if (data) {
    ctx.renderColorPickerForSelection(data);
    ctx.renderVehicleGrid(data);
  }
}

// ── Sync AI slots to Firebase ────────────────────────────
export function syncAisToServer(ctx: LobbyContext): void {
  const lobbyId = ctx.getCurrentLobbyId();
  if (!lobbyId || ctx.getMyRole() !== 'host') return;
  const aiSlots = ctx.getAiSlots();
  if (aiSlots.size === 0) {
    updateLobbyAis(lobbyId, null).catch(_swallow('clearAis'));
    return;
  }
  const ais: Record<string, { name: string; color: string; vehicle: string }> = {};
  for (const [slot, ai] of aiSlots) {
    ais[String(slot)] = { name: ai.name, color: ai.color, vehicle: ai.vehicle };
  }
  updateLobbyAis(lobbyId, ais).catch(_swallow('syncAis'));
}

// ── Add AI to a slot ─────────────────────────────────────
export function addAiToSlot(slotIndex: number, ctx: LobbyContext): void {
  const usedNames = new Set<string>();
  const usedColors = new Set<string>();
  const data = ctx.getLastLobbyData();
  if (data) {
    usedNames.add(data.host.username);
    usedColors.add(data.host.color);
    for (const g of getGuestList(data)) {
      usedNames.add(g.username);
      usedColors.add(g.color);
    }
  }
  for (const [, ai] of ctx.getAiSlots()) {
    usedNames.add(ai.name);
    usedColors.add(ai.color);
  }
  const aiSlots = ctx.getAiSlots();
  aiSlots.set(slotIndex, { name: pickAiName(usedNames), color: pickAiColor(usedColors), vehicle: 'bike' as VehicleType });
  ctx.setAiSlots(aiSlots);
  syncAisToServer(ctx);
  if (data) {
    ctx.renderLobbyCards(data);
    ctx.renderVehicleGrid(data);
    ctx.updatePartyHud(data);
  }
}

// ── Expand lobby size and add AI in one action ───────────
export function expandAndAddAi(newSlotIndex: number, ctx: LobbyContext): void {
  const lobbyId = ctx.getCurrentLobbyId();
  if (!lobbyId || ctx.getMyRole() !== 'host') return;
  const newSize = newSlotIndex + 1;
  if (newSize > MAX_LOBBY_SIZE) return;

  const sizeOpt = LOBBY_SIZE_OPTIONS.find(o => o.size === newSize);
  if (sizeOpt) {
    ctx.setLobbySizeIndex(LOBBY_SIZE_OPTIONS.indexOf(sizeOpt));
    ctx.syncSizeToQuickStart();
  }
  updateLobbySettings(lobbyId, { lobbySize: newSize }).catch(_swallow('expandLobbySize'));

  addAiToSlot(newSlotIndex, ctx);
}

// ── Kick AI from a slot and shrink the party ─────────────
export function removeSlot(slotIndex: number, ctx: LobbyContext): void {
  const lobbyId = ctx.getCurrentLobbyId();
  if (!lobbyId || ctx.getMyRole() !== 'host') return;

  if (ctx.getSelectedAiSlot() === slotIndex) ctx.setSelectedAiSlot(null);

  const aiSlots = ctx.getAiSlots();
  aiSlots.delete(slotIndex);

  // Re-index AI slots above the removed one to fill the gap
  const reindexed = new Map<number, { name: string; color: string; vehicle: VehicleType }>();
  for (const [slot, ai] of aiSlots) {
    reindexed.set(slot > slotIndex ? slot - 1 : slot, ai);
  }
  ctx.setAiSlots(reindexed);

  // Shrink lobby size
  const data = ctx.getLastLobbyData();
  const currentSize = data?.settings.lobbySize ?? 2;
  const newSize = Math.max(2, currentSize - 1);
  const sizeOpt = LOBBY_SIZE_OPTIONS.find(o => o.size === newSize);
  if (sizeOpt) ctx.setLobbySizeIndex(LOBBY_SIZE_OPTIONS.indexOf(sizeOpt));
  ctx.syncSizeToQuickStart();
  updateLobbySettings(lobbyId, { lobbySize: newSize }).catch(_swallow('removeSlotSettings'));

  syncAisToServer(ctx);

  if (data) {
    data.settings.lobbySize = newSize;
    ctx.renderLobbyCards(data);
    ctx.renderVehicleGrid(data);
    ctx.updatePartyHud(data);
  }
}

// ── Cycle AI color through available colors ──────────────
export function cycleAiColor(slotIndex: number, direction: number, ctx: LobbyContext): void {
  const aiSlots = ctx.getAiSlots();
  const ai = aiSlots.get(slotIndex);
  if (!ai) return;

  // Collect used colors
  const usedColors = new Set<string>();
  const data = ctx.getLastLobbyData();
  if (data) {
    usedColors.add(data.host.color);
    for (const g of getGuestList(data)) usedColors.add(g.color);
  }
  for (const [idx, slot] of aiSlots) {
    if (idx !== slotIndex) usedColors.add(slot.color);
  }

  // Find next available color
  const currentIdx = COLOR_KEYS.indexOf(ai.color);
  for (let i = 1; i < COLOR_KEYS.length; i++) {
    const nextIdx = (currentIdx + direction * i + COLOR_KEYS.length) % COLOR_KEYS.length;
    const candidate = COLOR_KEYS[nextIdx];
    if (!usedColors.has(candidate)) {
      ai.color = candidate;
      break;
    }
  }

  syncAisToServer(ctx);
  if (data) {
    ctx.renderLobbyCards(data);
    ctx.renderVehicleGrid(data);
    ctx.updatePartyHud(data);
  }
}

// ── Toggle AI vehicle between bike/car ───────────────────
export function cycleAiVehicle(slotIndex: number, ctx: LobbyContext): void {
  const aiSlots = ctx.getAiSlots();
  const ai = aiSlots.get(slotIndex);
  if (!ai) return;
  const vehicles: VehicleType[] = ['bike', 'car'];
  const idx = vehicles.indexOf(ai.vehicle);
  ai.vehicle = vehicles[(idx + 1) % vehicles.length];
  syncAisToServer(ctx);
  const data = ctx.getLastLobbyData();
  if (data) {
    ctx.renderLobbyCards(data);
    ctx.renderVehicleGrid(data);
    ctx.updatePartyHud(data);
  }
}

// ── Inline edit panel (party HUD outside lobby screen) ───
export function toggleAiInlineEdit(
  container: HTMLElement,
  slotIndex: number,
  ai: { name: string; color: string; vehicle: VehicleType },
  ctx: LobbyContext,
): void {
  // If already editing this slot, close it
  const existingEdit = container.querySelector(`.lobby-ai-inline-edit[data-slot="${slotIndex}"]`);
  if (existingEdit) { existingEdit.remove(); return; }

  // Close any other open edit
  container.querySelectorAll('.lobby-ai-inline-edit').forEach(el => el.remove());

  const edit = document.createElement('div');
  edit.className = 'lobby-ai-inline-edit';
  edit.dataset.slot = String(slotIndex);
  edit.style.padding = '6px 8px';
  edit.style.margin = '2px 0 4px';
  edit.style.background = 'rgba(var(--bg-dark-cyan), 0.5)';
  edit.style.borderRadius = '4px';
  edit.style.border = '1px solid rgba(var(--c-hot-dim), 0.15)';

  // Color arrows
  const colorRow = document.createElement('div');
  colorRow.className = 'lobby-ai-color-row';
  const css = COLOR_MAP[ai.color] || '#0ff';

  const leftArrow = document.createElement('span');
  leftArrow.className = 'lobby-ai-arrow';
  leftArrow.innerHTML = '<svg class="icon" style="width:12px;height:12px"><use href="/icons.svg#i-chev-l"/></svg>';
  leftArrow.addEventListener('click', (e) => { e.stopPropagation(); cycleAiColor(slotIndex, -1, ctx); });

  const colorDot = document.createElement('div');
  colorDot.className = 'lobby-ai-color-preview';
  colorDot.style.background = css;
  colorDot.style.boxShadow = `0 0 6px ${css}`;

  const rightArrow = document.createElement('span');
  rightArrow.className = 'lobby-ai-arrow';
  rightArrow.innerHTML = '<svg class="icon" style="width:12px;height:12px"><use href="/icons.svg#i-chev-r"/></svg>';
  rightArrow.addEventListener('click', (e) => { e.stopPropagation(); cycleAiColor(slotIndex, 1, ctx); });

  colorRow.appendChild(leftArrow);
  colorRow.appendChild(colorDot);
  colorRow.appendChild(rightArrow);
  edit.appendChild(colorRow);

  // Vehicle selector row
  const vehicleRow = document.createElement('div');
  vehicleRow.className = 'lobby-ai-color-row';
  vehicleRow.style.marginTop = '4px';

  const vLeftArrow = document.createElement('span');
  vLeftArrow.className = 'lobby-ai-arrow';
  vLeftArrow.innerHTML = '<svg class="icon" style="width:12px;height:12px"><use href="/icons.svg#i-chev-l"/></svg>';
  vLeftArrow.addEventListener('click', (e) => { e.stopPropagation(); cycleAiVehicle(slotIndex, ctx); });

  const vLabel = document.createElement('span');
  vLabel.style.cssText = "font-family:'Orbitron',sans-serif; font-size:9px; letter-spacing:2px; color:rgba(var(--c-teal),0.6); min-width:80px; text-align:center;";
  vLabel.textContent = (ai.vehicle || 'bike').toUpperCase();

  const vRightArrow = document.createElement('span');
  vRightArrow.className = 'lobby-ai-arrow';
  vRightArrow.innerHTML = '<svg class="icon" style="width:12px;height:12px"><use href="/icons.svg#i-chev-r"/></svg>';
  vRightArrow.addEventListener('click', (e) => { e.stopPropagation(); cycleAiVehicle(slotIndex, ctx); });

  vehicleRow.appendChild(vLeftArrow);
  vehicleRow.appendChild(vLabel);
  vehicleRow.appendChild(vRightArrow);
  edit.appendChild(vehicleRow);

  // Remove button
  const removeBtn = document.createElement('div');
  removeBtn.className = 'lobby-ai-remove';
  removeBtn.textContent = 'REMOVE';
  removeBtn.style.marginTop = '6px';
  removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeSlot(slotIndex, ctx); });
  edit.appendChild(removeBtn);

  // Insert after the AI row
  const aiRows = container.querySelectorAll('.party-member--ai');
  for (const row of aiRows) {
    const nameEl = row.querySelector('.party-member-name');
    if (nameEl && nameEl.textContent?.includes(ai.name)) {
      row.after(edit);
      return;
    }
  }
  container.appendChild(edit);
}

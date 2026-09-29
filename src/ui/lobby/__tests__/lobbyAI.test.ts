// ── lobbyAI unit tests ──────────────────────────────────
// Covers pickAiName / pickAiColor, selectAiSlot, syncAisToServer,
// addAiToSlot, expandAndAddAi, removeSlot, cycleAiColor,
// cycleAiVehicle, toggleAiInlineEdit.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VehicleType } from '../../../types/index';

// ── Mocks (must be declared before importing the module under test) ──
vi.mock('../../../lobby', () => ({
  updateLobbyAis: vi.fn(() => Promise.resolve()),
  updateLobbySettings: vi.fn(() => Promise.resolve()),
}));

import {
  pickAiName,
  pickAiColor,
  selectAiSlot,
  syncAisToServer,
  addAiToSlot,
  expandAndAddAi,
  removeSlot,
  cycleAiColor,
  cycleAiVehicle,
  toggleAiInlineEdit,
} from '../lobbyAI';
import { AI_NAMES, COLOR_KEYS } from '../lobbyContext';
import { makeMockCtx, makeLobby } from './helpers/mockLobbyContext';
import { updateLobbyAis, updateLobbySettings } from '../../../lobby';

const mockedUpdateLobbyAis = vi.mocked(updateLobbyAis);
const mockedUpdateLobbySettings = vi.mocked(updateLobbySettings);

describe('lobbyAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset DOM — tests that create elements append to body
    document.body.innerHTML = '';
  });

  // ── pickAiName ─────────────────────────────────────────
  describe('pickAiName', () => {
    it('returns a name not in the usedNames set', () => {
      const used = new Set<string>();
      const name = pickAiName(used);
      expect(AI_NAMES).toContain(name);
      expect(used.has(name)).toBe(false);
    });

    it('returns the only remaining name when all but one are taken', () => {
      const used = new Set(AI_NAMES.slice(0, -1));
      const name = pickAiName(used);
      expect(name).toBe(AI_NAMES[AI_NAMES.length - 1]);
    });

    it('returns a suffixed fallback when every name is taken', () => {
      const used = new Set(AI_NAMES);
      const name = pickAiName(used);
      // Must be a known base name with "-N" suffix
      expect(name).toMatch(/-\d+$/);
      const base = name.replace(/-\d+$/, '');
      expect(AI_NAMES).toContain(base);
    });
  });

  // ── pickAiColor ────────────────────────────────────────
  describe('pickAiColor', () => {
    it('returns an available color not in the usedColors set', () => {
      const used = new Set<string>();
      const color = pickAiColor(used);
      expect(COLOR_KEYS).toContain(color);
      expect(used.has(color)).toBe(false);
    });

    it('falls back to any COLOR_KEY when all are taken', () => {
      const used = new Set(COLOR_KEYS);
      const color = pickAiColor(used);
      expect(COLOR_KEYS).toContain(color);
    });

    it('returns the sole remaining color when all but one are taken', () => {
      const remaining = COLOR_KEYS[3];
      const used = new Set(COLOR_KEYS.filter(k => k !== remaining));
      const color = pickAiColor(used);
      expect(color).toBe(remaining);
    });
  });

  // ── selectAiSlot ───────────────────────────────────────
  describe('selectAiSlot', () => {
    it('passes the slot index through to ctx.setSelectedAiSlot', () => {
      const ctx = makeMockCtx({ myRole: 'host' });
      selectAiSlot(2, ctx);
      expect(ctx.setSelectedAiSlot).toHaveBeenCalledWith(2);
    });

    it('null selection clears the selected AI slot', () => {
      const ctx = makeMockCtx({ myRole: 'host', selectedAiSlot: 1 });
      selectAiSlot(null, ctx);
      expect(ctx.setSelectedAiSlot).toHaveBeenCalledWith(null);
    });

    it('highlights the selected lobby card and clears others', () => {
      const col = document.createElement('div');
      col.id = 'lobby-players-col';
      for (const slot of [0, 1, 2]) {
        const card = document.createElement('div');
        card.className = 'lobby-card lobby-card--selected';
        card.dataset.slot = String(slot);
        col.appendChild(card);
      }
      document.body.appendChild(col);

      const ctx = makeMockCtx({
        myRole: 'host',
        aiSlots: new Map([[1, { name: 'BOT', color: 'cyan', vehicle: 'bike' as VehicleType }]]),
      });
      selectAiSlot(1, ctx);

      const cards = col.querySelectorAll('.lobby-card');
      expect((cards[0] as HTMLElement).classList.contains('lobby-card--selected')).toBe(false);
      expect((cards[1] as HTMLElement).classList.contains('lobby-card--selected')).toBe(true);
      expect((cards[2] as HTMLElement).classList.contains('lobby-card--selected')).toBe(false);
    });

    it('calls renderColorPickerForSelection when lastLobbyData exists', () => {
      const data = makeLobby();
      const ctx = makeMockCtx({ myRole: 'host', lastLobbyData: data });
      selectAiSlot(1, ctx);
      expect(ctx.renderColorPickerForSelection).toHaveBeenCalledWith(data);
      expect(ctx.renderVehicleGrid).toHaveBeenCalledWith(data);
    });

    it('skips renderers when no lobby data exists', () => {
      const ctx = makeMockCtx({ myRole: 'host', lastLobbyData: null });
      selectAiSlot(1, ctx);
      expect(ctx.renderColorPickerForSelection).not.toHaveBeenCalled();
      expect(ctx.renderVehicleGrid).not.toHaveBeenCalled();
    });
  });

  // ── syncAisToServer ────────────────────────────────────
  describe('syncAisToServer', () => {
    it('no-ops when there is no lobby id', () => {
      const ctx = makeMockCtx({ currentLobbyId: null, myRole: 'host' });
      syncAisToServer(ctx);
      expect(mockedUpdateLobbyAis).not.toHaveBeenCalled();
    });

    it('no-ops when the user is not the host', () => {
      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'guest' });
      syncAisToServer(ctx);
      expect(mockedUpdateLobbyAis).not.toHaveBeenCalled();
    });

    it('clears AIs with null when the slot map is empty', () => {
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: new Map(),
      });
      syncAisToServer(ctx);
      expect(mockedUpdateLobbyAis).toHaveBeenCalledWith('L1', null);
    });

    it('sends a stringified-key AI record to Firebase', () => {
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'NEON', color: 'cyan', vehicle: 'bike' }],
        [2, { name: 'FLUX', color: 'green', vehicle: 'car' }],
      ]);
      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'host', aiSlots: ais });
      syncAisToServer(ctx);
      expect(mockedUpdateLobbyAis).toHaveBeenCalledWith('L1', {
        '1': { name: 'NEON', color: 'cyan', vehicle: 'bike' },
        '2': { name: 'FLUX', color: 'green', vehicle: 'car' },
      });
    });
  });

  // ── addAiToSlot ────────────────────────────────────────
  describe('addAiToSlot', () => {
    it('populates the slot with a fresh name and color', () => {
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        lastLobbyData: makeLobby({ hostUsername: 'ALICE', hostColor: 'red' }),
      });
      addAiToSlot(1, ctx);
      const slots = ctx.getAiSlots();
      expect(slots.has(1)).toBe(true);
      const ai = slots.get(1)!;
      expect(ai.name).not.toBe('ALICE');
      expect(ai.color).not.toBe('red');
      expect(ai.vehicle).toBe('bike');
    });

    it('syncs the new state to the server and re-renders UI', () => {
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        lastLobbyData: makeLobby(),
      });
      addAiToSlot(1, ctx);
      expect(mockedUpdateLobbyAis).toHaveBeenCalled();
      expect(ctx.renderLobbyCards).toHaveBeenCalled();
      expect(ctx.renderVehicleGrid).toHaveBeenCalled();
      expect(ctx.updatePartyHud).toHaveBeenCalled();
    });

    it('excludes existing AI colors and guest colors from new picks', () => {
      const existingAi = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'NEON', color: 'cyan', vehicle: 'bike' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: existingAi,
        lastLobbyData: makeLobby({
          hostColor: 'red',
          guests: [{ color: 'green' }],
        }),
      });
      addAiToSlot(2, ctx);
      const newAi = ctx.getAiSlots().get(2)!;
      expect(['red', 'green', 'cyan']).not.toContain(newAi.color);
    });
  });

  // ── expandAndAddAi ─────────────────────────────────────
  describe('expandAndAddAi', () => {
    it('returns early without a lobby id', () => {
      const ctx = makeMockCtx({ currentLobbyId: null, myRole: 'host' });
      expandAndAddAi(2, ctx);
      expect(mockedUpdateLobbySettings).not.toHaveBeenCalled();
    });

    it('returns early when not host', () => {
      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'guest' });
      expandAndAddAi(2, ctx);
      expect(mockedUpdateLobbySettings).not.toHaveBeenCalled();
    });

    it('refuses to expand beyond MAX_LOBBY_SIZE', () => {
      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'host' });
      expandAndAddAi(99, ctx);
      expect(mockedUpdateLobbySettings).not.toHaveBeenCalled();
    });

    it('sends lobbySize update and adds an AI to the new slot', () => {
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        lastLobbyData: makeLobby(),
      });
      expandAndAddAi(2, ctx); // newSize = 3 → slot index 2
      expect(mockedUpdateLobbySettings).toHaveBeenCalledWith('L1', { lobbySize: 3 });
      expect(ctx.syncSizeToQuickStart).toHaveBeenCalled();
      expect(ctx.getAiSlots().has(2)).toBe(true);
    });
  });

  // ── removeSlot ─────────────────────────────────────────
  describe('removeSlot', () => {
    it('no-ops without lobby id or host role', () => {
      const ctx1 = makeMockCtx({ currentLobbyId: null, myRole: 'host' });
      removeSlot(1, ctx1);
      expect(mockedUpdateLobbySettings).not.toHaveBeenCalled();

      const ctx2 = makeMockCtx({ currentLobbyId: 'L1', myRole: 'guest' });
      removeSlot(1, ctx2);
      expect(mockedUpdateLobbySettings).not.toHaveBeenCalled();
    });

    it('clears the selected AI slot when removing it', () => {
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'BOT', color: 'cyan', vehicle: 'bike' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: ais,
        selectedAiSlot: 1,
        lastLobbyData: makeLobby({ lobbySize: 3 }),
      });
      removeSlot(1, ctx);
      expect(ctx.setSelectedAiSlot).toHaveBeenCalledWith(null);
    });

    it('re-indexes higher AI slots after a removal', () => {
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'A', color: 'cyan', vehicle: 'bike' }],
        [2, { name: 'B', color: 'green', vehicle: 'bike' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: ais,
        lastLobbyData: makeLobby({ lobbySize: 3 }),
      });
      removeSlot(1, ctx);
      const newSlots = ctx.getAiSlots();
      expect(newSlots.has(1)).toBe(true);
      expect(newSlots.get(1)!.name).toBe('B');
      expect(newSlots.has(2)).toBe(false);
    });

    it('shrinks lobby size but never below 2', () => {
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'BOT', color: 'cyan', vehicle: 'bike' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: ais,
        lastLobbyData: makeLobby({ lobbySize: 2 }),
      });
      removeSlot(1, ctx);
      expect(mockedUpdateLobbySettings).toHaveBeenCalledWith('L1', { lobbySize: 2 });
    });
  });

  // ── cycleAiColor ───────────────────────────────────────
  describe('cycleAiColor', () => {
    it('is a no-op when the slot does not exist', () => {
      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'host' });
      cycleAiColor(5, 1, ctx);
      expect(mockedUpdateLobbyAis).not.toHaveBeenCalled();
    });

    it('advances to the next available color', () => {
      const startColor = COLOR_KEYS[0];
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'BOT', color: startColor, vehicle: 'bike' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: ais,
        lastLobbyData: makeLobby({ hostColor: 'white' }),
      });
      cycleAiColor(1, 1, ctx);
      expect(ctx.getAiSlots().get(1)!.color).not.toBe(startColor);
      expect(mockedUpdateLobbyAis).toHaveBeenCalled();
    });

    it('skips colors that are taken by other players or AIs', () => {
      // All but one color taken
      const remaining = COLOR_KEYS[2];
      const taken = COLOR_KEYS.filter(c => c !== remaining && c !== COLOR_KEYS[0]);
      const guests = taken.map(c => ({ color: c }));
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'BOT', color: COLOR_KEYS[0], vehicle: 'bike' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: ais,
        lastLobbyData: makeLobby({ hostColor: COLOR_KEYS[1], guests }),
      });
      cycleAiColor(1, 1, ctx);
      expect(ctx.getAiSlots().get(1)!.color).toBe(remaining);
    });
  });

  // ── cycleAiVehicle ─────────────────────────────────────
  describe('cycleAiVehicle', () => {
    it('toggles bike to car', () => {
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'BOT', color: 'cyan', vehicle: 'bike' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: ais,
        lastLobbyData: makeLobby(),
      });
      cycleAiVehicle(1, ctx);
      expect(ctx.getAiSlots().get(1)!.vehicle).toBe('car');
    });

    it('toggles car to bike', () => {
      const ais = new Map<number, { name: string; color: string; vehicle: VehicleType }>([
        [1, { name: 'BOT', color: 'cyan', vehicle: 'car' }],
      ]);
      const ctx = makeMockCtx({
        currentLobbyId: 'L1',
        myRole: 'host',
        aiSlots: ais,
        lastLobbyData: makeLobby(),
      });
      cycleAiVehicle(1, ctx);
      expect(ctx.getAiSlots().get(1)!.vehicle).toBe('bike');
    });

    it('is a no-op for a missing slot', () => {
      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'host' });
      cycleAiVehicle(3, ctx);
      expect(mockedUpdateLobbyAis).not.toHaveBeenCalled();
    });
  });

  // ── toggleAiInlineEdit ─────────────────────────────────
  describe('toggleAiInlineEdit', () => {
    it('creates an inline edit panel attached to the container', () => {
      const container = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'party-member--ai';
      const name = document.createElement('span');
      name.className = 'party-member-name';
      name.textContent = 'NEON';
      row.appendChild(name);
      container.appendChild(row);
      document.body.appendChild(container);

      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'host' });
      toggleAiInlineEdit(container, 1, { name: 'NEON', color: 'cyan', vehicle: 'bike' }, ctx);

      const edit = container.querySelector('.lobby-ai-inline-edit');
      expect(edit).toBeTruthy();
      expect((edit as HTMLElement).dataset.slot).toBe('1');
    });

    it('clicking the same slot twice removes the panel (toggle)', () => {
      const container = document.createElement('div');
      const row = document.createElement('div');
      row.className = 'party-member--ai';
      const name = document.createElement('span');
      name.className = 'party-member-name';
      name.textContent = 'NEON';
      row.appendChild(name);
      container.appendChild(row);
      document.body.appendChild(container);

      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'host' });
      const ai = { name: 'NEON', color: 'cyan', vehicle: 'bike' as VehicleType };
      toggleAiInlineEdit(container, 1, ai, ctx);
      expect(container.querySelector('.lobby-ai-inline-edit')).toBeTruthy();

      toggleAiInlineEdit(container, 1, ai, ctx);
      expect(container.querySelector('.lobby-ai-inline-edit')).toBeNull();
    });

    it('opening a different slot closes the previous panel', () => {
      const container = document.createElement('div');
      for (const name of ['NEON', 'FLUX']) {
        const row = document.createElement('div');
        row.className = 'party-member--ai';
        const nameEl = document.createElement('span');
        nameEl.className = 'party-member-name';
        nameEl.textContent = name;
        row.appendChild(nameEl);
        container.appendChild(row);
      }
      document.body.appendChild(container);

      const ctx = makeMockCtx({ currentLobbyId: 'L1', myRole: 'host' });
      toggleAiInlineEdit(container, 1, { name: 'NEON', color: 'cyan', vehicle: 'bike' }, ctx);
      toggleAiInlineEdit(container, 2, { name: 'FLUX', color: 'green', vehicle: 'car' }, ctx);

      const panels = container.querySelectorAll('.lobby-ai-inline-edit');
      expect(panels).toHaveLength(1);
      expect((panels[0] as HTMLElement).dataset.slot).toBe('2');
    });
  });
});

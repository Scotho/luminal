// ── Lobby Vehicle + Map Selection Integration Tests ─────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LOADOUTS, DISABLED_LOADOUTS } from '../lobby/lobbyContext';
import { LOADOUT_DISPLAY_NAMES } from '../../vehicleConfig';
import { resolveMapWinner, getSelectedMap, setSelectedMap, DEFAULT_MAP } from '../mapSelectUI';
import { getSelectedVehicle } from '../characterSelectUI';
import type { VehicleType, LobbyData, MapType } from '../../types/index';

// ── Helper ──────────────────────────────────────────────

function makeLobby(opts: {
  hostVehicle?: VehicleType | null;
  hostMapVote?: string | null;
  hostColor?: string;
  guests?: Array<{
    vehicle?: VehicleType | null;
    mapVote?: string | null;
    color?: string;
    presence?: boolean;
  }>;
}): LobbyData {
  const guests: Record<string, any> = {};
  (opts.guests ?? []).forEach((g, i) => {
    guests[`guest${i}`] = {
      uid: `guest${i}`,
      username: `GUEST${i}`,
      color: g.color ?? 'cyan',
      vehicle: g.vehicle ?? 'bike',
      mapVote: g.mapVote ?? null,
      presence: g.presence ?? true,
    };
  });
  return {
    host: {
      uid: 'host',
      username: 'HOST',
      color: opts.hostColor ?? 'red',
      vehicle: opts.hostVehicle ?? 'bike',
      mapVote: opts.hostMapVote ?? null,
    },
    guests,
    settings: { seriesLength: 1, lobbySize: 2 + (opts.guests?.length ?? 0) },
    status: 'waiting',
    createdAt: Date.now(),
  } as any as LobbyData;
}

// ── Tests ───────────────────────────────────────────────

describe('Lobby Vehicle + Map Integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── 1. Lobby Vehicle Grid — Selectable vs Disabled ────

  describe('Lobby Vehicle Grid — Selectable vs Disabled', () => {
    it('LOADOUTS contains exactly 3 entries', () => {
      expect(LOADOUTS).toHaveLength(3);
    });

    it('LOADOUTS contains bike, car, and hoverboard', () => {
      expect(LOADOUTS).toEqual(['bike', 'car', 'hoverboard']);
    });

    it('DISABLED_LOADOUTS is empty (all vehicles enabled)', () => {
      expect(DISABLED_LOADOUTS.has('hoverboard')).toBe(false);
      expect(DISABLED_LOADOUTS.size).toBe(0);
    });

    it('bike is NOT in disabled set', () => {
      expect(DISABLED_LOADOUTS.has('bike')).toBe(false);
    });

    it('car is NOT in disabled set', () => {
      expect(DISABLED_LOADOUTS.has('car')).toBe(false);
    });

    it('every LOADOUT has a display name', () => {
      for (const v of LOADOUTS) {
        expect(LOADOUT_DISPLAY_NAMES[v]).toBeTruthy();
      }
    });

    it('display names match expected values', () => {
      expect(LOADOUT_DISPLAY_NAMES.bike).toBe('SPECTRE');
      expect(LOADOUT_DISPLAY_NAMES.car).toBe('SLINGSHOT');
      expect(LOADOUT_DISPLAY_NAMES.hoverboard).toBe('VECTOR');
    });
  });

  // ── 2. Map Vote Resolution — Tie Breakers ─────────────

  describe('Map Vote Resolution — Tie Breakers', () => {
    it('unanimous vote returns clear winner with no tie', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [{ mapVote: 'synth_pit' }],
      }));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
      expect(result.tiedMaps).toEqual([]);
    });

    it('2-way split (host vs 1 guest) detects tie', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [{ mapVote: 'midtown_bowl' }],
      }));
      expect(result.winner).toBeNull();
      expect(result.isTie).toBe(true);
      expect(result.tiedMaps).toContain('synth_pit');
      expect(result.tiedMaps).toContain('midtown_bowl');
    });

    it('3-player: 2 vote same map, 1 different — majority wins', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'midtown_bowl',
        guests: [
          { mapVote: 'synth_pit' },
          { mapVote: 'synth_pit' },
        ],
      }));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('4-player: 2v2 split detects tie', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [
          { mapVote: 'synth_pit' },
          { mapVote: 'midtown_bowl' },
          { mapVote: 'midtown_bowl' },
        ],
      }));
      expect(result.winner).toBeNull();
      expect(result.isTie).toBe(true);
      expect(result.tiedMaps).toHaveLength(2);
    });

    it('3-way with all different votes is a tie', () => {
      // With only 2 maps available, a 3-way split is not possible;
      // but a 2-player all-different is the equivalent tie scenario.
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [{ mapVote: 'midtown_bowl' }],
      }));
      expect(result.isTie).toBe(true);
    });

    it('no votes cast returns DEFAULT_MAP (midtown_bowl)', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: null,
        guests: [{ mapVote: null }],
      }));
      expect(result.winner).toBe('midtown_bowl');
      expect(result.winner).toBe(DEFAULT_MAP);
      expect(result.isTie).toBe(false);
    });

    it('only host votes — host choice wins', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [{ mapVote: null }],
      }));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('guests with presence=false are excluded from vote count', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'midtown_bowl',
        guests: [
          { mapVote: 'synth_pit', presence: false },
          { mapVote: 'synth_pit', presence: false },
        ],
      }));
      // Both guest votes excluded → only host vote counts
      expect(result.winner).toBe('midtown_bowl');
      expect(result.isTie).toBe(false);
    });
  });

  // ── 3. Map Vote Resolution — Edge Cases ───────────────

  describe('Map Vote Resolution — Edge Cases', () => {
    it('invalid/garbage mapVote values are ignored', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [{ mapVote: 'garbage_arena' }],
      }));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('null guest votes are ignored', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'midtown_bowl',
        guests: [{ mapVote: null }, { mapVote: null }],
      }));
      expect(result.winner).toBe('midtown_bowl');
      expect(result.isTie).toBe(false);
    });

    it('mixed valid + invalid votes — only valid counted', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [
          { mapVote: 'not_a_real_map' },
          { mapVote: 'midtown_bowl' },
        ],
      }));
      // synth_pit (host) vs midtown_bowl (guest1), invalid ignored → tie
      expect(result.isTie).toBe(true);
      expect(result.tiedMaps).toContain('synth_pit');
      expect(result.tiedMaps).toContain('midtown_bowl');
    });

    it('all guests have presence=false — only host vote counts', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'synth_pit',
        guests: [
          { mapVote: 'midtown_bowl', presence: false },
          { mapVote: 'midtown_bowl', presence: false },
          { mapVote: 'midtown_bowl', presence: false },
        ],
      }));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('host has invalid vote + one valid guest → guest wins', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'fake_map',
        guests: [{ mapVote: 'synth_pit' }],
      }));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('all votes invalid → returns DEFAULT_MAP', () => {
      const result = resolveMapWinner(makeLobby({
        hostMapVote: 'x',
        guests: [{ mapVote: 'y' }, { mapVote: 'z' }],
      }));
      expect(result.winner).toBe(DEFAULT_MAP);
      expect(result.isTie).toBe(false);
    });
  });

  // ── 4. Vehicle Selection — No Selection Scenario ──────

  describe('Vehicle Selection — No Selection Scenario', () => {
    it('no vehicle saved in localStorage defaults to bike', () => {
      expect(getSelectedVehicle()).toBe('bike');
    });

    it('no map saved in localStorage defaults to DEFAULT_MAP', () => {
      expect(getSelectedMap()).toBe(DEFAULT_MAP);
      expect(getSelectedMap()).toBe('midtown_bowl');
    });
  });

  // ── 5. Vehicle Selection — Cross-Mode Consistency ─────

  describe('Vehicle Selection — Cross-Mode Consistency', () => {
    it('vehicle saved in character select is what lobby reads', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('localStorage luminal-vehicle car returns car from getSelectedVehicle', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('map saved from solo play persists to lobby context', () => {
      setSelectedMap('synth_pit');
      expect(getSelectedMap()).toBe('synth_pit');
      // Simulating "entering lobby" — the value persists
      expect(localStorage.getItem('luminal-map')).toBe('synth_pit');
    });

    it('switching vehicle in character select persists for lobby', () => {
      localStorage.setItem('luminal-vehicle', 'bike');
      expect(getSelectedVehicle()).toBe('bike');
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });
  });

  // ── 6. Lobby Vehicle Assignment — Data Structure ──────

  describe('Lobby Vehicle Assignment — Data Structure', () => {
    it('host vehicle field is present in lobby data', () => {
      const lobby = makeLobby({ hostVehicle: 'car' });
      expect(lobby.host.vehicle).toBe('car');
    });

    it('guest vehicle fields are present', () => {
      const lobby = makeLobby({
        guests: [{ vehicle: 'car' }, { vehicle: 'bike' }],
      });
      expect(lobby.guests!['guest0'].vehicle).toBe('car');
      expect(lobby.guests!['guest1'].vehicle).toBe('bike');
    });

    it('vehicles default to bike when not specified in makeLobby', () => {
      const lobby = makeLobby({ guests: [{}] });
      expect(lobby.host.vehicle).toBe('bike');
      expect(lobby.guests!['guest0'].vehicle).toBe('bike');
    });

    it('host and guest can have different vehicles', () => {
      const lobby = makeLobby({
        hostVehicle: 'car',
        guests: [{ vehicle: 'bike' }],
      });
      expect(lobby.host.vehicle).toBe('car');
      expect(lobby.guests!['guest0'].vehicle).toBe('bike');
    });

    it('null vehicle falls back to bike via helper default', () => {
      const lobby = makeLobby({
        hostVehicle: null,
        guests: [{ vehicle: null }],
      });
      // The ?? operator in makeLobby coalesces null to 'bike'
      expect(lobby.host.vehicle).toBe('bike');
      expect(lobby.guests!['guest0'].vehicle).toBe('bike');
    });
  });

  // ── 7. Map + Vehicle Combined Scenarios ───────────────

  describe('Map + Vehicle Combined Scenarios', () => {
    it('player picks car + synth_pit — both persist independently', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      setSelectedMap('synth_pit');
      expect(getSelectedVehicle()).toBe('car');
      expect(getSelectedMap()).toBe('synth_pit');
    });

    it('changing vehicle does not affect map selection', () => {
      setSelectedMap('synth_pit');
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedMap()).toBe('synth_pit');
      localStorage.setItem('luminal-vehicle', 'bike');
      expect(getSelectedMap()).toBe('synth_pit');
    });

    it('changing map does not affect vehicle selection', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      setSelectedMap('synth_pit');
      expect(getSelectedVehicle()).toBe('car');
      setSelectedMap('midtown_bowl');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('clearing localStorage resets both to defaults', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      setSelectedMap('synth_pit');
      localStorage.clear();
      expect(getSelectedVehicle()).toBe('bike');
      expect(getSelectedMap()).toBe(DEFAULT_MAP);
    });

    it('vehicle and map use separate storage keys', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      setSelectedMap('synth_pit');
      expect(localStorage.getItem('luminal-vehicle')).toBe('car');
      expect(localStorage.getItem('luminal-map')).toBe('synth_pit');
    });
  });

  // ── 8. Lobby Size Variants ────────────────────────────

  describe('Lobby Size Variants', () => {
    describe('1v1 lobby (host + 1 guest)', () => {
      it('unanimous vote produces clear winner', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'synth_pit',
          guests: [{ mapVote: 'synth_pit' }],
        }));
        expect(result.winner).toBe('synth_pit');
        expect(result.isTie).toBe(false);
      });

      it('split vote produces tie', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'synth_pit',
          guests: [{ mapVote: 'midtown_bowl' }],
        }));
        expect(result.isTie).toBe(true);
      });
    });

    describe('3-player lobby', () => {
      it('2v1 majority vote produces winner', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'midtown_bowl',
          guests: [
            { mapVote: 'midtown_bowl' },
            { mapVote: 'synth_pit' },
          ],
        }));
        expect(result.winner).toBe('midtown_bowl');
        expect(result.isTie).toBe(false);
      });

      it('host alone vs 2 guests — guests win by majority', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'midtown_bowl',
          guests: [
            { mapVote: 'synth_pit' },
            { mapVote: 'synth_pit' },
          ],
        }));
        expect(result.winner).toBe('synth_pit');
        expect(result.isTie).toBe(false);
      });
    });

    describe('4-player lobby', () => {
      it('2v2 split produces tie', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'synth_pit',
          guests: [
            { mapVote: 'synth_pit' },
            { mapVote: 'midtown_bowl' },
            { mapVote: 'midtown_bowl' },
          ],
        }));
        expect(result.isTie).toBe(true);
        expect(result.tiedMaps).toHaveLength(2);
      });

      it('3v1 produces clear winner', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'synth_pit',
          guests: [
            { mapVote: 'synth_pit' },
            { mapVote: 'synth_pit' },
            { mapVote: 'midtown_bowl' },
          ],
        }));
        expect(result.winner).toBe('synth_pit');
        expect(result.isTie).toBe(false);
      });

      it('4-0 unanimous in 4-player lobby', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'midtown_bowl',
          guests: [
            { mapVote: 'midtown_bowl' },
            { mapVote: 'midtown_bowl' },
            { mapVote: 'midtown_bowl' },
          ],
        }));
        expect(result.winner).toBe('midtown_bowl');
        expect(result.isTie).toBe(false);
      });

      it('votesByMap tracks all voter UIDs correctly', () => {
        const result = resolveMapWinner(makeLobby({
          hostMapVote: 'synth_pit',
          guests: [
            { mapVote: 'synth_pit' },
            { mapVote: 'midtown_bowl' },
            { mapVote: 'midtown_bowl' },
          ],
        }));
        expect(result.votesByMap.get('synth_pit')).toEqual(['host', 'guest0']);
        expect(result.votesByMap.get('midtown_bowl')).toEqual(['guest1', 'guest2']);
      });
    });
  });
});

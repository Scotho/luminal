import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSelectedMap, setSelectedMap, resolveMapWinner, isValidMapId, renderMapSelector, DEFAULT_MAP } from '../mapSelectUI';
import { MAPS } from '../../types/index';
import type { LobbyData } from '../../types/index';

function makeLobby(hostVote: string | null, guestVotes: Array<string | null>): LobbyData {
  const guests: Record<string, any> = {};
  guestVotes.forEach((vote, i) => {
    guests[`guest${i}`] = {
      uid: `guest${i}`, username: `GUEST${i}`, color: 'cyan',
      mapVote: vote,
    };
  });
  return {
    host: { uid: 'host', username: 'HOST', color: 'magenta', mapVote: hostVote } as any,
    guests,
    settings: { seriesLength: 3 },
    status: 'waiting',
    createdAt: Date.now(),
  } as LobbyData;
}

describe('mapSelectUI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getSelectedMap', () => {
    it('defaults to midtown_bowl when nothing saved', () => {
      expect(getSelectedMap()).toBe('midtown_bowl');
    });

    it('returns saved map', () => {
      localStorage.setItem('luminal-map', 'synth_pit');
      expect(getSelectedMap()).toBe('synth_pit');
    });

    it('returns default for invalid saved value', () => {
      localStorage.setItem('luminal-map', 'invalid');
      expect(getSelectedMap()).toBe('midtown_bowl');
    });

    it('validates against MAPS array, not hardcoded strings', () => {
      // If a value is in MAPS, it should be returned
      localStorage.setItem('luminal-map', 'synth_pit');
      expect(getSelectedMap()).toBe('synth_pit');
      localStorage.setItem('luminal-map', 'midtown_bowl');
      expect(getSelectedMap()).toBe('midtown_bowl');
    });
  });

  describe('setSelectedMap', () => {
    it('persists to localStorage and dispatches event', () => {
      let fired = false;
      const handler = (e: Event) => {
        fired = true;
        expect((e as CustomEvent).detail.map).toBe('synth_pit');
      };
      document.addEventListener('luminal-map-changed', handler);
      setSelectedMap('synth_pit');
      document.removeEventListener('luminal-map-changed', handler);
      expect(localStorage.getItem('luminal-map')).toBe('synth_pit');
      expect(fired).toBe(true);
    });
  });

  describe('isValidMapId', () => {
    it('returns true for valid map IDs', () => {
      expect(isValidMapId('synth_pit')).toBe(true);
      expect(isValidMapId('midtown_bowl')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isValidMapId('fake_map')).toBe(false);
      expect(isValidMapId('')).toBe(false);
      expect(isValidMapId(null)).toBe(false);
      expect(isValidMapId(undefined)).toBe(false);
      expect(isValidMapId(42)).toBe(false);
      expect(isValidMapId('x'.repeat(100000))).toBe(false);
    });
  });

  describe('resolveMapWinner', () => {
    it('returns winner with no tie when unanimous', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', ['synth_pit']));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
      expect(result.tiedMaps).toEqual([]);
    });

    it('returns winner with no tie when clear majority', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', ['midtown_bowl', 'midtown_bowl']));
      expect(result.winner).toBe('midtown_bowl');
      expect(result.isTie).toBe(false);
      expect(result.tiedMaps).toEqual([]);
    });

    it('returns tie when host and guest vote differently', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', ['midtown_bowl']));
      expect(result.winner).toBeNull();
      expect(result.isTie).toBe(true);
      expect(result.tiedMaps).toContain('synth_pit');
      expect(result.tiedMaps).toContain('midtown_bowl');
      expect(result.tiedMaps.length).toBe(2);
    });

    it('returns default when no votes cast', () => {
      const result = resolveMapWinner(makeLobby(null, []));
      expect(result.winner).toBe('midtown_bowl');
      expect(result.isTie).toBe(false);
    });

    it('returns host only vote as winner', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', []));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('ignores null guest votes', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', [null]));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('ignores invalid/garbage mapVote values', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', ['fake_map', 'garbage']));
      expect(result.winner).toBe('synth_pit');
      expect(result.isTie).toBe(false);
    });

    it('ignores guests with presence false', () => {
      const guests: Record<string, any> = {
        guest0: { uid: 'guest0', username: 'G0', color: 'cyan', mapVote: 'synth_pit', presence: true },
        guest1: { uid: 'guest1', username: 'G1', color: 'lime', mapVote: 'synth_pit', presence: false },
      };
      const lobby = {
        host: { uid: 'host', username: 'HOST', color: 'magenta', mapVote: 'midtown_bowl' },
        guests,
        settings: { seriesLength: 3 },
        status: 'waiting',
        createdAt: Date.now(),
      } as any;
      const result = resolveMapWinner(lobby);
      expect(result.isTie).toBe(true);
      expect(result.tiedMaps).toContain('synth_pit');
      expect(result.tiedMaps).toContain('midtown_bowl');
    });

    it('populates votesByMap with player UIDs', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', ['midtown_bowl']));
      expect(result.votesByMap.get('synth_pit')).toEqual(['host']);
      expect(result.votesByMap.get('midtown_bowl')).toEqual(['guest0']);
    });

    it('handles 3-way tie with all maps voted once each', () => {
      const result = resolveMapWinner(makeLobby('synth_pit', ['midtown_bowl']));
      expect(result.isTie).toBe(true);
    });
  });

  describe('renderMapSelector', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      localStorage.clear();
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    describe('solo mode', () => {
      it('renders ARENA label and a tile per map', () => {
        renderMapSelector({ mode: 'solo', container });
        expect(container.querySelector('.map-select-label')?.textContent).toBe('ARENA');
        const tiles = container.querySelectorAll('.map-select-tile');
        expect(tiles.length).toBe(MAPS.length);
        tiles.forEach((tile, i) => {
          expect(tile.querySelector('.map-select-tile-name')?.textContent).toBe(MAPS[i].label);
        });
      });

      it('marks default map as selected', () => {
        renderMapSelector({ mode: 'solo', container });
        const tiles = container.querySelectorAll('.map-select-tile');
        expect(tiles[0].classList.contains('map-select-tile--selected')).toBe(true);
        expect(tiles[1].classList.contains('map-select-tile--selected')).toBe(false);
      });

      it('clicking a tile updates selection', () => {
        renderMapSelector({ mode: 'solo', container });
        const tile = container.querySelector('[data-map="synth_pit"]') as HTMLElement;
        tile.click();
        expect(getSelectedMap()).toBe('synth_pit');
        // After re-render, synth_pit should be selected
        const updatedTile = container.querySelector('[data-map="synth_pit"]');
        expect(updatedTile?.classList.contains('map-select-tile--selected')).toBe(true);
      });
    });

    describe('lobby mode', () => {
      it('shows ACTIVE badge on winning map', () => {
        const votes = new Map();
        votes.set('synth_pit', []);
        votes.set('midtown_bowl', []);
        renderMapSelector({
          mode: 'lobby', container, votes,
          activeMap: 'midtown_bowl', localVote: null,
          onVote: () => {},
        });
        const activeTile = container.querySelector('[data-map="midtown_bowl"]');
        expect(activeTile?.classList.contains('map-select-tile--active')).toBe(true);
        expect(activeTile?.querySelector('.map-select-tile-badge')?.textContent).toBe('ACTIVE');
      });

      it('renders player names under voted maps', () => {
        const votes = new Map();
        votes.set('synth_pit', [{ name: 'ALICE', color: '#0ff', isHost: false }]);
        votes.set('midtown_bowl', [{ name: 'BOB', color: '#f0f', isHost: true }]);
        renderMapSelector({
          mode: 'lobby', container, votes,
          activeMap: 'midtown_bowl', localVote: 'synth_pit',
          onVote: () => {},
        });
        const synthTile = container.querySelector('[data-map="synth_pit"]');
        expect(synthTile?.querySelector('.map-select-player-name')?.textContent).toBe('ALICE');
        const bowlTile = container.querySelector('[data-map="midtown_bowl"]');
        expect(bowlTile?.querySelector('.map-select-player-name')?.textContent).toBe('BOB');
      });

      it('calls onVote callback when tile is clicked', () => {
        const onVote = vi.fn();
        const votes = new Map();
        votes.set('synth_pit', []);
        votes.set('midtown_bowl', []);
        renderMapSelector({
          mode: 'lobby', container, votes,
          activeMap: 'midtown_bowl', localVote: null,
          onVote,
        });
        const tile = container.querySelector('[data-map="synth_pit"]') as HTMLElement;
        tile.click();
        expect(onVote).toHaveBeenCalledWith('synth_pit');
      });

      it('renders host crown SVG', () => {
        const votes = new Map();
        votes.set('synth_pit', []);
        votes.set('midtown_bowl', [{ name: 'HOST', color: '#0ff', isHost: true }]);
        renderMapSelector({
          mode: 'lobby', container, votes,
          activeMap: 'midtown_bowl', localVote: 'midtown_bowl',
          onVote: () => {},
        });
        const crown = container.querySelector('.map-select-crown');
        expect(crown).not.toBeNull();
      });
    });
  });
});

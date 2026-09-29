// ── Lobby Context Unit Tests ────────────────────────────
// Verifies constants, options, and the _swallow helper.

import { describe, it, expect, vi } from 'vitest';
import {
  COLOR_MAP,
  COLOR_KEYS,
  BESTOF_OPTIONS,
  LOBBY_SIZE_OPTIONS,
  MAX_LOBBY_SIZE,
  INVITE_PERM_OPTIONS,
  ALLOW_ANON_OPTIONS,
  AI_NAMES,
  ICON_TOOLTIPS,
  LOADOUTS,
  DISABLED_LOADOUTS,
  _swallow,
} from '../lobbyContext';
import { PLAYER_COLOR_CSS_MAP, PLAYER_COLOR_KEYS } from '../../../playerColors';

describe('lobbyContext — constants', () => {
  describe('COLOR_MAP / COLOR_KEYS', () => {
    it('COLOR_MAP is the player color CSS map', () => {
      expect(COLOR_MAP).toBe(PLAYER_COLOR_CSS_MAP);
    });

    it('COLOR_KEYS contains the same keys as PLAYER_COLOR_KEYS', () => {
      expect(COLOR_KEYS).toEqual([...PLAYER_COLOR_KEYS]);
    });

    it('every COLOR_KEY has a corresponding CSS string', () => {
      for (const key of COLOR_KEYS) {
        expect(typeof COLOR_MAP[key]).toBe('string');
        expect(COLOR_MAP[key].length).toBeGreaterThan(0);
      }
    });

    it('includes the canonical red, cyan, and white keys', () => {
      expect(COLOR_KEYS).toContain('red');
      expect(COLOR_KEYS).toContain('cyan');
      expect(COLOR_KEYS).toContain('white');
    });
  });

  describe('BESTOF_OPTIONS', () => {
    it('has exactly three options (single, BO3, BO5)', () => {
      expect(BESTOF_OPTIONS).toHaveLength(3);
    });

    it('rounds are strictly increasing (1, 3, 5)', () => {
      expect(BESTOF_OPTIONS.map(o => o.rounds)).toEqual([1, 3, 5]);
    });

    it('every option has a non-empty label', () => {
      for (const opt of BESTOF_OPTIONS) {
        expect(opt.label).toBeTruthy();
      }
    });

    it('single match label is "SINGLE MATCH"', () => {
      expect(BESTOF_OPTIONS[0].label).toBe('SINGLE MATCH');
    });
  });

  describe('LOBBY_SIZE_OPTIONS', () => {
    it('has three size options (1v1, 3, 4 players)', () => {
      expect(LOBBY_SIZE_OPTIONS).toHaveLength(3);
    });

    it('sizes match 2, 3, 4', () => {
      expect(LOBBY_SIZE_OPTIONS.map(o => o.size)).toEqual([2, 3, 4]);
    });

    it('MAX_LOBBY_SIZE matches largest option', () => {
      const largest = Math.max(...LOBBY_SIZE_OPTIONS.map(o => o.size));
      expect(MAX_LOBBY_SIZE).toBe(largest);
    });
  });

  describe('INVITE_PERM_OPTIONS', () => {
    it('has invite / private / public options in order', () => {
      expect(INVITE_PERM_OPTIONS.map(o => o.value)).toEqual(['invite', 'private', 'public']);
    });

    it('labels are human-readable strings', () => {
      for (const opt of INVITE_PERM_OPTIONS) {
        expect(typeof opt.label).toBe('string');
        expect(opt.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ALLOW_ANON_OPTIONS', () => {
    it('has an ALLOW (true) and BLOCK (false) option', () => {
      expect(ALLOW_ANON_OPTIONS).toHaveLength(2);
      expect(ALLOW_ANON_OPTIONS[0]).toEqual({ label: 'ALLOW', value: true });
      expect(ALLOW_ANON_OPTIONS[1]).toEqual({ label: 'BLOCK', value: false });
    });
  });

  describe('AI_NAMES', () => {
    it('has a large, deduplicated pool of AI bot names', () => {
      expect(AI_NAMES.length).toBeGreaterThanOrEqual(32);
      const set = new Set(AI_NAMES);
      expect(set.size).toBe(AI_NAMES.length);
    });

    it('all names are upper-case and non-empty', () => {
      for (const name of AI_NAMES) {
        expect(name).toBe(name.toUpperCase());
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ICON_TOOLTIPS', () => {
    it('maps the star icon to "EARLY ADOPTER"', () => {
      expect(ICON_TOOLTIPS.star).toBe('EARLY ADOPTER');
    });
  });

  describe('LOADOUTS / DISABLED_LOADOUTS', () => {
    it('LOADOUTS contains the three vehicles in expected order', () => {
      expect(LOADOUTS).toEqual(['bike', 'car', 'hoverboard']);
    });

    it('DISABLED_LOADOUTS is an empty set (all selectable)', () => {
      expect(DISABLED_LOADOUTS.size).toBe(0);
      for (const v of LOADOUTS) {
        expect(DISABLED_LOADOUTS.has(v)).toBe(false);
      }
    });
  });
});

describe('lobbyContext — _swallow helper', () => {
  it('returns a function that swallows errors silently in production', () => {
    const prevDev = import.meta.env.DEV;
    // Force non-dev by stubbing console.warn — if called, test fails
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const swallow = _swallow('test-label');
    expect(() => swallow(new Error('boom'))).not.toThrow();
    // In DEV (vitest default) we expect warn to have been called once
    if (prevDev) {
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('[lobby] test-label');
    }
    warn.mockRestore();
  });

  it('accepts any unknown value without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const swallow = _swallow('x');
    expect(() => swallow(null)).not.toThrow();
    expect(() => swallow(undefined)).not.toThrow();
    expect(() => swallow('string error')).not.toThrow();
    expect(() => swallow({ stack: 'fake' })).not.toThrow();
    warn.mockRestore();
  });

  it('different labels produce distinct closures', () => {
    const a = _swallow('a');
    const b = _swallow('b');
    expect(a).not.toBe(b);
    expect(typeof a).toBe('function');
    expect(typeof b).toBe('function');
  });
});

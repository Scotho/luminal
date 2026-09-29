// ── Environment Switcher tests ─────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockLocalStorage } from './helpers';

// ── Mock dependencies before import ────────────────────────
vi.mock('../ui/icons', () => ({
  icon: (_name: string) => '<svg></svg>',
}));

vi.mock('../ui/statusBanner', () => ({
  getServiceStatus: (_key: string) => ({ color: 'dim', text: '—' }),
  onServiceStatusChanged: (_fn: () => void) => () => {},
}));

import {
  getDbEnvironment,
  setDbEnvironment,
  getGameEnvironment,
  setGameEnvironment,
  getEnvironment,
  setEnvironment,
  getConfig,
  ENVIRONMENTS,
} from '../envSwitcher';

// ── Tests ──────────────────────────────────────────────────

describe('envSwitcher', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = mockLocalStorage();
    storage.clear();
  });

  // ── getDbEnvironment ──────────────────────────────────────

  describe('getDbEnvironment', () => {
    it('returns "live" by default when nothing stored', () => {
      expect(getDbEnvironment()).toBe('live');
    });

    it('returns stored DB environment', () => {
      storage.set('luminal-admin-db-env', 'test');
      expect(getDbEnvironment()).toBe('test');
    });

    it('falls back to legacy key when DB key missing', () => {
      storage.set('luminal-admin-environment', 'local');
      expect(getDbEnvironment()).toBe('local');
    });

    it('prefers DB key over legacy key', () => {
      storage.set('luminal-admin-db-env', 'test');
      storage.set('luminal-admin-environment', 'local');
      expect(getDbEnvironment()).toBe('test');
    });

    it('ignores invalid stored values', () => {
      storage.set('luminal-admin-db-env', 'invalid-env');
      expect(getDbEnvironment()).toBe('live');
    });
  });

  // ── setDbEnvironment ──────────────────────────────────────

  describe('setDbEnvironment', () => {
    it('persists environment to localStorage', () => {
      setDbEnvironment('local');
      expect(storage.get('luminal-admin-db-env')).toBe('local');
    });

    it('overwrites previous value', () => {
      setDbEnvironment('test');
      setDbEnvironment('live');
      expect(storage.get('luminal-admin-db-env')).toBe('live');
    });
  });

  // ── getGameEnvironment ────────────────────────────────────

  describe('getGameEnvironment', () => {
    it('returns "local" by default when nothing stored', () => {
      expect(getGameEnvironment()).toBe('local');
    });

    it('returns stored game environment', () => {
      storage.set('luminal-admin-game-env', 'live');
      expect(getGameEnvironment()).toBe('live');
    });

    it('ignores invalid stored values', () => {
      storage.set('luminal-admin-game-env', 'bogus');
      expect(getGameEnvironment()).toBe('local');
    });
  });

  // ── setGameEnvironment ────────────────────────────────────

  describe('setGameEnvironment', () => {
    it('persists game environment to localStorage', () => {
      setGameEnvironment('test');
      expect(storage.get('luminal-admin-game-env')).toBe('test');
    });
  });

  // ── Backward-compat aliases ───────────────────────────────

  describe('getEnvironment (alias)', () => {
    it('returns same as getDbEnvironment', () => {
      storage.set('luminal-admin-db-env', 'test');
      expect(getEnvironment()).toBe(getDbEnvironment());
    });
  });

  describe('setEnvironment (alias)', () => {
    it('sets DB environment', () => {
      setEnvironment('local');
      expect(storage.get('luminal-admin-db-env')).toBe('local');
    });
  });

  // ── getConfig ─────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns config for current environment', () => {
      storage.set('luminal-admin-db-env', 'local');
      const config = getConfig();
      expect(config.label).toBe('LOCAL');
      expect(config.isEmulator).toBe(true);
      expect(config.databaseURL).toBe('http://localhost:9000');
    });

    it('returns live config by default', () => {
      const config = getConfig();
      expect(config.label).toBe('LIVE');
      expect(config.isEmulator).toBe(false);
    });
  });

  // ── ENVIRONMENTS constant ─────────────────────────────────

  describe('ENVIRONMENTS', () => {
    it('has local, test, and live entries', () => {
      expect(ENVIRONMENTS.local).toBeDefined();
      expect(ENVIRONMENTS.test).toBeDefined();
      expect(ENVIRONMENTS.live).toBeDefined();
    });

    it('local uses emulator URLs', () => {
      expect(ENVIRONMENTS.local.isEmulator).toBe(true);
      expect(ENVIRONMENTS.local.firestoreHost).toBe('localhost:8080');
      expect(ENVIRONMENTS.local.authHost).toBe('http://localhost:9099');
    });

    it('test and live are not emulators', () => {
      expect(ENVIRONMENTS.test.isEmulator).toBe(false);
      expect(ENVIRONMENTS.live.isEmulator).toBe(false);
    });

    it('all environments have same projectId', () => {
      expect(ENVIRONMENTS.local.projectId).toBe('luminal-game');
      expect(ENVIRONMENTS.test.projectId).toBe('luminal-game');
      expect(ENVIRONMENTS.live.projectId).toBe('luminal-game');
    });
  });
});

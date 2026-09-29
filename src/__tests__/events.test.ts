// ── Event constants tests ────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  EVT_CHARACTER_CHANGED,
  EVT_MAP_CHANGED,
  EVT_SETTINGS_RESTORED,
  EVT_LOBBY_CTX_MENU,
  EVT_PLAY_CLOUD_REPLAY,
} from '../events';

const ALL_EVENTS = [
  EVT_CHARACTER_CHANGED,
  EVT_MAP_CHANGED,
  EVT_SETTINGS_RESTORED,
  EVT_LOBBY_CTX_MENU,
  EVT_PLAY_CLOUD_REPLAY,
] as const;

describe('events constants', () => {
  it('exports all expected event constants as strings', () => {
    expect(typeof EVT_CHARACTER_CHANGED).toBe('string');
    expect(typeof EVT_MAP_CHANGED).toBe('string');
    expect(typeof EVT_SETTINGS_RESTORED).toBe('string');
    expect(typeof EVT_LOBBY_CTX_MENU).toBe('string');
    expect(typeof EVT_PLAY_CLOUD_REPLAY).toBe('string');
  });

  it('event names are unique', () => {
    const unique = new Set(ALL_EVENTS);
    expect(unique.size).toBe(ALL_EVENTS.length);
  });

  it('event names match expected values', () => {
    expect(EVT_CHARACTER_CHANGED).toBe('luminal-character-changed');
    expect(EVT_MAP_CHANGED).toBe('luminal-map-changed');
    expect(EVT_SETTINGS_RESTORED).toBe('luminal-settings-restored');
    expect(EVT_LOBBY_CTX_MENU).toBe('lobby:show-ctx-menu');
    expect(EVT_PLAY_CLOUD_REPLAY).toBe('play-cloud-replay');
  });

  it('event names follow naming convention (lowercase-with-hyphens or namespace:name)', () => {
    const pattern = /^[a-z][a-z0-9:-]*$/;
    for (const name of ALL_EVENTS) {
      expect(name).toMatch(pattern);
    }
  });

  it('events can be dispatched and received on DOM', () => {
    const el = document.createElement('div');
    let received = false;

    el.addEventListener(EVT_CHARACTER_CHANGED, () => {
      received = true;
    });

    el.dispatchEvent(new CustomEvent(EVT_CHARACTER_CHANGED));
    expect(received).toBe(true);
  });
});

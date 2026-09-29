import type { ColorEntry } from './types/index';

export interface PlayerColorDefinition extends ColorEntry {
  key: string;
  css: string;
}

export const PLAYER_COLORS: readonly PlayerColorDefinition[] = [
  { key: 'red', color: 0xC02018, emissive: 0x6D120F, css: '#C02018' },
  { key: 'orange', color: 0xE08830, emissive: 0x704418, css: '#E08830' },
  { key: 'magenta', color: 0xFC741E, emissive: 0x7a3808, css: '#FC741E' },
  { key: 'lime', color: 0xFAC322, emissive: 0x7a5e08, css: '#FAC322' },
  { key: 'green', color: 0x66D450, emissive: 0x326828, css: '#66D450' },
  { key: 'cyan', color: 0x49A2B2, emissive: 0x17434d, css: '#49A2B2' },
  { key: 'teal', color: 0x2D6469, emissive: 0x143035, css: '#2D6469' },
  { key: 'blue', color: 0x1A6A8A, emissive: 0x0a3545, css: '#1A6A8A' },
  { key: 'pink', color: 0xD440B8, emissive: 0x6A2060, css: '#D440B8' },
  { key: 'white', color: 0xE0F0F0, emissive: 0x607878, css: '#E0F0F0' },
] as const;

export const DEFAULT_PLAYER_COLOR_KEY = 'red';
export const FALLBACK_OPPONENT_COLOR_KEY = 'red';
export const MENU_DEMO_COLOR_KEYS = ['cyan', 'orange'] as const;

export const PLAYER_COLOR_MAP: Record<string, ColorEntry> = Object.freeze(
  Object.fromEntries(PLAYER_COLORS.map(({ key, color, emissive }) => [key, { color, emissive }])) as Record<string, ColorEntry>,
);

export const PLAYER_COLOR_CSS_MAP: Record<string, string> = Object.freeze(
  Object.fromEntries(PLAYER_COLORS.map(({ key, css }) => [key, css])) as Record<string, string>,
);

export const PLAYER_COLOR_KEYS: readonly string[] = PLAYER_COLORS.map(({ key }) => key);

export function getPlayerColor(key: string): ColorEntry {
  return PLAYER_COLOR_MAP[key] || PLAYER_COLOR_MAP[DEFAULT_PLAYER_COLOR_KEY];
}

// ts-prune-ignore-next
export function getPlayerColorCss(key: string): string {
  return PLAYER_COLOR_CSS_MAP[key] || PLAYER_COLOR_CSS_MAP[DEFAULT_PLAYER_COLOR_KEY];
}

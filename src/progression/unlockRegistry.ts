/**
 * Master unlock registry.
 * Defines what unlocks at each level and standalone challenges.
 */

import type { UnlockEntry, LevelUnlocks, ChallengeDefinition, TokenChoice } from './progressionTypes';

export const LEVEL_UNLOCKS: readonly LevelUnlocks[] = [
  { level: 1, xpRequired: 0, unlocks: [
    { id: 'vehicle:bike', category: 'vehicle', label: 'SPECTRE' },
    { id: 'map:midtown_bowl', category: 'map', label: 'MIDTOWN BOWL' },
    { id: 'color:red', category: 'color', label: 'Red' },
    { id: 'color:cyan', category: 'color', label: 'Cyan' },
  ]},
  { level: 2, xpRequired: 100, unlocks: [
    { id: 'color:blue', category: 'color', label: 'Blue' },
  ]},
  { level: 3, xpRequired: 250, unlocks: [
    { id: 'vehicle:car', category: 'vehicle', label: 'SLINGSHOT' },
    { id: 'color:green', category: 'color', label: 'Green' },
  ]},
  { level: 4, xpRequired: 500, unlocks: [
    { id: 'color:pink', category: 'color', label: 'Pink' },
  ]},
  { level: 5, xpRequired: 850, unlocks: [
    { id: 'color:lime', category: 'color', label: 'Lime' },
  ]},
  { level: 6, xpRequired: 1300, unlocks: [
    { id: 'color:orange', category: 'color', label: 'Orange' },
  ]},
  { level: 7, xpRequired: 1850, unlocks: [
    { id: 'color:teal', category: 'color', label: 'Teal' },
  ]},
  { level: 8, xpRequired: 2500, unlocks: [
    { id: 'color:white', category: 'color', label: 'White' },
  ]},
  { level: 9, xpRequired: 3300, unlocks: [
    { id: 'color:magenta', category: 'color', label: 'Magenta' },
  ]},
  { level: 10, xpRequired: 4200, unlocks: [
    { id: 'vehicle:hoverboard', category: 'vehicle', label: 'VECTOR' },
  ]},
  { level: 11, xpRequired: 5300, unlocks: [
    { id: 'emissive:enhanced_glow', category: 'emissive', label: 'Enhanced Glow' },
  ]},
  { level: 12, xpRequired: 6600, unlocks: [
    { id: 'emissive:pulse', category: 'emissive', label: 'Pulse Effect' },
  ]},
  { level: 13, xpRequired: 8100, unlocks: [
    { id: 'emissive:overdrive', category: 'emissive', label: 'Overdrive' },
  ]},
  { level: 14, xpRequired: 9800, unlocks: [
    { id: 'emissive:luminal', category: 'emissive', label: 'Luminal Radiance' },
  ]},
  { level: 15, xpRequired: 11700, unlocks: [] },
];

export const CHALLENGES: readonly ChallengeDefinition[] = [
  { id: 'win_streak', label: 'Win Streak', description: 'Win 5 consecutive matches', type: 'performance', target: 5, unlockId: 'map:synth_pit', trackingEvent: 'consecutive_win', rewardType: 'map' },
  { id: 'flow_master', label: 'Flow Master', description: 'Earn 1,500 FLOW in a single match', type: 'performance', target: 1, unlockId: 'map:synth_city', trackingEvent: 'match_flow_1500', rewardType: 'map' },
  { id: 'first_steps', label: 'First Steps', description: 'Play 3 matches', type: 'usage', target: 3, unlockId: 'color:orange', trackingEvent: 'match_complete', rewardType: 'color' },
  { id: 'grid_rider', label: 'Grid Rider', description: 'Use VECTOR in 5 matches', type: 'usage', target: 5, unlockId: 'color:teal', trackingEvent: 'match_vehicle_hoverboard', rewardType: 'color' },
];

// ── Token Groups ──────────────────────────────────────────

const TOKEN_GROUPS: readonly TokenChoice[] = [
  {
    group: 6,
    options: [
      { id: 'vehicle:car', category: 'vehicle', label: 'SLINGSHOT' },
      { id: 'map:synth_city', category: 'map', label: 'SYNTH CITY' },
      { id: 'color:white+teal', category: 'color', label: 'White + Teal Bundle' },
    ],
  },
  {
    group: 9,
    options: [
      { id: 'map:synth_city', category: 'map', label: 'SYNTH CITY' },
      { id: 'color:magenta+orange', category: 'color', label: 'Magenta + Orange Bundle' },
      { id: 'emissive:early_access', category: 'emissive', label: 'Emissive Upgrade Pack' },
    ],
  },
];

export function getTokenGroup(group: number): TokenChoice | null {
  return TOKEN_GROUPS.find(t => t.group === group) ?? null;
}

export function getUnlocksForLevel(level: number): UnlockEntry[] {
  const entry = LEVEL_UNLOCKS.find(l => l.level === level);
  return entry ? [...entry.unlocks] : [];
}

export function getAutoUnlocksUpToLevel(level: number): UnlockEntry[] {
  const unlocks: UnlockEntry[] = [];
  for (const entry of LEVEL_UNLOCKS) {
    if (entry.level > level) break;
    unlocks.push(...entry.unlocks);
  }
  return unlocks;
}

export function getAllChallenges(): ChallengeDefinition[] {
  return [...CHALLENGES];
}

export function getChallengeById(id: string): ChallengeDefinition | undefined {
  return CHALLENGES.find(c => c.id === id);
}

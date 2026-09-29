// ── Custom DOM Event Names ──────────────────────────────
// Centralised so typos cause import errors, not silent bugs.

export const EVT_CHARACTER_CHANGED = 'luminal-character-changed' as const;
export const EVT_MAP_CHANGED = 'luminal-map-changed' as const;
export const EVT_SETTINGS_RESTORED = 'luminal-settings-restored' as const;
export const EVT_LOBBY_CTX_MENU = 'lobby:show-ctx-menu' as const;
export const EVT_PLAY_CLOUD_REPLAY = 'play-cloud-replay' as const;

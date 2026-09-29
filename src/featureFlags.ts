// src/featureFlags.ts — Client-side feature flag reader

interface FlagState {
  enabled: boolean;
  rolloutPct?: number;
  targetUids?: string[];
}

const _flags: Record<string, boolean> = {};

/** Evaluate whether a flag is active for the given user. */
// ts-prune-ignore-next
export function evaluate(flag: FlagState, uid: string | undefined): boolean {
  if (!flag.enabled) return false;
  if (uid && flag.targetUids?.includes(uid)) return true;
  if (flag.rolloutPct != null && flag.rolloutPct < 100) {
    if (!uid) return false;
    let hash = 0;
    for (let i = 0; i < uid.length; i++) hash = ((hash << 5) - hash + uid.charCodeAt(i)) | 0;
    return (Math.abs(hash) % 100) < flag.rolloutPct;
  }
  return true;
}

/** Check whether a feature flag is enabled for the current user. */
// ts-prune-ignore-next
export function isFeatureEnabled(name: string): boolean {
  return _flags[name] ?? false;
}

/** Reset all state — for testing only. */
// ts-prune-ignore-next
export function _resetForTesting(): void {
  for (const key of Object.keys(_flags)) delete _flags[key];
}

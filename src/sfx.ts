// Barrel for procedural sound effects.
//
// The real implementations live in ./sfx/* split by purpose:
//   - sfx/sfxUI     — menu / nav / wheel / chat / lobby / countdown
//   - sfx/sfxArena  — explosions, victory/defeat, streak ceremony
//   - sfx/sfxPlayer — engine, boost/dash/sputter, slipstream
//   - sfx/sfxGrind  — player grind-trail suite (enter/loop/bail/exit/hop/land)
//   - sfx/sfxShared — helpers (scheduleDisconnect)
//
// External callers continue to `import { ... } from './sfx'`. New code should
// prefer importing from the specific category module directly.

// Context control — re-exported for backward compatibility.
export { getCtx, getSfxOutput, setSfxVolume, setSfxDampen } from './sfxContext';

// UI sounds: hover, tick, confirm, navigate, notif, countdown, chat,
// lobby join/leave, error, map wheel, plus sample-based UI re-exports.
export {
  playUiBlip,
  playUiTab,
  playUiToggle,
  playUiCtxAction,
  playUiReadout,
  playUiMatchmaking,
  playUiMatchFound,
  playUiSettings,
  playHover,
  playTick,
  playConfirm,
  playNavigate,
  playNavigateBack,
  playNotif,
  playCountdown,
  playChat,
  playLobbyJoin,
  playLobbyLeave,
  playError,
  playWheelBoot,
  playWheelTick,
  playWheelLock,
  playWheelReveal,
  startRewardTally,
  playRewardTotal,
  playRewardLevelUp,
} from './sfx/sfxUI';

// Arena / environmental sounds.
export {
  playVictory,
  playDefeat,
  playStreakTick,
  playNewRecord,
  playStreakLoss,
  playExplosion,
} from './sfx/sfxArena';

// Player vehicle feedback.
export {
  startEngine,
  updateEngine,
  stopEngine,
  startProximitySpark,
  updateProximitySpark,
  stopProximitySpark,
  playBoost,
  playDash,
  playSputter,
  playTurnSwoosh,
} from './sfx/sfxPlayer';

// Player grind-trail feedback.
export {
  playGrindEnter,
  startGrindLoop,
  updateGrindLoop,
  stopGrindLoop,
  playGrindBail,
  playGrindExit,
  playGrindHop,
  playGrindLanding,
  playTrailGrindedAlert,
  playGrindSweetLockIn,
  playGrindChainExtend,
  playGrindMilestone,
  playGrindCashOut,
  playGrindBust,
} from './sfx/sfxGrind';

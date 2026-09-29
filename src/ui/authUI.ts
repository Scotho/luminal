// ── Auth UI (public barrel) ─────────────────────────────
// The auth-screen wiring, shared mutable state, helper utilities,
// and per-flow wire* helpers all live in ./authUIFlows. This module
// is the canonical import site for the rest of the codebase and
// re-exports the public surface so existing imports (main.ts,
// authWiring.ts, matchSubmit.ts, screenHooks.ts, statsUI.ts, and the
// test suite) keep working unchanged.
export {
  initAuthUI,
  getCurrentUid,
  getCurrentUsername,
  getCurrentIcon,
  getIsRealUser,
  ensureLoggedIn,
  getLoginExitHook,
} from './authUIFlows';

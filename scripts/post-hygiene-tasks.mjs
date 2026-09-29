// Posts code-hygiene audit findings to the admin dashboard.
// One-shot script; safe to re-run (it just appends new tasks).

const ADMIN = 'http://localhost:5175';

const tasks = [
  // ── Empty catch / swallow-only catch audit ───────────────
  {
    priority: 4,
    prompt:
      'Audit catch blocks for silent error swallowing. Prior count was 10 empty catches; current audit (scripts/find-empty-catches.mjs) finds 0 truly empty catches but 66 comment-only catches (body contains only a comment, no logging or handling). Hotspots: src/audio.ts (12), src/sfx.ts (5), src/characterSelectUI.ts (6), src/vehicleAudioEngine.ts (5), src/spatialAudio.ts (6), src/engineStrategyRpmBand.ts (5). Review each: convert to net.warn() / gfxLog.warn() if the error matters, keep the comment if the swallow is deliberate (e.g. audio-context teardown races), but add a one-word justification comment ("// expected: already disposed"). Run `node scripts/find-empty-catches.mjs` for the full list.',
  },

  // ── as any casts in source (non-test) ────────────────────
  {
    priority: 3,
    prompt:
      'Remove `as any` casts from non-test source. Current count: 6 casts in 3 files (prior memory said 36 — already improved dramatically). Files: (1) src/main.ts has 4 `(window as any).X = ...` bootstrap exports — replace with a typed `declare global { interface Window { ... } }` block; (2) src/ui/characterSelectUI.ts:374 `(window as any).luminalUnlock = ...` — move into the same window-type augmentation; (3) src/vehicleAudioEngine.ts:206 `(strategy as any).nodes` — add an `EngineStrategyWithNodes` interface or a type guard. After fix, `grep -rn "as any" src --include="*.ts" | grep -v ".test.ts" | grep -v "/__tests__/" | grep -v "/e2e/"` should return 0.',
  },

  // ── Unused imports / locals sweep ───────────────────────
  {
    priority: 3,
    prompt:
      'Sweep unused imports and unused locals. `npx eslint src/` reports 301 @typescript-eslint/no-unused-vars warnings across 111 files. Most are dead imports (e.g. src/ui/settings/settingsGraphics.ts:6 BloomLevel, src/atmosphere.ts MIST_COLOR/MIST_SIZE) or dead constant blocks (src/core/*.ts grind tuning constants that were superseded). Approach: (1) run `npx eslint src/ --fix` to auto-remove simple unused imports; (2) manually inspect remaining unused consts — some may indicate dead code paths worth deleting entirely (e.g. leftover grind tuning constants); (3) target 0 no-unused-vars warnings. Do NOT rename live params with `_` prefix just to silence the rule — delete them if truly unused.',
  },

  // ── Dead exports (ts-prune) ─────────────────────────────
  {
    priority: 3,
    prompt:
      'Audit and remove dead exports. `npx ts-prune` reports 316 exported symbols with no external consumer (excluding those "used in module"). Notable clusters: src/audioDebugLog.ts (~10 dead exports), src/ui/lobby/index.ts (~24 re-exports that nothing imports), src/atmosphere.ts createEarlyMist/updateEarlyMist/disposeEarlyMist/createAtmosphere/updateAtmosphere/disposeAtmosphere (all unused — possible dead file), src/localHaze.ts createLocalHaze/dispose/update. Approach: (1) verify ts-prune results against runtime usage (window globals, dynamic imports), (2) delete truly dead exports and their implementations, (3) for barrel files like ui/lobby/index.ts, decide whether the barrel is load-bearing or can be deleted. Re-run `npx ts-prune | grep -v "used in module" | wc -l` until <50.',
  },

  // ── Critical file refactors (>800 LOC) ──────────────────
  {
    priority: 5,
    prompt:
      'Refactor src/game.ts (2034 LOC — by far the largest source file). Dominant offenders inside: update() at line 711 is 582 lines, _checkCollisions() at line 1413 is 362 lines, constructor at line 354 is 193 lines. Plan: (1) extract _checkCollisions() into src/core/gameCollisions.ts (it maps well to core/ since collisions are already partially factored there); (2) split update() by phase — the function body alternates between input, physics, camera, HUD, and netcode ticks, each of which can become a private method or a module helper (`updateInputPhase`, `updateRenderPhase`, etc.); (3) move constructor init blocks into named setup helpers. Target: game.ts <900 LOC, update() <150 LOC. Keep all tests passing (`npm test -- game`).',
  },
  {
    priority: 5,
    prompt:
      'Refactor src/grid.ts (1667 LOC) — the createArena() function at line 418 is 1225 lines long, the single worst function in the codebase. This is one monolithic function building every arena prop, light, stand, mist volume, and panel. Plan: (1) split createArena into phase helpers: buildFloor(), buildStands(), buildPanels(), buildLights(), buildMist(), buildProps(); (2) extract the arena color/role lookup tables into src/arenaTheme.ts; (3) each helper should take (scene, opts) and return its disposables. Target: grid.ts <700 LOC, no function >150 LOC. Current test coverage via src/__tests__/grid.test.ts (942 lines) should be unchanged after refactor.',
  },
  {
    priority: 5,
    prompt:
      'Refactor src/core/simulation.ts (1609 LOC) — deterministic sim core. Offending functions: _advanceGrind() at line 712 is 298 lines, _advanceDrift() at line 404 is 192 lines, advancePlayer() at line 1017 is 176 lines, simStep() at line 1263 is 100 lines. Plan: (1) extract grind logic into src/core/simGrind.ts (the grind state machine is self-contained and already has a test file); (2) extract drift into src/core/simDrift.ts; (3) keep advancePlayer as the orchestrator but delegate to the new helpers. CRITICAL: simulation.ts is the lockstep sim core — any refactor must produce bit-identical output. Run simulation.property.test.ts and lockstepManager.test.ts after each step.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/audio.ts (1484 LOC) — main audio router. No single giant function (largest is _attachDeckListeners at 96L) but the file accumulates 12 comment-only catch blocks and many unrelated concerns: deck listener wiring, SFX routing, bus mixing, ambient beds. Plan: (1) extract music-deck logic (lines 277–541, 1246–1430) into src/audioDeck.ts — this accounts for ~10 of the 12 swallow catches and is the most self-contained subsystem; (2) extract ambient bed management into src/audioAmbient.ts; (3) keep audio.ts as the top-level router. Target: audio.ts <700 LOC. Pairs well with the empty-catches task.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/sfx.ts (1351 LOC) — SFX library. playCountdown() at line 583 is 106L. The file is mostly a flat list of `play*` functions — ~80 of them. Plan: (1) group by category into subfiles: src/sfx/sfxPlayer.ts (player feedback), src/sfx/sfxArena.ts (ambient, hits, explosions), src/sfx/sfxUI.ts (menu clicks, confirmations); (2) keep sfx.ts as a re-export barrel for existing call sites; (3) once migrated, inline call sites can import directly from the submodule. Target: no single sfx subfile >500 LOC.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/onlineMatch.ts (1261 LOC) — online match state machine. start() at line 212 is 200L, _setupNextRound() at line 1062 is 108L. Note: src/onlineMatch.class.ts already exists (and has its own tests). This legacy onlineMatch.ts should be audited for what is still live vs. duplicated by the class-based version. Plan: (1) diff the two implementations and confirm which is authoritative; (2) if onlineMatch.ts is pure wiring around OnlineMatch class, reduce it to a thin adapter; (3) if both carry logic, extract shared helpers into src/net/matchHelpers.ts. Target: onlineMatch.ts <400 LOC or deleted.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/player.ts (1253 LOC) — Player class. constructor at line 206 is 142L, applySimState() at line 686 is 154L, courseCorrect() at line 842 is 82L. Plan: (1) split Player class across partials: src/playerPhysics.ts (movement integration), src/playerState.ts (applySimState, course correction, sim mirroring), src/playerRender.ts (mesh/trail updates) — use composition: `this.physics = new PlayerPhysics(this)`; (2) keep Player as the public facade. Target: player.ts <500 LOC, constructor <80 LOC. Run player.test.ts and playerGrindIntegration.test.ts.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/modes/roundFlow.ts (1126 LOC) — round lifecycle state machine. startCountdown() at line 232 is 149L, triggerOnlineGameover() at line 979 is 146L, showResultScreenWaterfall() at line 871 is 105L, applyPrebuiltResultScreen() at line 769 is 100L. Plan: (1) extract the gameover/result waterfall sequence into src/modes/roundResultFlow.ts; (2) extract countdown orchestration into src/modes/roundCountdown.ts; (3) keep roundFlow.ts as the phase-transition dispatcher. roundFlow.test.ts is 1402 lines — tests should continue to pass untouched.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/ai.ts (1092 LOC) — AI opponent controller. getAIInput() at line 517 is 524 lines, by far the longest function in the file. This is the tick-by-tick decision tree: target acquisition → path selection → maneuver choice → input emission. Plan: (1) split getAIInput() into phased helpers: aiPerception() → aiPlan() → aiManeuver() → aiEmitInput(); (2) move per-maneuver tables (AIManeuver enum, turn timings) into src/aiManeuvers.ts; (3) target: no AI function >120 LOC. Verify with casual.ts e2e scenario which exercises AI death recording.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/modes/onlineMode.ts (1019 LOC) — online mode host. startOnlineMatch() at line 97 is 391L, updateLockstepTick() at line 547 is 292L. These are the two hottest entry points for online play. Plan: (1) split startOnlineMatch into subscribe-to-match → seed-rng → build-lockstep → hand-off phases, each a private method; (2) extract the per-tick lockstep logic (input capture → sim advance → hash report) into src/modes/onlineLockstepTick.ts; (3) target onlineMode.ts <500 LOC. Exercise with online-smoke/critical-path.test.ts.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/ui/lobby/lobbyPartyHud.ts (993 LOC). _createMemberRow() at line 80 is 155L, initPartyHudListeners() at line 840 is 153L, showLobbyContextMenu() at line 660 is 104L, closeLobbyCtxMenu at 642. Plan: (1) extract the row-building DOM template into src/ui/lobby/lobbyPartyRow.ts; (2) extract the context-menu system into src/ui/lobby/lobbyContextMenu.ts (it is already cohesive); (3) keep lobbyPartyHud.ts as the orchestrator. Target: <500 LOC.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/modes/replayMode.ts (927 LOC) — replay playback. _updateReplayCamera() at line 442 is 121L, _updateBgReplay() at line 716 is 101L. Plan: (1) extract replay camera logic into src/modes/replayCamera.ts; (2) extract bg-replay (menu backdrop mode) into src/modes/replayBackground.ts; (3) keep replayMode.ts as the state dispatcher. Run modes/__tests__/replayMode.test.ts.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/ui/lobby/lobbyUI.ts (921 LOC). _onLobbyUpdate() at line 197 is 324L — single biggest function in lobby UI. This is the RTDB lobby snapshot handler that diffs state and updates every HUD element. Plan: (1) split _onLobbyUpdate into phase helpers: syncMembers(), syncReadyState(), syncMapVote(), syncChat(), syncCountdown() — each driven from the same snapshot; (2) note ui/lobby/index.ts already re-exports many symbols, some dead (see dead-exports task). Target: lobbyUI.ts <500 LOC.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/ui/onlineUI.ts (910 LOC). handleOnlineStateChange() at line 271 is 251L, initOnlineUI() at line 668 is 188L, showMatchFound() at line 133 is 93L. Plan: (1) split handleOnlineStateChange into per-state handlers (onQueueing, onMatched, onLobby, etc.) — a switch→dispatch table; (2) extract initOnlineUI wiring into src/ui/onlineUIBindings.ts. Target: onlineUI.ts <500 LOC.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/ui/authUI.ts (889 LOC). initAuthUI() at line 315 is 574 lines — one of the longest functions in the codebase. This is the entire auth screen wiring (sign-in, sign-up, anon, reset password, verify, error toasts) in one function. Plan: (1) split initAuthUI by flow: wireSignIn(), wireSignUp(), wireAnonFlow(), wireResetPassword(), wireVerifyEmail(); (2) each helper takes the already-cached DOM refs; (3) keep initAuthUI as the orchestrator that calls them. Target: initAuthUI <80L, authUI.ts <500 LOC.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/playerVFX.ts (839 LOC). updateGroundFX() at line 342 is 124L, updateElectricArcs() at line 519 is 89L. Plan: (1) extract ground-FX (dust, sparks, skid lines) into src/playerVFX/groundFX.ts; (2) extract arc/lightning effects into src/playerVFX/arcFX.ts; (3) keep playerVFX.ts as the orchestrator that owns lifetime. Target: <500 LOC.',
  },
  {
    priority: 4,
    prompt:
      'Refactor src/netcode.ts (825 LOC) — legacy netcode layer. start() at line 265 is 141L. Plan: (1) inventory what still uses netcode.ts vs. the newer src/net/*Transport.ts and src/core/lockstep*.ts layers — netcode.ts may be mostly dead code at this point; (2) if still live, split start() by phase: auth → room → listeners → handshake; (3) if dead, delete. Run net/firebaseMatchTransport.test.ts and core/lockstepManager.test.ts to confirm either path.',
  },

  // ── Warning-tier files (500–800 LOC) rollup ─────────────
  {
    priority: 2,
    prompt:
      'Audit warning-tier files (500–800 LOC) for future extraction. 13 non-test files: src/types/index.ts 779, src/ui/lobby/lobbyPlayers.ts 742 (renderVehicleGrid 154L, renderLobbyCards 115L), src/trail.ts 734 (constructor 212L), src/arenaEffects.ts 704 (updateArenaAudio 470L — flag for immediate refactor), src/ui/characterSelectUI.ts 682, src/ui/musicUI.ts 639 (initMusicUI 212L, _initDragReorder 124L), src/ui/profileUI.ts 625, src/ui/navigation.ts 584, src/ui/lobbyPreview.ts 581 (_createPreviewScene 185L), src/atmosphere.ts 552, src/ui/notifUI.ts 551, src/core/lockstepManager.ts 529, src/ui/friendsUI.ts 527. This task is a tracking parent — decide per-file whether to promote to its own refactor task or defer.',
  },

  // ── Long functions in non-critical files ────────────────
  {
    priority: 4,
    prompt:
      'Refactor src/arenaEffects.ts updateArenaAudio() at line 97 — 470 lines, by far the longest function in any non-critical file. This is the per-frame arena audio crossfader: ambient bed, hit reverb, boundary hum, light hum, panel resonance. Plan: (1) extract each audio layer into its own `updateXxx(state, dt)` helper; (2) keep updateArenaAudio as a 20-line orchestrator that delegates. arenaEffects.ts itself is 704 LOC so this extraction alone will bring the file under 400 LOC. Run __tests__/arenaEffects.test.ts.',
  },
  {
    priority: 3,
    prompt:
      'Refactor src/gameLoop.ts loop() at line 50 — 311 lines in a 360 LOC file, so the function IS the file. The loop function currently does: RAF scheduling, delta time clamp, fixed-timestep accumulator, sim step, render, perf sampling, frame-budget gating. Plan: (1) extract fixed-timestep accumulator logic into src/gameLoopFixedStep.ts; (2) extract perf sampling into src/gameLoopPerf.ts; (3) keep loop() as a 40-line orchestrator. Verify frame cadence still hits 60fps with the existing perf-budget.json thresholds.',
  },

  // ── Smaller long-function tasks in medium files ────────
  {
    priority: 2,
    prompt:
      'Refactor src/ui/buttonHandlers.ts initButtonHandlers() at line 48 — 237L in a 284L file. The function wires every menu button in one block. Plan: group by screen and extract (wireMainMenuButtons, wireLobbyButtons, wireSettingsButtons). Target: initButtonHandlers <40L.',
  },
  {
    priority: 2,
    prompt:
      'Refactor src/debugLog.ts getNetLog() (224L at line 130) and getNetcodeStats() (123L at line 358). Both build formatted diagnostic strings by concatenation. Plan: extract row-builder helpers so each stat type has its own format function. Target: neither function >80L.',
  },
  {
    priority: 2,
    prompt:
      'Refactor src/ui/replayUI.ts initReplayUI() at line 215 — 215L. Split into per-control wiring helpers (wireScrubber, wireSpeedButtons, wireCameraModeToggle, etc.). Target: initReplayUI <60L.',
  },
  {
    priority: 2,
    prompt:
      'Refactor src/camera/cameraRig.ts updateCamera() at line 230 — 213L. This is the per-frame camera update: target follow, look-ahead lerp, shake, FOV pulse. Plan: extract each concern into its own update phase helper. Existing tests in camera/cameraRig.test.ts (662L) exercise this heavily. Target: updateCamera <80L.',
  },
];

async function main() {
  let posted = 0;
  for (const t of tasks) {
    const body = { tag: 'code-hygiene', source: 'code-hygiene-audit', ...t };
    try {
      const res = await fetch(`${ADMIN}/__admin_task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ok) {
        console.log(`[${++posted}] ${j.ref} posted — ${t.prompt.slice(0, 60)}...`);
      } else {
        console.error('FAILED:', j);
      }
    } catch (err) {
      console.error('ERR:', err.message);
    }
  }
  console.log(`\nPosted ${posted}/${tasks.length} tasks.`);

  // Reset the code-hygiene audit
  try {
    const res = await fetch(`${ADMIN}/__admin_audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'code-hygiene', action: 'reset' }),
    });
    console.log('\nAudit reset:', res.status, await res.text());
  } catch (err) {
    console.error('Audit reset failed:', err.message);
  }
}

main();

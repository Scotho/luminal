// ── Online State Handlers ────────────────────────────────
// Per-state callbacks for OnlineMatch state transitions.
// Extracted from onlineUI.ts (TASK-250). Pure extraction — behaviour unchanged.
import { OnlineMatch } from '../onlineMatch';
import { confirmMatchStarted } from '../matchmaking';
import { pushNotif } from './notifUI';
import { escapeHtml } from './dom';
import { showResultMapPanel, hideResultMapPanel } from './resultMapSelect';
import { rejoinLobbyAfterMatch } from './lobby/lobbyUI';
import { getSelectedMap, setSelectedMap, DEFAULT_MAP } from './mapSelectUI';
import { playMapWheel } from './mapWheel';
import type { MapWheelCandidate } from './mapWheel';
import { MAPS } from '../types/index';
import type { MapType } from '../types/index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

export interface StatesContext {
  game: GameInstance;
  getCurrentUid: () => string | null;
  getCurrentUsername: () => string | null;
  getCurrentOnlineMatch: () => OnlineMatch | null;
  setCurrentOnlineMatch: (m: OnlineMatch | null) => void;
  getAcceptTimerInterval: () => ReturnType<typeof setInterval> | null;
  showScreen: (screen: string | null) => void;
  setCurrentScreen: (s: string | null) => void;
  updateControlUI: () => void;
  hideChatForMatch: () => void;
  initMatchChat: (matchId: string, opponentName: string) => void;
  destroyMatchChat: () => void;
  restoreChatAfterMatch: () => void;
  restoreBgMode: () => void;
  hideDynBack: () => void;
  clearNavStack: () => void;
  setLobbyMatchStarting: (v: boolean) => void;
}

let ctx: StatesContext | null = null;

export function initOnlineUIStates(context: StatesContext): void {
  ctx = context;
}

function requireCtx(): StatesContext {
  if (!ctx) throw new Error('onlineUIStates used before initOnlineUIStates()');
  return ctx;
}

// ── Pre-game screen ─────────────────────────────────────
export function showPregameScreen(match: OnlineMatch, onDone: () => void): void {
  const { getCurrentUsername } = requireCtx();
  // Skip the pregame screen entirely for 1v1 matches
  if (match.seriesLength <= 1) { onDone(); return; }

  const el: HTMLElement = document.getElementById('pregame-screen')!;
  const winsNeeded: number = Math.ceil(match.seriesLength / 2);

  // Title
  document.getElementById('pregame-title')!.textContent = `BEST OF ${match.seriesLength}`;
  document.getElementById('pregame-hint')!.textContent = `FIRST TO ${winsNeeded} WINS`;

  // VS line (include all human opponents + lobby AI names)
  const playerName: string = getCurrentUsername() || 'YOU';
  let vsHTML: string = `<span class="pregame-name">${escapeHtml(playerName.toUpperCase())}</span>`;
  for (const opp of match.opponents) {
    vsHTML += ` VS <span class="pregame-name">${escapeHtml((opp.name || 'OPPONENT').toUpperCase())}</span>`;
  }
  if (match.lobbyAis) {
    const aiEntries = Object.entries(match.lobbyAis).sort(([a], [b]) => Number(a) - Number(b));
    for (const [, aiData] of aiEntries) {
      vsHTML += ` VS <span class="pregame-name">${escapeHtml((aiData.name || 'BOT').toUpperCase())}</span>`;
    }
  }
  document.getElementById('pregame-vs')!.innerHTML = vsHTML;

  // Score dots hidden — series HUD handles this
  document.getElementById('pregame-score')!.innerHTML = '';

  // Show
  el.classList.remove('hidden', 'pregame--fade-out');

  // Hold for 3s, fade out, then start countdown
  setTimeout(() => {
    el.classList.add('pregame--fade-out');
    setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('pregame--fade-out');
      onDone();
    }, 800); // match the CSS transition duration
  }, 3000);
}

// ── State handlers ──────────────────────────────────────
export async function onCountdown(): Promise<void> {
  const c = requireCtx();
  const currentOnlineMatch = c.getCurrentOnlineMatch();
  const currentUid = c.getCurrentUid();
  const game = c.game;

  clearInterval(c.getAcceptTimerInterval()!);

  // Both accepted — permanently remove from queue (first round only)
  if (currentOnlineMatch!.round === 1) {
    confirmMatchStarted(currentUid!, currentOnlineMatch!.opponentUid).catch(() => {});
  }

  // Start match chat on first round
  if (currentOnlineMatch!.round === 1) {
    c.initMatchChat(currentOnlineMatch!.matchId,
      currentOnlineMatch!.opponents.map(o => o.name || 'opponent').join(', '));
  }
  c.hideChatForMatch();

  // Clear stale nav stack and back button from queue/matchFound flow
  c.hideDynBack();
  c.clearNavStack();

  // Hide ALL overlays
  c.showScreen(null);
  document.getElementById('online-pause-overlay')!.classList.add('hidden');
  // Reset online result buttons
  document.getElementById('btn-online-next')!.classList.remove('menu-btn--waiting', 'menu-btn--opponent-ready');
  document.getElementById('btn-online-next')!.style.display = 'none';
  document.getElementById('btn-online-rematch')!.classList.remove('menu-btn--waiting', 'menu-btn--opponent-ready');
  document.getElementById('btn-online-rematch')!.style.display = 'none';
  document.getElementById('btn-online-leave')!.style.display = 'none';
  document.getElementById('btn-return-lobby-result')!.style.display = 'none';
  document.getElementById('online-next-timer')!.style.display = 'none';

  // Sync series state from OnlineMatch to game HUD
  game.seriesLength = currentOnlineMatch!.seriesLength;
  // TASK-292: mint a stable seriesId once at round 1 so every round of the
  // best-of shares the same id on its stored replay.
  if (currentOnlineMatch!.round === 1) {
    game.startSeriesIdForOnline();
  }
  const myWins: number = currentOnlineMatch!.scores[currentUid!] || 0;
  const oppWins: number = currentOnlineMatch!.scores[currentOnlineMatch!.opponentUid] || 0;
  game.seriesPlayerWins = myWins;
  game.seriesAiWins = [oppWins];
  const oppColorKey: string | number = currentOnlineMatch!.opponentColor || 'red';
  game._seriesAiColors = [game._colorMap[oppColorKey] || game._colorMap.red];
  // Include lobby AI bots in the series HUD
  if (currentOnlineMatch!.lobbyAis) {
    const aiEntries = Object.entries(currentOnlineMatch!.lobbyAis).sort(([a], [b]) => Number(a) - Number(b));
    for (const [, aiData] of aiEntries) {
      const aiColorEntry = game._colorMap[aiData.color] || game._colorMap.red;
      game._seriesAiColors.push(aiColorEntry);
      game.seriesAiWins.push(0);
    }
  }
  game._updateSeriesHUD();

  // Start the game in online mode
  game.mode = 'online';
  // Note: game._onlineMatch is assigned inside startOnlineMatch's fade callback
  // (after cleanup()), NOT here — setting it early causes cleanup() to call
  // onlineMatch.stop(), killing all netcode listeners (state sync, death events).

  // ── Matchmaking map resolution (round 1 only, non-lobby matches) ──
  // Lobby matches already ran their own wheel in startLobbyMatch. Matchmaking
  // arrives here with two independent map picks; spin the deterministic wheel
  // (seeded from match.seed — both clients land on the same winner) when they
  // differ, otherwise lock in the agreed map directly.
  if (currentOnlineMatch!.round === 1 && !currentOnlineMatch!.lobbyId) {
    // Detach the menu-demo's map listener before setSelectedMap fires —
    // otherwise it kicks off its own "LOADING MAP" transition that persists
    // into the match (canvas opacity 0 + overlay) because startOnlineMatch's
    // teardown clears the reset timer.
    game._demoMode?.stopListeningForMapChanges?.();
    await _resolveMatchmakingMap(currentOnlineMatch!, c.getCurrentUsername() || 'YOU');
  }

  game.startOnlineMatch(currentOnlineMatch);
  c.setCurrentScreen(null);
  c.updateControlUI();
}

async function _resolveMatchmakingMap(match: OnlineMatch, myUsername: string): Promise<void> {
  const myMap: MapType = match.myMapVote ?? getSelectedMap();
  const opp = match.opponents[0];
  const oppMap: MapType | null = opp?.mapVote ?? null;

  // No opponent pick or same pick → lock in directly, no ceremony.
  if (!oppMap || oppMap === myMap) {
    setSelectedMap(myMap || DEFAULT_MAP);
    return;
  }

  const myLabel = MAPS.find(m => m.id === myMap)?.label ?? String(myMap).toUpperCase();
  const oppLabel = MAPS.find(m => m.id === oppMap)?.label ?? String(oppMap).toUpperCase();
  const candidates: MapWheelCandidate[] = [
    { mapId: myMap, label: myLabel, playerNames: [myUsername.toUpperCase()] },
    { mapId: oppMap, label: oppLabel, playerNames: [(opp?.name || 'OPPONENT').toUpperCase()] },
  ];
  const winner = await playMapWheel(candidates, match.seed);
  setSelectedMap(winner);
}

export function onBothLoaded(): void {
  const c = requireCtx();
  const currentOnlineMatch = c.getCurrentOnlineMatch();
  // Show pre-game screen on first round or rematch, then start countdown
  if (currentOnlineMatch && currentOnlineMatch.round === 1) {
    showPregameScreen(currentOnlineMatch, () => c.game.beginOnlineCountdown());
  } else {
    c.game.beginOnlineCountdown();
  }
}

export function onRoundOver(data?: unknown): void {
  const c = requireCtx();
  const currentOnlineMatch = c.getCurrentOnlineMatch();
  const currentUid = c.getCurrentUid();
  const game = c.game;

  // Dismiss online pause overlay if open
  document.getElementById('online-pause-overlay')!.classList.add('hidden');
  // Sync series scores from OnlineMatch to game HUD
  if (currentOnlineMatch) {
    game.seriesPlayerWins = currentOnlineMatch.scores[currentUid!] || 0;
    game.seriesAiWins = [currentOnlineMatch.scores[currentOnlineMatch.opponentUid] || 0];
    // Preserve lobby AI win slots
    if (currentOnlineMatch.lobbyAis) {
      const aiCount = Object.keys(currentOnlineMatch.lobbyAis).length;
      while (game.seriesAiWins.length < 1 + aiCount) game.seriesAiWins.push(0);
    }
    game._updateSeriesHUD();
  }

  // Trigger game over through the synced path
  const roundData = data as { iWon: boolean; isDraw: boolean; seriesOver: boolean; winner: string };
  game.triggerOnlineGameover(roundData.iWon, roundData.isDraw, roundData.winner);

  // Reset button states
  const nextBtn: HTMLElement = document.getElementById('btn-online-next')!;
  const rematchBtn: HTMLElement = document.getElementById('btn-online-rematch')!;
  nextBtn.classList.remove('menu-btn--waiting', 'menu-btn--opponent-ready');
  nextBtn.innerHTML = 'NEXT ROUND <i class="btn-icon" style="margin-right:0;margin-left:8px"><svg class="icon"><use href="/icons.svg#i-play"/></svg></i>';
  rematchBtn.classList.remove('menu-btn--waiting', 'menu-btn--opponent-ready');
  rematchBtn.innerHTML = '<i class="btn-icon"><svg class="icon"><use href="/icons.svg#i-repeat"/></svg></i>REMATCH';

  // Configure online-specific buttons
  if (roundData.seriesOver) {
    (nextBtn as HTMLElement).style.display = 'none';
    document.getElementById('online-next-timer')!.textContent = roundData.iWon ? 'SERIES WON' : (roundData.isDraw ? 'DRAW' : 'SERIES LOST');
    (rematchBtn as HTMLElement).style.display = '';
    // Show map voting for lobby rematches
    if (currentOnlineMatch?.lobbyId) {
      showResultMapPanel({
        mode: 'solo',
      });
    }
  } else {
    (nextBtn as HTMLElement).style.display = '';
    document.getElementById('online-next-timer')!.textContent = '';
    (rematchBtn as HTMLElement).style.display = 'none';
  }

  // Show "Return Party to Lobby" only for lobby host
  document.getElementById('btn-return-lobby-result')!.style.display =
    (currentOnlineMatch?.lobbyId && currentOnlineMatch.lobbyRole === 'host') ? '' : 'none';
}

export function onNextRoundTimer(data?: unknown): void {
  const seconds = Math.max(0, data as number);
  document.getElementById('online-next-timer')!.textContent =
    seconds > 0 ? `Next round in ${seconds}s...` : 'Starting...';
}

export function onOpponentReady(data?: unknown): void {
  const readyData = data as { readyCount: number; totalOpponents: number; readyNames: string[] } | undefined;
  const timerEl = document.getElementById('online-next-timer')!;
  const nextBtn = document.getElementById('btn-online-next')!;
  const rematchBtn = document.getElementById('btn-online-rematch')!;
  const activeBtn = nextBtn.style.display !== 'none' ? nextBtn : rematchBtn;

  // Update status text
  if (readyData && readyData.totalOpponents > 1) {
    timerEl.textContent = `${readyData.readyCount}/${readyData.totalOpponents} OPPONENTS READY`;
  } else {
    timerEl.textContent = 'OPPONENT READY';
  }

  // Add badge to button (only if player hasn't clicked yet)
  if (!activeBtn.classList.contains('menu-btn--waiting')) {
    activeBtn.classList.add('menu-btn--opponent-ready');
    const existing = activeBtn.querySelector('.btn-ready-badge');
    if (!existing) {
      const badge = document.createElement('span');
      badge.className = 'btn-ready-badge';
      badge.textContent = readyData && readyData.totalOpponents > 1
        ? `${readyData.readyCount}/${readyData.totalOpponents}`
        : 'READY';
      activeBtn.appendChild(badge);
    } else if (readyData && readyData.totalOpponents > 1) {
      existing.textContent = `${readyData.readyCount}/${readyData.totalOpponents}`;
    }
  }
}

export function onOpponentDisconnected(): void {
  const c = requireCtx();
  const game = c.game;

  hideResultMapPanel();
  // Opponent left — end the match, award win
  if (game.state === 'playing' || game.state === 'countdown' || game.state === 'transition' || game.state === 'waitingOnline') {
    document.getElementById('countdown')!.classList.add('hidden');
    document.getElementById('pregame-screen')!.classList.add('hidden');
    if (game.opponent && game.opponent.alive) game.opponent.kill();
    game.state = 'gameover';
  }

  // Toast notification
  pushNotif({ id: `opp-dc-${Date.now()}`, type: 'info', message: 'Opponent disconnected', createdAt: Date.now() });

  // Reset stuck buttons and show only leave + replay
  const nextBtn: HTMLElement = document.getElementById('btn-online-next')!;
  const rematchBtn: HTMLElement = document.getElementById('btn-online-rematch')!;
  nextBtn.classList.remove('menu-btn--waiting');
  nextBtn.style.display = 'none';
  rematchBtn.classList.remove('menu-btn--waiting');
  rematchBtn.innerHTML = '<i class="btn-icon"><svg class="icon"><use href="/icons.svg#i-repeat"/></svg></i>REMATCH';
  rematchBtn.style.display = 'none';
  document.getElementById('btn-continue')!.style.display = 'none';
  document.getElementById('btn-go-settings')!.style.display = 'none';
  document.getElementById('btn-mainmenu')!.style.display = 'none';
  document.getElementById('btn-online-leave')!.style.display = '';
  document.getElementById('online-next-timer')!.style.display = '';
  document.getElementById('online-next-timer')!.textContent = 'OPPONENT DISCONNECTED';
  document.getElementById('result-text')!.textContent = 'VICTORY';
  document.getElementById('result-text')!.style.color = 'rgb(var(--c-teal))';

  // Show the result overlay if not already visible
  const resultEl: HTMLElement = document.getElementById('result')!;
  if (resultEl.classList.contains('hidden')) {
    c.showScreen('gameover');
  }
}

export function onReturnToLobby(): void {
  const c = requireCtx();
  const currentOnlineMatch = c.getCurrentOnlineMatch();
  const game = c.game;

  const lobbyId = currentOnlineMatch?.lobbyId;
  const lobbyRole = currentOnlineMatch?.lobbyRole;
  if (!lobbyId || !lobbyRole) return;
  hideResultMapPanel();

  // Stop the online match
  if (currentOnlineMatch) {
    currentOnlineMatch.stop();
    c.setCurrentOnlineMatch(null);
  }
  game.mode = 'local';
  game._onlineMatch = null;
  game._fading = false;
  game.seriesLength = 1;
  c.setLobbyMatchStarting(false);

  // Full UI reset (same as online-leave)
  document.getElementById('btn-online-next')!.style.display = 'none';
  document.getElementById('btn-online-rematch')!.style.display = 'none';
  document.getElementById('btn-online-leave')!.style.display = 'none';
  document.getElementById('btn-return-lobby-pause')!.style.display = 'none';
  document.getElementById('btn-return-lobby-result')!.style.display = 'none';
  document.getElementById('online-next-timer')!.style.display = 'none';
  document.getElementById('series-score')!.classList.add('hidden');
  document.getElementById('pregame-screen')!.classList.add('hidden');
  document.getElementById('countdown')!.classList.add('hidden');
  document.getElementById('online-pause-overlay')!.classList.add('hidden');
  document.getElementById('result-buttons')!.style.display = '';
  document.getElementById('meter-wrap')!.classList.add('menu-hidden');
  document.getElementById('radar')!.classList.add('hidden');
  document.getElementById('match-timer')!.classList.add('hidden');
  document.getElementById('streak-display')!.classList.add('hidden');
  document.getElementById('scene-fade')!.classList.remove('scene-fade--active');

  c.destroyMatchChat();

  // Use returnToMenu for proper game cleanup (scene rebuild, state reset).
  // The lobby navigation in rejoinLobbyAfterMatch will override the 'main' screen
  // that returnToMenu shows after its fade.
  game.returnToMenu(); c.restoreBgMode(); c.restoreChatAfterMatch();

  // Rejoin the lobby — navigateTo('lobby') runs after await, overriding 'main'
  (async () => {
    const rejoined = await rejoinLobbyAfterMatch(lobbyId, lobbyRole);
    if (rejoined) {
      pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'Returned to lobby', createdAt: Date.now() });
    } else {
      // Lobby was deleted during the match — stay on main menu
      pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'Lobby no longer exists', createdAt: Date.now() });
    }
  })();
}

// ── Dispatch table ──────────────────────────────────────
type StateHandler = (data?: unknown) => void;

const dispatch: Record<string, StateHandler> = {
  countdown: () => onCountdown(),
  bothLoaded: () => onBothLoaded(),
  roundOver: onRoundOver,
  nextRoundTimer: onNextRoundTimer,
  opponentReady: onOpponentReady,
  opponentDisconnected: () => onOpponentDisconnected(),
  returnToLobby: () => onReturnToLobby(),
};

export function dispatchOnlineState(state: string, data?: unknown): void {
  const c = requireCtx();
  // Ignore stale callbacks if we're no longer in an online match.
  // 'countdown' is exempt — it's the event that transitions game.mode to 'online'.
  if (c.game.mode !== 'online' && state !== 'countdown') return;
  const handler = dispatch[state];
  if (handler) handler(data);
}

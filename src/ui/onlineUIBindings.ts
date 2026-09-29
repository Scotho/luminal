// ── Online UI Bindings ───────────────────────────────────
// DOM event listener wiring for the Online Play / Queue / Match-Found screens.
// Extracted from onlineUI.ts (TASK-250). Pure extraction — behaviour unchanged.
import { enterQueue, leaveQueue, onMatchFound, onQueueCount, listenForMatch } from '../matchmaking';
import { OnlineMatch } from '../onlineMatch';
import { pushNotif } from './notifUI';
import { playUiMatchmaking } from '../sfx';
import { hideResultMapPanel } from './resultMapSelect';
import { getSelectedMap } from './mapSelectUI';
import type { MatchFoundData } from '../types/index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

export interface BindingsContext {
  game: GameInstance;
  getCurrentUid: () => string | null;
  getCurrentUsername: () => string | null;
  getCurrentOnlineMatch: () => OnlineMatch | null;
  setCurrentOnlineMatch: (m: OnlineMatch | null) => void;
  getPlayerColorKey: () => string;
  showMatchFound: (match: MatchFoundData) => void;
  startQueueTimer: () => void;
  getQueueTimerInterval: () => ReturnType<typeof setInterval> | null;
  navigateTo: (screen: string) => void;
  navigateBack: () => void;
  setCurrentScreen: (s: string | null) => void;
  setFocusIndex: (i: number) => void;
  updateFocus: () => void;
  ensureAudio: () => void;
  restoreBgMode: () => void;
  restoreChatAfterMatch: () => void;
  destroyMatchChat: () => void;
  setLobbyMatchStarting: (v: boolean) => void;
  fetchAndRenderLobbies: () => Promise<void>;
  toggleLobbies: () => void;
  manualRefreshLobbies: () => void;
  collapseLobbies: () => boolean;
}

export function wireOnlineUIBindings(ctx: BindingsContext): void {
  // Queue count display on online screen
  onQueueCount((count: number) => {
    document.getElementById('queue-search-count')!.textContent = count + ' in queue';
    document.getElementById('queue-count')!.textContent = count + ' players in queue';
  });

  // Fetch lobby count snapshot when find match screen becomes visible
  const onlineOverlay = document.getElementById('online-overlay')!;
  const observer = new MutationObserver(() => {
    if (!onlineOverlay.classList.contains('hidden')) {
      ctx.fetchAndRenderLobbies();
    } else {
      ctx.collapseLobbies();
    }
  });
  observer.observe(onlineOverlay, { attributes: true, attributeFilter: ['class'] });

  // Casual match button
  document.getElementById('btn-casual-match')!.addEventListener('click', async () => {
    ctx.ensureAudio();
    ctx.collapseLobbies();
    ctx.navigateTo('queue');
    playUiMatchmaking();
    ctx.startQueueTimer();

    // Set up match callbacks BEFORE entering queue — enterQueue triggers
    // an immediate tryFindMatch that could match before callbacks are set
    const matchHandler = (match: MatchFoundData): void => {
      clearInterval(ctx.getQueueTimerInterval()!);
      ctx.showMatchFound(match);
    };
    onMatchFound(matchHandler);
    listenForMatch(ctx.getCurrentUid()!, matchHandler);

    // Enter queue (starts polling + may match immediately).
    // Pin the player's current map choice so the match can resolve a winner
    // (matchmaking equivalent of lobby's mapVote — see onlineUIStates.onCountdown).
    await enterQueue(ctx.getCurrentUid()!, ctx.getCurrentUsername()!, ctx.getPlayerColorKey(), getSelectedMap());
  });

  // Open Lobbies toggle
  document.getElementById('btn-open-lobbies')!.addEventListener('click', () => {
    ctx.ensureAudio();
    ctx.toggleLobbies();
  });

  // Manual refresh button
  document.getElementById('open-lobbies-refresh-btn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.manualRefreshLobbies();
  });

  // Keyboard nav for lobby list
  document.getElementById('open-lobbies-list')!.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      ctx.collapseLobbies(); // already focuses btn-open-lobbies
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...document.querySelectorAll<HTMLElement>('.open-lobbies-row')];
      const refreshBtn = document.getElementById('open-lobbies-refresh-btn')!;
      const focusables = [...rows, refreshBtn];
      const current = document.activeElement as HTMLElement;
      const idx = focusables.indexOf(current);
      const next = e.key === 'ArrowDown'
        ? focusables[(idx + 1) % focusables.length]
        : focusables[(idx - 1 + focusables.length) % focusables.length];
      next?.focus();
    }
  });

  // Cancel queue
  document.getElementById('btn-queue-cancel')!.addEventListener('click', async () => {
    clearInterval(ctx.getQueueTimerInterval()!);
    ctx.navigateBack();
    await leaveQueue(ctx.getCurrentUid()!);
  });

  // Online next round
  document.getElementById('btn-online-next')!.addEventListener('click', async () => {
    const btn: HTMLElement = document.getElementById('btn-online-next')!;
    if (btn.classList.contains('menu-btn--waiting')) return;
    btn.classList.remove('menu-btn--opponent-ready');
    const badge = btn.querySelector('.btn-ready-badge');
    if (badge) badge.remove();
    btn.classList.add('menu-btn--waiting');
    btn.innerHTML = 'WAITING FOR OPPONENT...';
    try {
      const match = ctx.getCurrentOnlineMatch();
      if (match) await match.clickNextRound();
    } catch {
      btn.classList.remove('menu-btn--waiting');
      btn.innerHTML = 'NEXT ROUND <i class="btn-icon" style="margin-right:0;margin-left:8px"><svg class="icon"><use href="/icons.svg#i-play"/></svg></i>';
      pushNotif({ id: `net-err-${Date.now()}`, type: 'info', message: 'Connection error — tap to retry', createdAt: Date.now() });
    }
  });

  // Online rematch
  document.getElementById('btn-online-rematch')!.addEventListener('click', async () => {
    const btn: HTMLElement = document.getElementById('btn-online-rematch')!;
    if (btn.classList.contains('menu-btn--waiting')) return;
    hideResultMapPanel();
    btn.classList.remove('menu-btn--opponent-ready');
    const badge = btn.querySelector('.btn-ready-badge');
    if (badge) badge.remove();
    btn.classList.add('menu-btn--waiting');
    btn.innerHTML = '<i class="btn-icon"><svg class="icon"><use href="/icons.svg#i-repeat"/></svg></i>WAITING FOR OPPONENT...';
    try {
      const match = ctx.getCurrentOnlineMatch();
      if (match) await match.requestRematch();
    } catch {
      btn.classList.remove('menu-btn--waiting');
      btn.innerHTML = '<i class="btn-icon"><svg class="icon"><use href="/icons.svg#i-repeat"/></svg></i>REMATCH';
      pushNotif({ id: `net-err-${Date.now()}`, type: 'info', message: 'Connection error — tap to retry', createdAt: Date.now() });
    }
  });

  // Return party to lobby (host only — from pause or result screen)
  const returnToLobbyHandler = (): void => {
    const match = ctx.getCurrentOnlineMatch();
    if (!match?.lobbyId || match.lobbyRole !== 'host') return;
    match.signalReturnToLobby();
  };
  document.getElementById('btn-return-lobby-pause')!.addEventListener('click', returnToLobbyHandler);
  document.getElementById('btn-return-lobby-result')!.addEventListener('click', returnToLobbyHandler);

  // Online leave
  document.getElementById('btn-online-leave')!.addEventListener('click', () => {
    hideResultMapPanel();
    const match = ctx.getCurrentOnlineMatch();
    if (match) {
      match.stop();
      ctx.setCurrentOnlineMatch(null);
    }
    ctx.game.mode = 'local';
    ctx.game._onlineMatch = null;
    ctx.game._fading = false; // force clear fade lock so returnToMenu always works
    ctx.game.seriesLength = 1; // reset series HUD
    ctx.setLobbyMatchStarting(false);

    // Full UI reset — clear all online-specific state
    document.getElementById('btn-online-next')!.style.display = 'none';
    document.getElementById('btn-online-rematch')!.style.display = 'none';
    document.getElementById('btn-online-leave')!.style.display = 'none';
    document.getElementById('btn-return-lobby-pause')!.style.display = 'none';
    document.getElementById('btn-return-lobby-result')!.style.display = 'none';
    document.getElementById('online-next-timer')!.style.display = 'none';
    document.getElementById('series-score')!.classList.add('hidden');
    document.getElementById('pregame-screen')!.classList.add('hidden');
    document.getElementById('countdown')!.classList.add('hidden');
    document.getElementById('result-buttons')!.style.display = '';
    document.getElementById('meter-wrap')!.classList.add('menu-hidden');
    document.getElementById('radar')!.classList.add('hidden');
    document.getElementById('match-timer')!.classList.add('hidden');
    document.getElementById('streak-display')!.classList.add('hidden');
    // Reset scene fade
    document.getElementById('scene-fade')!.classList.remove('scene-fade--active');

    ctx.destroyMatchChat();
    ctx.game.returnToMenu();
    ctx.restoreBgMode();
    ctx.restoreChatAfterMatch();
    ctx.setCurrentScreen('main');
    ctx.setFocusIndex(0);
    ctx.updateFocus();
  });
}

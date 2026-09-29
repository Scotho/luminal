// ── Match History UI (extracted from main.ts) ────────────
import { getReplayList, loadReplay, toggleFavorite, toggleFavoriteSeries, decompressFrames } from '../replayStore';
import type { LoadedReplayEntry, ReplaySnapshot, ReplayListEntry, ColorEntry, VehicleType } from '../types/index';
import type { MatchHistoryEntry } from '../cloudReplay';
import { formatRelativeTime, formatTime } from '../utils';
import { ico } from './dom';
import { setReplaySourceScreen, resetReplayUI } from './replayUI';
import { warnDev } from '../swallow';
import { EVT_PLAY_CLOUD_REPLAY } from '../events';
import { playUiTab } from '../sfx';

// ── Grouping types ───────────────────────────────────────

/** A best-of series containing 2+ chronologically-ordered rounds. */
export interface HistorySeriesGroup {
  kind: 'series';
  seriesId: string;
  entries: ReplayListEntry[]; // ordered by roundIndex ascending (round 1 → round N)
}

/** A standalone match that is not part of any series (BO1 or legacy). */
export interface HistoryMatchGroup {
  kind: 'match';
  entry: ReplayListEntry;
}

export type HistoryGroup = HistorySeriesGroup | HistoryMatchGroup;

/**
 * TASK-295: Collapse sibling replays that share a `seriesInfo.seriesId` into
 * a single parent group. Ungrouped (null seriesId or missing seriesInfo)
 * entries stay as standalone `match` groups.
 *
 * The input `entries` are expected to be in reverse-chronological order (as
 * returned by `getReplayList()`). The output preserves that order: each
 * series group appears at the position of its MOST RECENT child, while
 * children within a group are re-sorted ascending by `roundIndex` so the
 * expanded drawer reads "MATCH 1, MATCH 2, MATCH 3".
 */
export function groupHistoryEntries(entries: ReplayListEntry[]): HistoryGroup[] {
  const out: HistoryGroup[] = [];
  const seen: Set<string> = new Set();
  for (const e of entries) {
    const sid: string | null | undefined = e.seriesInfo?.seriesId;
    if (!sid) {
      out.push({ kind: 'match', entry: e });
      continue;
    }
    if (seen.has(sid)) continue;
    seen.add(sid);
    const siblings: ReplayListEntry[] = entries.filter(
      (x: ReplayListEntry) => x.seriesInfo?.seriesId === sid,
    );
    // Sort ascending by roundIndex so "MATCH 1" is the first round played.
    const sorted: ReplayListEntry[] = [...siblings].sort(
      (a: ReplayListEntry, b: ReplayListEntry) =>
        (a.seriesInfo?.roundIndex ?? 0) - (b.seriesInfo?.roundIndex ?? 0),
    );
    if (sorted.length === 1) {
      // Safety: a series that ended up with only one round is effectively
      // standalone — render it as a plain match row.
      out.push({ kind: 'match', entry: sorted[0] });
    } else {
      out.push({ kind: 'series', seriesId: sid, entries: sorted });
    }
  }
  return out;
}

/** Sum player wins across all rounds of a series. */
function _seriesPlayerWins(group: HistorySeriesGroup): number {
  return group.entries.reduce(
    (sum: number, e: ReplayListEntry) => sum + (e.result === 'player' ? 1 : 0),
    0,
  );
}

/** Sum AI wins across all rounds of a series (any 'ai' result counts). */
function _seriesAiWins(group: HistorySeriesGroup): number {
  return group.entries.reduce(
    (sum: number, e: ReplayListEntry) => sum + (e.result === 'ai' ? 1 : 0),
    0,
  );
}

/** The most-recent (highest timestamp) child's timestamp — used for the head. */
function _seriesMostRecentTimestamp(group: HistorySeriesGroup): number {
  return group.entries.reduce(
    (max: number, e: ReplayListEntry) => (e.timestamp > max ? e.timestamp : max),
    0,
  );
}

/** Declared "length" of the series — derived from children's seriesInfo.length. */
function _seriesLength(group: HistorySeriesGroup): number {
  return group.entries[0]?.seriesInfo?.length ?? group.entries.length;
}

/** True when every round of the series is already favourited. */
function _seriesAllFavourited(group: HistorySeriesGroup): boolean {
  return group.entries.every((e: ReplayListEntry) => e.favorite);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

interface MatchHistoryDeps {
  game: GameInstance;
  navigateTo: (screen: string) => void;
  showScreen: (name: string | null) => void;
  setCurrentScreen: (s: string | null) => void;
}

let _game: GameInstance = null;
let _showScreen: (name: string | null) => void = () => { /* noop until init */ };
let _setCurrentScreen: (s: string | null) => void = () => { /* noop until init */ };
let historyTab: string = 'recent';

export function initMatchHistory(deps: MatchHistoryDeps): void {
  const { game, showScreen, setCurrentScreen } = deps;
  _game = game;
  _showScreen = showScreen;
  _setCurrentScreen = setCurrentScreen;

  // Match history lives inside the stats overlay's #stats-panel-history panel.
  // Wire up the RECENT / FAVORITES pills — scope lookups to the panel so we
  // don't pick up stray .history-tab elements elsewhere in the DOM.
  const panel = document.getElementById('stats-panel-history');
  if (panel) {
    panel.querySelectorAll('.history-tab').forEach((tab: Element) => {
      tab.addEventListener('click', () => {
        playUiTab();
        historyTab = (tab as HTMLElement).dataset.historyTab || 'recent';
        panel.querySelectorAll('.history-tab').forEach((t: Element) => {
          const isActive = t === tab;
          t.classList.toggle('history-tab--active', isActive);
          t.setAttribute('aria-selected', String(isActive));
        });
        renderHistory();
      });
    });
  }

  window.addEventListener(EVT_PLAY_CLOUD_REPLAY, ((e: CustomEvent) => {
    const { frames, entry } = e.detail as { frames: Parameters<typeof decompressFrames>[0]; entry: MatchHistoryEntry };
    const decompressed = decompressFrames(frames);

    // Build a ReplaySnapshot from cloud data.
    // Players[0] is p1; derive player/ai colors and vehicles from metadata.
    const p1 = entry.players[0];
    const p2 = entry.players[1];
    const playerColor: number = p1?.color ?? 0x00ffff;
    const aiColors: ColorEntry[] = p2 ? [{ color: p2.color, emissive: p2.color }] : [];
    const playerVehicle: VehicleType = (p1?.vehicle as VehicleType | undefined) ?? 'bike';
    const aiVehicles: VehicleType[] = p2 ? [(p2.vehicle as VehicleType | undefined) ?? 'bike'] : [];

    const snapshot: ReplaySnapshot = {
      frames: decompressed,
      playerColor,
      playerEmissive: playerColor,
      playerVehicle,
      aiColors,
      aiVehicles,
      duration: entry.duration,
    };

    _game._lastReplaySnapshot = snapshot;
    _game._lastSavedReplayId = null;
    setReplaySourceScreen('profile');
    _showScreen('replay');
    _setCurrentScreen('replay');
    resetReplayUI();
    _game.startReplayFromSnapshot(snapshot).catch(warnDev);
  }) as EventListener);
}

export async function renderHistory(): Promise<void> {
  const list: ReplayListEntry[] = await getReplayList();
  const container: HTMLElement | null = document.getElementById('history-list');
  if (!container) return;
  const emptyEl: HTMLElement | null = document.querySelector('#stats-panel-history .history-empty');
  const filtered: ReplayListEntry[] = historyTab === 'favorites' ? list.filter((e: ReplayListEntry) => e.favorite) : list;
  container.innerHTML = '';
  if (filtered.length === 0) {
    if (emptyEl) {
      emptyEl.textContent = historyTab === 'favorites' ? 'NO FAVORITES YET' : 'NO MATCHES YET';
      emptyEl.removeAttribute('hidden');
    }
    return;
  }
  if (emptyEl) emptyEl.setAttribute('hidden', '');

  // TASK-295: collapse sibling rounds into a single series parent row.
  const groups: HistoryGroup[] = groupHistoryEntries(filtered);
  for (const group of groups) {
    if (group.kind === 'series') {
      container.appendChild(_buildSeriesRow(group));
    } else {
      container.appendChild(_buildHistoryRow(group.entry));
    }
  }
}

function _buildHistoryRow(entry: ReplayListEntry): HTMLDivElement {
  const row: HTMLDivElement = document.createElement('div');
  row.className = 'history-row';
  row.setAttribute('data-replay-id', entry.id);
  if (entry.seriesInfo?.seriesId) row.setAttribute('data-series-id', entry.seriesInfo.seriesId);

  // ── Head (click target for expand/collapse) ──
  const head: HTMLButtonElement = document.createElement('button');
  head.type = 'button';
  head.className = 'history-row-head';

  const chevron: HTMLSpanElement = document.createElement('span');
  chevron.className = 'history-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '\u25B8'; // ▸
  head.appendChild(chevron);

  const result: HTMLSpanElement = document.createElement('span');
  const resultClass = entry.result === 'player' ? 'result-win' : entry.result === 'ai' ? 'result-loss' : 'result-draw';
  result.className = `history-result ${resultClass}`;
  result.textContent = entry.result === 'player' ? 'WIN' : entry.result === 'ai' ? 'LOSS' : 'DRAW';
  head.appendChild(result);

  const mapSpan: HTMLSpanElement = document.createElement('span');
  mapSpan.className = 'history-map';
  mapSpan.textContent = _formatModeName(entry.matchType);
  head.appendChild(mapSpan);

  const playersSpan: HTMLSpanElement = document.createElement('span');
  playersSpan.className = 'history-players';
  const playerCount: number = 1 + Math.max(1, entry.aiColors?.length || 1);
  playersSpan.textContent = `${playerCount} PLAYERS`;
  head.appendChild(playersSpan);

  const timeSpan: HTMLSpanElement = document.createElement('span');
  timeSpan.className = 'history-time';
  timeSpan.textContent = formatRelativeTime(entry.timestamp);
  head.appendChild(timeSpan);

  row.appendChild(head);

  // ── Favourite star (independent click target) ──
  const fav: HTMLButtonElement = document.createElement('button');
  fav.type = 'button';
  fav.className = 'history-fav' + (entry.favorite ? ' history-fav--active' : '');
  fav.setAttribute('aria-label', 'Toggle favourite');
  fav.innerHTML = entry.favorite ? ico('star', 'icon--fill-stroke') : ico('star');
  fav.addEventListener('click', async (e: Event) => {
    e.stopPropagation();
    const isFav: boolean = await toggleFavorite(entry.id);
    fav.classList.toggle('history-fav--active', isFav);
    fav.innerHTML = isFav ? ico('star', 'icon--fill-stroke') : ico('star');
    if (historyTab === 'favorites' && !isFav) renderHistory();
  });
  row.appendChild(fav);

  // ── Expandable details drawer ──
  const details: HTMLDivElement = document.createElement('div');
  details.className = 'history-details';
  details.setAttribute('hidden', '');

  const opponentName: string = entry.opponentName || 'AI';
  const playerWins: number = entry.seriesInfo?.playerWins ?? (entry.result === 'player' ? 1 : 0);
  const maxAiWins: number = entry.seriesInfo && entry.seriesInfo.aiWins.length > 0
    ? Math.max(...entry.seriesInfo.aiWins)
    : (entry.result === 'ai' ? 1 : 0);

  details.appendChild(_buildDetailRow('MODE', _formatModeName(entry.matchType)));
  details.appendChild(_buildDetailRow('DURATION', formatTime(entry.duration)));
  details.appendChild(_buildDetailRow('OPPONENT', opponentName));
  details.appendChild(_buildDetailRow('SCORE', `${playerWins} - ${maxAiWins}`));

  const watchBtn: HTMLButtonElement = document.createElement('button');
  watchBtn.type = 'button';
  watchBtn.className = 'history-watch-btn menu-btn menu-btn--primary';
  watchBtn.textContent = 'WATCH REPLAY';
  watchBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    _watchHistoryReplay(entry.id);
  });
  details.appendChild(watchBtn);

  row.appendChild(details);

  // ── Expand/collapse toggle (head only — fav + watch stop propagation) ──
  head.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const expanded = row.classList.toggle('history-row--expanded');
    if (expanded) details.removeAttribute('hidden');
    else details.setAttribute('hidden', '');
  });

  return row;
}

/**
 * TASK-295: Build a collapsible series parent row. Collapsed form shows a
 * SET pill ("WON 2-1" / "LOST 1-2" / "TIED"), "BEST OF N" label, player
 * count, relative time, and a cascading favourite star. Expanded form
 * reveals each round as a compact `_buildSeriesChildRow`.
 */
function _buildSeriesRow(group: HistorySeriesGroup): HTMLDivElement {
  const row: HTMLDivElement = document.createElement('div');
  row.className = 'history-row history-row--series';
  row.setAttribute('data-series-id', group.seriesId);

  const playerWins: number = _seriesPlayerWins(group);
  const aiWins: number = _seriesAiWins(group);
  const totalRounds: number = _seriesLength(group);
  const mostRecent: number = _seriesMostRecentTimestamp(group);
  const allFav: boolean = _seriesAllFavourited(group);

  // ── Head (click target for expand/collapse) ──
  const head: HTMLButtonElement = document.createElement('button');
  head.type = 'button';
  head.className = 'history-row-head';

  const chevron: HTMLSpanElement = document.createElement('span');
  chevron.className = 'history-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '\u25B8'; // ▸
  head.appendChild(chevron);

  // SET pill — summarises the series outcome using the same palette as
  // the per-match result pill so the history reads consistently.
  const setPill: HTMLSpanElement = document.createElement('span');
  let setLabel: string;
  let setClass: string;
  if (playerWins > aiWins) {
    setLabel = `WON ${playerWins}-${aiWins}`;
    setClass = 'result-win';
  } else if (aiWins > playerWins) {
    setLabel = `LOST ${playerWins}-${aiWins}`;
    setClass = 'result-loss';
  } else {
    setLabel = 'TIED';
    setClass = 'result-draw';
  }
  setPill.className = `history-result history-set-pill ${setClass}`;
  setPill.textContent = setLabel;
  head.appendChild(setPill);

  const bestOfLabel: HTMLSpanElement = document.createElement('span');
  bestOfLabel.className = 'history-best-of';
  bestOfLabel.textContent = `BEST OF ${totalRounds}`;
  head.appendChild(bestOfLabel);

  // Player count — reuse the per-child logic on the first entry. Every
  // round of a series shares the same player set so this is accurate.
  const first: ReplayListEntry | undefined = group.entries[0];
  const playersSpan: HTMLSpanElement = document.createElement('span');
  playersSpan.className = 'history-players';
  const playerCount: number = 1 + Math.max(1, first?.aiColors?.length || 1);
  playersSpan.textContent = `${playerCount} PLAYERS`;
  head.appendChild(playersSpan);

  const timeSpan: HTMLSpanElement = document.createElement('span');
  timeSpan.className = 'history-time';
  timeSpan.textContent = formatRelativeTime(mostRecent);
  head.appendChild(timeSpan);

  row.appendChild(head);

  // ── Favourite star — cascades across every round of the series. ──
  const fav: HTMLButtonElement = document.createElement('button');
  fav.type = 'button';
  fav.className = 'history-fav' + (allFav ? ' history-fav--active' : '');
  fav.setAttribute('aria-label', 'Toggle favourite series');
  fav.innerHTML = allFav ? ico('star', 'icon--fill-stroke') : ico('star');
  fav.addEventListener('click', async (e: Event) => {
    e.stopPropagation();
    const isFav: boolean = await toggleFavoriteSeries(group.seriesId);
    fav.classList.toggle('history-fav--active', isFav);
    fav.innerHTML = isFav ? ico('star', 'icon--fill-stroke') : ico('star');
    // Keep the favourites tab in sync when a series is un-favourited.
    if (historyTab === 'favorites' && !isFav) renderHistory();
  });
  row.appendChild(fav);

  // ── Expandable children drawer ──
  const childrenWrap: HTMLDivElement = document.createElement('div');
  childrenWrap.className = 'history-series-children';
  childrenWrap.setAttribute('hidden', '');
  group.entries.forEach((child: ReplayListEntry, idx: number) => {
    childrenWrap.appendChild(_buildSeriesChildRow(child, idx + 1, totalRounds, group.seriesId));
  });
  row.appendChild(childrenWrap);

  // ── Expand/collapse toggle (head only — fav stops propagation) ──
  head.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const expanded: boolean = row.classList.toggle('history-row--expanded');
    if (expanded) childrenWrap.removeAttribute('hidden');
    else childrenWrap.setAttribute('hidden', '');
  });

  return row;
}

/**
 * TASK-295: Compact child row shown inside an expanded series parent.
 * Layout: MATCH N | RESULT | DURATION | WATCH. Favourite star still
 * visible but toggles the ENTIRE series (favouriting any round favourites
 * the whole best-of).
 */
function _buildSeriesChildRow(
  entry: ReplayListEntry,
  roundIndex: number,
  totalRounds: number,
  seriesId: string,
): HTMLDivElement {
  const row: HTMLDivElement = document.createElement('div');
  row.className = 'history-row history-row--series-child';
  row.setAttribute('data-replay-id', entry.id);
  row.setAttribute('data-series-id', seriesId);

  const matchLabel: HTMLSpanElement = document.createElement('span');
  matchLabel.className = 'history-match-label';
  matchLabel.textContent = `MATCH ${roundIndex}/${totalRounds}`;
  row.appendChild(matchLabel);

  const result: HTMLSpanElement = document.createElement('span');
  const resultClass = entry.result === 'player' ? 'result-win' : entry.result === 'ai' ? 'result-loss' : 'result-draw';
  result.className = `history-result ${resultClass}`;
  result.textContent = entry.result === 'player' ? 'WIN' : entry.result === 'ai' ? 'LOSS' : 'DRAW';
  row.appendChild(result);

  const mapSpan: HTMLSpanElement = document.createElement('span');
  mapSpan.className = 'history-map';
  mapSpan.textContent = _formatModeName(entry.matchType);
  row.appendChild(mapSpan);

  const durationSpan: HTMLSpanElement = document.createElement('span');
  durationSpan.className = 'history-duration';
  durationSpan.textContent = formatTime(entry.duration);
  row.appendChild(durationSpan);

  // Favourite star — cascades to the parent series (per TASK-295 spec:
  // "favouriting any single round of a best-of favourites the whole series").
  const fav: HTMLButtonElement = document.createElement('button');
  fav.type = 'button';
  fav.className = 'history-fav' + (entry.favorite ? ' history-fav--active' : '');
  fav.setAttribute('aria-label', 'Toggle favourite series');
  fav.innerHTML = entry.favorite ? ico('star', 'icon--fill-stroke') : ico('star');
  fav.addEventListener('click', async (e: Event) => {
    e.stopPropagation();
    const isFav: boolean = await toggleFavoriteSeries(seriesId);
    // Re-render so every sibling child row + the parent star update together.
    fav.classList.toggle('history-fav--active', isFav);
    fav.innerHTML = isFav ? ico('star', 'icon--fill-stroke') : ico('star');
    await renderHistory();
  });
  row.appendChild(fav);

  const watchBtn: HTMLButtonElement = document.createElement('button');
  watchBtn.type = 'button';
  watchBtn.className = 'history-watch-btn menu-btn menu-btn--primary';
  watchBtn.textContent = 'WATCH';
  watchBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    _watchHistoryReplay(entry.id);
  });
  row.appendChild(watchBtn);

  return row;
}

function _buildDetailRow(label: string, value: string): HTMLDivElement {
  const wrap: HTMLDivElement = document.createElement('div');
  wrap.className = 'history-detail-row';
  const l: HTMLSpanElement = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  const v: HTMLSpanElement = document.createElement('span');
  v.className = 'value';
  v.textContent = value;
  wrap.appendChild(l);
  wrap.appendChild(v);
  return wrap;
}

function _formatModeName(matchType: string): string {
  if (matchType === 'casual') return 'CASUAL';
  return 'AI';
}

async function _watchHistoryReplay(id: string): Promise<void> {
  const entry: LoadedReplayEntry | null = await loadReplay(id);
  if (!entry) return;
  const snapshot: ReplaySnapshot = { frames: entry.frames, playerColor: entry.playerColor, playerEmissive: entry.playerEmissive, playerVehicle: entry.playerVehicle || 'bike', aiColors: entry.aiColors, aiVehicles: entry.aiVehicles || [], duration: entry.duration };
  _game._lastSavedReplayId = id;
  _game._lastReplaySnapshot = snapshot;
  setReplaySourceScreen('history');
  _showScreen('replay');
  _setCurrentScreen('replay');
  resetReplayUI();
  await _game.startReplayFromSnapshot(snapshot);
}

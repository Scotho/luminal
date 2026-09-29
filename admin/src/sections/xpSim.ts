// ── XP Progression Simulator ────────────────────────────────
// Admin panel for testing the 15-level progression system.
// Mirrors XP thresholds and match formula from src/progression/xpConfig.ts.

interface SimXpState {
  level: number;
  totalXp: number;
  unlockedItems: string[];
  tokensUsed: Record<number, string>;
  matchesPlayed: number;
  wins: number;
  currentStreak: number;
  history: Array<{
    match: number;
    won: boolean;
    xpAwarded: number;
    levelBefore: number;
    levelAfter: number;
    unlocks: string[];
  }>;
}

// XP Config (mirrored from src/progression/xpConfig.ts)
const XP_THRESHOLDS = [0, 100, 250, 500, 850, 1300, 1850, 2500, 3300, 4200, 5300, 6600, 8100, 9800, 11700];
const MAX_LEVEL = 15;
const XP_BASE = 80;
const XP_WIN_BONUS = 40;
const XP_STREAK_MULT = 10;
const XP_STREAK_CAP = 50;
const XP_SERIES_MULT = 20;

// Level Unlock Labels
const LEVEL_UNLOCK_LABELS: Record<number, string[]> = {
  1: ['SPECTRE', 'MIDTOWN BOWL', 'Red', 'Cyan'],
  2: ['SYNTH PIT', 'Blue'],
  3: ['Green'],
  4: ['VECTOR'],
  5: ['HOLO DOME', 'Pink'],
  6: ['[TOKEN #1]'],
  7: ['Lime'],
  8: ['SLINGSHOT (safety)'],
  9: ['[TOKEN #2]'],
  10: ['SYNTH CITY (safety)'],
  11: ['White'],
  12: ['Enhanced Glow'],
  13: ['Pulse Effect'],
  14: ['Overdrive'],
  15: ['Luminal Radiance'],
};

function getLevelFromXp(totalXp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (totalXp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

function calcMatchXp(won: boolean, streak: number, seriesLength: number): number {
  return XP_BASE + (won ? XP_WIN_BONUS : 0) + Math.min(streak * XP_STREAK_MULT, XP_STREAK_CAP) + XP_SERIES_MULT * (seriesLength - 1);
}

function xpProgressPercent(level: number, totalXp: number): number {
  if (level >= MAX_LEVEL) return 100;
  const current = XP_THRESHOLDS[level - 1];
  const next = XP_THRESHOLDS[level];
  return Math.min(100, Math.round(((totalXp - current) / (next - current)) * 100));
}

export function renderXpSim(container: HTMLElement): void {
  const state: SimXpState = {
    level: 1, totalXp: 0, unlockedItems: [],
    tokensUsed: {}, matchesPlayed: 0, wins: 0,
    currentStreak: 0, history: [],
  };
  let seriesLength = 1;

  function simMatch(won: boolean): void {
    const levelBefore = state.level;
    const xp = calcMatchXp(won, state.currentStreak, seriesLength);
    state.totalXp += xp;
    state.level = getLevelFromXp(state.totalXp);
    state.matchesPlayed++;
    if (won) { state.wins++; state.currentStreak++; } else { state.currentStreak = 0; }
    const unlocks: string[] = [];
    for (let lvl = levelBefore + 1; lvl <= state.level; lvl++) {
      const labels = LEVEL_UNLOCK_LABELS[lvl] || [];
      unlocks.push(...labels);
      state.unlockedItems.push(...labels);
    }
    state.history.push({ match: state.matchesPlayed, won, xpAwarded: xp, levelBefore, levelAfter: state.level, unlocks });
    render();
  }

  function render(): void {
    const pct = xpProgressPercent(state.level, state.totalXp);
    const toNext = state.level < MAX_LEVEL ? XP_THRESHOLDS[state.level] - state.totalXp : 0;
    const winRate = state.matchesPlayed > 0 ? Math.round((state.wins / state.matchesPlayed) * 100) : 0;

    const estimates: string[] = [];
    if (state.level < MAX_LEVEL) {
      const avgXp = state.matchesPlayed > 0
        ? state.totalXp / state.matchesPlayed
        : calcMatchXp(true, 1, seriesLength) * 0.55 + calcMatchXp(false, 0, seriesLength) * 0.45;
      for (const targetLvl of [5, 10, 15]) {
        if (state.level >= targetLvl) continue;
        const xpNeeded = XP_THRESHOLDS[targetLvl - 1] - state.totalXp;
        estimates.push(`L${targetLvl}: ~${Math.ceil(xpNeeded / avgXp)} matches`);
      }
    }

    container.innerHTML = `
      <div class="section-header" style="margin-bottom:16px">
        <h2>XP Progression Simulator</h2>
        <span style="font-size:12px;color:var(--text-dim)">Test the 15-level unlock system with simulated matches</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Player Status</div>
          <div style="font-size:28px;font-weight:700;margin-bottom:4px;color:#00e5ff">Level ${state.level}</div>
          <div style="font-size:13px;color:var(--text-dim);margin-bottom:12px">${state.totalXp} XP total | ${state.matchesPlayed} matches | ${winRate}% WR | Streak: ${state.currentStreak}</div>
          <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:10px;overflow:hidden;margin-bottom:4px">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#00e5ff,#76ff03);border-radius:4px;transition:width 0.3s"></div>
          </div>
          <div style="font-size:10px;color:var(--text-dim)">${state.level < MAX_LEVEL ? `${toNext} XP to Level ${state.level + 1} (${pct}%)` : 'MAX LEVEL'}</div>
          ${estimates.length > 0 ? `<div style="font-size:10px;color:var(--text-dim);margin-top:8px">${estimates.join(' | ')}</div>` : ''}
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Simulate Match</div>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="admin-btn" id="xp-win" style="flex:1;background:#065f46;border-color:#10b981">WIN</button>
            <button class="admin-btn" id="xp-loss" style="flex:1;background:#7f1d1d;border-color:#ef4444">LOSS</button>
            <button class="admin-btn" id="xp-random" style="flex:1">RANDOM</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <button class="admin-btn admin-btn--small" id="xp-sim10">Sim 10</button>
            <button class="admin-btn admin-btn--small" id="xp-sim50">Sim 50</button>
            <button class="admin-btn admin-btn--small" id="xp-sim100">Sim 100</button>
            <button class="admin-btn admin-btn--small" id="xp-reset" style="margin-left:auto">Reset</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <label style="font-size:11px;color:var(--text-dim)">Series:</label>
            <select id="xp-series" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:2px 6px;border-radius:4px;font-size:11px">
              <option value="1"${seriesLength === 1 ? ' selected' : ''}>BO1</option>
              <option value="3"${seriesLength === 3 ? ' selected' : ''}>BO3</option>
              <option value="5"${seriesLength === 5 ? ' selected' : ''}>BO5</option>
            </select>
            <span style="font-size:10px;color:var(--text-dim);margin-left:8px">Win XP: ${calcMatchXp(true, state.currentStreak, seriesLength)} | Loss XP: ${calcMatchXp(false, 0, seriesLength)}</span>
          </div>
        </div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Unlock Timeline</div>
        <div style="display:flex;gap:2px;align-items:end;height:60px">
          ${Array.from({ length: 15 }, (_, i) => {
            const lvl = i + 1;
            const reached = state.level >= lvl;
            const unlocks = LEVEL_UNLOCK_LABELS[lvl] || [];
            const barH = Math.max(10, (unlocks.length / 4) * 60);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px" title="L${lvl}: ${unlocks.join(', ') || 'none'}">
              <div style="width:100%;height:${barH}px;background:${reached ? '#00e5ff' : 'rgba(255,255,255,0.08)'};border-radius:2px;transition:background 0.3s"></div>
              <span style="font-size:8px;color:${reached ? '#00e5ff' : 'var(--text-dim)'}">${lvl}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Unlocked (${state.unlockedItems.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${state.unlockedItems.length === 0
            ? '<span style="color:var(--text-dim);font-size:11px">None yet</span>'
            : state.unlockedItems.map(item =>
              `<span style="background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.3);border-radius:4px;padding:2px 8px;font-size:11px;color:#00e5ff">${item}</span>`
            ).join('')}
        </div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Match History (${state.history.length})</div>
        <div style="max-height:250px;overflow-y:auto;font-size:11px;font-family:monospace">
          ${state.history.length === 0 ? '<div style="color:var(--text-dim)">No matches yet</div>' : ''}
          ${[...state.history].reverse().slice(0, 50).map(h => {
            const color = h.won ? '#4ade80' : '#f87171';
            const lvlChange = h.levelAfter > h.levelBefore ? ` &rarr; <strong style="color:#00e5ff">L${h.levelAfter}</strong>` : '';
            const unlockText = h.unlocks.length > 0 ? ` [${h.unlocks.join(', ')}]` : '';
            return `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
              <span style="width:28px;color:var(--text-dim)">#${h.match}</span>
              <span style="width:32px;color:${color};font-weight:700">${h.won ? 'WIN' : 'LOSS'}</span>
              <span style="width:60px">+${h.xpAwarded} XP</span>
              <span style="width:50px">L${h.levelBefore}${lvlChange}</span>
              <span style="flex:1;color:#76ff03;font-size:10px">${unlockText}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;

    container.querySelector('#xp-win')?.addEventListener('click', () => simMatch(true));
    container.querySelector('#xp-loss')?.addEventListener('click', () => simMatch(false));
    container.querySelector('#xp-random')?.addEventListener('click', () => simMatch(Math.random() > 0.45));
    container.querySelector('#xp-sim10')?.addEventListener('click', () => { for (let i = 0; i < 10; i++) simMatch(Math.random() > 0.45); });
    container.querySelector('#xp-sim50')?.addEventListener('click', () => { for (let i = 0; i < 50; i++) simMatch(Math.random() > 0.45); });
    container.querySelector('#xp-sim100')?.addEventListener('click', () => { for (let i = 0; i < 100; i++) simMatch(Math.random() > 0.45); });
    container.querySelector('#xp-series')?.addEventListener('change', (e) => {
      seriesLength = parseInt((e.target as HTMLSelectElement).value);
      render();
    });
    container.querySelector('#xp-reset')?.addEventListener('click', () => {
      state.level = 1; state.totalXp = 0; state.unlockedItems = [];
      state.tokensUsed = {}; state.matchesPlayed = 0; state.wins = 0;
      state.currentStreak = 0; state.history = [];
      render();
    });
  }
  render();
}

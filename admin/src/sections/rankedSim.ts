// ── Ranked Simulator ─────────────────────────────────────
// Admin panel for testing ranked MMR flow with simulated opponents.
// Runs the full Elo + LP + promotion/demotion pipeline client-side.

interface SimRank {
  tier: string;
  division: number;
  lp: number;
}

interface SimPlayer {
  name: string;
  mmr: number;
  rank: SimRank;
  wins: number;
  losses: number;
  gamesPlayed: number;
  placementComplete: boolean;
  demotionShield: boolean;
  history: Array<{ opponent: string; oppMmr: number; result: 'W' | 'L'; mmrDelta: number; lpBefore: number; lpAfter: number; rankBefore: string; rankAfter: string }>;
}

// ── Elo math (mirrored from src/ranked/mmr.ts) ─────────

function eloExpected(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

function kFactor(mmr: number, games: number): number {
  if (games < 5) return 64;
  if (mmr >= 2400) return 16;
  if (mmr >= 2000) return 24;
  return 32;
}

// ── Rank math (mirrored from src/ranked/ranks.ts) ───────

const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'luminal'];
const TIER_COLORS: Record<string, string> = {
  bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700',
  platinum: '#00CED1', diamond: '#B9F2FF', master: '#9B59B6', luminal: '#FF00FF',
};
const TIER_RANGES: Record<string, [number, number]> = {
  bronze: [0, 799], silver: [800, 1199], gold: [1200, 1599],
  platinum: [1600, 1999], diamond: [2000, 2399],
};
const DIV_NAMES: Record<number, string> = { 4: 'IV', 3: 'III', 2: 'II', 1: 'I' };

function rankName(r: SimRank): string {
  const t = r.tier.charAt(0).toUpperCase() + r.tier.slice(1);
  if (r.tier === 'master' || r.tier === 'luminal') return `${t} ${r.lp}LP`;
  return `${t} ${DIV_NAMES[r.division]} ${r.lp}LP`;
}

function midpointMmr(tier: string, div: number): number {
  if (tier === 'master' || tier === 'luminal') return 2600;
  const [min, max] = TIER_RANGES[tier] || [0, 799];
  const span = (max - min + 1) / 4;
  return Math.round(min + span * (4 - div) + span / 2);
}

function lpChange(mmr: number, tier: string, div: number, isWin: boolean): number {
  const mid = midpointMmr(tier, div);
  const adj = Math.max(-10, Math.min(10, Math.round((mmr - mid) / 20)));
  return isWin ? 25 + adj : 25 - adj;
}

function rankFromMmr(mmr: number): SimRank {
  if (mmr >= 1600) return { tier: 'platinum', division: 4, lp: 50 };
  if (mmr >= 1400) return { tier: 'gold', division: 2, lp: 50 };
  if (mmr >= 1200) return { tier: 'gold', division: 4, lp: 50 };
  if (mmr >= 1000) return { tier: 'silver', division: 3, lp: 50 };
  if (mmr >= 800) return { tier: 'silver', division: 4, lp: 50 };
  if (mmr >= 600) return { tier: 'bronze', division: 1, lp: 50 };
  if (mmr >= 400) return { tier: 'bronze', division: 2, lp: 50 };
  if (mmr >= 200) return { tier: 'bronze', division: 3, lp: 50 };
  return { tier: 'bronze', division: 4, lp: 50 };
}

function applyLp(player: SimPlayer, delta: number): void {
  const { tier, division } = player.rank;
  if (tier === 'master' || tier === 'luminal') {
    player.rank.lp = Math.max(0, player.rank.lp + delta);
    return;
  }
  const newLp = player.rank.lp + delta;
  if (newLp >= 100) {
    const carry = newLp - 100;
    if (division > 1) {
      player.rank.division = division - 1;
    } else {
      const idx = TIERS.indexOf(tier);
      const next = idx < TIERS.length - 2 ? TIERS[idx + 1] : 'master';
      player.rank.tier = next;
      player.rank.division = (next === 'master' || next === 'luminal') ? 1 : 4;
    }
    player.rank.lp = Math.min(carry, 99);
    player.demotionShield = true;
  } else if (newLp < 0) {
    if (tier === 'bronze' && division === 4) { player.rank.lp = 0; return; }
    if (player.demotionShield) { player.rank.lp = 0; player.demotionShield = false; return; }
    const tierFloor = (TIER_RANGES[tier] || [0])[0];
    if (division === 4 && player.mmr >= tierFloor) {
      player.rank.lp = 0; player.demotionShield = true; return;
    }
    if (division === 4) {
      const idx = TIERS.indexOf(tier);
      if (idx > 0) { player.rank.tier = TIERS[idx - 1]; player.rank.division = 1; }
    } else {
      player.rank.division = division + 1;
    }
    player.rank.lp = 75;
    player.demotionShield = true;
  } else {
    player.rank.lp = newLp;
  }
}

// ── Queue Expansion Display ─────────────────────────────

const QUEUE_TIERS = [
  { maxAge: 30, range: 50, label: '0-30s: ±50 MMR' },
  { maxAge: 60, range: 100, label: '30s-1m: ±100 MMR' },
  { maxAge: 120, range: 200, label: '1-2m: ±200 MMR' },
  { maxAge: 180, range: 300, label: '2-3m: ±300 MMR' },
  { maxAge: 300, range: 500, label: '3-5m: ±500 MMR' },
  { maxAge: 600, range: 800, label: '5-10m: ±800 MMR' },
  { maxAge: 900, range: Infinity, label: '10-15m: Anyone' },
];

// ── Sim Engine ──────────────────────────────────────────

function generateOpponent(playerMmr: number): { name: string; mmr: number } {
  // Generate opponent near the player's MMR with some variance
  const variance = (Math.random() - 0.5) * 400; // ±200 MMR
  const oppMmr = Math.max(0, Math.round(playerMmr + variance));
  const names = ['Nexus', 'Phantom', 'Blitz', 'Cascade', 'Vortex', 'Prism', 'Echo', 'Neon', 'Flux', 'Bolt',
    'Drift', 'Pulse', 'Strafe', 'Glitch', 'Byte', 'Cipher', 'Vector', 'Nova', 'Spark', 'Trace'];
  return { name: names[Math.floor(Math.random() * names.length)], mmr: oppMmr };
}

function simMatch(player: SimPlayer, oppMmr: number, oppName: string, win: boolean): void {
  const lpBefore = player.rank.lp;
  const rankBefore = rankName(player.rank);
  const prevMmr = player.mmr;

  const eW = eloExpected(player.mmr, oppMmr);
  const k = kFactor(player.mmr, player.gamesPlayed);
  const score = win ? 1 : 0;
  player.mmr = Math.max(0, Math.round(player.mmr + k * (score - eW)));

  if (win) player.wins++; else player.losses++;
  player.gamesPlayed++;

  if (!player.placementComplete && player.gamesPlayed >= 5) {
    player.placementComplete = true;
    player.rank = rankFromMmr(player.mmr);
    player.demotionShield = true;
  }

  if (player.placementComplete) {
    const lp = lpChange(player.mmr, player.rank.tier, player.rank.division, win);
    applyLp(player, win ? lp : -lp);
  }

  player.history.push({
    opponent: oppName, oppMmr, result: win ? 'W' : 'L',
    mmrDelta: player.mmr - prevMmr,
    lpBefore, lpAfter: player.rank.lp,
    rankBefore, rankAfter: rankName(player.rank),
  });
}

// ── Render ──────────────────────────────────────────────

export function renderRankedSim(container: HTMLElement): void {
  const player: SimPlayer = {
    name: 'You', mmr: 1000,
    rank: { tier: 'bronze', division: 4, lp: 0 },
    wins: 0, losses: 0, gamesPlayed: 0,
    placementComplete: false, demotionShield: false, history: [],
  };

  function render(): void {
    const tierColor = TIER_COLORS[player.rank.tier] || '#fff';
    const placementText = player.placementComplete
      ? `<span style="color:${tierColor};font-weight:700">${rankName(player.rank)}</span>`
      : `Placement ${player.gamesPlayed}/5`;

    container.innerHTML = `
      <div class="section-header" style="margin-bottom:16px">
        <h2>Ranked Simulator</h2>
        <span style="font-size:12px;color:var(--text-dim)">Test MMR flow with simulated opponents</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <!-- Player Card -->
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Your Stats</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:4px">${placementText}</div>
          <div style="font-size:13px;color:var(--text-dim);margin-bottom:12px">MMR: <strong>${player.mmr}</strong> &nbsp; ${player.wins}W ${player.losses}L</div>
          ${player.placementComplete ? `
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:8px;overflow:hidden;margin-bottom:4px">
              <div style="height:100%;width:${player.rank.tier === 'master' || player.rank.tier === 'luminal' ? 50 : player.rank.lp}%;background:${tierColor};border-radius:4px;transition:width 0.3s"></div>
            </div>
            <div style="font-size:10px;color:var(--text-dim)">
              ${player.rank.lp}/100 LP &nbsp;
              ${player.demotionShield ? '🛡️ Shield' : ''}
            </div>
          ` : ''}
        </div>

        <!-- Controls -->
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Simulate Match</div>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="btn" id="rs-win" style="flex:1;background:#065f46;border-color:#10b981">WIN</button>
            <button class="btn" id="rs-loss" style="flex:1;background:#7f1d1d;border-color:#ef4444">LOSS</button>
            <button class="btn" id="rs-random" style="flex:1">RANDOM</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <button class="btn btn--sm" id="rs-sim10">Sim 10</button>
            <button class="btn btn--sm" id="rs-sim50">Sim 50</button>
            <button class="btn btn--sm" id="rs-reset" style="margin-left:auto">Reset</button>
          </div>
          <div style="font-size:10px;color:var(--text-dim)">
            K-factor: ${kFactor(player.mmr, player.gamesPlayed)} &nbsp;|&nbsp;
            Win prob vs equal: ${(eloExpected(player.mmr, player.mmr) * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      <!-- Queue Expansion Visualization -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Queue Expansion (MMR ${player.mmr})</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${QUEUE_TIERS.map(t => {
            const lo = t.range === Infinity ? 0 : Math.max(0, player.mmr - t.range);
            const hi = t.range === Infinity ? '∞' : player.mmr + t.range;
            const pct = t.range === Infinity ? 100 : Math.min(100, (t.range * 2) / 40);
            return `<div style="display:flex;align-items:center;gap:8px;font-size:11px">
              <span style="width:110px;color:var(--text-dim)">${t.label}</span>
              <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${tierColor};opacity:0.6;border-radius:3px"></div>
              </div>
              <span style="width:80px;text-align:right;color:var(--text-dim)">${lo} - ${hi}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Match History -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px">Match History (${player.history.length} games)</div>
        <div style="max-height:300px;overflow-y:auto;font-size:11px;font-family:monospace">
          ${player.history.length === 0 ? '<div style="color:var(--text-dim)">No matches yet</div>' : ''}
          ${[...player.history].reverse().map((h, i) => {
            const color = h.result === 'W' ? '#4ade80' : '#f87171';
            const delta = h.mmrDelta >= 0 ? `+${h.mmrDelta}` : `${h.mmrDelta}`;
            return `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
              <span style="width:24px;color:var(--text-dim)">#${player.history.length - i}</span>
              <span style="width:20px;color:${color};font-weight:700">${h.result}</span>
              <span style="width:100px">vs ${h.opponent} (${h.oppMmr})</span>
              <span style="width:55px;color:${color}">${delta} MMR</span>
              <span style="width:60px">${h.lpBefore}→${h.lpAfter} LP</span>
              <span style="flex:1;color:var(--text-dim)">${h.rankBefore !== h.rankAfter ? `${h.rankBefore} → ${h.rankAfter}` : h.rankAfter}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;

    // Wire buttons
    const doMatch = (win: boolean) => {
      const opp = generateOpponent(player.mmr);
      simMatch(player, opp.mmr, opp.name, win);
      render();
    };

    container.querySelector('#rs-win')?.addEventListener('click', () => doMatch(true));
    container.querySelector('#rs-loss')?.addEventListener('click', () => doMatch(false));
    container.querySelector('#rs-random')?.addEventListener('click', () => doMatch(Math.random() > 0.45)); // slight win bias

    container.querySelector('#rs-sim10')?.addEventListener('click', () => {
      for (let i = 0; i < 10; i++) doMatch(Math.random() > 0.45);
    });
    container.querySelector('#rs-sim50')?.addEventListener('click', () => {
      for (let i = 0; i < 50; i++) doMatch(Math.random() > 0.45);
    });

    container.querySelector('#rs-reset')?.addEventListener('click', () => {
      player.mmr = 1000;
      player.rank = { tier: 'bronze', division: 4, lp: 0 };
      player.wins = 0; player.losses = 0; player.gamesPlayed = 0;
      player.placementComplete = false; player.demotionShield = false;
      player.history = [];
      render();
    });
  }

  render();
}

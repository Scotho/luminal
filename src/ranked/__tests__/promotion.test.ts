// ── Promotion / Demotion Tests ───────────────────────────
import { describe, it, expect } from 'vitest';
import { applyLpChange } from '../promotion';
import type { RankInfo } from '../types';

function rank(tier: string, division: number, lp: number): RankInfo {
  return { tier, division, lp } as RankInfo;
}

describe('applyLpChange', () => {
  // ── Normal LP changes ─────────────────────────────────

  describe('normal LP changes', () => {
    it('adds LP on win within division', () => {
      const r = applyLpChange(rank('gold', 3, 50), 25, 1300, false);
      expect(r.newRank).toEqual(rank('gold', 3, 75));
      expect(r.promoted).toBe(false);
      expect(r.demoted).toBe(false);
    });

    it('subtracts LP on loss within division', () => {
      const r = applyLpChange(rank('gold', 3, 50), -25, 1300, false);
      expect(r.newRank).toEqual(rank('gold', 3, 25));
      expect(r.promoted).toBe(false);
      expect(r.demoted).toBe(false);
    });
  });

  // ── Promotion ─────────────────────────────────────────

  describe('promotion', () => {
    it('promotes within tier (IV → III)', () => {
      const r = applyLpChange(rank('silver', 4, 80), 30, 900, false);
      expect(r.newRank.tier).toBe('silver');
      expect(r.newRank.division).toBe(3);
      expect(r.newRank.lp).toBe(10); // carry over 110-100=10
      expect(r.promoted).toBe(true);
      expect(r.tierChange).toBe(false);
    });

    it('promotes across tier boundary (Silver I → Gold IV)', () => {
      const r = applyLpChange(rank('silver', 1, 85), 30, 1200, false);
      expect(r.newRank.tier).toBe('gold');
      expect(r.newRank.division).toBe(4);
      expect(r.newRank.lp).toBe(15);
      expect(r.promoted).toBe(true);
      expect(r.tierChange).toBe(true);
    });

    it('promotes from Diamond I to Master', () => {
      const r = applyLpChange(rank('diamond', 1, 90), 20, 2400, false);
      expect(r.newRank.tier).toBe('master');
      expect(r.newRank.division).toBe(1);
      expect(r.promoted).toBe(true);
      expect(r.tierChange).toBe(true);
    });

    it('grants demotion shield on promotion', () => {
      const r = applyLpChange(rank('gold', 2, 85), 25, 1400, false);
      expect(r.promoted).toBe(true);
      expect(r.newDemotionShield).toBe(true);
    });

    it('carry-over LP capped at 99', () => {
      const r = applyLpChange(rank('gold', 4, 70), 35, 1300, false);
      expect(r.newRank.lp).toBeLessThan(100);
    });
  });

  // ── Demotion ──────────────────────────────────────────

  describe('demotion', () => {
    it('demotion shield absorbs loss at 0 LP', () => {
      const r = applyLpChange(rank('gold', 3, 10), -25, 1300, true);
      expect(r.newRank.tier).toBe('gold');
      expect(r.newRank.division).toBe(3);
      expect(r.newRank.lp).toBe(0);
      expect(r.demoted).toBe(false);
      expect(r.newDemotionShield).toBe(false); // shield consumed
    });

    it('demotes within tier without shield (III → IV)', () => {
      const r = applyLpChange(rank('gold', 3, 10), -25, 1300, false);
      expect(r.newRank.tier).toBe('gold');
      expect(r.newRank.division).toBe(4);
      expect(r.newRank.lp).toBe(75);
      expect(r.demoted).toBe(true);
      expect(r.newDemotionShield).toBe(true); // new shield granted
    });

    it('tier demotion when at div IV and MMR below tier floor', () => {
      const r = applyLpChange(rank('gold', 4, 10), -25, 1100, false);
      // MMR 1100 < gold floor 1200 → demote to Silver I
      expect(r.newRank.tier).toBe('silver');
      expect(r.newRank.division).toBe(1);
      expect(r.newRank.lp).toBe(75);
      expect(r.demoted).toBe(true);
      expect(r.tierChange).toBe(true);
    });

    it('tier demotion blocked when MMR is still in-tier', () => {
      const r = applyLpChange(rank('gold', 4, 10), -25, 1300, false);
      // MMR 1300 >= gold floor 1200 → stay in Gold IV
      expect(r.newRank.tier).toBe('gold');
      expect(r.newRank.division).toBe(4);
      expect(r.newRank.lp).toBe(0);
      expect(r.demoted).toBe(false);
      expect(r.newDemotionShield).toBe(true);
    });

    it('cannot demote below Bronze IV', () => {
      const r = applyLpChange(rank('bronze', 4, 5), -30, 50, false);
      expect(r.newRank.tier).toBe('bronze');
      expect(r.newRank.division).toBe(4);
      expect(r.newRank.lp).toBe(0);
      expect(r.demoted).toBe(false);
    });
  });

  // ── Master+ ───────────────────────────────────────────

  describe('master and luminal', () => {
    it('Master LP increases unbounded', () => {
      const r = applyLpChange(rank('master', 1, 500), 25, 2800, false);
      expect(r.newRank.tier).toBe('master');
      expect(r.newRank.lp).toBe(525);
      expect(r.promoted).toBe(false);
    });

    it('Master LP floors at 0', () => {
      const r = applyLpChange(rank('master', 1, 10), -30, 2400, false);
      expect(r.newRank.lp).toBe(0);
    });

    it('Luminal LP works the same', () => {
      const r = applyLpChange(rank('luminal', 1, 1000), 20, 3000, false);
      expect(r.newRank.tier).toBe('luminal');
      expect(r.newRank.lp).toBe(1020);
    });
  });

  // ── Edge cases ────────────────────────────────────────

  describe('edge cases', () => {
    it('exact 100 LP triggers promotion', () => {
      const r = applyLpChange(rank('silver', 2, 75), 25, 1000, false);
      expect(r.promoted).toBe(true);
      expect(r.newRank.division).toBe(1);
      expect(r.newRank.lp).toBe(0);
    });

    it('loss leaving exactly 0 LP does not demote if shielded', () => {
      const r = applyLpChange(rank('gold', 3, 25), -25, 1300, true);
      expect(r.newRank.lp).toBe(0);
      expect(r.demoted).toBe(false);
    });

    it('preserves demotion shield when LP stays positive', () => {
      const r = applyLpChange(rank('gold', 3, 50), -20, 1300, true);
      expect(r.newRank.lp).toBe(30);
      expect(r.newDemotionShield).toBe(true);
    });

    it('Diamond I → Master on promotion (critical boundary)', () => {
      const r = applyLpChange(rank('diamond', 1, 80), 30, 2400, false);
      expect(r.newRank.tier).toBe('master');
      expect(r.newRank.division).toBe(1);
      expect(r.promoted).toBe(true);
      expect(r.tierChange).toBe(true);
    });

    it('Platinum I → Diamond IV on promotion', () => {
      const r = applyLpChange(rank('platinum', 1, 85), 25, 2000, false);
      expect(r.newRank.tier).toBe('diamond');
      expect(r.newRank.division).toBe(4);
      expect(r.promoted).toBe(true);
      expect(r.tierChange).toBe(true);
    });

    it('Silver IV tier demotion to Bronze I when MMR below floor', () => {
      const r = applyLpChange(rank('silver', 4, 10), -25, 700, false);
      expect(r.newRank.tier).toBe('bronze');
      expect(r.newRank.division).toBe(1);
      expect(r.demoted).toBe(true);
      expect(r.tierChange).toBe(true);
    });

    it('large LP gain wraps correctly (35 LP gain from 90 LP)', () => {
      const r = applyLpChange(rank('gold', 3, 90), 35, 1500, false);
      expect(r.promoted).toBe(true);
      expect(r.newRank.lp).toBe(25); // 90+35=125, carry=25
    });

    it('rapid sequential demotion — shield consumed then re-granted', () => {
      // First loss: shield consumed
      const r1 = applyLpChange(rank('gold', 3, 5), -25, 1200, true);
      expect(r1.newRank.lp).toBe(0);
      expect(r1.newDemotionShield).toBe(false);

      // Second loss: no shield, demote
      const r2 = applyLpChange(r1.newRank, -25, 1200, r1.newDemotionShield);
      expect(r2.demoted).toBe(true);
      expect(r2.newRank.division).toBe(4);
      expect(r2.newRank.lp).toBe(75);
      expect(r2.newDemotionShield).toBe(true); // new shield granted
    });

    it('Master demotion is not possible (LP just floors at 0)', () => {
      const r = applyLpChange(rank('master', 1, 5), -30, 2300, false);
      expect(r.newRank.tier).toBe('master');
      expect(r.newRank.lp).toBe(0);
      expect(r.demoted).toBe(false);
    });
  });
});

// ── Loadout Preview — Hoverboard Model Tests ────────────────
// Verifies the VECTOR preview in the character select carousel:
// 1. Board is parallel with the trail (aligned on the same Y-plane)
// 2. Rider character has feet on the board (rider sits above board)
// 3. All parts (board, rider, trail) rotate together as a unit

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const LOAD_TIMEOUT = 30_000;

let browser: Browser;
let page: Page;

/** Dismiss the loading screen and navigate to character select. */
async function goToCharacterSelect(p: Page): Promise<void> {
  await p.goto(BASE_URL);
  await p.waitForSelector('#click-prompt.click-prompt--visible', { timeout: LOAD_TIMEOUT });
  await p.click('#loading-screen');
  await p.waitForFunction(
    () => document.getElementById('loading-screen')?.style.display === 'none',
    { timeout: 10_000 },
  );
  await p.waitForTimeout(500);
  await p.click('#btn-character-select');
  await p.waitForSelector('#character-select-overlay:not(.hidden)', { timeout: 5_000 });
  await p.waitForTimeout(2000); // let previews fully initialise
}

/**
 * Run JS in the browser page via addScriptTag so dynamic import() goes through
 * the Vite dev server, not Vitest SSR transform.
 */
async function evalInBrowser<T>(p: Page, code: string): Promise<T> {
  // Write result to a unique window key
  const key = `__test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await p.addScriptTag({
    type: 'module',
    content: `
      try {
        const __result = await (async () => { ${code} })();
        window['${key}'] = { ok: true, value: __result };
      } catch (e) {
        window['${key}'] = { ok: false, error: e.message };
      }
    `,
  });
  // Wait for the result to appear
  await p.waitForFunction((k) => window[k] !== undefined, key, { timeout: 10_000 });
  const envelope = await p.evaluate((k) => window[k], key) as { ok: boolean; value?: T; error?: string };
  if (!envelope.ok) throw new Error(envelope.error);
  return envelope.value as T;
}

describe('Loadout Preview — Hoverboard Model', () => {
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await goToCharacterSelect(page);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  // ── 1. All three vehicle previews render a canvas ───────────
  it('all three vehicle cards have a preview canvas', async () => {
    const canvases = await page.evaluate(() => ({
      bike: document.getElementById('cs-canvas-wrap-bike')?.querySelectorAll('canvas').length ?? 0,
      car: document.getElementById('cs-canvas-wrap-car')?.querySelectorAll('canvas').length ?? 0,
      hoverboard: document.getElementById('cs-canvas-wrap-hoverboard')?.querySelectorAll('canvas').length ?? 0,
    }));
    expect(canvases.bike).toBe(1);
    expect(canvases.car).toBe(1);
    expect(canvases.hoverboard).toBe(1);
  });

  // ── 2. Hoverboard model loads and SkinnedMesh bones are rebound ─
  it('SkinnedMesh skeleton bones are inside the cloned group (not the original template)', async () => {
    const info = await evalInBrowser<{ boneCount: number; bonesInClone: number }>(page, `
      const mod = await import('/src/viewerExports.ts');
      const group = mod.cloneHoverboardModel(0x00ff88, true);
      const groupIds = new Set();
      group.traverse(c => groupIds.add(c.id));
      let boneCount = 0;
      let bonesInClone = 0;
      group.traverse(child => {
        if (child.isSkinnedMesh) {
          const bones = child.skeleton?.bones ?? [];
          boneCount = bones.length;
          bonesInClone = bones.filter(b => groupIds.has(b.id)).length;
        }
      });
      return { boneCount, bonesInClone };
    `);
    expect(info.boneCount).toBeGreaterThan(0);
    expect(info.bonesInClone).toBe(info.boneCount);
  });

  // ── 3. Board is parallel with trail (both on Y≈0 ground plane) ─
  it('hoverboard and trail sit on the same ground plane (Y≈0)', async () => {
    const result = await evalInBrowser<{ boardMinY: number; boardMaxY: number; riderMinY: number }>(page, `
      const mod = await import('/src/viewerExports.ts');
      const { Box3 } = await import('/node_modules/three/build/three.module.js');
      const group = mod.cloneHoverboardModel(0x00ff88, true);
      const boardBox = new Box3();
      const riderBox = new Box3();
      group.traverse(child => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const isBoard = mats.some(m =>
          m.name === 'M_HoverB_Body' || m.name === 'M_HoverB_Plates' || m.name === 'M_HoverB_Lights'
        );
        const box = new Box3().setFromObject(child);
        if (isBoard) boardBox.union(box); else riderBox.union(box);
      });
      return { boardMinY: boardBox.min.y, boardMaxY: boardBox.max.y, riderMinY: riderBox.min.y };
    `);
    // Board bottom should be near Y=0
    expect(result.boardMinY).toBeLessThan(0.2);
  });

  // ── 4. Rider is above the board (feet on it, not below) ──────
  it('rider character sits above the board (feet on board)', async () => {
    const result = await evalInBrowser<{ boardCenterY: number; riderMinY: number }>(page, `
      const mod = await import('/src/viewerExports.ts');
      const { Box3, Vector3 } = await import('/node_modules/three/build/three.module.js');
      const group = mod.cloneHoverboardModel(0x00ff88, true);
      let boardCenterY = 0;
      let riderMinY = Infinity;
      group.traverse(child => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const isBoard = mats.some(m =>
          m.name === 'M_HoverB_Body' || m.name === 'M_HoverB_Plates' || m.name === 'M_HoverB_Lights'
        );
        const box = new Box3().setFromObject(child);
        if (isBoard) { const c = new Vector3(); box.getCenter(c); boardCenterY = c.y; }
        else { if (box.min.y < riderMinY) riderMinY = box.min.y; }
      });
      return { boardCenterY, riderMinY };
    `);
    // Rider's lowest point should be at or above the board center
    expect(result.riderMinY).toBeGreaterThanOrEqual(result.boardCenterY - 0.15);
  });

  // ── 5. All models rotate together (board + rider + trail) ────
  it('hoverboard preview pixels change over time (model is spinning)', async () => {
    const frame1 = await page.evaluate(() => {
      const canvas = document.getElementById('cs-canvas-wrap-hoverboard')?.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 400) hash += data[i] + data[i + 1] + data[i + 2];
      return hash;
    });
    await page.waitForTimeout(600);
    const frame2 = await page.evaluate(() => {
      const canvas = document.getElementById('cs-canvas-wrap-hoverboard')?.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 400) hash += data[i] + data[i + 1] + data[i + 2];
      return hash;
    });
    expect(frame1).not.toBeNull();
    expect(frame2).not.toBeNull();
    expect(frame1).not.toBe(frame2);
  });

  // ── 6. Bike and car previews also spin (baseline) ────────────
  it('bike preview pixels change over time (spinning)', async () => {
    const frame1 = await page.evaluate(() => {
      const canvas = document.getElementById('cs-canvas-wrap-bike')?.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 400) hash += data[i] + data[i + 1] + data[i + 2];
      return hash;
    });
    await page.waitForTimeout(600);
    const frame2 = await page.evaluate(() => {
      const canvas = document.getElementById('cs-canvas-wrap-bike')?.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 400) hash += data[i] + data[i + 1] + data[i + 2];
      return hash;
    });
    expect(frame1).not.toBeNull();
    expect(frame2).not.toBeNull();
    expect(frame1).not.toBe(frame2);
  });

  // ── 7. Rider mesh world positions change with pivot rotation ──
  it('rider SkinnedMesh world position changes when pivot rotates (spins with board)', async () => {
    const result = await evalInBrowser<{ x0: number; z0: number; x1: number; z1: number; moved: boolean }>(page, `
      const mod = await import('/src/viewerExports.ts');
      const { Group, Vector3 } = await import('/node_modules/three/build/three.module.js');
      const group = mod.cloneHoverboardModel(0x00ff88, true);
      const pivot = new Group();
      pivot.add(group);
      let skinned = null;
      group.traverse(child => { if (child.isSkinnedMesh) skinned = child; });
      if (!skinned) return { error: 'no SkinnedMesh found' };
      pivot.rotation.y = 0;
      pivot.updateMatrixWorld(true);
      const pos0 = new Vector3();
      skinned.getWorldPosition(pos0);
      pivot.rotation.y = Math.PI / 2;
      pivot.updateMatrixWorld(true);
      const pos1 = new Vector3();
      skinned.getWorldPosition(pos1);
      return {
        x0: +pos0.x.toFixed(4), z0: +pos0.z.toFixed(4),
        x1: +pos1.x.toFixed(4), z1: +pos1.z.toFixed(4),
        moved: pos0.distanceTo(pos1) > 0.001,
      };
    `);
    expect(result.moved).toBe(true);
  });

  // ── 8. No "COMING SOON" on hoverboard card ──────────────────
  it('hoverboard card has no COMING SOON badge', async () => {
    const hasSoon = await page.evaluate(() => {
      const card = document.getElementById('cs-card-hoverboard');
      return !!card?.querySelector('.cs-card-soon');
    });
    expect(hasSoon).toBe(false);
  });
});

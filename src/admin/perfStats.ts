// ── Admin Panel: Perf Stats + God Mode + Netcode Section ─
// God mode toggle, live perf stats grid, netcode debug display.

import type * as THREE from 'three';
import type { GameLike } from '../adminPanel';
import type { VehicleType } from '../types/index';
import { getLastFps } from '../ui/effects';
import { getNetcodeStats } from '../debugLog';
import { LOADOUT_DISPLAY_NAMES } from '../vehicleConfig';
import { addHeader, getAppendTarget } from './helpers';

export function addGodModeButton(panel: HTMLDivElement, gameRef: GameLike | null): void {
  const godBtn = document.createElement('div');
  const updateGodStyle = (on: boolean): void => {
    godBtn.textContent = on ? 'GOD MODE: ON  (no clip, no trail, AI frozen)' : 'GOD MODE: OFF';
    godBtn.style.color = on ? '#ff6666' : '#888';
    godBtn.style.borderColor = on ? 'rgba(255,102,102,0.4)' : 'rgba(73,162,178,0.2)';
    godBtn.style.background = on ? 'rgba(255,102,102,0.06)' : 'transparent';
  };
  Object.assign(godBtn.style, {
    padding: '6px 10px', textAlign: 'center', cursor: 'pointer',
    color: '#888', border: '1px solid rgba(73,162,178,0.2)',
    marginBottom: '8px', fontSize: '11px', letterSpacing: '2px', fontWeight: 'bold',
    transition: 'all 0.15s',
  });
  updateGodStyle(!!gameRef?.adminGodMode);

  godBtn.addEventListener('click', () => {
    if (!gameRef) return;
    const on = !gameRef.adminGodMode;
    gameRef.adminGodMode = on;
    // Toggle trail suppression on human player
    if (gameRef.player) gameRef.player.suppressTrail = on;
    updateGodStyle(on);
  });
  panel.appendChild(godBtn);

  // ── Vehicle Cycle Button ─────────────────────────────────
  // Sets vehicle for the next round (does NOT restart the current match).
  const vehicleOrder: VehicleType[] = ['bike', 'car', 'hoverboard'];
  const vehicleBtn = document.createElement('div');
  const updateVehicleLabel = (): void => {
    const saved = (localStorage.getItem('luminal-vehicle') || 'bike') as VehicleType;
    const name = LOADOUT_DISPLAY_NAMES[saved] || saved.toUpperCase();
    vehicleBtn.textContent = `NEXT VEHICLE: ${name}`;
  };
  Object.assign(vehicleBtn.style, {
    padding: '6px 10px', textAlign: 'center', cursor: 'pointer',
    color: '#49A2B2', border: '1px solid rgba(73,162,178,0.2)',
    marginBottom: '8px', fontSize: '11px', letterSpacing: '2px', fontWeight: 'bold',
    transition: 'all 0.15s',
  });
  updateVehicleLabel();
  vehicleBtn.addEventListener('click', () => {
    const current = (localStorage.getItem('luminal-vehicle') || 'bike') as VehicleType;
    const idx = vehicleOrder.indexOf(current);
    const next = vehicleOrder[(idx + 1) % vehicleOrder.length];
    localStorage.setItem('luminal-vehicle', next);
    updateVehicleLabel();
  });
  panel.appendChild(vehicleBtn);
}

export function addPerfStatsSection(
  panel: HTMLDivElement,
  renderer: THREE.WebGLRenderer | null,
  freecamTickFnRef: { current: (() => void) | null },
): void {
  addHeader('PERF STATS', 'perf');

  const perfGrid = document.createElement('div');
  Object.assign(perfGrid.style, {
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 8px',
    marginBottom: '8px', fontSize: '10px',
  });
  getAppendTarget().appendChild(perfGrid);

  const perfCells: Record<string, HTMLSpanElement> = {};
  for (const key of ['FPS', 'DRAWS', 'TRIS', 'GEOM', 'TEX', 'SHADERS']) {
    const cell = document.createElement('div');
    Object.assign(cell.style, {
      background: 'rgba(73,162,178,0.06)', borderRadius: '3px',
      padding: '4px 6px', textAlign: 'center',
    });
    const val = document.createElement('div');
    Object.assign(val.style, { color: '#49A2B2', fontSize: '13px', fontWeight: 'bold' });
    val.textContent = '—';
    const lbl = document.createElement('div');
    lbl.style.color = '#555';
    lbl.textContent = key;
    cell.appendChild(val);
    cell.appendChild(lbl);
    perfGrid.appendChild(cell);
    perfCells[key] = val;
  }

  // ── Netcode Debug ────────────────────────────────────────
  addHeader('NETCODE', 'netcode');

  const netRow = document.createElement('div');
  Object.assign(netRow.style, {
    display: 'flex', gap: '8px', padding: '2px 0 4px', fontSize: '10px', alignItems: 'center',
  });
  const netDebugLabel = document.createElement('span');
  netDebugLabel.textContent = 'debug log';
  netDebugLabel.style.width = '80px';
  netDebugLabel.style.flexShrink = '0';
  const netDebugToggle = document.createElement('input');
  netDebugToggle.type = 'checkbox';
  netDebugToggle.checked = !!window.NETCODE_DEBUG;
  Object.assign(netDebugToggle.style, { accentColor: '#49A2B2' });
  netDebugToggle.addEventListener('input', () => {
    window.NETCODE_DEBUG = netDebugToggle.checked;
  });
  netRow.appendChild(netDebugLabel);
  netRow.appendChild(netDebugToggle);
  getAppendTarget().appendChild(netRow);

  const netStatusRow = document.createElement('div');
  Object.assign(netStatusRow.style, {
    display: 'flex', gap: '8px', padding: '2px 0 8px', fontSize: '10px', alignItems: 'center',
    borderBottom: '1px solid rgba(73,162,178,0.1)', marginBottom: '4px',
  });
  const rttEl = document.createElement('span');
  rttEl.style.color = '#49A2B2';
  rttEl.textContent = 'RTT: —';
  const healthEl = document.createElement('span');
  healthEl.style.marginLeft = 'auto';
  healthEl.textContent = 'NO MATCH';
  healthEl.style.color = '#555';
  healthEl.style.letterSpacing = '1px';
  healthEl.style.fontWeight = 'bold';
  netStatusRow.appendChild(rttEl);
  netStatusRow.appendChild(healthEl);
  getAppendTarget().appendChild(netStatusRow);

  // rAF ticker for live perf + netcode stats
  const tickPerf = (): void => {
    if (!panel?.isConnected) return;
    const r = renderer;
    if (r) {
      perfCells['DRAWS'].textContent = String(r.info.render.calls);
      perfCells['TRIS'].textContent = r.info.render.triangles > 999
        ? (r.info.render.triangles / 1000).toFixed(1) + 'k'
        : String(r.info.render.triangles);
      perfCells['GEOM'].textContent = String(r.info.memory.geometries);
      perfCells['TEX'].textContent = String(r.info.memory.textures);
      perfCells['SHADERS'].textContent = String(r.info.programs?.length ?? '?');
    }
    perfCells['FPS'].textContent = String(getLastFps());

    // Netcode
    const netStats = getNetcodeStats();
    if (netStats) {
      rttEl.textContent = `RTT: ${Math.round(netStats.rtt)}ms`;
      healthEl.textContent = netStats.health.toUpperCase();
      const hColors: Record<string, string> = { healthy: '#4a4', degraded: '#e8a735', unstable: '#e44', connected: '#49A2B2', waiting: '#888' };
      healthEl.style.color = hColors[netStats.health] || '#555';
    } else {
      rttEl.textContent = 'RTT: —';
      healthEl.textContent = 'NO MATCH';
      healthEl.style.color = '#555';
    }

    // Freecam input update
    if (freecamTickFnRef.current) freecamTickFnRef.current();

    requestAnimationFrame(tickPerf);
  };
  requestAnimationFrame(tickPerf);
}

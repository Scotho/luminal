// admin/src/ui/agentsDropdown.ts — Top-bar agents dropdown with status + usage tooltips
import { getAgentPools } from './agentPools';
import { sessionManager } from './ccSessionManager';
import { escapeHtml } from './render';
import { loadUsageRecords, aggregateUsage, formatDuration, estimateCost, loadOllamaUsageRecords, aggregateOllamaUsage } from './ccUsage';
import { closeAllDropdowns, registerDropdownCloser } from '../envSwitcher';

let _dropdownOpen = false;
let _container: HTMLElement | null = null;

export function initAgentsDropdown(): () => void {
  _container = document.getElementById('agents-dropdown-wrap');
  if (!_container) return () => {};

  const cleanups: (() => void)[] = [];

  const unsub = sessionManager.onChange(() => render());
  cleanups.push(unsub);

  _container.addEventListener('click', handleClick);
  document.addEventListener('click', handleDocClick);

  cleanups.push(() => {
    _container?.removeEventListener('click', handleClick);
    document.removeEventListener('click', handleDocClick);
  });

  render();
  return () => { for (const fn of cleanups) fn(); };
}

function render(): void {
  if (!_container) return;
  const running = sessionManager.running();
  const pools = getAgentPools();
  const anyOnline = pools.some(p => p.available);
  const count = running.length;
  const dotClass = anyOnline ? 'green' : 'red';

  _container.innerHTML = `
    <button id="agents-dropdown-btn" class="agents-dd-btn">
      <span class="status-dot ${dotClass}" style="width:6px;height:6px;"></span>
      <span class="agents-dd-count">${count}</span>
      <span class="agents-dd-label">AGENTS</span>
      <span class="agents-dd-caret">${_dropdownOpen ? '\u25B2' : '\u25BC'}</span>
    </button>
    ${_dropdownOpen ? renderDropdown(pools, running) : ''}
  `;
}

function renderDropdown(pools: ReturnType<typeof getAgentPools>, running: ReturnType<typeof sessionManager.running>): string {
  const poolRows = pools.map(p => {
    const dot = p.available ? 'green' : 'dim';
    const model = p.model ? ` (${escapeHtml(p.model)})` : '';
    return `
      <div class="agents-dd-row" data-pool="${escapeHtml(p.id)}">
        <span class="status-dot ${dot}" style="width:6px;height:6px;"></span>
        <span class="agents-dd-pool-label">${escapeHtml(p.label)}${model}</span>
        <span class="agents-dd-pool-status">${p.available ? 'Online' : 'Offline'}</span>
      </div>
    `;
  }).join('');

  const runningRows = running.length > 0
    ? running.map(s => `
        <div class="agents-dd-row agents-dd-running">
          <span class="status-dot orange" style="width:5px;height:5px;animation:pulse 2s infinite;"></span>
          <span class="agents-dd-session-label">${escapeHtml(s.label)}</span>
        </div>
      `).join('')
    : '<div class="agents-dd-empty">No active agents</div>';

  return `
    <div class="agents-dd-dropdown">
      <div class="agents-dd-section-header">BACKENDS</div>
      ${poolRows}
      <div class="agents-dd-sep"></div>
      <div class="agents-dd-section-header">RUNNING</div>
      ${runningRows}
    </div>
  `;
}

function handleClick(e: MouseEvent): void {
  e.stopPropagation();
  const target = e.target as HTMLElement;
  const poolRow = target.closest('.agents-dd-row[data-pool]') as HTMLElement | null;
  if (poolRow) {
    showPoolTooltip(poolRow, poolRow.dataset.pool!);
    return;
  }
  if (target.closest('#agents-dropdown-btn')) {
    const wasOpen = _dropdownOpen;
    closeAllDropdowns();
    if (!wasOpen) {
      _dropdownOpen = true;
      registerDropdownCloser(() => { _dropdownOpen = false; render(); });
    }
    render();
  }
}

function handleDocClick(e: MouseEvent): void {
  if (!_dropdownOpen) return;
  if (!_container?.contains(e.target as HTMLElement)) {
    _dropdownOpen = false;
    render();
  }
}

async function showPoolTooltip(anchor: HTMLElement, poolId: string): Promise<void> {
  document.querySelectorAll('.agents-tooltip').forEach(t => t.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'agents-tooltip';

  if (poolId === 'claude') {
    const records = await loadUsageRecords();
    const agg = aggregateUsage(records);
    const cost = estimateCost(records);
    const total = agg.totalInput + agg.totalOutput;
    tooltip.innerHTML = `
      <div class="agents-tooltip-title">Claude Usage</div>
      <div class="agents-tooltip-row">Tokens: <strong>${(total / 1000).toFixed(1)}K</strong></div>
      <div class="agents-tooltip-row">Sessions: <strong>${agg.totalSessions}</strong></div>
      <div class="agents-tooltip-row">Active time: <strong>${formatDuration(agg.totalDurationMs)}</strong></div>
      <div class="agents-tooltip-row">Est. cost: <strong>$${cost.toFixed(2)}</strong></div>
    `;
  } else {
    const ollamaRecords = loadOllamaUsageRecords();
    const ollamaAgg = aggregateOllamaUsage(ollamaRecords);
    if (ollamaAgg.totalSessions > 0) {
      const tokFmt = ollamaAgg.totalTokens >= 1000 ? `${(ollamaAgg.totalTokens / 1000).toFixed(1)}K` : String(ollamaAgg.totalTokens);
      tooltip.innerHTML = `
        <div class="agents-tooltip-title">Local Agent Usage</div>
        <div class="agents-tooltip-row">Tokens (est.): <strong>${tokFmt}</strong></div>
        <div class="agents-tooltip-row">Sessions: <strong>${ollamaAgg.totalSessions}</strong></div>
        <div class="agents-tooltip-row">Active time: <strong>${formatDuration(ollamaAgg.totalDurationMs)}</strong></div>
      `;
    } else {
      tooltip.innerHTML = `
        <div class="agents-tooltip-title">Local Agent</div>
        <div class="agents-tooltip-row">No usage recorded yet</div>
      `;
    }
  }

  anchor.style.position = 'relative';
  anchor.appendChild(tooltip);
  setTimeout(() => tooltip.remove(), 4000);
}

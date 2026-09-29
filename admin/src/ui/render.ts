/** Escape HTML special characters. */
export function escapeHtml(str: string): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a timestamp delta as "Xs ago", "Xm ago", "Xh ago". */
export function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Format byte count as human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format a delta as "+N new" badge HTML. Returns empty string if delta <= 0. */
export function deltaBadge(count: number): string {
  if (count <= 0) return '';
  return `<span class="stat-delta">+${count} new</span>`;
}

/** Format ISO date as short local string. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Create a section header with title, last-updated text, and refresh button. */
export function sectionHeader(title: string, lastUpdated: string | null, onRefresh: () => void, iconHtml?: string): string {
  const updatedText = lastUpdated ? `Last updated: ${shortDate(lastUpdated)}` : 'Not yet loaded';
  const id = `refresh-${title.toLowerCase().replace(/\s+/g, '-')}`;
  setTimeout(() => {
    document.getElementById(id)?.addEventListener('click', onRefresh);
  }, 0);
  const prefix = iconHtml ? `${iconHtml} ` : '';
  return `
    <div class="section-header">
      <h2>${prefix}${escapeHtml(title)}</h2>
      <div>
        <span class="last-updated">${updatedText}</span>
        <button class="refresh-btn" id="${id}">Refresh</button>
      </div>
    </div>
  `;
}

/** Create a stat card. */
export function statCard(value: string | number, label: string, delta?: number): string {
  return `
    <div class="stat-card">
      <div class="stat-val">${value}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
      ${delta !== undefined ? deltaBadge(delta) : ''}
    </div>
  `;
}

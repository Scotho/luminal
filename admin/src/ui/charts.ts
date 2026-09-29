// admin/src/ui/charts.ts — Shared SVG sparkline and time-series chart utilities

export interface SparklineOpts {
  width?: number;
  height?: number;
  color?: string;
  /** Threshold line: dashed horizontal line at this Y value. */
  threshold?: number;
  /** Color for points above threshold. Default: 'var(--red)'. */
  thresholdColor?: string;
}

/**
 * Render an inline SVG sparkline into a container element.
 * Returns the SVG string (also sets innerHTML if element exists).
 */
export function renderSparkline(elementId: string, data: number[], opts: SparklineOpts = {}): string {
  const w = opts.width ?? 200;
  const h = opts.height ?? 40;
  const color = opts.color ?? 'rgba(110,224,240,0.6)';

  if (data.length < 2) {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = '';
    return '';
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const last = data[data.length - 1];
  const lastX = w;
  const lastY = h - ((last - min) / range) * (h - 4) - 2;

  let thresholdLine = '';
  if (opts.threshold !== undefined) {
    const ty = h - ((opts.threshold - min) / range) * (h - 4) - 2;
    const clampedTy = Math.max(2, Math.min(h - 2, ty));
    thresholdLine = `<line x1="0" y1="${clampedTy.toFixed(1)}" x2="${w}" y2="${clampedTy.toFixed(1)}" stroke="${opts.thresholdColor ?? 'var(--red)'}" stroke-width="0.5" stroke-dasharray="4,2" opacity="0.6"/>`;
  }

  const svg = `
    <svg viewBox="0 0 ${w} ${h}" style="width:${w}px; height:${h}px;">
      ${thresholdLine}
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5" fill="${color.replace(/[\d.]+\)$/, '1)')}"/>
    </svg>
  `;

  const el = document.getElementById(elementId);
  if (el) el.innerHTML = svg;
  return svg;
}

export interface TimeSeriesOpts {
  field?: string;
  color?: string;
  height?: number;
  /** Threshold line at this Y value. */
  threshold?: number;
  thresholdColor?: string;
}

/**
 * Render an SVG time-series chart with area fill into a container element.
 * `data` is an array of `{ ts, value }` objects.
 */
export function renderTimeSeriesChart(
  containerId: string,
  data: { ts: number; value: number }[],
  opts: TimeSeriesOpts = {},
): void {
  const el = document.getElementById(containerId);
  if (!el || data.length < 2) {
    if (el) el.innerHTML = '<span style="color:var(--text-dim);font-size:11px;">Not enough data</span>';
    return;
  }

  const color = opts.color ?? 'rgba(110,224,240,0.8)';
  const W = el.clientWidth || 400;
  const H = opts.height ?? 120;
  const values = data.map(d => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const divisor = data.length > 1 ? data.length - 1 : 1;

  const points = values.map((v, i) => {
    const x = (i / divisor) * W;
    const y = H - 8 - ((v - min) / range) * (H - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const areaPath = `M${points[0]} ${points.map((_, i) => `L${points[i]}`).join(' ')} L${W},${H} L0,${H} Z`;

  const gradId = `area-grad-${containerId}`;
  const yMax = max;
  const yMid = Math.round((max + min) / 2);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  let thresholdLine = '';
  if (opts.threshold !== undefined) {
    const ty = H - 8 - ((opts.threshold - min) / range) * (H - 16);
    const clampedTy = Math.max(2, Math.min(H - 2, ty));
    thresholdLine = `<line x1="0" y1="${clampedTy.toFixed(1)}" x2="${W}" y2="${clampedTy.toFixed(1)}" stroke="${opts.thresholdColor ?? 'var(--red)'}" stroke-width="0.5" stroke-dasharray="4,2" opacity="0.6"/>`;
  }

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;">
      <defs>
        <linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${thresholdLine}
      <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="4"/>
      <path d="${areaPath}" fill="url(#${gradId})"/>
      <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${points[points.length - 1].split(',')[0]}" cy="${points[points.length - 1].split(',')[1]}" r="3" fill="${color}"/>
      <text x="4" y="12" fill="var(--text-dim)" font-size="9" font-family="var(--font-mono)">${yMax}</text>
      <text x="4" y="${H / 2 + 3}" fill="var(--text-quiet)" font-size="8" font-family="var(--font-mono)">${yMid}</text>
      <text x="4" y="${H - 2}" fill="var(--text-quiet)" font-size="8" font-family="var(--font-mono)">${fmtTime(data[0].ts)}</text>
      <text x="${W - 4}" y="${H - 2}" fill="var(--text-quiet)" font-size="8" font-family="var(--font-mono)" text-anchor="end">${fmtTime(data[data.length - 1].ts)}</text>
    </svg>
  `;
}

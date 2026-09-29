// ── permissionGateway.ts — CC-Flair Permission Gateway ─────────────
//
// Web-native approval flow for dangerous tool calls. Intercepts SSE
// stream events for Edit/Bash/Write/git-push, surfaces a modal with
// tool name, args, risk classification (green/yellow/red), diff preview.
// Approve / Deny / Approve-All-Similar. Denial tracking sidebar badge.
// Inspired by CC PermissionContext.ts atomic resolve-once pattern.

import { escapeHtml } from './render';
import { bus } from './eventBus';

// ── Risk classification ────────────────────────────────────

export type RiskLevel = 'green' | 'yellow' | 'red';

export interface ToolCallEvent {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
  cardIndex: number;
}

export interface PermissionResult {
  action: 'approve' | 'deny' | 'approve-all-similar';
}

const RED_RE = /git\s+push|rm\s+-rf|git\s+reset\s+--hard|DROP\s+TABLE|git\s+checkout\s+--?\s|git\s+clean\s+-f|--force/i;
const YELLOW_RE = /git\s+|npm\s+publish|curl.*POST|docker|npm\s+run|npx\s+/i;

export function classifyRisk(tool: string, args: Record<string, unknown>): RiskLevel {
  if (tool === 'Bash') {
    const cmd = String(args.command ?? '');
    if (RED_RE.test(cmd)) return 'red';
    if (YELLOW_RE.test(cmd)) return 'yellow';
    return 'green';
  }
  if (tool === 'Edit' || tool === 'Write') return 'yellow';
  return 'green';
}

const RISK_LABELS: Record<RiskLevel, string> = { green: 'SAFE', yellow: 'CAUTION', red: 'DANGER' };
const RISK_COLORS: Record<RiskLevel, string> = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red-bright)' };
const RISK_BG: Record<RiskLevel, string> = {
  green: 'rgba(74,222,128,0.08)', yellow: 'rgba(250,204,21,0.08)', red: 'rgba(248,113,113,0.10)',
};

// ── Auto-approve registry ──────────────────────────────────

const _autoApproved = new Set<string>();

function autoKey(tool: string, risk: RiskLevel): string { return `${tool}:${risk}`; }

export function isAutoApproved(tool: string, risk: RiskLevel): boolean {
  return _autoApproved.has(autoKey(tool, risk));
}
export function addAutoApproval(tool: string, risk: RiskLevel): void {
  _autoApproved.add(autoKey(tool, risk));
}
export function clearAutoApprovals(): void { _autoApproved.clear(); }
export function getAutoApprovals(): string[] { return [..._autoApproved]; }

// ── Denial tracking ────────────────────────────────────────

let _denialCount = 0;
const _denialLog: Array<{ tool: string; risk: RiskLevel; ts: number }> = [];

export function getDenialCount(): number { return _denialCount; }
export function getDenialLog(): Array<{ tool: string; risk: RiskLevel; ts: number }> {
  return [..._denialLog];
}
export function clearDenials(): void {
  _denialCount = 0;
  _denialLog.length = 0;
  _updateDenialBadge();
}

function _recordDenial(tool: string, risk: RiskLevel): void {
  _denialCount++;
  _denialLog.push({ tool, risk, ts: Date.now() });
  _updateDenialBadge();
}

// ── Denial badge on cc-status-btn ──────────────────────────

function _updateDenialBadge(): void {
  const btn = document.getElementById('cc-status-btn');
  if (!btn) return;
  let badge = btn.querySelector('.perm-denial-badge') as HTMLElement | null;
  if (_denialCount === 0) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'perm-denial-badge';
    btn.appendChild(badge);
  }
  badge.textContent = String(_denialCount);
}

// ── Modal styles (injected once) ───────────────────────────

let _stylesInjected = false;

function _injectStyles(): void {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const s = document.createElement('style');
  s.id = 'perm-gateway-styles';
  s.textContent = [
    '.perm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;animation:perm-fi 150ms ease}',
    '@keyframes perm-fi{from{opacity:0}to{opacity:1}}',
    '.perm-modal{background:var(--bg-panel,#111827);border:1px solid var(--border-strong,rgba(148,163,184,.24));border-radius:10px;width:520px;max-width:92vw;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.6);animation:perm-si 200ms ease}',
    '@keyframes perm-si{from{opacity:0;transform:translateY(-16px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '.perm-header{display:flex;align-items:center;gap:10px;padding:16px 20px 12px;border-bottom:1px solid var(--border,rgba(148,163,184,.14))}',
    '.perm-header-title{font-family:var(--font-display,"Inter",monospace);font-size:14px;font-weight:700;color:var(--text,#e2e8f0);letter-spacing:.5px}',
    '.perm-risk-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:var(--font-display,"Inter",monospace)}',
    '.perm-risk-dot{width:6px;height:6px;border-radius:50%}',
    '.perm-body{padding:16px 20px;overflow-y:auto;flex:1}',
    '.perm-tool-label{font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim,#94a3b8);margin-bottom:6px}',
    '.perm-args-block{background:rgba(0,0,0,.25);border:1px solid var(--border,rgba(148,163,184,.14));border-radius:6px;padding:12px 14px;font-family:"JetBrains Mono","Fira Code",monospace;font-size:12px;line-height:1.5;color:var(--text,#e2e8f0);white-space:pre-wrap;word-break:break-word;max-height:280px;overflow-y:auto}',
    '.perm-diff-block{margin-top:12px}',
    '.perm-diff-line-add{color:var(--green,#4ade80);background:rgba(74,222,128,.06)}',
    '.perm-diff-line-remove{color:var(--red-bright,#f87171);background:rgba(248,113,113,.06)}',
    '.perm-footer{display:flex;align-items:center;gap:8px;padding:12px 20px 16px;border-top:1px solid var(--border,rgba(148,163,184,.14))}',
    '.perm-footer .perm-spacer{flex:1}',
    '.perm-btn{padding:6px 14px;border:1px solid var(--border-strong,rgba(148,163,184,.24));border-radius:6px;font-family:var(--font-display,"Inter",monospace);font-size:12px;font-weight:600;cursor:pointer;transition:background 150ms,border-color 150ms,color 150ms;background:transparent;color:var(--text,#e2e8f0)}',
    '.perm-btn:hover{background:rgba(255,255,255,.04)}',
    '.perm-btn:focus-visible{outline:1.5px solid var(--accent,#38bdf8);outline-offset:1px}',
    '.perm-btn--approve{color:var(--green,#4ade80);border-color:rgba(74,222,128,.3)}',
    '.perm-btn--approve:hover{background:rgba(74,222,128,.10);border-color:rgba(74,222,128,.5)}',
    '.perm-btn--deny{color:var(--red-bright,#f87171);border-color:rgba(248,113,113,.3)}',
    '.perm-btn--deny:hover{background:rgba(248,113,113,.10);border-color:rgba(248,113,113,.5)}',
    '.perm-btn--approve-all{color:var(--accent,#38bdf8);border-color:rgba(56,189,248,.3)}',
    '.perm-btn--approve-all:hover{background:rgba(56,189,248,.08);border-color:rgba(56,189,248,.5)}',
    '.perm-denial-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--red,#dc2626);color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center;pointer-events:none}',
  ].join('\n');
  document.head.appendChild(s);
}

// ── Format tool args for display ───────────────────────────

function _formatArgs(tool: string, args: Record<string, unknown>): string {
  if (tool === 'Bash') return String(args.command ?? JSON.stringify(args, null, 2));
  if (tool === 'Edit') {
    const fp = String(args.file_path ?? '');
    const old = String(args.old_string ?? '');
    const nw = String(args.new_string ?? '');
    const lines: string[] = [];
    if (fp) lines.push(`File: ${fp}`);
    if (old || nw) {
      lines.push('');
      for (const l of old.split('\n')) lines.push(`- ${l}`);
      for (const l of nw.split('\n')) lines.push(`+ ${l}`);
    }
    return lines.join('\n') || JSON.stringify(args, null, 2);
  }
  if (tool === 'Write') {
    const fp = String(args.file_path ?? '');
    const content = String(args.content ?? '');
    const preview = content.length > 500 ? content.slice(0, 500) + '\n... (truncated)' : content;
    return fp ? `File: ${fp}\n\n${preview}` : preview;
  }
  return JSON.stringify(args, null, 2);
}

function _renderDiffPreview(args: Record<string, unknown>): string {
  const old = String(args.old_string ?? '');
  const nw = String(args.new_string ?? '');
  if (!old && !nw) return '';
  const lines: string[] = [];
  for (const l of old.split('\n')) lines.push(`<div class="perm-diff-line-remove">- ${escapeHtml(l)}</div>`);
  for (const l of nw.split('\n')) lines.push(`<div class="perm-diff-line-add">+ ${escapeHtml(l)}</div>`);
  return `<div class="perm-diff-block"><div class="perm-tool-label">Diff Preview</div><div class="perm-args-block">${lines.join('')}</div></div>`;
}

// ── Permission modal ───────────────────────────────────────

/**
 * Show a permission modal. Returns a promise that resolves once the user
 * picks an action. Uses a resolve-once pattern (atomic settle) inspired
 * by CC PermissionContext.ts.
 */
export function requestPermission(event: ToolCallEvent): Promise<PermissionResult> {
  _injectStyles();
  const risk = classifyRisk(event.tool, event.args);

  return new Promise<PermissionResult>((resolve) => {
    let resolved = false;
    const settle = (result: PermissionResult): void => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const overlay = document.createElement('div');
    overlay.className = 'perm-overlay';
    const rc = RISK_COLORS[risk];
    const rb = RISK_BG[risk];
    const argsText = _formatArgs(event.tool, event.args);
    const diffHtml = event.tool === 'Edit' ? _renderDiffPreview(event.args) : '';

    overlay.innerHTML = `<div class="perm-modal">
      <div class="perm-header">
        <div class="perm-header-title">Permission Request</div>
        <div class="perm-risk-badge" style="color:${rc};background:${rb};border:1px solid ${rc}30">
          <span class="perm-risk-dot" style="background:${rc}"></span>${RISK_LABELS[risk]}
        </div>
      </div>
      <div class="perm-body">
        <div class="perm-tool-label">Tool: ${escapeHtml(event.tool)}</div>
        <div class="perm-args-block">${escapeHtml(argsText)}</div>
        ${diffHtml}
      </div>
      <div class="perm-footer">
        <button class="perm-btn perm-btn--deny" data-perm-action="deny">Deny</button>
        <span class="perm-spacer"></span>
        <button class="perm-btn perm-btn--approve-all" data-perm-action="approve-all-similar">Approve All ${escapeHtml(event.tool)}</button>
        <button class="perm-btn perm-btn--approve" data-perm-action="approve">Approve</button>
      </div>
    </div>`;

    overlay.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-perm-action]') as HTMLElement | null;
      if (!btn) return;
      const a = btn.dataset.permAction;
      if (a === 'approve') settle({ action: 'approve' });
      else if (a === 'deny') { _recordDenial(event.tool, risk); settle({ action: 'deny' }); }
      else if (a === 'approve-all-similar') { addAutoApproval(event.tool, risk); settle({ action: 'approve-all-similar' }); }
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === 'y') { e.preventDefault(); settle({ action: 'approve' }); }
      else if (e.key === 'Escape' || e.key === 'n') { e.preventDefault(); _recordDenial(event.tool, risk); settle({ action: 'deny' }); }
      else if (e.key === 'a') { e.preventDefault(); addAutoApproval(event.tool, risk); settle({ action: 'approve-all-similar' }); }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    (overlay.querySelector('.perm-btn--approve') as HTMLElement | null)?.focus();
  });
}

// ── Gate function for SSE stream processing ────────────────

/**
 * Gate a tool call through the permission system. Returns true if
 * approved, false if denied.
 */
export async function gateToolCall(event: ToolCallEvent): Promise<boolean> {
  const risk = classifyRisk(event.tool, event.args);
  if (risk === 'green') return true;
  if (isAutoApproved(event.tool, risk)) return true;
  const result = await requestPermission(event);
  if (result.action === 'approve' || result.action === 'approve-all-similar') return true;
  bus.emit('cc:done', { label: `Denied: ${event.tool}`, exitCode: null });
  return false;
}

// ── Enabled state ──────────────────────────────────────────

let _enabled = true;
export function isPermissionGatewayEnabled(): boolean { return _enabled; }
export function setPermissionGatewayEnabled(enabled: boolean): void { _enabled = enabled; }

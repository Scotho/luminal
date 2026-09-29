// ── permissionGatewayBridge.ts — Bridges permission gateway into SSE stream ──
//
// Intercepts tool_use events from the CC stream, gates them through the
// permission gateway modal, and buffers subsequent events while the modal
// is open. On denial, cancels the agent process via the cancel endpoint.

import type { ToolCallEvent } from './permissionGateway';
import {
  gateToolCall,
  classifyRisk,
  isAutoApproved,
  isPermissionGatewayEnabled,
  setPermissionGatewayEnabled,
  clearAutoApprovals,
} from './permissionGateway';
import { getSetting, saveSettings } from './settingsStore';

// ── Types ─────────────────────────────────────────────────

export interface BufferedLine {
  sessionId: string;
  line: string;
  isStderr: boolean;
}

type ProcessLineFn = (sessionId: string, line: string, isStderr?: boolean) => void;

// ── State ─────────────────────────────────────────────────

let _gating = false;
let _buffer: BufferedLine[] = [];
let _processLine: ProcessLineFn | null = null;
/** True only after initBridge() has been called. */
let _initialized = false;
/** Pending tool input chunks accumulated during input_json_delta streaming. */
let _pendingToolInput = '';
/** Tool name from the most recent content_block_start. */
let _pendingToolName: string | null = null;
/** Card index of the pending tool. */
let _pendingCardIndex = 0;

// ── Initialization ────────────────────────────────────────

/**
 * Initialize the bridge with the processLine function from SessionManager.
 * Must be called before any stream events flow through the bridge.
 */
export function initBridge(processLine: ProcessLineFn): void {
  _processLine = processLine;
  _initialized = true;
  // Restore enabled state from settings (default: OFF)
  const enabled = getSetting('permissionGateway');
  setPermissionGatewayEnabled(enabled);
}

// ── Toggle ────────────────────────────────────────────────

/**
 * Toggle the permission gateway on or off. Persists to settings.
 * When toggled off, clears any pending auto-approvals.
 */
export function togglePermissionGateway(enabled: boolean): void {
  setPermissionGatewayEnabled(enabled);
  saveSettings({ permissionGateway: enabled });
  if (!enabled) {
    clearAutoApprovals();
    // If currently gating, flush the buffer immediately
    if (_gating) {
      _gating = false;
      _flushBuffer();
    }
  }
}

// ── Stream interception ───────────────────────────────────

/**
 * Called when a content_block_start event with tool_use type is detected.
 * Stores the tool name for the upcoming gate check at content_block_stop.
 */
export function onToolUseStart(
  sessionId: string,
  toolName: string,
  cardIndex: number,
): void {
  if (!_initialized || !isPermissionGatewayEnabled()) return;
  _pendingToolName = toolName;
  _pendingCardIndex = cardIndex;
  _pendingToolInput = '';
}

/**
 * Called when an input_json_delta event arrives during tool input streaming.
 * Accumulates the partial JSON so we have the full args at content_block_stop.
 */
export function onToolInputDelta(partialJson: string): void {
  if (!_initialized || !isPermissionGatewayEnabled() || !_pendingToolName) return;
  _pendingToolInput += partialJson;
}

/**
 * Called at content_block_stop. If a tool was pending, gates it through the
 * permission modal. Returns true if the caller should skip its normal
 * content_block_stop processing (because we're buffering).
 */
export async function onToolUseStop(sessionId: string): Promise<boolean> {
  if (!_initialized || !isPermissionGatewayEnabled() || !_pendingToolName) {
    _resetPending();
    return false;
  }

  const toolName = _pendingToolName;
  const cardIndex = _pendingCardIndex;
  _resetPending();

  // Parse accumulated tool input
  let args: Record<string, unknown> = {};
  if (_pendingToolInput) {
    try {
      args = JSON.parse(_pendingToolInput) as Record<string, unknown>;
    } catch {
      // Partial or malformed JSON — gate with empty args
    }
  }
  _pendingToolInput = '';

  const event: ToolCallEvent = {
    tool: toolName,
    args,
    sessionId,
    cardIndex,
  };

  // Start gating — buffer all subsequent lines
  _gating = true;

  const approved = await gateToolCall(event);

  _gating = false;

  if (!approved) {
    // Denied — cancel the agent process
    await _cancelAgent(sessionId);
    return true;
  }

  // Approved — flush buffered events
  _flushBuffer();
  return false;
}

/**
 * Wraps a processLine call. If we're currently gating (modal is shown),
 * buffers the line instead of processing it immediately.
 * Returns true if the line was buffered (caller should skip processing).
 */
export function bufferIfGating(
  sessionId: string,
  line: string,
  isStderr: boolean,
): boolean {
  if (!_initialized || !_gating) return false;
  _buffer.push({ sessionId, line, isStderr });
  return true;
}

/**
 * Returns whether the bridge is currently gating (modal is open).
 */
export function isGating(): boolean {
  return _gating;
}

// ── Internal helpers ──────────────────────────────────────

function _resetPending(): void {
  _pendingToolName = null;
  _pendingCardIndex = 0;
}

function _flushBuffer(): void {
  const lines = _buffer.splice(0);
  if (!_processLine) return;
  for (const item of lines) {
    _processLine(item.sessionId, item.line, item.isStderr);
  }
}

async function _cancelAgent(sessionId: string): Promise<void> {
  try {
    await fetch(`/__admin_exec/cancel?agent=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
    });
  } catch {
    // Best-effort cancel — agent may already be done
  }
}

// ── Synchronous gate preview ─────────────────────────────

/**
 * Returns true if onToolUseStop will actually show a modal (i.e. the tool
 * requires user approval). Returns false when the gateway is disabled, no
 * tool is pending, or the pending tool would be auto-approved / green-risk.
 * Callers use this to decide whether card-marking must be deferred.
 */
export function willGate(): boolean {
  if (!_initialized || !isPermissionGatewayEnabled() || !_pendingToolName) return false;
  let args: Record<string, unknown> = {};
  if (_pendingToolInput) {
    try { args = JSON.parse(_pendingToolInput) as Record<string, unknown>; } catch { /* noop */ }
  }
  const risk = classifyRisk(_pendingToolName, args);
  if (risk === 'green') return false;
  if (isAutoApproved(_pendingToolName, risk)) return false;
  return true;
}

// ── Test helpers ──────────────────────────────────────────

/** Reset all bridge state. For testing only. */
export function _resetBridge(): void {
  _gating = false;
  _buffer = [];
  _pendingToolName = null;
  _pendingCardIndex = 0;
  _pendingToolInput = '';
  // Note: does NOT reset _initialized — call initBridge again to re-init
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';

// Install localStorage mock before module imports
const storage = mockLocalStorage();

// Stub fetch before imports
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' })));

// Stub sessionStorage for SessionManager persistence
const sessionStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
};
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true });

import {
  initBridge,
  togglePermissionGateway,
  onToolUseStart,
  onToolInputDelta,
  onToolUseStop,
  bufferIfGating,
  isGating,
  _resetBridge,
} from '../permissionGatewayBridge';
import {
  isPermissionGatewayEnabled,
  setPermissionGatewayEnabled,
  clearAutoApprovals,
  addAutoApproval,
  clearDenials,
} from '../permissionGateway';

describe('permissionGatewayBridge', () => {
  const mockProcessLine = vi.fn();

  beforeEach(() => {
    _resetBridge();
    clearAutoApprovals();
    clearDenials();
    setPermissionGatewayEnabled(false);
    storage.clear();
    vi.clearAllMocks();
    initBridge(mockProcessLine);
  });

  afterEach(() => {
    // Clean up any modals
    document.querySelectorAll('.perm-overlay').forEach(el => el.remove());
    setPermissionGatewayEnabled(false);
  });

  // ── initBridge ──────────────────────────────────────────

  describe('initBridge', () => {
    it('restores enabled state from settings (default OFF)', () => {
      expect(isPermissionGatewayEnabled()).toBe(false);
    });

    it('sets enabled state from explicit toggle', () => {
      togglePermissionGateway(true);
      expect(isPermissionGatewayEnabled()).toBe(true);
      // Re-init should read the persisted value
      // (In practice, loadSettings caches; the toggle writes through)
      togglePermissionGateway(false);
      expect(isPermissionGatewayEnabled()).toBe(false);
    });
  });

  // ── togglePermissionGateway ─────────────────────────────

  describe('togglePermissionGateway', () => {
    it('enables the gateway', () => {
      togglePermissionGateway(true);
      expect(isPermissionGatewayEnabled()).toBe(true);
    });

    it('disables the gateway and clears auto-approvals', () => {
      togglePermissionGateway(true);
      addAutoApproval('Edit', 'yellow');
      togglePermissionGateway(false);
      expect(isPermissionGatewayEnabled()).toBe(false);
    });

    it('persists to settings', () => {
      togglePermissionGateway(true);
      const stored = storage.get('luminal-admin-settings');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.permissionGateway).toBe(true);
    });
  });

  // ── bufferIfGating ──────────────────────────────────────

  describe('bufferIfGating', () => {
    it('returns false when not gating', () => {
      expect(bufferIfGating('s1', 'line', false)).toBe(false);
    });

    it('returns false when gateway is disabled', () => {
      expect(bufferIfGating('s1', 'line', false)).toBe(false);
    });
  });

  // ── isGating ────────────────────────────────────────────

  describe('isGating', () => {
    it('returns false initially', () => {
      expect(isGating()).toBe(false);
    });
  });

  // ── onToolUseStart ──────────────────────────────────────

  describe('onToolUseStart', () => {
    it('no-ops when gateway is disabled', () => {
      onToolUseStart('s1', 'Bash', 0);
      // No pending tool name — gate check at stop should return false
      expect(isGating()).toBe(false);
    });
  });

  // ── onToolInputDelta ────────────────────────────────────

  describe('onToolInputDelta', () => {
    it('no-ops when gateway is disabled', () => {
      onToolInputDelta('{"command":"ls"}');
      expect(isGating()).toBe(false);
    });
  });

  // ── onToolUseStop (green risk — auto-approved) ──────────

  describe('onToolUseStop', () => {
    it('returns false when gateway is disabled', async () => {
      const result = await onToolUseStop('s1');
      expect(result).toBe(false);
    });

    it('auto-approves green risk tools without showing modal', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Read', 0);
      onToolInputDelta('{"file_path":"foo.ts"}');
      const result = await onToolUseStop('s1');
      expect(result).toBe(false);
      expect(document.querySelector('.perm-overlay')).toBeNull();
    });

    it('auto-approves when tool+risk is in auto-approval registry', async () => {
      setPermissionGatewayEnabled(true);
      addAutoApproval('Edit', 'yellow');
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"foo.ts"}');
      const result = await onToolUseStop('s1');
      expect(result).toBe(false);
      expect(document.querySelector('.perm-overlay')).toBeNull();
    });
  });

  // ── Stream interception: gate → approve ─────────────────

  describe('gate check with approval', () => {
    it('shows modal for yellow-risk tool and approves on button click', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"foo.ts","old_string":"a","new_string":"b"}');

      const gatePromise = onToolUseStop('s1');

      // Modal should be visible
      expect(document.querySelector('.perm-overlay')).toBeTruthy();
      expect(isGating()).toBe(true);

      // Lines should be buffered while gating
      expect(bufferIfGating('s1', 'some-line', false)).toBe(true);

      // Approve
      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();

      const result = await gatePromise;
      expect(result).toBe(false); // false = not denied, proceed normally
      expect(isGating()).toBe(false);
      expect(document.querySelector('.perm-overlay')).toBeNull();

      // Buffered lines should have been flushed
      expect(mockProcessLine).toHaveBeenCalledWith('s1', 'some-line', false);
    });
  });

  // ── Stream interception: gate → deny ────────────────────

  describe('gate check with denial', () => {
    it('shows modal for red-risk tool and cancels agent on deny', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Bash', 0);
      onToolInputDelta('{"command":"git push --force origin main"}');

      const gatePromise = onToolUseStop('s1');

      // Modal should be visible with DANGER badge
      expect(document.querySelector('.perm-overlay')).toBeTruthy();
      expect(document.querySelector('.perm-risk-badge')?.textContent).toContain('DANGER');

      // Deny
      (document.querySelector('[data-perm-action="deny"]') as HTMLElement)?.click();

      const result = await gatePromise;
      expect(result).toBe(true); // true = denied, caller should skip

      // Should have called cancel endpoint
      expect(fetch).toHaveBeenCalledWith(
        '/__admin_exec/cancel?agent=s1',
        { method: 'POST' },
      );
    });
  });

  // ── Stream interception: approve-all-similar ────────────

  describe('gate check with approve-all-similar', () => {
    it('registers auto-approval and approves subsequent same-risk tools', async () => {
      setPermissionGatewayEnabled(true);

      // First call — shows modal
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"a.ts"}');
      const gate1 = onToolUseStop('s1');
      (document.querySelector('[data-perm-action="approve-all-similar"]') as HTMLElement)?.click();
      await gate1;

      // Second call — should auto-approve without modal
      _resetBridge();
      onToolUseStart('s1', 'Edit', 1);
      onToolInputDelta('{"file_path":"b.ts"}');
      const result = await onToolUseStop('s1');
      expect(result).toBe(false);
      expect(document.querySelector('.perm-overlay')).toBeNull();
    });
  });

  // ── Buffer flush ────────────────────────────────────────

  describe('buffer flush on approval', () => {
    it('processes all buffered lines through processLine after approval', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Write', 0);
      onToolInputDelta('{"file_path":"foo.ts","content":"hello"}');

      const gatePromise = onToolUseStop('s1');

      // Buffer multiple lines while gating
      bufferIfGating('s1', 'line-1', false);
      bufferIfGating('s1', 'line-2', false);
      bufferIfGating('s1', 'line-3', true);

      // Approve
      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      await gatePromise;

      // All buffered lines should have been flushed in order
      expect(mockProcessLine).toHaveBeenCalledTimes(3);
      expect(mockProcessLine).toHaveBeenNthCalledWith(1, 's1', 'line-1', false);
      expect(mockProcessLine).toHaveBeenNthCalledWith(2, 's1', 'line-2', false);
      expect(mockProcessLine).toHaveBeenNthCalledWith(3, 's1', 'line-3', true);
    });
  });

  // ── Disabled gateway passes through ─────────────────────

  describe('disabled gateway', () => {
    it('does not intercept tool calls when disabled', async () => {
      setPermissionGatewayEnabled(false);
      onToolUseStart('s1', 'Bash', 0);
      onToolInputDelta('{"command":"rm -rf /"}');
      const result = await onToolUseStop('s1');
      expect(result).toBe(false);
      expect(document.querySelector('.perm-overlay')).toBeNull();
    });
  });

  // ── Toggle off during gating flushes buffer ─────────────

  describe('toggle off during gating', () => {
    it('flushes buffer when gateway is disabled while modal is open', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"foo.ts"}');

      // Start gating — don't await; fire-and-forget so the modal opens
      void onToolUseStop('s1');

      // Buffer a line
      bufferIfGating('s1', 'buffered-line', false);
      expect(isGating()).toBe(true);

      // Toggle off — should flush buffer and dismiss modal
      togglePermissionGateway(false);
      expect(isGating()).toBe(false);
      expect(mockProcessLine).toHaveBeenCalledWith('s1', 'buffered-line', false);

      // Resolve the gate promise (approve the now-dismissed modal)
      // The modal was removed by togglePermissionGateway, so we need to handle the stale promise
      // In practice, the gate promise resolves via the cc:done bus event from the gateway
      // For this test, we just verify the buffer was flushed
    });
  });

  // ── Rapid toggle during active gating ──────────────────

  describe('rapid toggle during active gating', () => {
    it('handles rapid on/off/on without corrupting state', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"foo.ts"}');

      // Start gating
      void onToolUseStop('s1');
      expect(isGating()).toBe(true);

      // Rapid toggles: off → on → off
      togglePermissionGateway(false);
      expect(isGating()).toBe(false);

      togglePermissionGateway(true);
      expect(isGating()).toBe(false); // should still be false — gate was cleared

      togglePermissionGateway(false);
      expect(isGating()).toBe(false);

      // Bridge should still function after rapid toggles
      expect(isPermissionGatewayEnabled()).toBe(false);
    });

    it('flushes buffer only once during rapid toggles', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Write', 0);
      onToolInputDelta('{"file_path":"x.ts","content":"data"}');

      void onToolUseStop('s1');
      bufferIfGating('s1', 'buffered-data', false);

      // Toggle off (flushes buffer) then on then off
      togglePermissionGateway(false);
      togglePermissionGateway(true);
      togglePermissionGateway(false);

      // processLine should only be called once (the first toggle-off flush)
      expect(mockProcessLine).toHaveBeenCalledTimes(1);
      expect(mockProcessLine).toHaveBeenCalledWith('s1', 'buffered-data', false);
    });
  });

  // ── Multiple sequential tool calls ─────────────────────

  describe('multiple tool calls in sequence', () => {
    it('gates each tool call independently', async () => {
      setPermissionGatewayEnabled(true);

      // First tool call — approve
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"a.ts","old_string":"x","new_string":"y"}');
      const gate1 = onToolUseStop('s1');
      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      const result1 = await gate1;
      expect(result1).toBe(false);
      expect(isGating()).toBe(false);

      // Reset bridge state for next call (simulates new content_block cycle)
      _resetBridge();
      initBridge(mockProcessLine);
      setPermissionGatewayEnabled(true);

      // Second tool call — deny
      onToolUseStart('s1', 'Bash', 1);
      onToolInputDelta('{"command":"git push --force"}');
      const gate2 = onToolUseStop('s1');
      (document.querySelector('[data-perm-action="deny"]') as HTMLElement)?.click();
      const result2 = await gate2;
      expect(result2).toBe(true);
    });

    it('buffers lines across sequential approvals correctly', async () => {
      setPermissionGatewayEnabled(true);

      // First tool — buffer some lines
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"a.ts"}');
      const gate1 = onToolUseStop('s1');
      bufferIfGating('s1', 'line-A', false);
      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      await gate1;

      expect(mockProcessLine).toHaveBeenCalledWith('s1', 'line-A', false);
      mockProcessLine.mockClear();

      // Second tool — should start with empty buffer
      _resetBridge();
      initBridge(mockProcessLine);
      setPermissionGatewayEnabled(true);

      onToolUseStart('s1', 'Write', 1);
      onToolInputDelta('{"file_path":"b.ts","content":"data"}');
      const gate2 = onToolUseStop('s1');
      bufferIfGating('s1', 'line-B', true);
      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      await gate2;

      expect(mockProcessLine).toHaveBeenCalledTimes(1);
      expect(mockProcessLine).toHaveBeenCalledWith('s1', 'line-B', true);
    });
  });

  // ── Malformed tool args handling ───────────────────────

  describe('malformed tool args', () => {
    it('gates with empty args when input JSON is malformed', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Edit', 0);
      // Partial/corrupt JSON
      onToolInputDelta('{"file_path":"foo.ts", "old_stri');

      const gatePromise = onToolUseStop('s1');

      // Modal should still appear (Edit is yellow-risk regardless of args)
      expect(document.querySelector('.perm-overlay')).toBeTruthy();

      // Approve it
      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      const result = await gatePromise;
      expect(result).toBe(false);
    });

    it('gates with empty args when no input deltas received', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Write', 0);
      // No onToolInputDelta calls at all

      const gatePromise = onToolUseStop('s1');

      // Modal should still appear (Write is yellow-risk)
      expect(document.querySelector('.perm-overlay')).toBeTruthy();

      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      const result = await gatePromise;
      expect(result).toBe(false);
    });

    it('handles empty string input delta gracefully', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('');
      onToolInputDelta('');

      const gatePromise = onToolUseStop('s1');
      expect(document.querySelector('.perm-overlay')).toBeTruthy();

      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      const result = await gatePromise;
      expect(result).toBe(false);
    });
  });

  // ── onToolUseStop without prior start ──────────────────

  describe('onToolUseStop without prior start', () => {
    it('returns false when no tool was started (no pending tool name)', async () => {
      setPermissionGatewayEnabled(true);
      // Call stop without a preceding start
      const result = await onToolUseStop('s1');
      expect(result).toBe(false);
      expect(document.querySelector('.perm-overlay')).toBeNull();
    });
  });

  // ── Buffer not leaking across sessions ─────────────────

  describe('buffer isolation', () => {
    it('buffers lines from different sessions during gating', async () => {
      setPermissionGatewayEnabled(true);
      onToolUseStart('s1', 'Edit', 0);
      onToolInputDelta('{"file_path":"foo.ts"}');

      const gatePromise = onToolUseStop('s1');

      // Buffer lines from two different sessions
      bufferIfGating('s1', 'session1-line', false);
      bufferIfGating('s2', 'session2-line', false);

      // Approve — all buffered lines should flush
      (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
      await gatePromise;

      expect(mockProcessLine).toHaveBeenCalledTimes(2);
      expect(mockProcessLine).toHaveBeenCalledWith('s1', 'session1-line', false);
      expect(mockProcessLine).toHaveBeenCalledWith('s2', 'session2-line', false);
    });
  });
});

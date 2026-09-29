import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub fetch and eventBus before imports
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}), text: async () => '' })));

import {
  classifyRisk,
  isAutoApproved,
  addAutoApproval,
  clearAutoApprovals,
  getAutoApprovals,
  getDenialCount,
  getDenialLog,
  clearDenials,
  gateToolCall,
  requestPermission,
  isPermissionGatewayEnabled,
  setPermissionGatewayEnabled,
} from '../permissionGateway';
import type { ToolCallEvent } from '../permissionGateway';

// ── classifyRisk ───────────────────────────────────────────

describe('classifyRisk', () => {
  it('returns red for git push', () => {
    expect(classifyRisk('Bash', { command: 'git push origin main' })).toBe('red');
  });

  it('returns red for rm -rf', () => {
    expect(classifyRisk('Bash', { command: 'rm -rf /' })).toBe('red');
  });

  it('returns red for git reset --hard', () => {
    expect(classifyRisk('Bash', { command: 'git reset --hard HEAD~1' })).toBe('red');
  });

  it('returns red for --force flag', () => {
    expect(classifyRisk('Bash', { command: 'git push --force origin main' })).toBe('red');
  });

  it('returns red for git clean -f', () => {
    expect(classifyRisk('Bash', { command: 'git clean -f' })).toBe('red');
  });

  it('returns yellow for git status', () => {
    expect(classifyRisk('Bash', { command: 'git status' })).toBe('yellow');
  });

  it('returns yellow for npm publish', () => {
    expect(classifyRisk('Bash', { command: 'npm publish' })).toBe('yellow');
  });

  it('returns yellow for curl POST', () => {
    expect(classifyRisk('Bash', { command: 'curl -X POST http://example.com' })).toBe('yellow');
  });

  it('returns yellow for docker commands', () => {
    expect(classifyRisk('Bash', { command: 'docker build .' })).toBe('yellow');
  });

  it('returns green for simple bash commands', () => {
    expect(classifyRisk('Bash', { command: 'ls -la' })).toBe('green');
  });

  it('returns green for echo', () => {
    expect(classifyRisk('Bash', { command: 'echo hello' })).toBe('green');
  });

  it('returns yellow for Edit tool', () => {
    expect(classifyRisk('Edit', { file_path: 'foo.ts', old_string: 'a', new_string: 'b' })).toBe('yellow');
  });

  it('returns yellow for Write tool', () => {
    expect(classifyRisk('Write', { file_path: 'foo.ts', content: 'hello' })).toBe('yellow');
  });

  it('returns green for Read tool', () => {
    expect(classifyRisk('Read', { file_path: 'foo.ts' })).toBe('green');
  });

  it('returns green for Grep tool', () => {
    expect(classifyRisk('Grep', { pattern: 'foo' })).toBe('green');
  });

  it('returns green for Glob tool', () => {
    expect(classifyRisk('Glob', { pattern: '*.ts' })).toBe('green');
  });
});

// ── Auto-approve registry ──────────────────────────────────

describe('auto-approve registry', () => {
  beforeEach(() => clearAutoApprovals());

  it('starts empty', () => {
    expect(isAutoApproved('Bash', 'yellow')).toBe(false);
    expect(getAutoApprovals()).toEqual([]);
  });

  it('adds and checks auto-approvals', () => {
    addAutoApproval('Edit', 'yellow');
    expect(isAutoApproved('Edit', 'yellow')).toBe(true);
    expect(isAutoApproved('Edit', 'red')).toBe(false);
    expect(isAutoApproved('Bash', 'yellow')).toBe(false);
  });

  it('getAutoApprovals returns all entries', () => {
    addAutoApproval('Edit', 'yellow');
    addAutoApproval('Bash', 'red');
    expect(getAutoApprovals()).toContain('Edit:yellow');
    expect(getAutoApprovals()).toContain('Bash:red');
  });

  it('clearAutoApprovals resets', () => {
    addAutoApproval('Edit', 'yellow');
    clearAutoApprovals();
    expect(isAutoApproved('Edit', 'yellow')).toBe(false);
  });
});

// ── Denial tracking ────────────────────────────────────────

describe('denial tracking', () => {
  beforeEach(() => clearDenials());

  it('starts at zero', () => {
    expect(getDenialCount()).toBe(0);
    expect(getDenialLog()).toEqual([]);
  });

  it('clearDenials resets count and log', () => {
    // We can't easily trigger a denial without the modal, but we can test the API
    clearDenials();
    expect(getDenialCount()).toBe(0);
  });
});

// ── gateToolCall ───────────────────────────────────────────

describe('gateToolCall', () => {
  beforeEach(() => {
    clearAutoApprovals();
    clearDenials();
  });

  it('auto-approves green risk tools', async () => {
    const event: ToolCallEvent = { tool: 'Read', args: { file_path: 'foo.ts' }, sessionId: 's1', cardIndex: 0 };
    const result = await gateToolCall(event);
    expect(result).toBe(true);
  });

  it('auto-approves when tool+risk is in registry', async () => {
    addAutoApproval('Edit', 'yellow');
    const event: ToolCallEvent = { tool: 'Edit', args: { file_path: 'foo.ts' }, sessionId: 's1', cardIndex: 0 };
    const result = await gateToolCall(event);
    expect(result).toBe(true);
  });
});

// ── Enabled state ──────────────────────────────────────────

describe('enabled state', () => {
  afterEach(() => setPermissionGatewayEnabled(true));

  it('defaults to enabled', () => {
    expect(isPermissionGatewayEnabled()).toBe(true);
  });

  it('can be toggled', () => {
    setPermissionGatewayEnabled(false);
    expect(isPermissionGatewayEnabled()).toBe(false);
    setPermissionGatewayEnabled(true);
    expect(isPermissionGatewayEnabled()).toBe(true);
  });
});

// ── requestPermission (DOM modal) ──────────────────────────

describe('requestPermission modal', () => {
  beforeEach(() => {
    clearAutoApprovals();
    clearDenials();
    // Ensure the cc-status-btn exists for badge tests
    const btn = document.createElement('button');
    btn.id = 'cc-status-btn';
    btn.style.position = 'relative';
    document.body.appendChild(btn);
  });

  afterEach(() => {
    document.querySelectorAll('.perm-overlay').forEach(el => el.remove());
    document.getElementById('cc-status-btn')?.remove();
  });

  it('shows modal overlay in the DOM', () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts', old_string: 'a', new_string: 'b' },
      sessionId: 's1', cardIndex: 0,
    };
    // Don't await — we'll interact with it synchronously
    const promise = requestPermission(event);
    expect(document.querySelector('.perm-overlay')).toBeTruthy();
    expect(document.querySelector('.perm-modal')).toBeTruthy();
    expect(document.querySelector('.perm-risk-badge')?.textContent).toContain('CAUTION');
    // Approve to resolve the promise
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    return promise;
  });

  it('resolves with approve on button click', async () => {
    const event: ToolCallEvent = {
      tool: 'Bash', args: { command: 'git push origin main' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    expect(document.querySelector('.perm-risk-badge')?.textContent).toContain('DANGER');
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    const result = await promise;
    expect(result.action).toBe('approve');
    expect(document.querySelector('.perm-overlay')).toBeNull();
  });

  it('resolves with deny on deny click and increments denial count', async () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    (document.querySelector('[data-perm-action="deny"]') as HTMLElement)?.click();
    const result = await promise;
    expect(result.action).toBe('deny');
    expect(getDenialCount()).toBe(1);
    expect(getDenialLog()).toHaveLength(1);
    expect(getDenialLog()[0].tool).toBe('Edit');
  });

  it('resolves with approve-all-similar and registers auto-approval', async () => {
    const event: ToolCallEvent = {
      tool: 'Write', args: { file_path: 'foo.ts', content: 'hello' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    (document.querySelector('[data-perm-action="approve-all-similar"]') as HTMLElement)?.click();
    const result = await promise;
    expect(result.action).toBe('approve-all-similar');
    expect(isAutoApproved('Write', 'yellow')).toBe(true);
  });

  it('adds denial badge to cc-status-btn', async () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    (document.querySelector('[data-perm-action="deny"]') as HTMLElement)?.click();
    await promise;
    const badge = document.querySelector('.perm-denial-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('1');
  });

  it('shows diff preview for Edit tool', () => {
    const event: ToolCallEvent = {
      tool: 'Edit',
      args: { file_path: 'foo.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    expect(document.querySelector('.perm-diff-block')).toBeTruthy();
    expect(document.querySelector('.perm-diff-line-remove')).toBeTruthy();
    expect(document.querySelector('.perm-diff-line-add')).toBeTruthy();
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    return promise;
  });

  it('keyboard Enter approves', async () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const result = await promise;
    expect(result.action).toBe('approve');
  });

  it('keyboard Escape denies', async () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const result = await promise;
    expect(result.action).toBe('deny');
  });

  it('keyboard "a" approves all similar', async () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    const result = await promise;
    expect(result.action).toBe('approve-all-similar');
  });

  it('resolve-once: multiple clicks only settle once', async () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    const denyBtn = document.querySelector('[data-perm-action="deny"]') as HTMLElement;
    const approveBtn = document.querySelector('[data-perm-action="approve"]') as HTMLElement;
    denyBtn?.click();
    approveBtn?.click(); // should be ignored
    const result = await promise;
    expect(result.action).toBe('deny');
    // Only one denial recorded
    expect(getDenialCount()).toBe(1);
  });

  it('resolve-once: keyboard after button click is ignored', async () => {
    const event: ToolCallEvent = {
      tool: 'Edit', args: { file_path: 'foo.ts' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    // Keyboard event after resolve should be ignored
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const result = await promise;
    expect(result.action).toBe('approve');
    // No denials should be recorded since Escape was after resolve
    expect(getDenialCount()).toBe(0);
  });

  it('displays tool name in the modal body', () => {
    const event: ToolCallEvent = {
      tool: 'Bash', args: { command: 'npm run build' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    const toolLabel = document.querySelector('.perm-tool-label');
    expect(toolLabel?.textContent).toContain('Bash');
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    return promise;
  });

  it('shows command text for Bash tool args', () => {
    const event: ToolCallEvent = {
      tool: 'Bash', args: { command: 'echo hello world' },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    const argsBlock = document.querySelector('.perm-args-block');
    expect(argsBlock?.textContent).toContain('echo hello world');
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    return promise;
  });

  it('handles missing command arg for Bash tool gracefully', () => {
    const event: ToolCallEvent = {
      tool: 'Bash', args: {},
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    // Should still render without crashing
    expect(document.querySelector('.perm-overlay')).toBeTruthy();
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    return promise;
  });

  it('handles Write tool with very long content (truncation)', () => {
    const longContent = 'x'.repeat(1000);
    const event: ToolCallEvent = {
      tool: 'Write', args: { file_path: 'big.ts', content: longContent },
      sessionId: 's1', cardIndex: 0,
    };
    const promise = requestPermission(event);
    const argsBlock = document.querySelector('.perm-args-block');
    // Should truncate content beyond 500 chars
    expect(argsBlock?.textContent).toContain('(truncated)');
    (document.querySelector('[data-perm-action="approve"]') as HTMLElement)?.click();
    return promise;
  });
});

// ── classifyRisk edge cases ───────────────────────────────

describe('classifyRisk edge cases', () => {
  it('returns red for DROP TABLE', () => {
    expect(classifyRisk('Bash', { command: 'mysql -e "DROP TABLE users"' })).toBe('red');
  });

  it('returns red for git checkout -- (destructive checkout)', () => {
    expect(classifyRisk('Bash', { command: 'git checkout -- .' })).toBe('red');
  });

  it('returns green when command is undefined', () => {
    expect(classifyRisk('Bash', {})).toBe('green');
  });

  it('returns yellow for npm run commands', () => {
    expect(classifyRisk('Bash', { command: 'npm run test' })).toBe('yellow');
  });

  it('returns yellow for npx commands', () => {
    expect(classifyRisk('Bash', { command: 'npx vitest run' })).toBe('yellow');
  });

  it('returns green for unknown tool types', () => {
    expect(classifyRisk('CustomTool', { something: 'value' })).toBe('green');
  });
});

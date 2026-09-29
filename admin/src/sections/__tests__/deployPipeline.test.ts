// admin/src/sections/__tests__/deployPipeline.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DeployRecord } from '../../types';

// Stub fetch — tests install their own responses per-test.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Prevent the SSE stream from firing during tests.
class FakeEventSource {
  url: string;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; }
  addEventListener(): void { /* noop */ }
  close(): void { /* noop */ }
}
vi.stubGlobal('EventSource', FakeEventSource);

import { renderDeployPipeline } from '../deployPipeline';

function fetchJson(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('renderDeployPipeline', () => {
  let container: HTMLElement;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '<div id="section-deploy-pipeline"></div>';
    container = document.getElementById('section-deploy-pipeline')!;
    mockFetch.mockReset();
    // Default: history is empty.
    mockFetch.mockResolvedValue(fetchJson([]));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('renders the Deploy Pipeline heading and controls', async () => {
    cleanup = renderDeployPipeline(container);
    expect(container.innerHTML).toContain('Deploy Pipeline');
    expect(container.querySelector('#deploy-target')).toBeTruthy();
    expect(container.querySelector('button[data-action="deploy"]')).toBeTruthy();
    expect(container.querySelector('button[data-action="dry-run"]')).toBeTruthy();
    expect(container.querySelector('#deploy-log')).toBeTruthy();
    expect(container.querySelector('#deploy-history-tbody')).toBeTruthy();
  });

  it('target picker contains the five allowed targets', () => {
    cleanup = renderDeployPipeline(container);
    const options = container.querySelectorAll<HTMLOptionElement>('#deploy-target option');
    const values = [...options].map(o => o.value);
    expect(values).toEqual(['live', 'test', 'rules', 'functions', 'hosting']);
  });

  it('populates history table from /__admin_deploy/history', async () => {
    const records: DeployRecord[] = [
      {
        id: 'd1',
        target: 'test',
        startedAt: Date.now() - 10_000,
        finishedAt: Date.now() - 5_000,
        status: 'success',
        exitCode: 0,
      },
      {
        id: 'd2',
        target: 'rules',
        startedAt: Date.now() - 60_000,
        finishedAt: Date.now() - 55_000,
        status: 'failure',
        exitCode: 1,
      },
    ];
    mockFetch.mockResolvedValueOnce(fetchJson(records));

    cleanup = renderDeployPipeline(container);
    await new Promise(r => setTimeout(r, 0));

    const tbody = container.querySelector('#deploy-history-tbody')!;
    expect(tbody.innerHTML).toContain('d1');
    expect(tbody.innerHTML).toContain('SUCCESS');
    expect(tbody.innerHTML).toContain('FAILURE');
  });

  it('empty history shows "No deploys yet"', async () => {
    mockFetch.mockResolvedValueOnce(fetchJson([]));
    cleanup = renderDeployPipeline(container);
    await new Promise(r => setTimeout(r, 0));
    expect(container.querySelector('#deploy-history-tbody')?.innerHTML)
      .toContain('No deploys yet');
  });

  it('cancelling the confirm on live prevents a run POST', async () => {
    // History call during initial render
    mockFetch.mockResolvedValueOnce(fetchJson([]));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    cleanup = renderDeployPipeline(container);
    await new Promise(r => setTimeout(r, 0));

    mockFetch.mockClear();

    const select = container.querySelector<HTMLSelectElement>('#deploy-target')!;
    select.value = 'live';
    const deployBtn = container.querySelector<HTMLButtonElement>('button[data-action="deploy"]')!;
    deployBtn.click();
    await new Promise(r => setTimeout(r, 0));

    expect(confirmSpy).toHaveBeenCalled();
    // fetch should NOT have been called (no POST) because confirm was cancelled
    expect(mockFetch).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('dry-run skips the confirm and POSTs /run with dryRun:true', async () => {
    mockFetch.mockResolvedValueOnce(fetchJson([])); // initial history
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    cleanup = renderDeployPipeline(container);
    await new Promise(r => setTimeout(r, 0));

    mockFetch.mockResolvedValueOnce(fetchJson({ ok: true, id: 'd-new', agentId: 'a1', command: 'firebase deploy --dry-run' }));
    mockFetch.mockResolvedValueOnce(fetchJson([])); // follow-up loadHistory

    const dryBtn = container.querySelector<HTMLButtonElement>('button[data-action="dry-run"]')!;
    dryBtn.click();
    await new Promise(r => setTimeout(r, 0));

    // Dry-run should not have prompted confirm at all
    expect(confirmSpy).not.toHaveBeenCalled();

    // And should have POSTed /__admin_deploy/run
    const runCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/__admin_deploy/run'));
    expect(runCall).toBeTruthy();
    const init = runCall?.[1] as RequestInit | undefined;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body ?? '{}')) as { target: string; dryRun: boolean };
    expect(body.dryRun).toBe(true);

    confirmSpy.mockRestore();
  });

  it('cleanup removes rendered markup', () => {
    cleanup = renderDeployPipeline(container);
    expect(container.innerHTML).toContain('Deploy Pipeline');
    cleanup();
    cleanup = null;
    expect(container.innerHTML).toBe('');
  });
});

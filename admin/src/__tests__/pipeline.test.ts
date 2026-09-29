import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineStatus, DeployEntry, CoverageEntry } from '../types';

// ── Mock imports that use browser APIs or server endpoints ──
vi.mock('../ui/ccPanel', () => ({
  dispatchCC: vi.fn(),
}));

vi.mock('../ui/confirm', () => ({
  confirmAction: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  document.body.innerHTML = '<div id="section-pipeline" class="section"></div>';
  mockFetch.mockReset();
});

import { renderPipeline } from '../sections/pipeline';

function mockStatus(overrides: Partial<PipelineStatus> = {}): PipelineStatus {
  return {
    build: { status: 'completed', conclusion: 'success', runNumber: 47, branch: 'main', sha: 'abc1234', updatedAt: '2026-04-05T14:00:00Z', url: 'https://github.com/run/47' },
    deploy: { version: 'v1.0.7', timestamp: '2026-04-05T14:30:00Z', target: 'live+test', commit: 'abc1234', branch: 'main', notes: ['test'], duration: 45 },
    coverage: { percent: 78.5, testCount: 76, delta: 2.1 },
    prs: { open: 2, unaddressedAIComments: 3 },
    ...overrides,
  };
}

function mockDeploys(): DeployEntry[] {
  return [
    { version: 'v1.0.7', timestamp: '2026-04-05T14:30:00Z', target: 'live+test', commit: 'abc1234', branch: 'main', notes: ['test'], duration: 45 },
    { version: 'v1.0.6', timestamp: '2026-04-03T10:00:00Z', target: 'live+test', commit: 'def5678', branch: 'main', notes: ['prev'], duration: 40 },
  ];
}

function mockCoverage(): CoverageEntry[] {
  return [
    { timestamp: '2026-04-01T00:00:00Z', commit: 'aaa', branch: 'main', coverage: 72.0, testCount: 70, passed: 70, failed: 0, duration: 9 },
    { timestamp: '2026-04-03T00:00:00Z', commit: 'bbb', branch: 'main', coverage: 75.0, testCount: 73, passed: 73, failed: 0, duration: 9.5 },
    { timestamp: '2026-04-05T00:00:00Z', commit: 'ccc', branch: 'main', coverage: 78.5, testCount: 76, passed: 76, failed: 0, duration: 10 },
  ];
}

// Helper: set up fetch mocks for a standard render
function setupFetchMocks(status = mockStatus(), deploys = mockDeploys(), coverage = mockCoverage()) {
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(status) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(deploys) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(coverage) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ workflow_runs: [] }) }) // CI runs
    // AI review summary fetches: pulls list, then per-PR reviews/comments/issue-comments
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }); // pulls (empty = no AI reviews)
}

describe('pipeline section', () => {
  it('renders Pipeline heading and status strip', async () => {
    setupFetchMocks();
    const el = document.getElementById('section-pipeline')!;
    await renderPipeline(el);

    expect(el.innerHTML).toContain('Pipeline');
    expect(el.innerHTML).toContain('v1.0.7');
    expect(el.innerHTML).toContain('78.5%');
  });

  it('renders gracefully with empty data', async () => {
    const emptyStatus: PipelineStatus = { build: null, deploy: null, coverage: null, prs: { open: 0, unaddressedAIComments: 0 } };
    setupFetchMocks(emptyStatus, [], []);
    const el = document.getElementById('section-pipeline')!;
    await renderPipeline(el);

    expect(el.innerHTML).toContain('Pipeline');
    expect(el.innerHTML).toContain('No deploys');
  });

  it('renders deploy history with rollback buttons', async () => {
    setupFetchMocks();
    const el = document.getElementById('section-pipeline')!;
    await renderPipeline(el);

    expect(el.innerHTML).toContain('Rollback');
    expect(el.innerHTML).toContain('v1.0.6');
  });

  it('renders coverage sparkline from history', async () => {
    setupFetchMocks();
    const el = document.getElementById('section-pipeline')!;
    await renderPipeline(el);

    // Sparkline uses block characters
    expect(el.innerHTML).toMatch(/[\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588]/);
  });

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const el = document.getElementById('section-pipeline')!;
    await renderPipeline(el);

    expect(el.innerHTML).toContain('Failed to load');
    expect(el.innerHTML).toContain('Retry');
  });
});

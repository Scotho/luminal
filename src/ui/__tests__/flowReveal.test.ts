/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const mockStopTally = vi.fn();
vi.mock('../../sfxAssets', () => ({
  startRewardTally: vi.fn(() => mockStopTally),
  playRewardTotal: vi.fn(),
  playRewardLevelUp: vi.fn(),
}));

import { startRewardTally, playRewardTotal } from '../../sfxAssets';
import { playFlowReveal, resetFlowReveal, requestSkipFlowReveal } from '../flowReveal';
import type { RoundResult } from '../../flow/flowTypes';

function setupDOM() {
  document.body.innerHTML = `
    <div id="flow-reveal" class="flow-reveal hidden">
      <div class="flow-reveal__trick-log" id="flow-reveal-log"></div>
      <div class="flow-reveal__subtotal">
        <span class="flow-reveal__subtotal-label">SUBTOTAL</span>
        <span class="flow-reveal__subtotal-value" id="flow-reveal-subtotal">0</span>
      </div>
      <div class="flow-reveal__mult hidden" id="flow-reveal-mult">
        <span class="flow-reveal__mult-streak" id="flow-reveal-mult-streak"></span>
        <span class="flow-reveal__mult-x" id="flow-reveal-mult-x"></span>
      </div>
      <div class="flow-reveal__total">
        <span class="flow-reveal__total-label">FLOW</span>
        <span class="flow-reveal__total-value" id="flow-reveal-total">0</span>
      </div>
    </div>
  `;
}

function makeWinResult(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    passiveSubtotal: 200,
    bonusSubtotal: 125,
    subtotal: 325,
    multiplier: 3,
    tierIndex: 1,
    awarded: 975,
    capApplied: 'none',
    died: false,
    trickLog: [
      { kind: 'elimination', amount: 125, count: 1 },
      { kind: 'slipstream', amount: 200 },
      { kind: 'survival', amount: 45 },
    ],
    ...overrides,
  };
}

function makeDeathResult(): RoundResult {
  return {
    passiveSubtotal: 50,
    bonusSubtotal: 0,
    subtotal: 50,
    multiplier: 1,
    tierIndex: 0,
    awarded: 0,
    capApplied: 'none',
    died: true,
    trickLog: [{ kind: 'slipstream', amount: 50 }],
  };
}

describe('flowReveal', () => {
  beforeEach(() => {
    setupDOM();
    vi.useFakeTimers();
    mockStopTally.mockClear();
    vi.mocked(startRewardTally).mockClear();
    vi.mocked(playRewardTotal).mockClear();
  });

  afterEach(() => {
    resetFlowReveal();
    vi.useRealTimers();
  });

  it('playFlowReveal shows container and eventually sets final value', async () => {
    const result = makeWinResult();
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;

    const total = document.getElementById('flow-reveal-total')!;
    expect(total.textContent).toBe('975');
  });

  it('death result adds flow-reveal--died class', async () => {
    const result = makeDeathResult();
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;

    const container = document.getElementById('flow-reveal')!;
    expect(container.classList.contains('flow-reveal--died')).toBe(true);
  });

  it('death result does not show multiplier', async () => {
    const result = makeDeathResult();
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;

    // Multiplier is 1x so it stays hidden
    const mult = document.getElementById('flow-reveal-mult')!;
    expect(mult.classList.contains('hidden')).toBe(true);
  });

  it('requestSkipFlowReveal resolves immediately', async () => {
    const result = makeWinResult();
    const p = playFlowReveal(result);
    requestSkipFlowReveal();
    await p;

    const totalWrap = document.getElementById('flow-reveal-total')!.parentElement!;
    expect(totalWrap.classList.contains('revealed')).toBe(true);
  });

  it('multiplier = 1 does not show mult element', async () => {
    const result = makeWinResult({ multiplier: 1, tierIndex: 0, awarded: 325 });
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;

    const mult = document.getElementById('flow-reveal-mult')!;
    expect(mult.classList.contains('hidden')).toBe(true);
  });

  it('renders trick log rows with correct kind data attributes', async () => {
    const result = makeWinResult();
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;

    const log = document.getElementById('flow-reveal-log')!;
    const rows = log.querySelectorAll('.flow-reveal__log-row');
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute('data-kind')).toBe('elimination');
    expect(rows[1].getAttribute('data-kind')).toBe('slipstream');
    expect(rows[2].getAttribute('data-kind')).toBe('survival');
  });

  it('resetFlowReveal hides the container', () => {
    const container = document.getElementById('flow-reveal')!;
    container.classList.remove('hidden');
    resetFlowReveal();
    expect(container.classList.contains('hidden')).toBe(true);
  });

  it('empty trick log still shows subtotal and total', async () => {
    const result = makeWinResult({ trickLog: [], subtotal: 100, awarded: 100, multiplier: 1, tierIndex: 0 });
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;

    const log = document.getElementById('flow-reveal-log')!;
    expect(log.children.length).toBe(0);
    const total = document.getElementById('flow-reveal-total')!;
    expect(total.textContent).toBe('100');
  });

  it('starts tally sound on reveal and stops it before total', async () => {
    const result = makeWinResult();
    const p = playFlowReveal(result);
    expect(startRewardTally).toHaveBeenCalled();
    vi.runAllTimers();
    await p;
    expect(mockStopTally).toHaveBeenCalled();
  });

  it('plays total sound when final value is revealed', async () => {
    const result = makeWinResult();
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;
    expect(playRewardTotal).toHaveBeenCalled();
  });

  it('does not start tally sound on death (fast-forwarded)', async () => {
    vi.mocked(startRewardTally).mockClear();
    const result = makeDeathResult();
    const p = playFlowReveal(result);
    vi.runAllTimers();
    await p;
    expect(startRewardTally).not.toHaveBeenCalled();
  });
});

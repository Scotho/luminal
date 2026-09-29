// admin/src/ui/__tests__/conversationNav.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConversationNav } from '../conversationNav';

let container: HTMLElement;
let ctrl: ReturnType<typeof createConversationNav>;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  container.innerHTML = `
    <div class="conv-turn">Block 1</div>
    <div class="conv-tool"><div class="conv-tool-header">Tool</div><div class="conv-tool-body">body</div></div>
    <div class="conv-turn">Block 3</div>
    <div class="conv-result">Result</div>
  `;
  document.body.appendChild(container);
  ctrl = createConversationNav(container);
  ctrl.attach();
});

afterEach(() => {
  ctrl.detach();
  container.remove();
});

function pressKey(key: string, opts: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('conversationNav', () => {
  it('j moves activeIdx from -1 to 0 (first block gets .conv-nav-active)', () => {
    expect(ctrl.getActiveIndex()).toBe(-1);
    pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(0);
    const blocks = container.querySelectorAll('.conv-turn, .conv-tool, .conv-agent, .conv-system, .conv-result');
    expect(blocks[0].classList.contains('conv-nav-active')).toBe(true);
  });

  it('j then j moves to index 1', () => {
    pressKey('j');
    pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(1);
  });

  it('k moves back from 1 to 0', () => {
    pressKey('j');
    pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(1);
    pressKey('k');
    expect(ctrl.getActiveIndex()).toBe(0);
  });

  it('k at index 0 stays at 0 (does not go negative)', () => {
    pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(0);
    pressKey('k');
    expect(ctrl.getActiveIndex()).toBe(0);
  });

  it('j at last index stays at last', () => {
    const blockCount = container.querySelectorAll('.conv-turn, .conv-tool, .conv-agent, .conv-system, .conv-result').length;
    for (let i = 0; i < blockCount + 5; i++) pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(blockCount - 1);
  });

  it('active block has .conv-nav-active class', () => {
    pressKey('j');
    pressKey('j');
    const blocks = Array.from(container.querySelectorAll<HTMLElement>('.conv-turn, .conv-tool, .conv-agent, .conv-system, .conv-result'));
    expect(blocks[1].classList.contains('conv-nav-active')).toBe(true);
    // Only one block active at a time
    const activeCount = container.querySelectorAll('.conv-nav-active').length;
    expect(activeCount).toBe(1);
  });

  it('Enter on tool block clicks its .conv-tool-header', () => {
    const header = container.querySelector<HTMLElement>('.conv-tool-header')!;
    const clickSpy = vi.fn();
    header.addEventListener('click', clickSpy);

    // Navigate to index 1 (the conv-tool block)
    pressKey('j'); // 0
    pressKey('j'); // 1
    expect(ctrl.getActiveIndex()).toBe(1);

    pressKey('Enter');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('y copies text to clipboard (mock navigator.clipboard.writeText)', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeSpy },
      writable: true,
      configurable: true,
    });

    pressKey('j');
    pressKey('y');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const blocks = Array.from(container.querySelectorAll<HTMLElement>('.conv-turn, .conv-tool, .conv-agent, .conv-system, .conv-result'));
    expect(writeSpy).toHaveBeenCalledWith(blocks[0].textContent || '');
  });

  it('G scrolls container to bottom (scrollTop set)', () => {
    // jsdom doesn't actually scroll but we can verify the assignment attempt
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    pressKey('G');
    expect(container.scrollTop).toBe(1000);
  });

  it('g twice within 500ms scrolls to top', () => {
    vi.useFakeTimers();
    Object.defineProperty(container, 'scrollTop', {
      writable: true,
      configurable: true,
      value: 999,
    });

    pressKey('g');
    pressKey('g'); // second g within 500ms
    expect(container.scrollTop).toBe(0);

    vi.useRealTimers();
  });

  it('detach removes active class and stops listening', () => {
    pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(0);
    expect(container.querySelectorAll('.conv-nav-active').length).toBe(1);

    ctrl.detach();

    expect(ctrl.getActiveIndex()).toBe(-1);
    expect(container.querySelectorAll('.conv-nav-active').length).toBe(0);

    // Keys should no longer navigate
    pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(-1);
  });

  it('keys are ignored when an input element is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pressKey('j');
    expect(ctrl.getActiveIndex()).toBe(-1);

    input.remove();
  });

  it('ArrowDown works same as j', () => {
    pressKey('ArrowDown');
    expect(ctrl.getActiveIndex()).toBe(0);
  });

  it('ArrowUp works same as k', () => {
    pressKey('j');
    pressKey('j');
    pressKey('ArrowUp');
    expect(ctrl.getActiveIndex()).toBe(0);
  });

  it('p dispatches agent-search:pin event on outputEl', () => {
    const pinSpy = vi.fn();
    container.addEventListener('agent-search:pin', pinSpy);

    pressKey('j');
    pressKey('p');

    expect(pinSpy).toHaveBeenCalledTimes(1);
    const detail = pinSpy.mock.calls[0][0].detail;
    expect(typeof detail.text).toBe('string');

    container.removeEventListener('agent-search:pin', pinSpy);
  });

  it('g single press does not scroll (only sets pending)', () => {
    vi.useFakeTimers();
    container.scrollTop = 500;

    pressKey('g'); // single g, should not scroll
    expect(container.scrollTop).toBe(500);

    vi.runAllTimers(); // timer expires, clears pending
    expect(container.scrollTop).toBe(500); // still no scroll

    vi.useRealTimers();
  });

  it('g pending resets after 500ms timeout', () => {
    vi.useFakeTimers();

    pressKey('g');
    vi.advanceTimersByTime(600); // timer fires

    // Now g again — should not scroll (pending was reset)
    container.scrollTop = 999;
    pressKey('g');
    expect(container.scrollTop).toBe(999); // no scroll, just re-set pending

    vi.useRealTimers();
  });
});

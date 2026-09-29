// admin/src/ui/__tests__/conversationSearch.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { CCCard } from '../../types';
import { makeCCCard } from '../../__tests__/helpers';
import { createConversationSearch } from '../conversationSearch';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML =
    '<div class="conv-turn"><div class="conv-assistant-body">Hello world foo bar</div></div>' +
    '<div class="conv-turn"><div class="conv-assistant-body">Another message with foo in it</div></div>';
  document.body.appendChild(el);
  return el;
}

describe('conversationSearch', () => {
  let container: HTMLElement;
  let cards: CCCard[];
  let getCards: () => CCCard[];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
    cards = [makeCCCard({ id: 'c1' }), makeCCCard({ id: 'c2' })];
    getCards = () => cards;
  });

  it('open() shows search bar (.cc-search-bar present)', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();
    expect(container.querySelector('.cc-search-bar')).not.toBeNull();
  });

  it('close() removes search bar (.cc-search-bar null)', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();
    ctrl.close();
    expect(container.querySelector('.cc-search-bar')).toBeNull();
  });

  it('typing query shows match count for 2 matches', async () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const input = container.querySelector('.cc-search-input') as HTMLInputElement;
    expect(input).not.toBeNull();

    input.value = 'foo';
    input.dispatchEvent(new Event('input'));

    const count = container.querySelector('.cc-search-count');
    expect(count).not.toBeNull();
    expect(count!.textContent).toContain('2');
  });

  it('empty query clears match count text', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const input = container.querySelector('.cc-search-input') as HTMLInputElement;

    // First search something
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));

    // Then clear
    input.value = '';
    input.dispatchEvent(new Event('input'));

    const count = container.querySelector('.cc-search-count');
    expect(count!.textContent).toBe('');
  });

  it('search is case-insensitive: "FOO" finds "foo"', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const input = container.querySelector('.cc-search-input') as HTMLInputElement;
    input.value = 'FOO';
    input.dispatchEvent(new Event('input'));

    const count = container.querySelector('.cc-search-count');
    expect(count!.textContent).toContain('2');
  });

  it('destroy() cleans up everything (search bar removed)', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();
    ctrl.destroy();
    expect(container.querySelector('.cc-search-bar')).toBeNull();
  });

  it('shows "0 results" when query has no matches', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const input = container.querySelector('.cc-search-input') as HTMLInputElement;
    input.value = 'zzznomatch';
    input.dispatchEvent(new Event('input'));

    const count = container.querySelector('.cc-search-count');
    expect(count!.textContent).toContain('0');
  });

  it('highlights matching elements with .cc-search-highlight', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const input = container.querySelector('.cc-search-input') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));

    const highlighted = container.querySelectorAll('.cc-search-highlight');
    expect(highlighted.length).toBe(2);
  });

  it('clearing search removes highlights', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const input = container.querySelector('.cc-search-input') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));

    input.value = '';
    input.dispatchEvent(new Event('input'));

    const highlighted = container.querySelectorAll('.cc-search-highlight');
    expect(highlighted.length).toBe(0);
  });

  it('contains prev, next, and close buttons', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    expect(container.querySelector('.cc-search-prev')).not.toBeNull();
    expect(container.querySelector('.cc-search-next')).not.toBeNull();
    expect(container.querySelector('.cc-search-close')).not.toBeNull();
  });

  it('close button removes the search bar', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const closeBtn = container.querySelector('.cc-search-close') as HTMLButtonElement;
    closeBtn.click();

    expect(container.querySelector('.cc-search-bar')).toBeNull();
  });

  it('Escape key closes the search bar', () => {
    const ctrl = createConversationSearch(container, getCards);
    ctrl.open();

    const input = container.querySelector('.cc-search-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(container.querySelector('.cc-search-bar')).toBeNull();
  });
});

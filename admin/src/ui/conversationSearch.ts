// admin/src/ui/conversationSearch.ts — In-conversation Ctrl+F search with match navigation
import type { CCCard } from '../types';

export interface SearchController {
  open(): void;
  close(): void;
  destroy(): void;
}

const SEARCHABLE_SELECTORS = [
  '.conv-assistant-body',
  '.conv-user-body',
  '.conv-tool-body',
  '.conv-result-preview',
];

/** Creates an in-conversation search bar for a flyout thread. */
export function createConversationSearch(
  outputContainer: HTMLElement,
  _getCards: () => CCCard[],
): SearchController {
  let bar: HTMLElement | null = null;
  let matchEls: HTMLElement[] = [];
  let currentIdx = -1;

  function getSearchableEls(): HTMLElement[] {
    return Array.from(
      outputContainer.querySelectorAll<HTMLElement>(SEARCHABLE_SELECTORS.join(', ')),
    );
  }

  function clearHighlights(): void {
    outputContainer
      .querySelectorAll('.cc-search-highlight, .cc-search-highlight--current')
      .forEach((el) => {
        el.classList.remove('cc-search-highlight', 'cc-search-highlight--current');
      });
    matchEls = [];
    currentIdx = -1;
  }

  function updateCurrent(): void {
    matchEls.forEach((el, i) => {
      el.classList.toggle('cc-search-highlight--current', i === currentIdx);
    });
    if (currentIdx >= 0 && matchEls[currentIdx]) {
      matchEls[currentIdx].scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function setCount(text: string): void {
    const counter = bar?.querySelector<HTMLElement>('.cc-search-count');
    if (counter) counter.textContent = text;
  }

  function runSearch(query: string): void {
    clearHighlights();

    if (!query) {
      setCount('');
      return;
    }

    const lower = query.toLowerCase();
    const els = getSearchableEls();

    for (const el of els) {
      if (el.textContent?.toLowerCase().includes(lower)) {
        el.classList.add('cc-search-highlight');
        matchEls.push(el);
      }
    }

    const total = matchEls.length;
    if (total === 0) {
      setCount('0 results');
      return;
    }

    currentIdx = 0;
    updateCurrent();
    setCount(`${currentIdx + 1} of ${total}`);
  }

  function nextMatch(): void {
    if (matchEls.length === 0) return;
    currentIdx = (currentIdx + 1) % matchEls.length;
    updateCurrent();
    setCount(`${currentIdx + 1} of ${matchEls.length}`);
  }

  function prevMatch(): void {
    if (matchEls.length === 0) return;
    currentIdx = (currentIdx - 1 + matchEls.length) % matchEls.length;
    updateCurrent();
    setCount(`${currentIdx + 1} of ${matchEls.length}`);
  }

  let docHandler: ((e: KeyboardEvent) => void) | null = null;

  function open(): void {
    if (bar) return;

    bar = document.createElement('div');
    bar.className = 'cc-search-bar';
    bar.innerHTML = [
      '<input class="cc-search-input" type="text" placeholder="Search…" autocomplete="off" />',
      '<span class="cc-search-count"></span>',
      '<button class="cc-search-prev" aria-label="Previous match">▲</button>',
      '<button class="cc-search-next" aria-label="Next match">▼</button>',
      '<button class="cc-search-close" aria-label="Close search">✕</button>',
    ].join('');

    outputContainer.prepend(bar);

    const input = bar.querySelector<HTMLInputElement>('.cc-search-input')!;

    input.addEventListener('input', () => {
      runSearch(input.value.trim());
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          prevMatch();
        } else {
          nextMatch();
        }
      }
    });

    bar.querySelector('.cc-search-prev')!.addEventListener('click', () => prevMatch());
    bar.querySelector('.cc-search-next')!.addEventListener('click', () => nextMatch());
    bar.querySelector('.cc-search-close')!.addEventListener('click', () => close());

    // n/N navigation when search is open but input is not focused
    docHandler = (e: KeyboardEvent): void => {
      if (document.activeElement === input) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'n') {
        e.preventDefault();
        if (e.shiftKey) prevMatch();
        else nextMatch();
      } else if (e.key === 'N') {
        e.preventDefault();
        prevMatch();
      }
    };
    document.addEventListener('keydown', docHandler);

    input.focus();
  }

  function close(): void {
    clearHighlights();
    bar?.remove();
    bar = null;
    if (docHandler) {
      document.removeEventListener('keydown', docHandler);
      docHandler = null;
    }
  }

  function destroy(): void {
    close();
  }

  return { open, close, destroy };
}

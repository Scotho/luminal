// admin/src/ui/conversationNav.ts — Keyboard-driven navigation through flyout conversation blocks

const BLOCK_SELECTORS = '.conv-turn, .conv-tool, .conv-agent, .conv-system, .conv-result';
const HEADER_SELECTORS = '.conv-tool-header, .cc-group-header';
const ACTIVE_CLASS = 'conv-nav-active';
const PROMPT_SELECTORS = [
  '#cc-prompt-editor-mount [contenteditable]',
  '#cc-prompt-editor-mount input',
  '#cc-prompt-editor-mount textarea',
].join(', ');

export interface ConversationNavController {
  attach(): void;
  detach(): void;
  getActiveIndex(): number;
}

/** Creates a keyboard-driven navigation controller for conversation blocks in outputEl. */
export function createConversationNav(outputEl: HTMLElement): ConversationNavController {
  let _activeIdx: number = -1;
  let _attached: boolean = false;
  let _gPending: boolean = false;
  let _gTimer: ReturnType<typeof setTimeout> | null = null;

  function getBlocks(): HTMLElement[] {
    return Array.from(outputEl.querySelectorAll<HTMLElement>(BLOCK_SELECTORS));
  }

  function setActiveIndicator(idx: number): void {
    // Clear previous active
    outputEl.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((el) => {
      el.classList.remove(ACTIVE_CLASS);
    });

    const blocks = getBlocks();
    if (idx < 0 || idx >= blocks.length) return;

    const block = blocks[idx];
    block.classList.add(ACTIVE_CLASS);
    block.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function isInputFocused(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    return (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.isContentEditable
    );
  }

  function clearGTimer(): void {
    if (_gTimer !== null) {
      clearTimeout(_gTimer);
      _gTimer = null;
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!_attached) return;
    if (isInputFocused()) return;

    const blocks = getBlocks();

    switch (e.key) {
      case 'j':
      case 'ArrowDown': {
        e.preventDefault();
        _activeIdx = Math.min(_activeIdx + 1, blocks.length - 1);
        setActiveIndicator(_activeIdx);
        break;
      }

      case 'k':
      case 'ArrowUp': {
        e.preventDefault();
        _activeIdx = Math.max(_activeIdx - 1, 0);
        setActiveIndicator(_activeIdx);
        break;
      }

      case 'Enter':
      case 'ArrowRight': {
        if (e.key === 'Enter' && e.shiftKey) {
          // Shift+Enter: toggle all expand/collapse
          e.preventDefault();
          const allHeaders = Array.from(
            outputEl.querySelectorAll<HTMLElement>(HEADER_SELECTORS),
          );
          const anyExpanded = allHeaders.some(
            (h) => h.parentElement?.classList.contains('expanded') ||
                   h.getAttribute('aria-expanded') === 'true',
          );
          if (anyExpanded) {
            allHeaders.forEach((h) => {
              if (
                h.parentElement?.classList.contains('expanded') ||
                h.getAttribute('aria-expanded') === 'true'
              ) h.click();
            });
          } else {
            allHeaders.forEach((h) => {
              if (
                !h.parentElement?.classList.contains('expanded') &&
                h.getAttribute('aria-expanded') !== 'true'
              ) h.click();
            });
          }
        } else {
          // Enter or ArrowRight: toggle active block's header
          e.preventDefault();
          if (_activeIdx < 0 || _activeIdx >= blocks.length) break;
          const block = blocks[_activeIdx];
          const header = block.querySelector<HTMLElement>(HEADER_SELECTORS);
          header?.click();
        }
        break;
      }

      case 'o': {
        // Expand active block, collapse all others
        e.preventDefault();
        if (_activeIdx < 0 || _activeIdx >= blocks.length) break;
        const activeBlock = blocks[_activeIdx];

        blocks.forEach((block, i) => {
          const header = block.querySelector<HTMLElement>(HEADER_SELECTORS);
          if (!header) return;
          const isExpanded =
            block.classList.contains('expanded') ||
            header.getAttribute('aria-expanded') === 'true';

          if (i === _activeIdx) {
            // Expand if not already expanded
            if (!isExpanded) header.click();
          } else {
            // Collapse if expanded
            if (isExpanded) header.click();
          }
        });

        // Re-scroll active block into view after toggling
        activeBlock.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        break;
      }

      case 'y': {
        // Copy active block text to clipboard
        e.preventDefault();
        if (_activeIdx < 0 || _activeIdx >= blocks.length) break;
        const block = blocks[_activeIdx];
        void navigator.clipboard.writeText(block.textContent || '');
        break;
      }

      case 'p': {
        // Pin active block text via custom event
        e.preventDefault();
        if (_activeIdx < 0 || _activeIdx >= blocks.length) break;
        const block = blocks[_activeIdx];
        outputEl.dispatchEvent(
          new CustomEvent('agent-search:pin', {
            detail: { text: block.textContent?.slice(0, 200) },
            bubbles: true,
          }),
        );
        break;
      }

      case '/': {
        // Focus prompt editor
        e.preventDefault();
        const promptEl = document.querySelector<HTMLElement>(PROMPT_SELECTORS);
        promptEl?.focus();
        break;
      }

      case 'g': {
        e.preventDefault();
        if (_gPending) {
          // gg: scroll to top
          clearGTimer();
          _gPending = false;
          outputEl.scrollTop = 0;
        } else {
          _gPending = true;
          _gTimer = setTimeout(() => {
            _gPending = false;
            _gTimer = null;
          }, 500);
        }
        break;
      }

      case 'G': {
        // Shift+G: scroll to bottom
        e.preventDefault();
        outputEl.scrollTop = outputEl.scrollHeight;
        break;
      }
    }
  }

  function attach(): void {
    if (_attached) return;
    _attached = true;
    document.addEventListener('keydown', handleKeydown);
  }

  function detach(): void {
    _attached = false;
    document.removeEventListener('keydown', handleKeydown);
    clearGTimer();
    _gPending = false;

    // Clear active indicator
    outputEl.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((el) => {
      el.classList.remove(ACTIVE_CLASS);
    });
    _activeIdx = -1;
  }

  function getActiveIndex(): number {
    return _activeIdx;
  }

  return { attach, detach, getActiveIndex };
}

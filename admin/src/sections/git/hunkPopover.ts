// admin/src/sections/git/hunkPopover.ts — Frosted-glass inline AI popover component

import { escapeHtml } from '../../ui/render';

export interface PopoverOptions {
  anchor: HTMLElement;
  title?: string;
  onFollowup?: (text: string) => void;
  onAutofix?: () => void;
}

export interface PopoverHandle {
  el: HTMLElement;
  appendToken(token: string): void;
  setContent(html: string): void;
  close(): void;
}

// Inject animations once into <head>
let _animationsInjected = false;
function _ensureAnimations(): void {
  if (_animationsInjected) return;
  _animationsInjected = true;
  const style = document.createElement('style');
  style.textContent = `
@keyframes popover-in {
  from { opacity:0; transform:scale(0.95) translateY(-4px); }
  to   { opacity:1; transform:scale(1) translateY(0); }
}
@keyframes popover-out {
  from { opacity:1; transform:scale(1) translateY(0); }
  to   { opacity:0; transform:scale(0.95) translateY(-4px); }
}
`.trim();
  document.head.appendChild(style);
}

export function createPopover(options: PopoverOptions): PopoverHandle {
  const { anchor, title, onFollowup, onAutofix } = options;

  _ensureAnimations();

  // --- Container ---
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    zIndex: '100',
    maxWidth: '420px',
    minWidth: '280px',
    background: 'rgba(7,15,19,0.88)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(110,224,240,0.3)',
    borderRadius: '6px',
    boxShadow: '0 0 20px rgba(110,224,240,0.1), 0 8px 32px rgba(0,0,0,0.5)',
    fontSize: '12px',
    color: 'var(--text)',
    animation: 'popover-in 150ms ease-out forwards',
    top: '0',
    right: '0',
  });

  // --- Header ---
  const headerEl = document.createElement('div');
  Object.assign(headerEl.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 10px 6px',
    borderBottom: '1px solid rgba(110,224,240,0.15)',
    gap: '6px',
  });

  const titleEl = document.createElement('span');
  Object.assign(titleEl.style, {
    fontWeight: '700',
    fontSize: '11px',
    color: 'var(--accent)',
    flex: '1',
  });
  titleEl.textContent = title ?? 'AI Analysis';

  const closeBtnEl = document.createElement('button');
  Object.assign(closeBtnEl.style, {
    background: 'none',
    border: 'none',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: '1',
    padding: '0 2px',
  });
  closeBtnEl.textContent = '×';
  closeBtnEl.title = 'Close';

  headerEl.appendChild(titleEl);
  headerEl.appendChild(closeBtnEl);

  // --- Body ---
  const bodyEl = document.createElement('div');
  Object.assign(bodyEl.style, {
    padding: '10px 12px',
    lineHeight: '1.6',
    maxHeight: '300px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });
  bodyEl.innerHTML = `<span style="color:var(--text-dim);">Thinking...</span>`;

  // --- Actions row ---
  const actionsEl = document.createElement('div');
  Object.assign(actionsEl.style, {
    display: 'flex',
    gap: '6px',
    padding: '6px 10px 8px',
    borderTop: '1px solid rgba(110,224,240,0.1)',
    flexWrap: 'wrap',
  });

  function _makeBtn(label: string, extraStyle?: Partial<CSSStyleDeclaration>): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      fontSize: '10px',
      border: '1px solid rgba(110,224,240,0.3)',
      borderRadius: '3px',
      background: 'rgba(110,224,240,0.05)',
      color: 'var(--text)',
      padding: '2px 7px',
      cursor: 'pointer',
    } as Partial<CSSStyleDeclaration>);
    if (extraStyle) Object.assign(btn.style, extraStyle);
    btn.textContent = label;
    return btn;
  }

  // Copy button
  const copyBtn = _makeBtn('Copy');
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(bodyEl.textContent ?? '').then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = orig; }, 1200);
    });
  });
  actionsEl.appendChild(copyBtn);

  // Ask Followup button
  if (onFollowup) {
    const followupBtn = _makeBtn('Ask Followup');
    followupBtn.addEventListener('click', () => {
      // Replace actions row content with input + send
      actionsEl.innerHTML = '';
      Object.assign(actionsEl.style, { flexDirection: 'column' });

      const inputRow = document.createElement('div');
      Object.assign(inputRow.style, {
        display: 'flex',
        gap: '4px',
        width: '100%',
      });

      const inputEl = document.createElement('input');
      Object.assign(inputEl.style, {
        flex: '1',
        fontSize: '11px',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(110,224,240,0.3)',
        borderRadius: '3px',
        color: 'var(--text)',
        padding: '3px 7px',
        outline: 'none',
      });
      inputEl.type = 'text';
      inputEl.placeholder = 'Ask a followup question…';

      const sendBtn = _makeBtn('Send');

      function _submit(): void {
        const text = inputEl.value.trim();
        if (text) onFollowup!(text);
      }

      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          _submit();
        }
      });
      sendBtn.addEventListener('click', _submit);

      inputRow.appendChild(inputEl);
      inputRow.appendChild(sendBtn);
      actionsEl.appendChild(inputRow);

      inputEl.focus();
    });
    actionsEl.appendChild(followupBtn);
  }

  // Auto-fix button
  if (onAutofix) {
    const autofixBtn = _makeBtn('Auto-fix', {
      borderColor: 'rgba(180,100,240,0.5)',
      color: 'rgba(200,140,255,0.9)',
    });
    autofixBtn.addEventListener('click', onAutofix);
    actionsEl.appendChild(autofixBtn);
  }

  // Assemble
  el.appendChild(headerEl);
  el.appendChild(bodyEl);
  el.appendChild(actionsEl);

  // Insert into .diff-hunk ancestor or parentElement
  const diffHunk = anchor.closest('.diff-hunk') as HTMLElement | null;
  const parent = diffHunk ?? anchor.parentElement ?? document.body;
  parent.appendChild(el);

  // Viewport overflow adjustment (after insertion so we have dimensions)
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      el.style.right = '';
      el.style.left = '0';
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = '';
      el.style.bottom = '0';
    }
  });

  // Close logic
  let _closed = false;
  function _close(): void {
    if (_closed) return;
    _closed = true;
    document.removeEventListener('keydown', _onKeydown);
    el.style.animation = 'popover-out 100ms ease-out forwards';
    setTimeout(() => el.remove(), 110);
  }

  closeBtnEl.addEventListener('click', _close);

  function _onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') _close();
  }
  document.addEventListener('keydown', _onKeydown);

  // appendToken state
  let _firstToken = true;
  let _accumulatedText = '';

  function appendToken(token: string): void {
    if (_firstToken) {
      _firstToken = false;
      bodyEl.innerHTML = '';
      _accumulatedText = '';
    }
    _accumulatedText += token;
    bodyEl.textContent = _accumulatedText;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function setContent(html: string): void {
    _firstToken = false;
    bodyEl.innerHTML = html;
  }

  return { el, appendToken, setContent, close: _close };
}

// admin/src/ui/promptEditor.ts

import { SkillPopover } from './skillPopover';
import { escapeHtml } from './render';
import { claudeIcon, llamaIcon } from './ccRenderer';
import { icon } from './icons';
import type { SkillEntry } from './skillRegistry';
import { createContextChips } from './contextChips';

export interface FileRef {
  path: string;    // relative path like 'src/player.ts'
  name: string;    // basename like 'player.ts'
}

export interface PromptEditorCallbacks {
  onSend: (text: string, skills: SkillInvocation[], attachments: File[]) => void;
}

export interface SkillInvocation {
  skill: SkillEntry;
  context: string;
}

export class PromptEditor {
  private _wrap: HTMLElement;
  private _toolbar: HTMLElement;
  private _body: HTMLElement;
  private _input: HTMLElement;
  private _attachmentsEl: HTMLElement;
  private _fileRefsEl: HTMLElement;
  private _fileInput: HTMLInputElement;
  private _popover: SkillPopover;
  private _callbacks: PromptEditorCallbacks;

  // State
  private _history: string[] = [];
  private _historyIndex = -1;
  private _sessionId: string | null = null;
  private static readonly HISTORY_PREFIX = 'luminal-msg-history-';
  private _attachments: File[] = [];
  private _fileRefs: FileRef[] = [];
  private _activeSkillLabel: HTMLElement | null = null;
  private _target: 'cc' | 'aider' = 'cc';
  private _aiderMode: 'suggest' | 'auto' = 'suggest';
  private _effort: import('../types').EffortLevel = 'high';
  private _contextChips: ReturnType<typeof createContextChips>;

  constructor(container: HTMLElement, callbacks: PromptEditorCallbacks) {
    this._callbacks = callbacks;

    // Build DOM
    this._wrap = document.createElement('div');
    this._wrap.className = 'prompt-editor-wrap';

    // Toolbar
    this._toolbar = document.createElement('div');
    this._toolbar.className = 'prompt-editor-toolbar';
    this._toolbar.innerHTML =
      '<button class="prompt-editor-toolbar-btn" data-action="skills" title="Insert skill command">&#9881; Skills</button>' +
      '<button class="prompt-editor-toolbar-btn" data-action="upload" title="Upload file">&#128206; Upload</button>' +
      '<div style="flex:1;"></div>' +
      '<div class="prompt-editor-effort-dropdown">' +
        '<button class="effort-trigger" data-effort="high" title="Set effort level">effort: <span class="effort-value">high</span><span class="effort-caret">▸</span></button>' +
        '<div class="effort-menu">' +
          '<button data-effort="low" title="Low — quick">low</button>' +
          '<button data-effort="medium" title="Medium — balanced">medium</button>' +
          '<button data-effort="high" title="High — comprehensive" class="active">high</button>' +
          '<button data-effort="max" title="Max — Opus only">max</button>' +
        '</div>' +
      '</div>' +
      '<div class="btn-group prompt-editor-backend-toggle">' +
        '<button class="btn-group-item active" data-target="cc" title="Claude Code">' + claudeIcon(13) + '</button>' +
        '<button class="btn-group-item" data-target="aider" title="Aider (Qwen)">' + llamaIcon(12) + '</button>' +
      '</div>' +
      '<div class="aider-mode-toggle">' +
        `<button class="btn-group-item active" data-mode="suggest" title="Suggest only — no file changes">${icon('help-circle', 17)}</button>` +
        `<button class="btn-group-item" data-mode="auto" title="Autonomous — edits files, creates commits">${icon('play', 17)}</button>` +
      '</div>';
    this._wrap.appendChild(this._toolbar);

    // Attachments area
    this._attachmentsEl = document.createElement('div');
    this._attachmentsEl.className = 'prompt-editor-attachments';
    this._wrap.appendChild(this._attachmentsEl);

    // File references area (between attachments and body)
    this._fileRefsEl = document.createElement('div');
    this._fileRefsEl.className = 'prompt-file-refs';
    this._wrap.appendChild(this._fileRefsEl);

    // Context chips
    this._contextChips = createContextChips(this._wrap);

    // Body (input + send)
    this._body = document.createElement('div');
    this._body.className = 'prompt-editor-body';

    this._input = document.createElement('div');
    this._input.className = 'prompt-editor-input';
    this._input.contentEditable = 'true';
    this._input.setAttribute('data-placeholder', 'Type a message... (/ for skills)');
    this._input.setAttribute('role', 'textbox');
    this._input.setAttribute('aria-multiline', 'true');
    // Disable browser plugins and autocomplete
    this._input.setAttribute('autocomplete', 'off');
    this._input.setAttribute('autocorrect', 'off');
    this._input.setAttribute('autocapitalize', 'off');
    this._input.setAttribute('spellcheck', 'false');
    this._input.setAttribute('data-gramm', 'false');
    this._input.setAttribute('data-gramm_editor', 'false');
    this._input.setAttribute('data-enable-grammarly', 'false');
    this._input.setAttribute('data-lt-active', 'false');

    this._body.appendChild(this._input);
    this._wrap.appendChild(this._body);

    // Hidden file input
    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.id = 'prompt-editor-file-input';
    this._fileInput.multiple = true;
    this._wrap.appendChild(this._fileInput);

    // Popover
    this._popover = new SkillPopover(this._body, {
      onSelect: (skill) => this._insertSkillLabel(skill),
      onClose: () => { /* popover closed */ },
    });

    // Event listeners
    this._input.addEventListener('keydown', (e) => this._onKeyDown(e));
    this._input.addEventListener('input', () => this._onInput());
    this._input.addEventListener('paste', (e) => this._onPaste(e));
    this._fileInput.addEventListener('change', () => this._onFileSelected());
    this._toolbar.addEventListener('click', (e) => this._onToolbarClick(e));
    document.addEventListener('click', (e) => {
      if (!this._toolbar.contains(e.target as Node)) {
        (this._toolbar.querySelector('.effort-menu') as HTMLElement | null)?.classList.remove('open');
      }
    });

    // Drop zone for file references from file browser
    this._body.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-luminal-file')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this._body.classList.add('drop-hover');
      }
    });
    this._body.addEventListener('dragleave', () => {
      this._body.classList.remove('drop-hover');
    });
    this._body.addEventListener('drop', (e) => {
      e.preventDefault();
      this._body.classList.remove('drop-hover');
      const fileData = e.dataTransfer?.getData('application/x-luminal-file');
      if (fileData) {
        try {
          const parsed: unknown = JSON.parse(fileData);
          if (parsed && typeof parsed === 'object' && 'path' in parsed && 'name' in parsed) {
            const ref = parsed as FileRef;
            this.addFileRef({ path: String(ref.path), name: String(ref.name) });
          }
        } catch { /* ignore bad data */ }
      }
    });

    // Listen for custom file-browser:attach events
    document.addEventListener('file-browser:attach', ((e: CustomEvent<{ path: string; name: string }>) => {
      this.addFileRef({ path: e.detail.path, name: e.detail.name });
    }) as EventListener);

    container.appendChild(this._wrap);
  }

  /** Focus the editor input. */
  focus(): void {
    this._input.focus();
  }

  /** Set placeholder text. */
  setPlaceholder(text: string): void {
    this._input.setAttribute('data-placeholder', text);
  }

  /** Get the wrapper element (for showing/hiding). */
  get element(): HTMLElement { return this._wrap; }

  /** Get current dispatch target. */
  get target(): 'cc' | 'aider' { return this._target; }

  /** Get current Aider autonomy mode. */
  get aiderMode(): 'suggest' | 'auto' { return this._aiderMode; }

  /** Get current effort level. */
  get effort(): import('../types').EffortLevel { return this._effort; }

  /** Bind a session ID — loads its persisted history and resets the index. */
  setSessionId(id: string | null): void {
    this._sessionId = id;
    this._historyIndex = -1;
    if (id) {
      try {
        const raw = localStorage.getItem(PromptEditor.HISTORY_PREFIX + id);
        this._history = raw ? JSON.parse(raw) as string[] : [];
      } catch {
        this._history = [];
      }
    } else {
      this._history = [];
    }
  }

  /** Remove persisted history for a session (call when tab is closed). */
  static clearHistory(sessionId: string): void {
    localStorage.removeItem(PromptEditor.HISTORY_PREFIX + sessionId);
  }

  /** Set dispatch target and update toggle UI. */
  setTarget(target: 'cc' | 'aider'): void {
    this._target = target;
    this._toolbar.querySelectorAll('.prompt-editor-backend-toggle .btn-group-item').forEach(btn => {
      const el = btn as HTMLElement;
      el.classList.toggle('active', el.dataset.target === target);
    });
    // Show/hide autonomy toggle
    const modeToggle = this._toolbar.querySelector('.aider-mode-toggle');
    if (modeToggle) {
      modeToggle.classList.toggle('visible', target === 'aider');
    }
  }

  /** Set Aider autonomy mode and update toggle UI. */
  setAiderMode(mode: 'suggest' | 'auto'): void {
    this._aiderMode = mode;
    this._toolbar.querySelectorAll('.aider-mode-toggle .btn-group-item').forEach(btn => {
      const el = btn as HTMLElement;
      el.classList.toggle('active', el.dataset.mode === mode);
    });
  }

  /** Clean up. */
  destroy(): void {
    this._popover.close();
    this._contextChips.destroy();
    this._wrap.remove();
  }

  // ── Keyboard ─────────────────────────────────────────────

  /** Check if the caret is directly inside the main input, not inside a skill label. */
  private _isCaretInMainInput(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node !== this._input) {
      if (node instanceof HTMLElement && node.classList.contains('skill-label')) return false;
      node = node.parentNode;
    }
    return node === this._input;
  }

  private _onKeyDown(e: KeyboardEvent): void {
    // Let popover handle keys first
    if (this._popover.isOpen() && this._popover.handleKey(e)) return;

    // Enter handling — context-dependent
    if (e.key === 'Enter') {
      // Shift+Enter always inserts a newline (default browser behavior)
      if (e.shiftKey) return;

      // Inside a skill label context input — lock the label, don't send
      if (this._activeSkillLabel) {
        e.preventDefault();
        this._lockSkillLabel();
        return;
      }

      // Caret is in the main text area (not inside a skill label) — send
      if (this._isCaretInMainInput()) {
        e.preventDefault();
        this._send();
        return;
      }

      // Otherwise (e.g. focus is somewhere unexpected) — do nothing special
      return;
    }

    // UP arrow for history — only when cursor is in the top row
    if (e.key === 'ArrowUp' && this._isCursorInTopRow()) {
      if (this._history.length > 0 && this._historyIndex < this._history.length - 1) {
        e.preventDefault();
        this._historyIndex++;
        this._input.textContent = this._history[this._historyIndex];
        this._placeCursorAtEnd();
      }
      return;
    }

    if (e.key === 'ArrowDown' && this._historyIndex >= 0) {
      e.preventDefault();
      this._historyIndex--;
      if (this._historyIndex < 0) {
        this._input.textContent = '';
      } else {
        this._input.textContent = this._history[this._historyIndex];
      }
      this._placeCursorAtEnd();
      return;
    }
  }

  // ── Input tracking for slash commands ─────────────────────

  private _onInput(): void {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (this._input.contains(range.startContainer)) {
        const beforeCursor = this._getTextBeforeCursor();
        const slashMatch = beforeCursor.match(/(?:^|\s)(\/[\w-]*)$/);
        if (slashMatch) {
          const query = slashMatch[1].slice(1);
          this._popover.open(query);
          return;
        }
      }
    }

    if (this._popover.isOpen()) {
      this._popover.close();
    }
  }

  // ── Clipboard paste ──────────────────────────────────────

  private _onPaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasFile = false;
    for (const item of items) {
      if (item.kind === 'file') {
        e.preventDefault();
        hasFile = true;
        const file = item.getAsFile();
        if (file) this._addAttachment(file);
      }
    }

    if (!hasFile) {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    }
  }

  // ── File upload ──────────────────────────────────────────

  private _onFileSelected(): void {
    const files = this._fileInput.files;
    if (!files) return;
    for (const file of files) {
      this._addAttachment(file);
    }
    this._fileInput.value = '';
  }

  private _addAttachment(file: File): void {
    this._attachments.push(file);
    this._renderAttachments();
  }

  private _removeAttachment(index: number): void {
    this._attachments.splice(index, 1);
    this._renderAttachments();
  }

  private _renderAttachments(): void {
    if (this._attachments.length === 0) {
      this._attachmentsEl.innerHTML = '';
      return;
    }
    this._attachmentsEl.innerHTML = this._attachments.map((f, i) => {
      const isImage = f.type.startsWith('image/');
      const preview = isImage ? `<img src="${URL.createObjectURL(f)}" alt="${escapeHtml(f.name)}" />` : '';
      return `<div class="prompt-attachment" data-index="${i}">` +
        preview +
        `<span>${escapeHtml(f.name)}</span>` +
        `<button class="prompt-attachment-close" data-index="${i}">&times;</button>` +
      `</div>`;
    }).join('');

    this._attachmentsEl.querySelectorAll('.prompt-attachment-close').forEach(btn => {
      btn.addEventListener('click', () => {
        this._removeAttachment(parseInt((btn as HTMLElement).dataset.index ?? '0'));
      });
    });
  }

  // ── File references ──────────────────────────────────────

  /** Add a file reference (no-op if duplicate path). */
  addFileRef(ref: FileRef): void {
    if (this._fileRefs.some(r => r.path === ref.path)) return;
    this._fileRefs.push(ref);
    this._renderFileRefs();
  }

  /** Remove a file reference by path. */
  removeFileRef(path: string): void {
    this._fileRefs = this._fileRefs.filter(r => r.path !== path);
    this._renderFileRefs();
  }

  private _renderFileRefs(): void {
    if (this._fileRefs.length === 0) {
      this._fileRefsEl.innerHTML = '';
      return;
    }
    this._fileRefsEl.innerHTML = this._fileRefs.map((r, i) =>
      `<div class="prompt-file-ref" data-index="${i}">` +
        `<span class="file-ref-icon">&#128196;</span>` +
        `<span class="file-ref-path">${escapeHtml(r.path)}</span>` +
        `<button class="file-ref-close" data-index="${i}">&times;</button>` +
      `</div>`
    ).join('');

    this._fileRefsEl.querySelectorAll('.file-ref-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.index ?? '0');
        const ref = this._fileRefs[idx];
        if (ref) this.removeFileRef(ref.path);
      });
    });
  }

  // ── Skill labels ─────────────────────────────────────────

  private _insertSkillLabel(skill: SkillEntry): void {
    this._popover.close();
    this._removeSlashText();

    const label = document.createElement('span');
    label.className = 'skill-label';
    label.contentEditable = 'false';
    label.dataset.skillName = skill.name;

    label.innerHTML =
      `<span class="skill-label-name">${escapeHtml(skill.name)}</span>` +
      `<span class="skill-label-dropdown" title="Change skill">&#9662;</span>` +
      `<input class="skill-label-context" placeholder="..." size="3" />` +
      `<button class="skill-label-close" title="Remove">&times;</button>`;

    // Insert at current cursor position (supports multiple labels)
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(label);
      // Add a thin space after so caret can rest between labels or after
      const spacer = document.createTextNode('\u200B');
      label.after(spacer);
      range.setStartAfter(spacer);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const contextInput = label.querySelector('.skill-label-context') as HTMLInputElement;
    this._activeSkillLabel = label;

    // Auto-size: grow/shrink input to fit text width
    const autoSize = (): void => {
      const len = contextInput.value.length || contextInput.placeholder.length;
      contextInput.size = Math.max(len, 3);
    };
    contextInput.addEventListener('input', autoSize);

    setTimeout(() => contextInput.focus(), 0);

    contextInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this._lockSkillLabel();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this._lockSkillLabel();
      }
      // Stop propagation so main editor doesn't intercept
      e.stopPropagation();
    });

    label.querySelector('.skill-label-close')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Remove the trailing spacer too
      if (label.nextSibling?.nodeType === Node.TEXT_NODE && label.nextSibling.textContent === '\u200B') {
        label.nextSibling.remove();
      }
      label.remove();
      this._activeSkillLabel = null;
      this._input.focus();
    });

    label.querySelector('.skill-label-dropdown')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._showSkillChangeDropdown(label);
    });
  }

  private _lockSkillLabel(): void {
    if (!this._activeSkillLabel) return;
    const contextInput = this._activeSkillLabel.querySelector('.skill-label-context') as HTMLInputElement;
    if (contextInput) {
      contextInput.readOnly = true;
      contextInput.style.opacity = '0.8';
      // Shrink to fit final text (or hide if empty)
      if (contextInput.value) {
        contextInput.size = contextInput.value.length;
      } else {
        contextInput.style.display = 'none';
      }
    }
    this._activeSkillLabel = null;
    this._input.focus();
    this._placeCursorAtEnd();
  }

  private _showSkillChangeDropdown(label: HTMLElement): void {
    const origOnSelect = (this._popover as unknown as { _callbacks: { onSelect: (s: SkillEntry) => void } })._callbacks.onSelect;
    (this._popover as unknown as { _callbacks: { onSelect: (s: SkillEntry) => void } })._callbacks.onSelect = (newSkill: SkillEntry) => {
      label.dataset.skillName = newSkill.name;
      const nameEl = label.querySelector('.skill-label-name');
      if (nameEl) nameEl.textContent = newSkill.name;
      const contextInput = label.querySelector('.skill-label-context') as HTMLInputElement;
      if (contextInput) {
        contextInput.readOnly = false;
        contextInput.style.opacity = '1';
        contextInput.style.display = '';
        contextInput.focus();
      }
      this._activeSkillLabel = label;
      (this._popover as unknown as { _callbacks: { onSelect: (s: SkillEntry) => void } })._callbacks.onSelect = origOnSelect;
    };
    this._popover.open('');
  }

  // ── Toolbar ──────────────────────────────────────────────

  private _onToolbarClick(e: MouseEvent): void {
    // Effort dropdown trigger
    const effortTrigger = (e.target as HTMLElement).closest('.effort-trigger') as HTMLElement | null;
    if (effortTrigger) {
      const menu = this._toolbar.querySelector('.effort-menu') as HTMLElement | null;
      menu?.classList.toggle('open');
      effortTrigger.dataset.open = menu?.classList.contains('open') ? 'true' : '';
      return;
    }

    // Effort menu item
    const effortItem = (e.target as HTMLElement).closest('.effort-menu button') as HTMLElement | null;
    if (effortItem?.dataset.effort) {
      const ef = effortItem.dataset.effort as import('../types').EffortLevel;
      this._effort = ef;
      this._toolbar.querySelectorAll('.effort-menu button').forEach(b => {
        (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.effort === ef);
      });
      const val = this._toolbar.querySelector('.effort-value');
      if (val) val.textContent = ef;
      const trigger = this._toolbar.querySelector('.effort-trigger') as HTMLElement | null;
      if (trigger) {
        trigger.dataset.effort = ef;
        trigger.classList.remove('effort-flash');
        void trigger.offsetWidth; // force reflow for animation restart
        trigger.classList.add('effort-flash');
      }
      const menu = this._toolbar.querySelector('.effort-menu') as HTMLElement | null;
      menu?.classList.remove('open');
      const trigger2 = this._toolbar.querySelector('.effort-trigger') as HTMLElement | null;
      if (trigger2) trigger2.dataset.open = '';
      return;
    }

    // Backend toggle
    const backendBtn = (e.target as HTMLElement).closest('.prompt-editor-backend-toggle .btn-group-item') as HTMLElement | null;
    if (backendBtn) {
      const target = backendBtn.dataset.target as 'cc' | 'aider';
      if (target) this.setTarget(target);
      return;
    }

    // Aider mode toggle
    const modeBtn = (e.target as HTMLElement).closest('.aider-mode-toggle .btn-group-item') as HTMLElement | null;
    if (modeBtn) {
      const mode = modeBtn.dataset.mode as 'suggest' | 'auto';
      if (mode) this.setAiderMode(mode);
      return;
    }

    const btn = (e.target as HTMLElement).closest('.prompt-editor-toolbar-btn') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'skills') {
      this._input.focus();
      document.execCommand('insertText', false, '/');
      this._onInput();
    }
    if (action === 'upload') {
      this._fileInput.click();
    }
  }

  // ── Send ─────────────────────────────────────────────────

  private _saveHistory(): void {
    if (!this._sessionId) return;
    try {
      localStorage.setItem(PromptEditor.HISTORY_PREFIX + this._sessionId, JSON.stringify(this._history.slice(0, 50)));
    } catch { /* storage full — ignore */ }
  }

  private async _send(): Promise<void> {
    const text = this._getPlainText().trim();
    const skills = this._extractSkillInvocations();
    if (!text && skills.length === 0 && this._attachments.length === 0 && this._fileRefs.length === 0) return;

    if (text) {
      this._history.unshift(text);
      if (this._history.length > 50) this._history.pop();
      this._saveHistory();
    }
    this._historyIndex = -1;

    // Prepend file references as @path syntax for Claude Code
    let prompt = text;
    if (this._fileRefs.length > 0) {
      const refLines = this._fileRefs.map(r => `@${r.path}`).join('\n');
      prompt = refLines + (prompt ? '\n\n' + prompt : '');
    }

    const contextContent = await this._contextChips.getEnabledContent();
    const fullText = prompt + contextContent;

    this._callbacks.onSend(fullText, skills, [...this._attachments]);

    this._input.innerHTML = '';
    this._attachments = [];
    this._renderAttachments();
    this._fileRefs = [];
    this._renderFileRefs();
  }

  // ── Helpers ──────────────────────────────────────────────

  private _getPlainText(): string {
    let text = '';
    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
      } else if (node instanceof HTMLElement) {
        if (node.classList.contains('skill-label')) {
          const name = node.dataset.skillName ?? '';
          const ctx = (node.querySelector('.skill-label-context') as HTMLInputElement)?.value ?? '';
          text += `${name}${ctx ? ' ' + ctx : ''}`;
        } else {
          for (const child of node.childNodes) walk(child);
          if (node.tagName === 'BR' || node.tagName === 'DIV') text += '\n';
        }
      }
    };
    for (const child of this._input.childNodes) walk(child);
    return text.replace(/\u00A0/g, ' ');
  }

  private _extractSkillInvocations(): SkillInvocation[] {
    const labels = this._input.querySelectorAll('.skill-label');
    const invocations: SkillInvocation[] = [];
    labels.forEach(label => {
      const name = (label as HTMLElement).dataset.skillName ?? '';
      const ctx = (label.querySelector('.skill-label-context') as HTMLInputElement)?.value ?? '';
      invocations.push({
        skill: { name, description: '', category: '', icon: '' },
        context: ctx,
      });
    });
    return invocations;
  }

  private _isCursorInTopRow(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const inputRect = this._input.getBoundingClientRect();
    return rect.top - inputRect.top < 24;
  }

  private _getTextBeforeCursor(): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const range = sel.getRangeAt(0).cloneRange();
    range.setStart(this._input, 0);
    return range.toString();
  }

  private _removeSlashText(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const textBefore = this._getTextBeforeCursor();
    const slashMatch = textBefore.match(/(?:^|\s)(\/[\w-]*)$/);
    if (!slashMatch) return;

    const len = slashMatch[1].length;
    for (let i = 0; i < len; i++) {
      document.execCommand('delete', false);
    }
  }

  private _placeCursorAtEnd(): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(this._input);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ── ccPanel.ts — Slim re-export hub + initCCPanel ──────
//
// All logic has been split into sub-modules. This file re-exports
// everything so that existing imports from './ccPanel' or '../ui/ccPanel'
// continue to resolve without changes.

import { escapeHtml } from './render';
import { icon } from './icons';
import { BUILTIN_TEMPLATES, TEMPLATE_GROUPS } from './agentTemplates';
import type { AgentTemplate } from './agentTemplates';
import { sessionManager, _setDispatchCC, _setPersistUsage } from './ccSessionManager';
import { renderFlyout, formatElapsed, showDiffModal, wireSessionDataToFlyout, wireTabDrag, getExternalSessions, selectExternalSession, dismissExternalSession, renderConversationThread } from './ccRenderer';
import { restoreFloatingPanels, wireTabTearOff } from './detachableWindow';
import { dispatchCC, dispatchCCResume, dispatchOllama, dispatchAider, continueConversation, wireAgentStream } from './ccDispatch';
import { persistUsage } from './ccUsage';
import { suppressToasts } from './toast';
import { bus } from './eventBus';
import { getSetting, saveSettings } from './settingsStore';
import { getAvailablePools } from './agentPools';
import { PromptEditor } from './promptEditor';
import { createConversationSearch } from './conversationSearch';
import { createConversationNav } from './conversationNav';
import { initBridge, togglePermissionGateway } from './permissionGatewayBridge';
import { isPermissionGatewayEnabled } from './permissionGateway';

// ── Wire circular-dependency callbacks ──────────────────
// SessionManager needs dispatchCC (from ccDispatch) and persistUsage (from ccUsage),
// but ccDispatch imports sessionManager. We break the cycle with setter injection.
_setDispatchCC(dispatchCC);
_setPersistUsage(persistUsage);

// Initialize permission gateway bridge with sessionManager.processLine
initBridge((sid, line, isStderr) => sessionManager.processLine(sid, line, isStderr));

// ── Re-exports ──────────────────────────────────────────

export { sessionManager, SessionManager, classifyOutputLine } from './ccSessionManager';
export { renderFlyout, renderCard, renderConversationThread, showDiffModal, wireSessionDataToFlyout, wireTabDrag, getExternalSessions, selectExternalSession, dismissExternalSession, claudeIcon, llamaIcon, renderExternalSessionDetail } from './ccRenderer';
export { dispatchCC, dispatchCCResume, dispatchOllama, dispatchAider, continueConversation, onTaskResult, wireAgentStream } from './ccDispatch';
export { loadUsageRecords, aggregateUsage, estimateCost, resetUsageRecords, usageInWindow, estimateUsagePct, formatDuration } from './ccUsage';

// ── initCCPanel ─────────────────────────────────────────

export function initCCPanel(): void {
  const flyout = document.getElementById('cc-flyout')!;
  const ccBtn = document.getElementById('cc-status-btn')!;
  const closeBtn = document.getElementById('cc-flyout-close')!;
  const cancelBtn = document.getElementById('cc-flyout-cancel')!;

  const newAgentBtn = document.getElementById('cc-new-agent')!;

  // ── Bottom details collapse toggle ────────────────────
  const bottomDetailsToggle = document.getElementById('cc-bottom-details-toggle');
  const bottomDetails = document.getElementById('cc-bottom-details');
  if (bottomDetailsToggle && bottomDetails) {
    // Restore saved state
    const saved = localStorage.getItem('cc-bottom-details-collapsed');
    if (saved === '1') {
      bottomDetails.classList.add('collapsed');
      bottomDetailsToggle.classList.add('collapsed');
      bottomDetails.style.maxHeight = '0';
    }

    bottomDetailsToggle.addEventListener('click', () => {
      const isCollapsed = bottomDetails.classList.contains('collapsed');
      if (isCollapsed) {
        // Expand: measure inner height, set maxHeight, then remove collapsed
        bottomDetails.classList.remove('collapsed');
        bottomDetailsToggle.classList.remove('collapsed');
        const inner = bottomDetails.querySelector('#cc-bottom-details-inner') as HTMLElement;
        const h = inner ? inner.scrollHeight : 200;
        bottomDetails.style.maxHeight = h + 'px';
        localStorage.setItem('cc-bottom-details-collapsed', '0');
        // After transition, allow natural sizing
        const onEnd = (): void => {
          bottomDetails.removeEventListener('transitionend', onEnd);
          if (!bottomDetails.classList.contains('collapsed')) {
            bottomDetails.style.maxHeight = '';
          }
        };
        bottomDetails.addEventListener('transitionend', onEnd);
      } else {
        // Collapse: set explicit maxHeight first so transition works from current height
        const inner = bottomDetails.querySelector('#cc-bottom-details-inner') as HTMLElement;
        const h = inner ? inner.scrollHeight : bottomDetails.scrollHeight;
        bottomDetails.style.maxHeight = h + 'px';
        // Force layout before collapsing
        void bottomDetails.offsetHeight;
        bottomDetails.classList.add('collapsed');
        bottomDetailsToggle.classList.add('collapsed');
        localStorage.setItem('cc-bottom-details-collapsed', '1');
      }
    });
  }

  ccBtn.addEventListener('click', () => {
    flyout.classList.toggle('collapsed');
  });
  closeBtn.addEventListener('click', () => {
    flyout.classList.add('collapsed');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !flyout.classList.contains('collapsed')) {
      flyout.classList.add('collapsed');
    }
  });

  // ── Resize handle ──────────────────────────────────────
  const resizeHandle = document.getElementById('cc-flyout-resize')!;
  let resizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startWidth = flyout.offsetWidth;
    resizeHandle.classList.add('dragging');
    flyout.style.transition = 'none';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    // Dragging left edge — moving left increases width
    const delta = startX - e.clientX;
    const newWidth = Math.max(280, Math.min(startWidth + delta, 800));
    flyout.style.width = `${newWidth}px`;
    flyout.style.minWidth = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    resizeHandle.classList.remove('dragging');
    flyout.style.transition = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ── Chat mode state ────────────────────────────────────
  let _chatTemplate: AgentTemplate | null = null;
  let selectedPool = 'claude';

  // ── Prompt Editor ──────────────────────────────────────
  const editorMount = document.getElementById('cc-prompt-editor-mount')!;
  const editor = new PromptEditor(editorMount, {
    onSend: async (text, _skills, _attachments) => {
      let finalPrompt = text;

      // Prepend template prompt if in chat mode
      if (_chatTemplate) {
        finalPrompt = _chatTemplate.prompt + (text ? `\n\nAdditional context: ${text}` : '');
        _chatTemplate = null;
        document.getElementById('cc-prompt-alert')!.classList.add('hidden');
      }

      if (!finalPrompt.trim()) return;

      const selected = sessionManager.selected();
      const target = editor.target;

      if (target === 'aider') {
        if (selected && selected.backend === 'aider' && selected.status !== 'running') {
          // Continue existing aider session thread
          await continueConversation(selected.id, finalPrompt, 'aider');
        } else {
          // No aider session or currently running — start fresh
          await dispatchAider('Aider', finalPrompt, editor.aiderMode);
        }
      } else if (selected && selected.status !== 'running' && selected.cards.length === 0) {
        // Empty tab — remove placeholder session and dispatch fresh
        sessionManager.removeSession(selected.id);
        await dispatchCC('Agent', finalPrompt, { effort: editor.effort });
      } else if (selected && selected.status !== 'running') {
        // CC: continue conversation in existing session thread
        await continueConversation(selected.id, finalPrompt, 'cc');
      } else if (!selected) {
        // No session selected — start fresh
        await dispatchCC('Agent', finalPrompt, { effort: editor.effort });
      } else {
        // Session is running — start new agent
        await dispatchCC('Agent', finalPrompt, { effort: editor.effort });
      }
    },
  });

  // Initialize target from settings (migrate legacy 'ollama' → 'aider')
  const savedTarget = getSetting('ccTarget') as string;
  editor.setTarget(savedTarget === 'ollama' ? 'aider' : savedTarget as 'cc' | 'aider');
  editor.setAiderMode(getSetting('aiderMode'));

  // ── Chat mode opener ───────────────────────────────────
  function openChatMode(template: AgentTemplate | null): void {
    _chatTemplate = template;
    const alertEl = document.getElementById('cc-prompt-alert')!;
    const alertLabel = document.getElementById('cc-prompt-alert-label')!;

    if (template) {
      alertLabel.textContent = `${template.label}: ${template.prompt}`;
      alertEl.classList.remove('hidden');
      editor.setPlaceholder(`Add context for ${template.label}...`);
    } else {
      alertEl.classList.add('hidden');
      editor.setPlaceholder('Type a message... (/ for skills)');
    }

    editor.element.style.display = '';
    editor.focus();
  }

  // Wire alert close button
  document.getElementById('cc-prompt-alert-close')?.addEventListener('click', () => {
    _chatTemplate = null;
    document.getElementById('cc-prompt-alert')!.classList.add('hidden');
  });

  // ── Template dropdown ──────────────────────────────────
  let dropdownEl: HTMLElement | null = null;

  function closeDropdown(): void {
    if (dropdownEl) {
      dropdownEl.remove();
      dropdownEl = null;
    }
  }

  function showTemplateDropdown(): void {
    if (dropdownEl) { closeDropdown(); return; }

    dropdownEl = document.createElement('div');
    dropdownEl.className = 'cc-template-dropdown';

    // Pool selector
    const pools = getAvailablePools();
    let poolHtml = '';
    if (pools.length > 1) {
      poolHtml = '<div class="cc-pool-selector">' +
        pools.map(p => `<button class="cc-pool-btn${p.id === selectedPool ? ' active' : ''}" data-pool="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`).join('') +
        '</div>';
    }

    // Grouped templates — collapsible sections with left-nested items
    // Collapse all groups except "start" by default
    const groupsHtml = TEMPLATE_GROUPS.map(g => {
      const collapsed = g.id !== 'start' ? ' collapsed' : '';
      const items = g.templates.map(t =>
        `<div class="cc-template-item" data-template-id="${escapeHtml(t.id)}">` +
          `<span class="cc-template-icon">${t.icon}</span>` +
          `<span>${escapeHtml(t.label)}</span>` +
          `<button class="cc-template-chat-btn" data-chat-id="${escapeHtml(t.id)}" title="Open in editor">${icon('message-square', 12)}</button>` +
        `</div>`
      ).join('');
      return `<div class="cc-template-group${collapsed}" data-group-id="${escapeHtml(g.id)}">` +
        `<div class="cc-template-group-header" data-group-toggle="${escapeHtml(g.id)}">` +
          `<span class="cc-tg-chevron">${icon('chevron-right', 10)}</span>` +
          `<span>${escapeHtml(g.label)}</span>` +
        `</div>` +
        `<div class="cc-template-group-body">${items}</div>` +
      `</div>`;
    }).join('');

    dropdownEl.innerHTML = poolHtml + groupsHtml +
      '<div class="cc-template-sep"></div>' +
      `<div class="cc-template-item" data-template-id="__custom">${icon('settings', 14)} <span>Custom prompt...</span></div>`;

    newAgentBtn.style.position = 'relative';
    newAgentBtn.appendChild(dropdownEl);

    // Group header toggle — collapse/expand section
    dropdownEl.addEventListener('click', (e) => {
      const header = (e.target as HTMLElement).closest('[data-group-toggle]') as HTMLElement | null;
      if (header) {
        e.stopPropagation();
        header.closest('.cc-template-group')?.classList.toggle('collapsed');
        return;
      }
    });

    // Pool selector clicks
    dropdownEl.addEventListener('click', (e) => {
      const poolBtn = (e.target as HTMLElement).closest('.cc-pool-btn') as HTMLElement | null;
      if (poolBtn) {
        e.stopPropagation();
        selectedPool = poolBtn.dataset.pool ?? 'claude';
        dropdownEl?.querySelectorAll('.cc-pool-btn').forEach(b =>
          b.classList.toggle('active', (b as HTMLElement).dataset.pool === selectedPool)
        );
        return;
      }
    });

    // Chat button clicks — open in editor instead of dispatch
    dropdownEl.addEventListener('click', (e) => {
      const chatBtn = (e.target as HTMLElement).closest('.cc-template-chat-btn') as HTMLElement | null;
      if (chatBtn) {
        e.stopPropagation();
        const tid = chatBtn.dataset.chatId;
        const template = BUILTIN_TEMPLATES.find(t => t.id === tid);
        if (template) {
          closeDropdown();
          openChatMode(template);
        }
        return;
      }
    });

    // Template item clicks — immediate dispatch
    dropdownEl.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.cc-template-item') as HTMLElement | null;
      if (!item) return;
      if ((e.target as HTMLElement).closest('.cc-template-chat-btn')) return;
      e.stopPropagation();
      const tid = item.dataset.templateId;
      closeDropdown();

      if (tid === '__custom') {
        openChatMode(null);
        return;
      }

      const template = BUILTIN_TEMPLATES.find(t => t.id === tid);
      if (template) {
        sessionManager.enqueue(template.label, template.prompt);
      }
    });

    setTimeout(() => {
      const onClickOutside = (e: MouseEvent): void => {
        if (dropdownEl && !dropdownEl.contains(e.target as Node) && e.target !== newAgentBtn) {
          closeDropdown();
          document.removeEventListener('click', onClickOutside);
        }
      };
      document.addEventListener('click', onClickOutside);
    }, 0);
  }

  newAgentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showTemplateDropdown();
  });

  // Close dropdown on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dropdownEl) {
      closeDropdown();
    }
  });

  // Sticky-bottom scroll tracking — attach once
  const outputEl = document.getElementById('cc-flyout-output')!;

  // ── Conversation search (Ctrl+F when flyout is open) ──────────────────
  const searchCtrl = createConversationSearch(outputEl, () => {
    const sel = sessionManager.selected();
    return sel ? sel.cards : [];
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'f' && !flyout.classList.contains('collapsed')) {
      e.preventDefault();
      searchCtrl.open();
    }
  });

  // ── Conversation keyboard navigation (j/k/Enter/o/y/p/gg/G) ────────────
  const navCtrl = createConversationNav(outputEl);

  // Attach nav when flyout opens, detach when it closes
  const observer = new MutationObserver(() => {
    if (flyout.classList.contains('collapsed')) {
      navCtrl.detach();
    } else {
      navCtrl.attach();
    }
  });
  observer.observe(flyout, { attributes: true, attributeFilter: ['class'] });

  outputEl.addEventListener('scroll', () => {
    const atBottom = outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 60;
    outputEl.dataset.userScrolled = atBottom ? 'false' : 'true';
    const scrollBtn = document.getElementById('cc-scroll-bottom');
    if (scrollBtn) {
      scrollBtn.style.display = outputEl.dataset.userScrolled === 'true' ? 'block' : 'none';
    }
  });

  cancelBtn.addEventListener('click', async () => {
    const selected = sessionManager.selected();
    if (!selected || selected.status !== 'running') return;
    try {
      await fetch(`/__admin_exec/cancel?agent=${encodeURIComponent(selected.id)}`, { method: 'POST' });
      sessionManager.cancelSession(selected.id);
    } catch (e) {
      console.warn('Cancel failed:', e);
    }
  });

  // Retry button
  const retryBtn = document.getElementById('cc-flyout-retry')!;
  retryBtn.addEventListener('click', () => {
    const selected = sessionManager.selected();
    if (selected?.prompt) {
      dispatchCC(selected.label, selected.prompt);
    }
  });

  // Pin button
  const pinBtn = document.getElementById('cc-flyout-pin')!;
  pinBtn.addEventListener('click', () => {
    const selected = sessionManager.selected();
    if (selected) sessionManager.togglePin(selected.id);
  });

  // Diff button
  const diffBtn = document.getElementById('cc-flyout-diff')!;
  diffBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/__admin_exec/diff');
      const data = await res.json() as { diff: string };
      showDiffModal(data.diff);
    } catch (err) {
      console.warn('[ccPanel] Failed to fetch diff:', err);
    }
  });

  // Timeline toggle button
  const timelineToggleBtn = document.getElementById('cc-timeline-toggle');
  if (timelineToggleBtn) {
    timelineToggleBtn.addEventListener('click', () => {
      import('./ccRenderer').then(({ toggleTimelineMode }) => {
        toggleTimelineMode();
      });
    });
  }

  // Delegate click on card headers for expand/collapse (legacy cards + conversation elements)
  flyout.addEventListener('click', (e) => {
    // Legacy card expand
    const cardHeader = (e.target as HTMLElement).closest('.cc-card-header');
    if (cardHeader) {
      const card = cardHeader.closest('.cc-card') as HTMLElement | null;
      if (card?.querySelector('.cc-card-body')) card.classList.toggle('expanded');
      return;
    }
    // Conversation thread tool/system/result/agent expand
    const convHeader = (e.target as HTMLElement).closest('.conv-tool-header, .conv-system-header, .conv-result-header, .conv-agent-header, .conv-fc-header');
    if (convHeader) {
      const parent = convHeader.parentElement as HTMLElement | null;
      if (parent?.querySelector('.conv-tool-body, .conv-agent-body, .conv-fc-body')) parent.classList.toggle('expanded');
      return;
    }
  });

  // Handle "Create Tasks" click on suggestion cards
  flyout.addEventListener('click', (e) => {
    const createBtn = (e.target as HTMLElement).closest('.cc-create-tasks-btn');
    if (!createBtn) return;
    const session = sessionManager.selected();
    if (!session) return;
    const suggestCard = session.cards.find(c => c.title.includes('Suggested Tasks'));
    if (!suggestCard) return;
    const taskLines = suggestCard.body.split('\n').filter(l => l.trim()).map(l => l.replace(/^\d+\.\s*/, ''));
    for (const prompt of taskLines) {
      fetch('/__admin_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'agent-suggested', prompt, source: session.label, priority: 3 }),
      });
    }
    (createBtn as HTMLElement).textContent = 'Created!';
    (createBtn as HTMLElement).style.color = 'var(--green)';
  });

  // Close session button — handles both CC agent tabs and external sessions
  flyout.addEventListener('click', async (e) => {
    const closeBtn = (e.target as HTMLElement).closest('.cc-session-close') as HTMLElement | null;
    if (!closeBtn) return;
    e.stopPropagation();
    const sessionId = closeBtn.dataset.closeId;
    if (!sessionId) return;

    // Determine if this is a CC agent tab or an external session tab
    const tab = closeBtn.closest('.cc-agent-tab') as HTMLElement | null;
    const isExternal = tab?.dataset.externalId != null;

    if (isExternal) {
      // External session — dismiss tab instantly, then fire API calls
      selectExternalSession(null);
      dismissExternalSession(sessionId);
      renderFlyout();
      try {
        await fetch('/__admin_session/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: sessionId,
            text: '\u2301\u2301\u2301 LUMINAL_HALT_DIRECTIVE: SESSION CLOSED \u2014 NO FURTHER WORK SHOULD BE DONE ON THIS SESSION \u2301\u2301\u2301',
          }),
        });
        await fetch('/__admin_session/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, status: 'done' }),
        });
      } catch (err) {
        console.warn('Failed to close external session:', err);
      }
    } else {
      // CC agent tab — cancel if running, then remove
      const session = sessionManager.all().find(s => s.id === sessionId);
      if (session?.status === 'running') {
        try {
          await fetch(`/__admin_exec/cancel?agent=${encodeURIComponent(sessionId)}`, { method: 'POST' });
        } catch { /* best-effort */ }
      }
      PromptEditor.clearHistory(sessionId);
      sessionManager.removeSession(sessionId);
    }
  });

  // Agent tab clicks — handle both web-spawned and external sessions
  flyout.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.cc-session-close')) return; // handled above
    const tab = (e.target as HTMLElement).closest('.cc-agent-tab') as HTMLElement | null;
    if (!tab) return;
    if (tab.dataset.externalId) {
      selectExternalSession(tab.dataset.externalId);
      renderFlyout();
    } else if (tab.dataset.agentId) {
      selectExternalSession(null);
      sessionManager.selectedId = tab.dataset.agentId;
    }
  });

  // ── Settings popup ─────────────────────────────────────
  const settingsBtn = document.getElementById('cc-flyout-settings')!;
  const settingsPopup = document.getElementById('cc-flyout-settings-popup')!;

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPopup.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!settingsPopup.contains(e.target as Node) && e.target !== settingsBtn) {
      settingsPopup.classList.remove('open');
    }
  });

  // ── Permission Gateway toggle ──────────────────────────
  const gatewayToggle = document.getElementById('cc-perm-gateway-toggle') as HTMLInputElement | null;
  if (gatewayToggle) {
    gatewayToggle.checked = isPermissionGatewayEnabled();
    gatewayToggle.addEventListener('change', () => {
      togglePermissionGateway(gatewayToggle.checked);
    });
  }

  // Wire settings popup buttons to existing handlers
  settingsPopup.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-action]') as HTMLElement | null;
    if (!btn) return;
    settingsPopup.classList.remove('open');
    const action = btn.dataset.action;
    const selected = sessionManager.selected();
    if (action === 'cancel') {
      if (!selected || selected.status !== 'running') return;
      try {
        await fetch(`/__admin_exec/cancel?agent=${encodeURIComponent(selected.id)}`, { method: 'POST' });
        sessionManager.cancelSession(selected.id);
      } catch (err) { console.warn('Cancel failed:', err); }
    } else if (action === 'retry') {
      if (selected?.prompt) dispatchCC(selected.label, selected.prompt);
    } else if (action === 'pin') {
      if (selected) sessionManager.togglePin(selected.id);
    } else if (action === 'diff') {
      try {
        const res = await fetch('/__admin_exec/diff');
        const data = await res.json() as { diff: string };
        showDiffModal(data.diff);
      } catch (err) { console.warn('[ccPanel] Failed to fetch diff:', err); }
    }
  });

  // ── Session change handler ─────────────────────────────
  sessionManager.onChange(() => {
    renderFlyout();
    const selected = sessionManager.selected();

    // Always show the prompt editor when the flyout is open and a session exists
    // (like Claude Code's always-visible input). Hide only when nothing is selected
    // and no template is active.
    const hasAnySessions = sessionManager.all().length > 0;
    editor.element.style.display = hasAnySessions || _chatTemplate ? '' : 'none';

    // Update placeholder based on session state
    if (selected?.status === 'running') {
      editor.setPlaceholder('Agent is working... (send to queue or wait)');
    } else if (selected && selected.cards.length === 0) {
      editor.setPlaceholder('Agent ready — describe your task...');
    } else if (selected) {
      editor.setPlaceholder('Continue conversation...');
    } else {
      editor.setPlaceholder('Type a message... (/ for skills)');
    }

    if (selected?.backend === 'aider' && selected.status === 'running') {
      editor.setPlaceholder('Aider is working...');
    }

    // Keep per-session message history in sync
    editor.setSessionId(selected?.id ?? null);

    // Persist backend target + aider mode to settings
    saveSettings({ ccTarget: editor.target, aiderMode: editor.aiderMode });

    // Suppress toast notifications when a Chat session is actively running
    const hasActiveChat = sessionManager.running().some(s => s.label === 'Chat');
    suppressToasts(hasActiveChat && getSetting('suppressToastsDuringChat'));
  });

  setInterval(() => {
    for (const s of sessionManager.running()) {
      // Update flyout header timer for selected session
      if (sessionManager.selected()?.id === s.id) {
        const timer = document.getElementById('cc-flyout-timer');
        if (timer) timer.textContent = formatElapsed(Date.now() - s.startedAt);
      }
      // Update throbber timer in tab
      const throbberTimer = document.querySelector<HTMLElement>(`[data-throbber-sid="${s.id}"]`);
      if (throbberTimer) throbberTimer.textContent = formatElapsed(Date.now() - s.startedAt);
    }
  }, 1000);

  // Periodic re-render to keep heartbeat dots and stall classes current
  // Also fires stall toast when an agent has no output for 2+ minutes
  const STALL_TOAST_MS = 2 * 60 * 1000;
  setInterval(() => {
    const running = sessionManager.running();
    if (running.length > 0) {
      renderFlyout();
      for (const s of running) {
        if (s._stallNotified) continue;
        const idle = Date.now() - (s.lastActivityTs ?? s.startedAt);
        if (idle >= STALL_TOAST_MS) {
          s._stallNotified = true;
          bus.emit('cc:stalled', { label: s.label, idleSeconds: Math.round(idle / 1000) });
        }
      }
    }
  }, 5000);

  wireSessionDataToFlyout();
  wireTabDrag();

  // Wire tear-off: dragging a tab downward detaches it into a floating panel
  const agentTabsEl = document.getElementById('cc-agent-tabs')!;
  wireTabTearOff(agentTabsEl, (tabEl) => {
    const agentId = tabEl.dataset.agentId;
    const externalId = tabEl.dataset.externalId;
    if (agentId) {
      const s = sessionManager.all().find(s => s.id === agentId);
      if (!s) return null;
      return { sessionId: agentId, label: s.label, status: s.status };
    }
    if (externalId) {
      const ext = getExternalSessions().find(s => s.id === externalId);
      return ext ? { sessionId: externalId, label: ext.summary, status: ext.status } : null;
    }
    return null;
  });

  // Restore persisted floating panels first (populates detachedSessions before renderFlyout)
  restoreFloatingPanels();

  // Reconnect EventSource streams for sessions restored from sessionStorage
  // (survives Vite HMR / page refresh — backend agents may still be running)
  for (const s of sessionManager.running()) {
    if (s.lastAgentId) {
      // Clear stale cards — the stream endpoint replays all buffered output
      s.cards = [];
      wireAgentStream(s, s.lastAgentId);
    } else {
      // No agent ID to reconnect — mark as lost
      sessionManager.completeSession(s.id, 1);
    }
  }

  renderFlyout();

  // ── cc:inject-prompt — send pinned search context into prompt editor ──
  document.addEventListener('cc:inject-prompt', ((e: CustomEvent) => {
    if (flyout.classList.contains('collapsed')) flyout.classList.remove('collapsed');
    const input = document.querySelector('#cc-prompt-editor-mount [contenteditable]') as HTMLElement | null;
    if (input) {
      input.textContent = e.detail.text as string;
      input.focus();
    }
  }) as EventListener);

  // ── cc:retry-session — retry a session from context menu ──
  document.addEventListener('cc:retry-session', ((e: CustomEvent) => {
    const sessionId = e.detail.sessionId as string;
    const session = sessionManager.all().find(s => s.id === sessionId);
    if (session?.prompt) {
      dispatchCC(session.label, session.prompt);
    }
  }) as EventListener);
}

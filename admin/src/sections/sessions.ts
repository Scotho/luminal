import { escapeHtml } from '../ui/render';
import type { Session, SessionPhase, AgentTask, SessionSection, SessionStatus, ReorderEntry } from '../types';
import { getSessionCache } from '../ui/sessionDataService';
import { icon } from '../ui/icons';

/** Normalize phases that may be stored as bare strings in older sessions. */
function normalizePhases(raw: unknown[]): SessionPhase[] {
  return raw.map(p => {
    if (typeof p === 'string') return { label: p, done: false };
    return p as SessionPhase;
  });
}

// ── Status colors ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<SessionStatus, string> = {
  'done': 'var(--green)',
  'done-followup': 'var(--yellow)',
  'needs-attention': 'var(--red)',
  'blocked': 'var(--red)',
  'active': 'var(--accent)',
  'todo': 'var(--text-dim)',
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  'done': 'Done',
  'done-followup': 'Follow-up',
  'needs-attention': 'Needs Attention',
  'blocked': 'Blocked',
  'active': 'Active',
  'todo': 'To Do',
};

const TYPE_COLORS: Record<string, string> = {
  'feature': 'var(--accent)',
  'bugfix': 'var(--red)',
  'polish': 'var(--purple, #aa64ff)',
  'tuning': 'var(--orange)',
  'chore': 'var(--text-dim)',
};

// ── Stale detection ──────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const ARCHIVE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isStale(session: Session, now: number = Date.now()): boolean {
  if (session.status !== 'active') return false;
  // Check most recent note timestamp first
  if (session.notes.length > 0) {
    const latestNote = session.notes.reduce((a, b) =>
      a.ts > b.ts ? a : b
    );
    return now - new Date(latestNote.ts).getTime() > STALE_THRESHOLD_MS;
  }
  // Fall back to created date
  return now - new Date(session.created).getTime() > STALE_THRESHOLD_MS;
}

function isArchivable(session: Session, now: number = Date.now()): boolean {
  return (session.status === 'done' || session.status === 'done-followup')
    && (now - new Date(session.created).getTime() > ARCHIVE_AGE_MS);
}

// ── Pure render helpers ──────────────────────────────────────────────────────

/** Sort sessions: current-stack first, then by created desc within each group. */
export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    // current-stack before backlog
    if (a.section !== b.section) {
      return a.section === 'current-stack' ? -1 : 1;
    }
    // newest first within section
    return b.created.localeCompare(a.created);
  });
}

/** Filter sessions by section. */
export function getSessionsBySection(sessions: Session[], section: SessionSection): Session[] {
  return sessions.filter(s => s.section === section);
}

/** Render a single session card as an HTML string. */
export function renderSessionCard(session: Session, agentTasks: AgentTask[], now?: number): string {
  const statusColor = STATUS_COLORS[session.status] ?? 'var(--text-dim)';
  const statusLabel = STATUS_LABELS[session.status] ?? session.status;
  const typeColor = TYPE_COLORS[session.type] ?? 'var(--text-dim)';
  const stale = isStale(session, now);
  const sessionAgentTasks = agentTasks.filter(t => t.sessionId === session.id);

  // Opacity based on status
  let opacity = '1';
  if (session.status === 'done') opacity = '0.6';
  else if (session.status === 'done-followup') opacity = '0.8';
  else if (session.status === 'todo') opacity = '0.6';

  // Phase checkboxes (normalize bare-string phases from older sessions)
  const phases = normalizePhases(session.phases as unknown[]);
  const phaseHtml = phases.length > 0
    ? `<div style="font-family:var(--font-mono); font-size:12px; color:var(--text-dim); margin-bottom:6px;">
        ${phases.map(p => `<div style="margin-bottom:2px;">${p.done ? '☑' : '☐'} ${escapeHtml(p.label)}</div>`).join('')}
      </div>`
    : '';

  // Quick stats line
  const stats: string[] = [];
  if (sessionAgentTasks.length > 0) stats.push(`${sessionAgentTasks.length} agent task${sessionAgentTasks.length !== 1 ? 's' : ''}`);
  if (session.notes.length > 0) stats.push(`${session.notes.length} note${session.notes.length !== 1 ? 's' : ''}`);
  if (session.branch) stats.push(`branch: ${escapeHtml(session.branch)}`);
  const statsHtml = stats.length > 0
    ? `<div style="font-size:12px; color:var(--text-dim); margin-bottom:6px;">${stats.join(' &middot; ')}</div>`
    : '';

  // E2E debugging info — parse structured error data from notes
  const isE2E = session.summary.startsWith('E2E:');
  const debugEntries = isE2E ? session.notes.filter(n =>
    n.text.includes('E2E FAILURE') || n.text.includes('E2E PASS') || n.text.includes('E2E WARNING')
  ) : [];
  const debugHtml = debugEntries.length > 0
    ? `<div style="margin-top:6px; margin-bottom:6px;">
        <div style="font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">Debugging</div>
        ${debugEntries.map(n => {
          const isPass = n.text.includes('PASS');
          const isWarn = n.text.includes('WARNING');
          const color = isPass ? 'var(--green)' : isWarn ? 'var(--orange)' : 'var(--red)';
          const icon = isPass ? '&#x2705;' : isWarn ? '&#x26A0;' : '&#x274C;';
          // Parse structured fields from note text
          const lines = n.text.split('\n');
          const errorLine = lines.find(l => l.startsWith('Error:'));
          const expectedLine = lines.find(l => l.startsWith('Expected:'));
          const actualLine = lines.find(l => l.startsWith('Actual:'));
          const timeLine = lines.find(l => l.startsWith('Time:'));
          return `
          <div style="font-size:11px; margin-bottom:6px; padding:6px 8px; background:var(--bg); border-left:3px solid ${color}; border-radius:0 4px 4px 0;">
            <div style="color:${color}; font-weight:600; margin-bottom:2px;">${icon} ${escapeHtml(lines[0])}</div>
            ${timeLine ? `<div style="color:var(--text-dim); font-size:10px;">${escapeHtml(timeLine)}</div>` : ''}
            ${errorLine ? `<div style="color:var(--text); margin-top:3px;"><strong>Error:</strong> <code style="font-size:10px; word-break:break-all;">${escapeHtml(errorLine.replace('Error: ', ''))}</code></div>` : ''}
            ${expectedLine ? `<div style="color:var(--green); font-size:10px; margin-top:2px;">${escapeHtml(expectedLine)}</div>` : ''}
            ${actualLine ? `<div style="color:var(--red); font-size:10px; margin-top:1px;">${escapeHtml(actualLine)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`
    : '';

  // Followup button
  const followupPrompt = `Continue session ${session.id}: "${session.summary}". Status: ${session.status}. ${session.plan ? 'Plan: ' + session.plan.slice(0, 200) : ''}`;
  const followupBtnHtml = `<button class="session-followup-btn refresh-btn" data-prompt="${escapeHtml(followupPrompt)}" style="font-size:10px; padding:2px 8px; margin-top:6px; cursor:pointer;" title="Copy followup prompt to clipboard">Request Followup</button>`;

  // Drill-down: More Details (hidden by default, toggled by click)
  const sortedNotes = [...session.notes].sort((a, b) => b.ts.localeCompare(a.ts));
  const drillDownHtml = `
    <div style="margin-top:8px;">
      <div class="session-drilldown-toggle" style="font-size:11px; font-weight:600; color:var(--accent); cursor:pointer; user-select:none; margin-bottom:4px;">▸ More Details</div>
      <div class="session-drilldown-body" style="display:none;">
        <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px; padding:6px 8px; background:var(--bg); border-radius:4px;">
          <div style="margin-bottom:3px;"><strong>ID:</strong> <code style="font-size:10px;">${escapeHtml(session.id)}</code></div>
          <div style="margin-bottom:3px;"><strong>Created:</strong> ${escapeHtml(new Date(session.created).toLocaleString())}</div>
          ${session.completed ? `<div style="margin-bottom:3px;"><strong>Completed:</strong> ${escapeHtml(new Date(session.completed).toLocaleString())}</div>` : ''}
          ${session.branch ? `<div style="margin-bottom:3px;"><strong>Branch:</strong> <code style="font-size:10px;">${escapeHtml(session.branch)}</code></div>` : ''}
          ${session.specPath ? `<div style="margin-bottom:3px;"><strong>Spec:</strong> <code style="font-size:10px;">${escapeHtml(session.specPath)}</code></div>` : ''}
        </div>
        ${session.plan ? `
          <div style="margin-bottom:8px;">
            <div style="font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">Plan</div>
            <div style="font-size:12px; color:var(--text-dim); padding:6px 8px; background:var(--bg); border-radius:4px; white-space:pre-wrap; word-break:break-word;">${escapeHtml(session.plan)}</div>
          </div>
        ` : ''}
        ${sortedNotes.length > 0 ? `
          <div style="margin-bottom:8px;">
            <div style="font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">Notes (${sortedNotes.length})</div>
            ${sortedNotes.map(n => {
              const isAgent = n.text.startsWith('[Agent:');
              const noteIcon = isAgent ? '&#9881; ' : '';
              const noteColor = isAgent ? 'var(--accent)' : 'var(--text-dim)';
              return `
              <div style="font-size:12px; margin-bottom:4px; padding-left:8px; border-left:2px solid ${isAgent ? 'var(--accent)' : 'var(--border)'};">
                <span style="color:${noteColor}; font-size:11px;">${noteIcon}${escapeHtml(new Date(n.ts).toLocaleString())}</span><br/>
                <span style="color:${noteColor}; white-space:pre-wrap; word-break:break-word;">${escapeHtml(n.text)}</span>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
        ${sessionAgentTasks.length > 0 ? `
          <div style="margin-bottom:8px;">
            <div style="font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">Agent Tasks (${sessionAgentTasks.length})</div>
            ${sessionAgentTasks.map(at => {
              const statusDot = at.agentStatus === 'done' ? '&#x1F7E2;'
                : at.agentStatus === 'running' ? '&#x1F535;'
                : at.agentStatus === 'error' ? '&#x1F534;'
                : '&#x26AA;';
              return `<div style="font-size:12px; margin-bottom:4px; padding-left:8px;">
                ${statusDot} <span style="color:var(--text-dim); font-size:11px;">${escapeHtml(at.agentStatus)}</span> — ${escapeHtml(at.prompt.slice(0, 200))}${at.prompt.length > 200 ? '...' : ''}
                ${at.output ? `<div style="font-size:10px; color:var(--text-dim); margin-top:2px; padding:4px 6px; background:var(--bg); border-radius:3px; white-space:pre-wrap; max-height:120px; overflow-y:auto;">${escapeHtml(at.output.slice(0, 500))}${at.output.length > 500 ? '...' : ''}</div>` : ''}
              </div>`;
            }).join('')}
          </div>
        ` : ''}
      </div>
    </div>`;

  // Blocked overlay
  const blockedOverlay = session.status === 'blocked'
    ? `<span style="position:absolute; top:8px; right:12px; color:var(--red); font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:0.05em;">BLOCKED</span>`
    : '';

  // Stale indicator
  const staleIndicator = stale
    ? `<span style="color:var(--orange); font-size:10px; margin-right:4px;">●</span>`
    : '';

  return `
    <div class="session-card${stale ? ' stale' : ''}" data-session-id="${escapeHtml(session.id)}" data-status="${escapeHtml(session.status)}" style="position:relative; background:var(--bg-panel); border:1px solid ${session.status === 'blocked' ? 'var(--red)' : 'var(--border)'}; border-left:3px solid ${statusColor}; border-radius:6px; padding:12px; margin-bottom:8px; opacity:${opacity};">
      ${blockedOverlay}
      <div class="session-card-header" style="display:flex; align-items:center; gap:8px; cursor:pointer; flex-wrap:wrap;">
        ${staleIndicator}<span style="width:8px; height:8px; border-radius:50%; background:${statusColor}; display:inline-block; flex-shrink:0;"></span>
        <span style="font-size:12px; color:${statusColor}; font-weight:600;">${escapeHtml(statusLabel)}</span>
        <span style="font-size:11px; padding:1px 6px; border-radius:3px; background:rgba(128,128,128,0.15); color:${typeColor}; font-weight:600; text-transform:uppercase; letter-spacing:0.03em;">${escapeHtml(session.type)}</span>
        <span style="font-size:13px; flex:1;">${escapeHtml(session.summary)}</span>
      </div>
      <div class="session-card-detail" style="display:none; margin-top:10px; padding-top:8px; border-top:1px solid var(--border);">
        ${phaseHtml}
        ${statsHtml}
        ${debugHtml}
        ${followupBtnHtml}
        ${drillDownHtml}
      </div>
    </div>
  `;
}

// ── Persistence helpers ──────────────────────────────────────────────────────

async function loadSessions(): Promise<Session[]> {
  // Read from the background-polled cache — always fresh, no extra fetch
  return getSessionCache();
}

async function loadAgentTasks(): Promise<AgentTask[]> {
  try {
    const res = await fetch('/data/agent-tasks.json');
    if (!res.ok) return [];
    return await res.json() as AgentTask[];
  } catch {
    return [];
  }
}

async function saveSessions(sessions: Session[]): Promise<void> {
  try {
    const res = await fetch('/__admin_save?file=sessions.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessions, null, 2),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  } catch (e) {
    console.warn('Failed to save sessions:', e);
  }
}

async function saveArchive(archived: Session[]): Promise<void> {
  try {
    // Load existing archive first
    let existing: Session[] = [];
    try {
      const res = await fetch('/data/sessions-archive.json');
      if (res.ok) existing = await res.json() as Session[];
    } catch { /* empty */ }

    const merged = [...existing, ...archived];
    const saveRes = await fetch('/__admin_save?file=sessions-archive.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged, null, 2),
    });
    if (!saveRes.ok) throw new Error(`Archive save failed: ${saveRes.status}`);
  } catch (e) {
    console.warn('Failed to save archive:', e);
    throw e;
  }
}

async function loadReorderLog(): Promise<ReorderEntry[]> {
  try {
    const res = await fetch('/data/reorder-log.json');
    if (!res.ok) return [];
    return await res.json() as ReorderEntry[];
  } catch {
    return [];
  }
}

// ── Section entry point ──────────────────────────────────────────────────────

// ── Kanban helpers ──────────────────────────────────────────────────────────

function renderKanbanCard(session: Session, agentTasks: AgentTask[]): string {
  const typeColor = TYPE_COLORS[session.type] ?? 'var(--text-dim)';
  const phases = normalizePhases(session.phases as unknown[]);
  const sessionAgentTasks = agentTasks.filter(t => t.sessionId === session.id);

  // Phase checkboxes
  const phaseHtml = phases.length > 0
    ? `<div style="font-family:var(--font-mono); font-size:10px; color:var(--text-dim); margin-top:4px;">
        ${phases.map(p => `<div style="margin-bottom:1px;">${p.done ? '☑' : '☐'} ${escapeHtml(p.label)}</div>`).join('')}
      </div>`
    : '';

  // Quick stats
  const stats: string[] = [];
  if (sessionAgentTasks.length > 0) stats.push(`${sessionAgentTasks.length} task${sessionAgentTasks.length !== 1 ? 's' : ''}`);
  if (session.notes.length > 0) stats.push(`${session.notes.length} note${session.notes.length !== 1 ? 's' : ''}`);
  const statsLine = stats.length > 0
    ? `<div style="font-size:9px; color:var(--text-dim); margin-top:3px;">${stats.join(' · ')}</div>`
    : '';

  // E2E debugging
  const isE2E = session.summary.startsWith('E2E:');
  const debugEntries = isE2E ? session.notes.filter(n =>
    n.text.includes('E2E FAILURE') || n.text.includes('E2E PASS') || n.text.includes('E2E WARNING')
  ) : [];
  const debugHtml = debugEntries.length > 0
    ? `<div style="margin-top:4px;">
        ${debugEntries.map(n => {
          const isPass = n.text.includes('PASS');
          const isWarn = n.text.includes('WARNING');
          const color = isPass ? 'var(--green)' : isWarn ? 'var(--orange)' : 'var(--red)';
          const lines = n.text.split('\n');
          const errorLine = lines.find(l => l.startsWith('Error:'));
          return `<div style="font-size:9px; margin-bottom:3px; padding:3px 5px; border-left:2px solid ${color}; border-radius:0 3px 3px 0; background:var(--bg-panel);">
            <div style="color:${color}; font-weight:600;">${escapeHtml(lines[0].slice(0, 80))}</div>
            ${errorLine ? `<div style="color:var(--text-dim); margin-top:1px; word-break:break-all;">${escapeHtml(errorLine.slice(0, 120))}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`
    : '';

  // Followup button
  const followupPrompt = `Continue session ${session.id}: "${session.summary}". Status: ${session.status}. ${session.plan ? 'Plan: ' + session.plan.slice(0, 200) : ''}`;
  const followupBtnHtml = `<button class="session-followup-btn refresh-btn" data-prompt="${escapeHtml(followupPrompt)}" style="font-size:9px; padding:1px 6px; margin-top:4px; cursor:pointer;" title="Copy followup prompt to clipboard">Followup</button>`;

  // Drill-down details
  const sortedNotes = [...session.notes].sort((a, b) => b.ts.localeCompare(a.ts));
  const drillDownHtml = `
    <div style="margin-top:4px;">
      <div class="session-drilldown-toggle" style="font-size:9px; font-weight:600; color:var(--accent); cursor:pointer; user-select:none;">▸ More Details</div>
      <div class="session-drilldown-body" style="display:none;">
        <div style="font-size:9px; color:var(--text-dim); margin-top:4px; padding:4px 6px; background:var(--bg-panel); border-radius:3px;">
          <div style="margin-bottom:2px;"><strong>ID:</strong> <code style="font-size:9px;">${escapeHtml(session.id)}</code></div>
          <div style="margin-bottom:2px;"><strong>Created:</strong> ${escapeHtml(new Date(session.created).toLocaleString())}</div>
          ${session.completed ? `<div style="margin-bottom:2px;"><strong>Completed:</strong> ${escapeHtml(new Date(session.completed).toLocaleString())}</div>` : ''}
          ${session.branch ? `<div style="margin-bottom:2px;"><strong>Branch:</strong> ${escapeHtml(session.branch)}</div>` : ''}
          ${session.specPath ? `<div style="margin-bottom:2px;"><strong>Spec:</strong> ${escapeHtml(session.specPath)}</div>` : ''}
        </div>
        ${session.plan ? `<div style="font-size:9px; color:var(--text-dim); margin-top:4px; padding:4px 6px; background:var(--bg-panel); border-radius:3px; white-space:pre-wrap; word-break:break-word;">${escapeHtml(session.plan)}</div>` : ''}
        ${sortedNotes.length > 0 ? `
          <div style="margin-top:4px;">
            <div style="font-size:9px; font-weight:600; color:var(--text-dim); margin-bottom:2px;">Notes (${sortedNotes.length})</div>
            ${sortedNotes.map(n => {
              const isAgent = n.text.startsWith('[Agent:');
              const noteColor = isAgent ? 'var(--accent)' : 'var(--text-dim)';
              return `<div style="font-size:9px; margin-bottom:3px; padding-left:6px; border-left:2px solid ${isAgent ? 'var(--accent)' : 'var(--border)'};">
                <span style="color:${noteColor};">${escapeHtml(new Date(n.ts).toLocaleString())}</span><br/>
                <span style="color:${noteColor}; white-space:pre-wrap; word-break:break-word;">${escapeHtml(n.text)}</span>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
      </div>
    </div>`;

  return `
    <div class="kanban-card" data-session-id="${escapeHtml(session.id)}" draggable="true" style="background:var(--bg); border:1px solid var(--border); border-left:3px solid ${typeColor}; border-radius:4px; padding:8px 10px; margin-bottom:6px; cursor:grab; font-size:12px; transition:border-color 0.15s;">
      <div style="font-weight:700; color:var(--text); margin-bottom:4px; line-height:1.3;">${escapeHtml(session.summary.slice(0, 60))}</div>
      <div style="font-size:10px; color:${typeColor}; text-transform:uppercase; letter-spacing:0.5px;">${escapeHtml(session.type)}</div>
      ${phaseHtml}
      ${statsLine}
      ${debugHtml}
      ${followupBtnHtml}
      ${drillDownHtml}
    </div>
  `;
}

function renderKanban(sessions: Session[], agentTasks: AgentTask[], container: HTMLElement): void {
  const columns: { status: string; label: string; color: string }[] = [
    { status: 'todo', label: 'To Do', color: 'var(--text-dim)' },
    { status: 'active', label: 'Active', color: 'var(--accent)' },
    { status: 'blocked', label: 'Blocked', color: 'var(--red-bright, #d45234)' },
    { status: 'needs-attention', label: 'Needs Attention', color: 'var(--red-bright, #d45234)' },
    { status: 'done', label: 'Done', color: 'var(--green)' },
    { status: 'done-followup', label: 'Follow-up', color: 'var(--yellow)' },
  ];

  const kanbanEl = document.createElement('div');
  kanbanEl.id = 'sessions-kanban';
  kanbanEl.style.cssText = 'display:flex; gap:12px; overflow-x:auto; padding-bottom:12px; min-height:400px;';

  for (const col of columns) {
    const colSessions = sessions.filter(s => s.status === col.status);
    const colEl = document.createElement('div');
    colEl.style.cssText = 'min-width:220px; width:220px; flex-shrink:0; background:var(--bg-panel); border:1px solid var(--border); border-radius:6px; display:flex; flex-direction:column; max-height:calc(100vh - 200px);';
    colEl.dataset.status = col.status;

    colEl.innerHTML = `
      <div style="padding:10px 12px; border-bottom:1px solid var(--border); font-family:var(--font-display,inherit); font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:${col.color};">
        ${escapeHtml(col.label)} <span style="color:var(--text-dim); font-family:var(--font-body,inherit); font-size:11px; font-weight:600;">(${colSessions.length})</span>
      </div>
      <div class="kanban-col-body" data-status="${col.status}" style="flex:1; overflow-y:auto; padding:8px;">
        ${colSessions.length > 0 ? colSessions.map(s => renderKanbanCard(s, agentTasks)).join('') : '<div style="color:var(--text-quiet); font-size:11px; text-align:center; padding:20px;">No sessions</div>'}
      </div>
    `;
    kanbanEl.appendChild(colEl);
  }

  // Replace or insert
  const existing = container.querySelector('#sessions-kanban');
  if (existing) existing.replaceWith(kanbanEl);
  else container.appendChild(kanbanEl);

  // Wire drag-and-drop between columns
  wireKanbanDrag(kanbanEl, sessions, agentTasks, container);
}

function wireKanbanDrag(kanbanEl: HTMLElement, sessions: Session[], agentTasks: AgentTask[], container: HTMLElement): void {
  kanbanEl.addEventListener('dragstart', (e: DragEvent) => {
    const card = (e.target as HTMLElement).closest('.kanban-card') as HTMLElement | null;
    if (!card) return;
    e.dataTransfer!.setData('text/plain', card.dataset.sessionId ?? '');
    card.style.opacity = '0.4';
  });

  kanbanEl.addEventListener('dragend', (e: DragEvent) => {
    const card = (e.target as HTMLElement).closest('.kanban-card') as HTMLElement | null;
    if (card) card.style.opacity = '1';
  });

  kanbanEl.querySelectorAll<HTMLElement>('.kanban-col-body').forEach(col => {
    col.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
    });
    col.addEventListener('dragleave', () => {
      col.style.background = '';
    });
    col.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      col.style.background = '';
      const sessionId = e.dataTransfer!.getData('text/plain');
      const newStatus = col.dataset.status;
      if (!sessionId || !newStatus) return;

      // Update session status via API
      await fetch('/__admin_session/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: newStatus }),
      });

      // Update local state and re-render
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        session.status = newStatus as SessionStatus;
        renderKanban(sessions, agentTasks, container);
      }
    });
  });
}

// ── Filter bar ──────────────────────────────────────────────────────────────

const STATUS_FILTERS: { value: SessionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'todo', label: 'To Do' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'needs-attention', label: 'Attention' },
  { value: 'done', label: 'Done' },
  { value: 'done-followup', label: 'Follow-up' },
];

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'feature', label: 'Feature' },
  { value: 'bugfix', label: 'Bugfix' },
  { value: 'polish', label: 'Polish' },
  { value: 'tuning', label: 'Tuning' },
  { value: 'chore', label: 'Chore' },
];

function renderFilterBar(activeStatus: string, activeType: string): string {
  const statusBtns = STATUS_FILTERS.map(f => {
    const isActive = f.value === activeStatus;
    const color = f.value === 'all' ? 'var(--text)' : STATUS_COLORS[f.value as SessionStatus] ?? 'var(--text-dim)';
    return `<button class="session-filter-btn" data-filter-group="status" data-filter="${f.value}" style="padding:2px 8px; font-size:10px; font-weight:700; letter-spacing:0.5px; border:1px solid ${isActive ? color : 'var(--border)'}; border-radius:var(--r-sm); background:${isActive ? color : 'transparent'}; color:${isActive ? 'var(--bg)' : 'var(--text-dim)'}; cursor:pointer; transition:all 0.15s;">${f.label}</button>`;
  }).join('');

  const typeBtns = TYPE_FILTERS.map(f => {
    const isActive = f.value === activeType;
    const color = f.value === 'all' ? 'var(--text)' : TYPE_COLORS[f.value] ?? 'var(--text-dim)';
    return `<button class="session-filter-btn" data-filter-group="type" data-filter="${f.value}" style="padding:2px 8px; font-size:10px; font-weight:700; letter-spacing:0.5px; border:1px solid ${isActive ? color : 'var(--border)'}; border-radius:var(--r-sm); background:${isActive ? color : 'transparent'}; color:${isActive ? 'var(--bg)' : 'var(--text-dim)'}; cursor:pointer; transition:all 0.15s;">${f.label}</button>`;
  }).join('');

  return `
    <div id="sessions-filter-bar" style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:16px; padding:10px 12px; background:var(--bg-panel-alt); border:1px solid var(--border); border-radius:var(--r-lg);">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:10px; color:var(--text-quiet); text-transform:uppercase; letter-spacing:1px; font-weight:700;">Status</span>
        ${statusBtns}
      </div>
      <div style="width:1px; height:20px; background:var(--border);"></div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:10px; color:var(--text-quiet); text-transform:uppercase; letter-spacing:1px; font-weight:700;">Type</span>
        ${typeBtns}
      </div>
    </div>
  `;
}

function applyFilters(sessions: Session[], statusFilter: string, typeFilter: string): Session[] {
  let filtered = sessions;
  if (statusFilter !== 'all') {
    filtered = filtered.filter(s => s.status === statusFilter);
  }
  if (typeFilter !== 'all') {
    filtered = filtered.filter(s => s.type === typeFilter);
  }
  return filtered;
}

/** Render the Sessions section into container. */
export async function renderSessions(container: HTMLElement): Promise<void> {
  const [sessionsRaw, agentTasks, reorderLog] = await Promise.all([
    loadSessions(),
    loadAgentTasks(),
    loadReorderLog(),
  ]);
  let sessions = sessionsRaw;
  let completedExpanded = false;
  let reorderExpanded = false;
  let viewMode: 'list' | 'kanban' = 'list';
  let statusFilter = 'all';
  let typeFilter = 'all';

  function render(): void {
    const filtered = applyFilters(sessions, statusFilter, typeFilter);
    const hasFilter = statusFilter !== 'all' || typeFilter !== 'all';
    const currentStack = sortSessions(getSessionsBySection(filtered, 'current-stack'));
    const backlog = sortSessions(getSessionsBySection(filtered, 'backlog'));
    const completed = filtered.filter(s => s.status === 'done' || s.status === 'done-followup');
    const completedSorted = [...completed].sort((a, b) => b.created.localeCompare(a.created));

    // Count archivable sessions (done, older than 7 days) — from unfiltered list
    const archivable = sessions.filter(s => isArchivable(s));

    const filterCountText = hasFilter ? ` — ${filtered.length} shown` : '';

    container.innerHTML = `
      <h2>${icon('layout-list', 18)} Sessions <span style="color:var(--text-dim); font-size:14px; font-weight:400;">(${sessions.length} total${filterCountText})</span>
        <span style="margin-left:auto; display:flex; gap:6px; align-items:center;">
          <button id="sessions-view-toggle" class="refresh-btn" style="font-size:11px;">${viewMode === 'list' ? 'Kanban View' : 'List View'}</button>
          ${archivable.length > 0 ? `<button id="sessions-archive-btn" class="refresh-btn" title="Archive done sessions older than 7 days">Archive (${archivable.length})</button>` : ''}
        </span>
      </h2>

      ${renderFilterBar(statusFilter, typeFilter)}

      <div id="sessions-list-view" style="display:${viewMode === 'list' ? 'block' : 'none'};">
        <div class="sessions-section" style="margin-bottom:20px;">
          <h3 style="margin:0 0 10px; font-size:15px; color:var(--text);">Current Stack</h3>
          ${currentStack.length > 0
            ? currentStack.map(s => renderSessionCard(s, agentTasks)).join('')
            : `<p style="color:var(--text-dim); font-size:13px;">${hasFilter ? 'No matching sessions.' : 'No sessions in current stack.'}</p>`}
        </div>

        <div class="sessions-section" style="margin-bottom:20px;">
          <h3 style="margin:0 0 10px; font-size:15px; color:var(--text);">Backlog</h3>
          ${backlog.length > 0
            ? backlog.map(s => renderSessionCard(s, agentTasks)).join('')
            : `<p style="color:var(--text-dim); font-size:13px;">${hasFilter ? 'No matching sessions.' : 'No sessions in backlog.'}</p>`}
        </div>

        ${completedSorted.length > 0 ? `
          <div class="sessions-section sessions-completed" style="margin-bottom:20px;">
            <h3 class="sessions-completed-toggle" style="margin:0 0 10px; font-size:15px; color:var(--text-dim); cursor:pointer; user-select:none;">${completedExpanded ? '▾' : '▸'} Completed (${completedSorted.length})</h3>
            <div id="sessions-completed-cards" style="display:${completedExpanded ? 'block' : 'none'};">
              ${completedSorted.map(s => renderSessionCard(s, agentTasks)).join('')}
            </div>
          </div>
        ` : ''}

        ${reorderLog.length > 0 ? `
          <div class="sessions-section" style="margin-bottom:20px;">
            <h3 class="reorder-history-toggle" style="cursor:pointer; color:var(--text-dim); font-size:14px; user-select:none;">
              ${reorderExpanded ? '▾' : '▸'} Reorder History (${reorderLog.length})
            </h3>
            <div id="reorder-history-list" style="display:${reorderExpanded ? 'block' : 'none'};">
              ${[...reorderLog].sort((a, b) => b.ts.localeCompare(a.ts)).map(entry => `
                <div style="font-size:12px; margin-bottom:6px; padding:6px 8px; border-left:2px solid var(--border); background:var(--bg-panel); border-radius:0 4px 4px 0;">
                  <span style="color:var(--text-dim); font-size:11px;">${escapeHtml(new Date(entry.ts).toLocaleString())}</span>
                  <span style="color:var(--text-dim); font-size:11px; margin-left:8px;">(${entry.newOrder.length} session${entry.newOrder.length !== 1 ? 's' : ''})</span><br/>
                  ${escapeHtml(entry.reason)}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Render kanban board if in kanban mode (apply filters)
    if (viewMode === 'kanban') {
      renderKanban(filtered, agentTasks, container);
    }

    // Update sidebar badge
    const activeSessions = sessions.filter(s => s.status === 'active' || s.status === 'blocked' || s.status === 'needs-attention');
    const navItem = document.querySelector('.nav-item[data-section="sessions"]');
    if (navItem) {
      const existing = navItem.querySelector('.nav-badge');
      const badge = existing || document.createElement('span');
      badge.className = 'nav-badge';
      badge.textContent = activeSessions.length > 0 ? String(activeSessions.length) : '';
      if (!existing) navItem.appendChild(badge);
    }

    wireEvents();
  }

  function wireEvents(): void {
    // Filter buttons
    container.querySelectorAll<HTMLElement>('.session-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.filterGroup;
        const value = btn.dataset.filter ?? 'all';
        if (group === 'status') statusFilter = value;
        else if (group === 'type') typeFilter = value;
        render();
      });
    });

    // Toggle list/kanban view
    document.getElementById('sessions-view-toggle')?.addEventListener('click', () => {
      viewMode = viewMode === 'list' ? 'kanban' : 'list';
      render();
    });

    // Toggle card expand/collapse
    container.querySelectorAll<HTMLElement>('.session-card-header').forEach(header => {
      header.addEventListener('click', () => {
        const card = header.closest<HTMLElement>('.session-card');
        if (!card) return;
        const detail = card.querySelector<HTMLElement>('.session-card-detail');
        if (!detail) return;
        const isExpanded = card.classList.contains('expanded');
        if (isExpanded) {
          card.classList.remove('expanded');
          detail.style.display = 'none';
        } else {
          card.classList.add('expanded');
          detail.style.display = 'block';
        }
      });
    });

    // Followup buttons — copy prompt to clipboard
    container.querySelectorAll<HTMLElement>('.session-followup-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const prompt = btn.dataset.prompt ?? '';
        navigator.clipboard.writeText(prompt).then(() => {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        });
      });
    });

    // Drill-down toggle
    container.querySelectorAll<HTMLElement>('.session-drilldown-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const body = toggle.nextElementSibling as HTMLElement | null;
        if (!body) return;
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        toggle.textContent = (open ? '▸' : '▾') + ' More Details';
      });
    });

    // Toggle completed section
    const completedToggle = container.querySelector<HTMLElement>('.sessions-completed-toggle');
    completedToggle?.addEventListener('click', () => {
      completedExpanded = !completedExpanded;
      render();
    });

    // Toggle reorder history section
    const reorderToggle = container.querySelector<HTMLElement>('.reorder-history-toggle');
    reorderToggle?.addEventListener('click', () => {
      reorderExpanded = !reorderExpanded;
      render();
    });

    // Archive button
    document.getElementById('sessions-archive-btn')?.addEventListener('click', async () => {
      const toArchive = sessions.filter(s => isArchivable(s));
      if (toArchive.length === 0) return;

      try {
        await saveArchive(toArchive);
      } catch {
        return; // Archive save failed — don't remove sessions from active list
      }
      const archiveIds = new Set(toArchive.map(s => s.id));
      sessions = sessions.filter(s => !archiveIds.has(s.id));
      await saveSessions(sessions);
      render();
    });
  }

  render();
}

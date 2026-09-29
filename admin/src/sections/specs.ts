import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';

interface SpecMeta {
  file: string;
  date: string;
  status: string;
  specNum: number | null;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('approved') || s.includes('accepted')) return 'var(--green)';
  if (s.includes('completed') || s.includes('done') || s.includes('implemented')) return 'var(--accent)';
  if (s.includes('draft')) return 'var(--text-dim)';
  if (s.includes('rejected') || s.includes('cancelled')) return 'var(--red-bright)';
  return 'var(--text-quiet)';
}

function renderSpecItem(spec: SpecMeta): string {
  const label = spec.file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ');
  const dateStr = spec.date || spec.file.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
  const parts: string[] = [];
  if (dateStr) parts.push(escapeHtml(dateStr));
  if (spec.status) parts.push(`<span style="color:${statusColor(spec.status)};">${escapeHtml(spec.status)}</span>`);
  const subtitle = parts.length ? parts.join(' &middot; ') : '';

  return `<div class="spec-item" data-file="${escapeHtml(spec.file)}" style="padding:8px 10px; cursor:pointer; border-radius:4px; margin-bottom:4px; transition:all 0.15s; display:flex; align-items:flex-start; gap:6px;">
    <div style="flex:1; min-width:0;">
      <div style="font-size:12px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(label)}</div>
      ${subtitle ? `<div style="font-size:10px; color:var(--text-dim); margin-top:2px;">${subtitle}</div>` : ''}
    </div>
    <button class="spec-delete" data-file="${escapeHtml(spec.file)}" title="Delete spec" style="flex-shrink:0; background:none; border:none; color:var(--text-quiet); cursor:pointer; font-size:14px; line-height:1; padding:2px 4px; border-radius:3px; opacity:0; transition:opacity 0.15s;">&times;</button>
  </div>`;
}

export async function renderSpecs(container: HTMLElement): Promise<void> {
  container.innerHTML = `<h2>${icon('file-text', 18)} Specs</h2><p style="color:var(--text-dim);">Loading...</p>`;

  try {
    const res = await fetch('/__admin_specs');
    const specs: SpecMeta[] = await res.json();

    if (specs.length === 0) {
      container.innerHTML = `<h2>${icon('file-text', 18)} Specs</h2><p style="color:var(--text-dim);">No spec files found in docs/superpowers/specs/</p>`;
      return;
    }

    container.innerHTML = `
      <style>
        .spec-item:hover { background: var(--bg-hover); }
        .spec-item:hover .spec-delete { opacity: 1 !important; }
        .spec-delete:hover { color: var(--red-bright) !important; background: rgba(176, 45, 28, 0.15); }
      </style>
      <div style="display:flex; gap:16px; height:calc(100vh - 120px);">
        <div id="spec-list" style="width:280px; flex-shrink:0; overflow-y:auto; border-right:1px solid var(--border); padding-right:12px;">
          <h2>${icon('file-text', 18)} Specs</h2>
          ${specs.map(s => renderSpecItem(s)).join('')}
        </div>
        <div id="spec-content" style="flex:1; overflow-y:auto; padding:0 16px;">
          <p style="color:var(--text-dim);">Select a spec to view</p>
        </div>
      </div>
    `;

    // Click handler — view spec
    container.addEventListener('click', async (e) => {
      const deleteBtn = (e.target as HTMLElement).closest('.spec-delete') as HTMLElement;
      if (deleteBtn) {
        e.stopPropagation();
        const file = deleteBtn.dataset.file;
        if (!file || !confirm(`Delete ${file}?`)) return;
        try {
          await fetch(`/__admin_specs?file=${encodeURIComponent(file)}`, { method: 'DELETE' });
          deleteBtn.closest('.spec-item')?.remove();
          const contentEl = document.getElementById('spec-content');
          if (contentEl) contentEl.innerHTML = '<p style="color:var(--text-dim);">Spec deleted</p>';
        } catch { /* ignore */ }
        return;
      }

      const item = (e.target as HTMLElement).closest('.spec-item') as HTMLElement;
      if (!item?.dataset.file) return;

      container.querySelectorAll('.spec-item').forEach(el => {
        (el as HTMLElement).style.background = '';
      });
      item.style.background = 'var(--bg-hover)';

      const contentEl = document.getElementById('spec-content')!;
      contentEl.innerHTML = '<p style="color:var(--text-dim);">Loading...</p>';

      try {
        const res = await fetch(`/__admin_specs/read?file=${encodeURIComponent(item.dataset.file)}`);
        const data = await res.json() as { content: string };
        contentEl.innerHTML = renderMarkdownToHtml(data.content);
      } catch {
        contentEl.innerHTML = '<p style="color:var(--red);">Failed to load spec</p>';
      }
    });

  } catch {
    container.innerHTML = `<h2>${icon('file-text', 18)} Specs</h2><p style="color:var(--red);">Failed to load specs list</p>`;
  }
}

/** Simple markdown to HTML renderer for spec display. */
export function renderMarkdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inCode = false;
  let inTable = false;
  let inList = false;

  for (const line of lines) {
    // Code blocks
    if (line.startsWith('```')) {
      if (inCode) {
        html.push('</code></pre>');
        inCode = false;
      } else {
        html.push(`<pre style="background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:12px; margin:8px 0; overflow-x:auto;"><code style="font-family:var(--font-mono); font-size:11px; line-height:1.6;">`);
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html.push(escapeHtml(line));
      html.push('\n');
      continue;
    }

    // Close list if needed
    if (inList && !line.match(/^[\s]*[-*|]/) && line.trim()) {
      inList = false;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)/);
    if (h) {
      const level = h[1].length;
      const sizes: Record<number, string> = { 1: '20px', 2: '16px', 3: '14px', 4: '13px', 5: '12px', 6: '11px' };
      html.push(`<h${level} style="font-family:var(--font-display); font-size:${sizes[level]}; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--text-heading); margin:16px 0 8px;">${inlineFormat(h[2])}</h${level}>`);
      continue;
    }

    // Table rows
    if (line.includes('|') && line.trim().startsWith('|')) {
      if (line.match(/^\|[\s-:|]+\|$/)) continue; // separator row
      const cells = line.split('|').filter(c => c.trim()).map(c => `<td style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:12px;">${inlineFormat(c.trim())}</td>`);
      if (!inTable) {
        html.push('<table style="width:100%; border-collapse:collapse; margin:8px 0;">');
        inTable = true;
      }
      html.push(`<tr>${cells.join('')}</tr>`);
      continue;
    }
    if (inTable && !line.includes('|')) {
      html.push('</table>');
      inTable = false;
    }

    // List items
    if (line.match(/^[\s]*[-*]\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      const text = line.replace(/^[\s]*[-*]\s/, '');
      html.push(`<div style="padding:2px 0 2px ${indent * 8 + 16}px; font-size:13px; line-height:1.6;">&#8226; ${inlineFormat(text)}</div>`);
      inList = true;
      continue;
    }

    // Numbered list
    if (line.match(/^[\s]*\d+\.\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      const num = line.match(/(\d+)\./)?.[1] ?? '';
      const text = line.replace(/^[\s]*\d+\.\s/, '');
      html.push(`<div style="padding:2px 0 2px ${indent * 8 + 16}px; font-size:13px; line-height:1.6;">${num}. ${inlineFormat(text)}</div>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      html.push('<hr style="border:none; border-top:1px solid var(--border); margin:16px 0;">');
      continue;
    }

    // Empty line
    if (!line.trim()) {
      html.push('<div style="height:8px;"></div>');
      continue;
    }

    // Paragraph
    html.push(`<p style="font-size:13px; line-height:1.6; margin:4px 0;">${inlineFormat(line)}</p>`);
  }

  if (inCode) html.push('</code></pre>');
  if (inTable) html.push('</table>');

  return html.join('\n');
}

/** Inline markdown formatting. */
export function inlineFormat(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`(.+?)`/g, '<code style="background:var(--bg); padding:1px 4px; border-radius:2px; font-family:var(--font-mono); font-size:11px;">$1</code>');
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent);">$1</a>');
  return html;
}

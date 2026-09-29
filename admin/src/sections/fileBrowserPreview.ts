// ── File Browser: File Preview Panel ──────────────────────────────────────────

import { escapeText } from './fileBrowserTree';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp']);
const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.scss', '.md', '.txt',
  '.yml', '.yaml', '.toml', '.sh', '.bat', '.env', '.lock', '.gitignore',
  '.xml', '.svg', '.map', '.mjs', '.cjs', '.mts', '.cts', '.d.ts',
]);

function isTextFile(ext: string): boolean {
  return TEXT_EXTS.has(ext.toLowerCase()) || ext === '';
}

function isImageFile(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

export async function fetchFileContent(filePath: string): Promise<string> {
  const res = await fetch(`/__admin_fs/read?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) throw new Error(`Failed to read ${filePath}`);
  return await res.text();
}

export function renderPreview(
  container: HTMLElement,
  filePath: string,
  fileName: string,
  extension: string,
  onClose: () => void,
): void {
  container.innerHTML = '';

  // Header bar
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:12px;';

  const titleSpan = document.createElement('span');
  titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);';
  titleSpan.textContent = filePath;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'X Close';
  closeBtn.style.cssText = 'background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--text-dim);cursor:pointer;font-size:11px;padding:2px 8px;transition:color 0.15s;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = 'var(--red)'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = 'var(--text-dim)'; });
  closeBtn.addEventListener('click', onClose);

  header.appendChild(titleSpan);
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Content area
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow:auto;padding:0;';
  container.appendChild(body);

  const ext = extension.toLowerCase();
  if (isImageFile(ext)) {
    renderImagePreview(body, filePath);
  } else if (isTextFile(ext)) {
    void renderTextPreview(body, filePath);
  } else {
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px;">
      <div style="font-size:24px;margin-bottom:12px;">?</div>
      <div>No preview available for <strong>${escapeText(fileName)}</strong></div>
      <div style="font-size:11px;margin-top:8px;">Extension: ${escapeText(ext || 'none')}</div>
    </div>`;
  }
}

function renderImagePreview(container: HTMLElement, filePath: string): void {
  container.style.cssText += 'display:flex;align-items:center;justify-content:center;padding:20px;';
  const img = document.createElement('img');
  img.src = `/__admin_fs/read?path=${encodeURIComponent(filePath)}`;
  img.alt = filePath;
  img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;';
  img.onerror = () => {
    container.innerHTML = '<div style="color:var(--red);padding:20px;">Failed to load image</div>';
  };
  container.appendChild(img);
}

async function renderTextPreview(container: HTMLElement, filePath: string): Promise<void> {
  container.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:12px;">Loading...</div>';
  try {
    const content = await fetchFileContent(filePath);
    const lines = content.split('\n');
    const gutterWidth = String(lines.length).length;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;font-family:var(--font-mono);font-size:12px;line-height:1.6;overflow:auto;height:100%;';

    const gutter = document.createElement('div');
    gutter.style.cssText = 'padding:8px 8px 8px 12px;color:var(--text-dim);text-align:right;user-select:none;border-right:1px solid var(--border);background:var(--surface);white-space:pre;flex-shrink:0;min-width:40px;';

    const code = document.createElement('pre');
    code.style.cssText = 'padding:8px 12px;margin:0;white-space:pre;overflow-x:auto;flex:1;color:var(--text);tab-size:2;';

    let gutterText = '';
    let codeText = '';
    for (let i = 0; i < lines.length; i++) {
      gutterText += String(i + 1).padStart(gutterWidth) + '\n';
      codeText += escapeText(lines[i]) + '\n';
    }

    gutter.textContent = gutterText;
    code.innerHTML = codeText;

    // Synchronize scroll
    wrapper.addEventListener('scroll', () => {
      gutter.style.transform = `translateY(-${wrapper.scrollTop}px)`;
    });

    wrapper.appendChild(gutter);
    wrapper.appendChild(code);
    container.innerHTML = '';
    container.appendChild(wrapper);
  } catch (err) {
    container.innerHTML = `<div style="padding:20px;color:var(--red);font-size:12px;">Failed to load file: ${escapeText(String(err))}</div>`;
  }
}

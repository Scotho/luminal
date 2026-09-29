// admin/src/ui/collapsibleGroup.ts — Collapsible group component for consecutive same-type tool calls

export interface GroupableItem {
  id: string;
  type: string;
  title: string;
  preview: string;
  body: string;
  depth: number;
  status: 'running' | 'done' | 'error';
}

/**
 * Scans consecutive runs of same `type` items and returns them as groups.
 * Runs of 3+ items → one array containing all items in the run.
 * Runs of 1–2 items → each item in its own singleton array.
 */
export function shouldGroup(items: GroupableItem[]): GroupableItem[][] {
  if (items.length === 0) return [];

  const result: GroupableItem[][] = [];

  let runStart = 0;
  while (runStart < items.length) {
    const runType = items[runStart].type;
    let runEnd = runStart + 1;
    while (runEnd < items.length && items[runEnd].type === runType) {
      runEnd++;
    }
    const run = items.slice(runStart, runEnd);
    if (run.length >= 3) {
      result.push(run);
    } else {
      for (const item of run) {
        result.push([item]);
      }
    }
    runStart = runEnd;
  }

  return result;
}

/**
 * Returns a descriptive summary label for the group based on the first item's type.
 */
function describeGroup(type: string, count: number): string {
  switch (type) {
    case 'Read':
      return `Read ${count} file${count !== 1 ? 's' : ''}`;
    case 'Grep':
    case 'Glob':
      return `Searched ${count} pattern${count !== 1 ? 's' : ''}`;
    case 'Edit':
    case 'Write':
      return `Edited ${count} file${count !== 1 ? 's' : ''}`;
    case 'Bash':
      return `Ran ${count} command${count !== 1 ? 's' : ''}`;
    default:
      return `${count} tool call${count !== 1 ? 's' : ''}`;
  }
}

/**
 * Renders a collapsible group into `container`.
 *
 * Structure:
 *   .cc-group[.cc-depth-N]
 *     .cc-group-header  (sticky)
 *       .cc-group-chevron  ▸ / ▾
 *       .cc-group-badge    "3"
 *       .cc-group-label    "Read 3 files"
 *       .cc-group-depth-badge  "(depth N)"  — depth >= 3 only
 *     .cc-group-body[.cc-group-body--expanded]
 *       .cc-group-item[data-id]  × N
 */
export function renderCollapsibleGroup(
  group: GroupableItem[],
  container: HTMLElement,
  options: { onItemClick?: (id: string) => void } = {},
): void {
  const depth = group[0]?.depth ?? 0;

  // ── Wrapper ──────────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.className = 'cc-group';
  if (depth === 1) wrapper.classList.add('cc-depth-1');
  else if (depth === 2) wrapper.classList.add('cc-depth-2');
  else if (depth >= 3) wrapper.classList.add('cc-depth-3');

  // ── Header ───────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'cc-group-header';
  header.style.position = 'sticky';
  header.style.top = '0';
  header.style.zIndex = '1';

  const chevron = document.createElement('span');
  chevron.className = 'cc-group-chevron';
  chevron.textContent = '▸';

  const badge = document.createElement('span');
  badge.className = 'cc-group-badge';
  badge.textContent = String(group.length);

  const label = document.createElement('span');
  label.className = 'cc-group-label';
  const firstType = group[0]?.type ?? '';
  label.textContent = describeGroup(firstType, group.length);

  header.appendChild(chevron);
  header.appendChild(badge);
  header.appendChild(label);

  // ── Depth badge (depth >= 3) ──────────────────────────────
  if (depth >= 3) {
    const depthBadge = document.createElement('span');
    depthBadge.className = 'cc-group-depth-badge';
    depthBadge.textContent = `(depth ${depth})`;
    header.appendChild(depthBadge);
  }

  // ── Body ─────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'cc-group-body';
  body.style.maxHeight = '0px';
  body.style.overflow = 'hidden';

  const itemEls: HTMLElement[] = [];
  for (const item of group) {
    const row = document.createElement('div');
    row.className = 'cc-group-item';
    row.setAttribute('data-id', item.id);
    row.textContent = item.preview || item.title;
    if (options.onItemClick) {
      row.addEventListener('click', () => options.onItemClick!(item.id));
    }
    body.appendChild(row);
    itemEls.push(row);
  }

  // ── Toggle ───────────────────────────────────────────────
  header.addEventListener('click', () => {
    const isExpanded = body.classList.toggle('cc-group-body--expanded');
    chevron.textContent = isExpanded ? '▾' : '▸';

    if (isExpanded) {
      const expandHeight = body.scrollHeight || itemEls.length * 28;
      body.style.maxHeight = `${expandHeight}px`;
      // Staggered item animation
      itemEls.forEach((item, i) => {
        item.style.animationDelay = `${i * 50}ms`;
        item.classList.add('cc-group-item--animate');
      });
      // After transition, remove inline maxHeight so dynamic content works
      const onTransitionEnd = () => {
        if (body.classList.contains('cc-group-body--expanded')) {
          body.style.maxHeight = '';
        }
        body.removeEventListener('transitionend', onTransitionEnd);
      };
      body.addEventListener('transitionend', onTransitionEnd);
    } else {
      // Must set explicit height before collapsing (if maxHeight was cleared)
      body.style.maxHeight = `${body.scrollHeight}px`;
      // Force reflow so the browser sees the explicit value before the transition
      body.getBoundingClientRect();
      body.style.maxHeight = '0px';
      // Remove animation classes on collapse
      itemEls.forEach(item => item.classList.remove('cc-group-item--animate'));
    }
  });

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  container.appendChild(wrapper);
}

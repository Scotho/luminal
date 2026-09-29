import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  shouldGroup,
  renderCollapsibleGroup,
  type GroupableItem,
} from '../collapsibleGroup';

// ── Helpers ───────────────────────────────────────────────

function makeItem(overrides: Partial<GroupableItem> = {}): GroupableItem {
  return {
    id: 'i1',
    type: 'Read',
    title: 'Read',
    preview: 'file.ts',
    body: 'content',
    depth: 0,
    status: 'done',
    ...overrides,
  };
}

// ── shouldGroup ───────────────────────────────────────────

describe('shouldGroup', () => {
  it('groups 3 consecutive same-type items into 1 array of 3', () => {
    const items = [
      makeItem({ id: 'a', type: 'Read' }),
      makeItem({ id: 'b', type: 'Read' }),
      makeItem({ id: 'c', type: 'Read' }),
    ];
    const groups = shouldGroup(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('does NOT group 2 consecutive same-type items (threshold is 3)', () => {
    const items = [
      makeItem({ id: 'a', type: 'Read' }),
      makeItem({ id: 'b', type: 'Read' }),
    ];
    const groups = shouldGroup(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });

  it('does not group mixed non-consecutive types — each is array of 1', () => {
    const items = [
      makeItem({ id: 'a', type: 'Read' }),
      makeItem({ id: 'b', type: 'Edit' }),
      makeItem({ id: 'c', type: 'Bash' }),
    ];
    const groups = shouldGroup(items);
    expect(groups).toHaveLength(3);
    groups.forEach(g => expect(g).toHaveLength(1));
  });

  it('handles mixed singles and a group: [Edit(1), Read(3), Bash(1)] → 3 groups', () => {
    const items = [
      makeItem({ id: 'a', type: 'Edit' }),
      makeItem({ id: 'b', type: 'Read' }),
      makeItem({ id: 'c', type: 'Read' }),
      makeItem({ id: 'd', type: 'Read' }),
      makeItem({ id: 'e', type: 'Bash' }),
    ];
    const groups = shouldGroup(items);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(1);   // Edit singleton
    expect(groups[0][0].type).toBe('Edit');
    expect(groups[1]).toHaveLength(3);   // Read group
    expect(groups[1][0].type).toBe('Read');
    expect(groups[2]).toHaveLength(1);   // Bash singleton
    expect(groups[2][0].type).toBe('Bash');
  });

  it('handles empty input', () => {
    expect(shouldGroup([])).toEqual([]);
  });

  it('handles single item', () => {
    const groups = shouldGroup([makeItem({ id: 'x' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  it('groups 5 consecutive same-type items into 1 array of 5', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `r${i}`, type: 'Read' }),
    );
    const groups = shouldGroup(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(5);
  });
});

// ── renderCollapsibleGroup ────────────────────────────────

describe('renderCollapsibleGroup', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders collapsed header with count in .cc-group-badge', () => {
    const group = [
      makeItem({ id: 'a' }),
      makeItem({ id: 'b' }),
      makeItem({ id: 'c' }),
    ];
    renderCollapsibleGroup(group, container);

    const header = container.querySelector('.cc-group-header');
    expect(header).not.toBeNull();
    const badge = container.querySelector('.cc-group-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('3');
  });

  it('body is hidden by default (no .cc-group-body--expanded)', () => {
    const group = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];
    renderCollapsibleGroup(group, container);

    const body = container.querySelector('.cc-group-body');
    expect(body).not.toBeNull();
    expect(body!.classList.contains('cc-group-body--expanded')).toBe(false);
  });

  it('toggles .cc-group-body--expanded on header click', () => {
    const group = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];
    renderCollapsibleGroup(group, container);

    const header = container.querySelector('.cc-group-header') as HTMLElement;
    const body = container.querySelector('.cc-group-body')!;

    // Click to expand
    header.click();
    expect(body.classList.contains('cc-group-body--expanded')).toBe(true);

    // Click again to collapse
    header.click();
    expect(body.classList.contains('cc-group-body--expanded')).toBe(false);
  });

  it('chevron toggles from ▸ to ▾ on expand and back', () => {
    const group = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];
    renderCollapsibleGroup(group, container);

    const header = container.querySelector('.cc-group-header') as HTMLElement;
    const chevron = container.querySelector('.cc-group-chevron')!;

    expect(chevron.textContent).toBe('▸');
    header.click();
    expect(chevron.textContent).toBe('▾');
    header.click();
    expect(chevron.textContent).toBe('▸');
  });

  it('applies depth class .cc-depth-2 for items at depth 2', () => {
    const group = [
      makeItem({ id: 'a', depth: 2 }),
      makeItem({ id: 'b', depth: 2 }),
      makeItem({ id: 'c', depth: 2 }),
    ];
    renderCollapsibleGroup(group, container);

    const wrapper = container.querySelector('.cc-group');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.classList.contains('cc-depth-2')).toBe(true);
  });

  it('applies no extra depth class at depth 0', () => {
    const group = [makeItem({ id: 'a', depth: 0 }), makeItem({ id: 'b', depth: 0 }), makeItem({ id: 'c', depth: 0 })];
    renderCollapsibleGroup(group, container);

    const wrapper = container.querySelector('.cc-group')!;
    expect(wrapper.classList.contains('cc-depth-0')).toBe(false);
    expect(wrapper.classList.contains('cc-depth-1')).toBe(false);
    expect(wrapper.classList.contains('cc-depth-2')).toBe(false);
    expect(wrapper.classList.contains('cc-depth-3')).toBe(false);
  });

  it('caps depth class at cc-depth-3 for depth >= 3', () => {
    const group = [makeItem({ id: 'a', depth: 5 }), makeItem({ id: 'b', depth: 5 }), makeItem({ id: 'c', depth: 5 })];
    renderCollapsibleGroup(group, container);

    const wrapper = container.querySelector('.cc-group')!;
    expect(wrapper.classList.contains('cc-depth-3')).toBe(true);
    expect(wrapper.classList.contains('cc-depth-5')).toBe(false);
  });

  it('fires onItemClick callback with item id when expanded item is clicked', () => {
    const group = [
      makeItem({ id: 'item-1' }),
      makeItem({ id: 'item-2' }),
      makeItem({ id: 'item-3' }),
    ];
    const onItemClick = vi.fn();
    renderCollapsibleGroup(group, container, { onItemClick });

    const header = container.querySelector('.cc-group-header') as HTMLElement;
    // Expand first
    header.click();

    const items = container.querySelectorAll('.cc-group-item');
    expect(items.length).toBe(3);

    (items[1] as HTMLElement).click();
    expect(onItemClick).toHaveBeenCalledWith('item-2');
  });

  it('each body item has a data-id attribute matching item id', () => {
    const group = [
      makeItem({ id: 'x1' }),
      makeItem({ id: 'x2' }),
      makeItem({ id: 'x3' }),
    ];
    renderCollapsibleGroup(group, container);

    const header = container.querySelector('.cc-group-header') as HTMLElement;
    header.click();

    const items = container.querySelectorAll('.cc-group-item');
    expect(items[0].getAttribute('data-id')).toBe('x1');
    expect(items[1].getAttribute('data-id')).toBe('x2');
    expect(items[2].getAttribute('data-id')).toBe('x3');
  });

  it('renders a .cc-group wrapper element', () => {
    const group = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];
    renderCollapsibleGroup(group, container);
    expect(container.querySelector('.cc-group')).not.toBeNull();
  });

  it('includes the item type label in the header', () => {
    const group = [
      makeItem({ id: 'a', type: 'Edit', title: 'Edit' }),
      makeItem({ id: 'b', type: 'Edit', title: 'Edit' }),
      makeItem({ id: 'c', type: 'Edit', title: 'Edit' }),
    ];
    renderCollapsibleGroup(group, container);

    const header = container.querySelector('.cc-group-header')!;
    expect(header.textContent).toContain('Edit');
  });

  it('expand sets maxHeight style instead of display', () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2' }), makeItem({ id: '3' })];
    renderCollapsibleGroup(items, container);
    const body = container.querySelector('.cc-group-body') as HTMLElement;
    expect(body.style.maxHeight).toBe('0px');
    (container.querySelector('.cc-group-header') as HTMLElement).click();
    expect(body.style.maxHeight).not.toBe('0px');
  });

  it('header has sticky positioning', () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2' }), makeItem({ id: '3' })];
    renderCollapsibleGroup(items, container);
    const header = container.querySelector('.cc-group-header') as HTMLElement;
    expect(header.style.position).toBe('sticky');
  });

  it('depth 3+ shows depth badge', () => {
    const items = [makeItem({ id: '1', depth: 4 }), makeItem({ id: '2', depth: 4 }), makeItem({ id: '3', depth: 4 })];
    renderCollapsibleGroup(items, container);
    const badge = container.querySelector('.cc-group-depth-badge');
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('4');
  });
});

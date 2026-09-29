// admin/src/ui/skillPopover.ts

import { filterSkills, getSkillEntries, type SkillEntry } from './skillRegistry';
import { escapeHtml } from './render';

export interface SkillPopoverCallbacks {
  onSelect: (skill: SkillEntry) => void;
  onClose: () => void;
}

export class SkillPopover {
  private _el: HTMLElement | null = null;
  private _tooltipEl: HTMLElement | null = null;
  private _items: SkillEntry[] = [];
  private _selectedIndex = 0;
  private _callbacks: SkillPopoverCallbacks;
  private _container: HTMLElement;

  constructor(container: HTMLElement, callbacks: SkillPopoverCallbacks) {
    this._container = container;
    this._callbacks = callbacks;
  }

  /** Show popover with initial filter (the text after /). */
  open(query: string): void {
    this.close();
    this._items = query ? filterSkills(query) : getSkillEntries();
    this._selectedIndex = 0;
    this._render();
  }

  /** Update filter as user types. */
  filter(query: string): void {
    this._items = query ? filterSkills(query) : getSkillEntries();
    this._selectedIndex = 0;
    this._render();
  }

  /** Handle keyboard events. Returns true if consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this._el) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._selectedIndex = Math.min(this._selectedIndex + 1, this._items.length - 1);
      this._render();
      return true;
    }
    if (e.key === 'ArrowUp') {
      if (this._selectedIndex <= 0) {
        // At top of list — close popover so ArrowUp falls through to history
        this.close();
        return false;
      }
      e.preventDefault();
      this._selectedIndex--;
      this._render();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const item = this._items[this._selectedIndex];
      if (item) this._callbacks.onSelect(item);
      this.close();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this._callbacks.onClose();
      this.close();
      return true;
    }
    return false;
  }

  isOpen(): boolean { return this._el !== null; }

  close(): void {
    this._el?.remove();
    this._el = null;
    this._tooltipEl?.remove();
    this._tooltipEl = null;
  }

  private _render(): void {
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.className = 'skill-popover';
      this._container.style.position = 'relative';
      this._container.appendChild(this._el);
      // Hide tooltip when mouse leaves the entire popover
      this._el.addEventListener('mouseleave', () => {
        this._hideTooltip();
      });
    }

    if (this._items.length === 0) {
      this._el.innerHTML = '<div class="skill-popover-empty">No matching skills</div>';
      return;
    }

    this._el.innerHTML = this._items.map((item, i) =>
      `<div class="skill-popover-item${i === this._selectedIndex ? ' selected' : ''}" data-index="${i}">` +
        `<span>${item.icon}</span>` +
        `<span class="skill-popover-item-name">${escapeHtml(item.name)}</span>` +
        `<span class="skill-popover-item-desc">${escapeHtml(item.description)}</span>` +
      `</div>`
    ).join('');

    // Scroll selected into view
    const selectedEl = this._el.querySelector('.selected') as HTMLElement | null;
    selectedEl?.scrollIntoView({ block: 'nearest' });

    // Wire hover events for tooltip + click
    this._el.querySelectorAll('.skill-popover-item').forEach(itemEl => {
      const idx = parseInt((itemEl as HTMLElement).dataset.index ?? '0');

      itemEl.addEventListener('mouseenter', () => {
        this._selectedIndex = idx;
        this._showTooltip(this._items[idx], itemEl as HTMLElement);
        this._render();
      });

      itemEl.addEventListener('mouseleave', () => {
        this._hideTooltip();
      });

      itemEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const item = this._items[idx];
        if (item) this._callbacks.onSelect(item);
        this.close();
      });
    });
  }

  private _showTooltip(skill: SkillEntry, anchor: HTMLElement): void {
    this._hideTooltip();
    const tt = document.createElement('div');
    tt.className = 'skill-popover-tooltip';
    tt.innerHTML = `<strong>${escapeHtml(skill.name)}</strong><br/>${escapeHtml(skill.description)}`;
    document.body.appendChild(tt);

    const rect = anchor.getBoundingClientRect();
    const ttRect = tt.getBoundingClientRect();

    // Position above the item, centered horizontally
    let left = rect.left + rect.width / 2 - ttRect.width / 2;
    const top = rect.top - ttRect.height - 8;

    // Clamp to viewport edges
    left = Math.max(8, Math.min(left, window.innerWidth - ttRect.width - 8));

    // Adjust caret to point at the anchor center
    const anchorCenter = rect.left + rect.width / 2;
    const caretLeft = Math.max(12, Math.min(anchorCenter - left, ttRect.width - 12));
    tt.style.setProperty('--caret-left', `${caretLeft}px`);

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;

    // Animate in
    requestAnimationFrame(() => tt.classList.add('visible'));
    this._tooltipEl = tt;
  }

  private _hideTooltip(): void {
    this._tooltipEl?.remove();
    this._tooltipEl = null;
  }
}

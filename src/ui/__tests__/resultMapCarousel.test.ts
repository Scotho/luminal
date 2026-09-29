import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSelectedMap, setSelectedMap, DEFAULT_MAP, isValidMapId } from '../mapSelectUI';
import { MAPS } from '../../types/index';
import { EVT_MAP_CHANGED } from '../../events';
import { hideResultMapPanel } from '../resultMapSelect';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build the result-screen DOM fragment matching gameplay.html */
function buildResultScreen(): {
  result: HTMLDivElement;
  panel: HTMLDivElement;
  carousel: HTMLDivElement;
} {
  const result = document.createElement('div');
  result.id = 'result';

  const content = document.createElement('div');
  content.className = 'content';

  const resultButtons = document.createElement('div');
  resultButtons.id = 'result-buttons';

  const btnContinue = document.createElement('button');
  btnContinue.id = 'btn-continue';
  resultButtons.appendChild(btnContinue);

  const btnMainmenu = document.createElement('button');
  btnMainmenu.id = 'btn-mainmenu';
  resultButtons.appendChild(btnMainmenu);

  content.appendChild(resultButtons);
  result.appendChild(content);

  const panel = document.createElement('div');
  panel.id = 'result-map-panel';
  panel.className = 'result-map-panel hidden';

  const label = document.createElement('div');
  label.className = 'result-map-panel-label';
  label.textContent = 'NEXT ARENA';
  panel.appendChild(label);

  const carousel = document.createElement('div');
  carousel.id = 'result-map-carousel';
  panel.appendChild(carousel);

  result.appendChild(panel);
  document.body.appendChild(result);

  return { result, panel, carousel };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resultMapCarousel', () => {
  let result: HTMLDivElement;
  let panel: HTMLDivElement;
  let carousel: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    ({ result, panel, carousel } = buildResultScreen());
  });

  afterEach(() => {
    hideResultMapPanel();
    result.remove();
  });

  // ── 1. DOM Structure ───────────────────────────────────────────────────────

  describe('DOM structure (result screen)', () => {
    it('#result-map-panel exists', () => {
      expect(document.getElementById('result-map-panel')).not.toBeNull();
    });

    it('#result-map-panel has hidden class by default', () => {
      expect(panel.classList.contains('hidden')).toBe(true);
    });

    it('#result-map-panel has label "NEXT ARENA"', () => {
      const label = panel.querySelector('.result-map-panel-label');
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe('NEXT ARENA');
    });

    it('#result-map-carousel container exists inside the panel', () => {
      // Use attribute selector to avoid jsdom duplicate-ID quirks (same as production code)
      const inner = panel.querySelector('[id="result-map-carousel"]');
      expect(inner).not.toBeNull();
      expect(inner).toBe(carousel);
    });

    it('result screen (#result) exists', () => {
      expect(document.getElementById('result')).not.toBeNull();
    });
  });

  // ── 2. Map Selection State Persistence ─────────────────────────────────────

  describe('map selection state persistence', () => {
    it('getSelectedMap() defaults to DEFAULT_MAP when nothing saved', () => {
      expect(getSelectedMap()).toBe(DEFAULT_MAP);
      expect(getSelectedMap()).toBe('midtown_bowl');
    });

    it('setSelectedMap("synth_pit") persists and fires event', () => {
      let detail: any = null;
      const handler = (e: Event) => { detail = (e as CustomEvent).detail; };
      document.addEventListener(EVT_MAP_CHANGED, handler);

      setSelectedMap('synth_pit');

      document.removeEventListener(EVT_MAP_CHANGED, handler);
      expect(localStorage.getItem('luminal-map')).toBe('synth_pit');
      expect(detail).not.toBeNull();
      expect(detail.map).toBe('synth_pit');
    });

    it('getSelectedMap() returns saved map after setSelectedMap()', () => {
      setSelectedMap('synth_pit');
      expect(getSelectedMap()).toBe('synth_pit');
    });

    it('setting invalid map via localStorage directly returns default', () => {
      localStorage.setItem('luminal-map', 'neon_void_999');
      expect(getSelectedMap()).toBe(DEFAULT_MAP);
    });

    it('isValidMapId() returns true for all MAPS entries', () => {
      for (const m of MAPS) {
        expect(isValidMapId(m.id)).toBe(true);
      }
    });

    it('isValidMapId() returns false for garbage/null/undefined', () => {
      expect(isValidMapId('garbage_arena')).toBe(false);
      expect(isValidMapId(null)).toBe(false);
      expect(isValidMapId(undefined)).toBe(false);
      expect(isValidMapId('')).toBe(false);
      expect(isValidMapId(42)).toBe(false);
    });
  });

  // ── 3. Map Data Integrity ──────────────────────────────────────────────────

  describe('map data integrity', () => {
    it('MAPS array has at least 2 entries', () => {
      expect(MAPS.length).toBeGreaterThanOrEqual(2);
    });

    it('each map has id and label fields', () => {
      for (const m of MAPS) {
        expect(m).toHaveProperty('id');
        expect(m).toHaveProperty('label');
      }
    });

    it('all map IDs are unique', () => {
      const ids = MAPS.map(m => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all map labels are non-empty strings', () => {
      for (const m of MAPS) {
        expect(typeof m.label).toBe('string');
        expect(m.label.length).toBeGreaterThan(0);
      }
    });

    it('DEFAULT_MAP is a valid map ID (exists in MAPS)', () => {
      expect(isValidMapId(DEFAULT_MAP)).toBe(true);
      expect(MAPS.some(m => m.id === DEFAULT_MAP)).toBe(true);
    });
  });

  // ── 4. Result Screen Layout Context ────────────────────────────────────────

  describe('result screen layout context', () => {
    it('result screen has continue button (#btn-continue)', () => {
      expect(result.querySelector('[id="btn-continue"]')).not.toBeNull();
    });

    it('result screen has main menu button (#btn-mainmenu)', () => {
      expect(result.querySelector('[id="btn-mainmenu"]')).not.toBeNull();
    });

    it('result map panel is a descendant of the result screen', () => {
      expect(result.contains(panel)).toBe(true);
    });

    it('carousel container is empty by default (rendered dynamically)', () => {
      expect(carousel.children.length).toBe(0);
      expect(carousel.innerHTML).toBe('');
    });
  });

  // ── 5. Map Selection Round-Trip ────────────────────────────────────────────

  describe('map selection round-trip', () => {
    it('set map to each valid map ID and getSelectedMap returns it', () => {
      for (const m of MAPS) {
        setSelectedMap(m.id);
        expect(getSelectedMap()).toBe(m.id);
      }
    });

    it('setSelectedMap dispatches luminal-map-changed with correct detail', () => {
      const received: string[] = [];
      const handler = (e: Event) => {
        received.push((e as CustomEvent).detail.map);
      };
      document.addEventListener(EVT_MAP_CHANGED, handler);

      setSelectedMap('synth_pit');
      setSelectedMap('midtown_bowl');

      document.removeEventListener(EVT_MAP_CHANGED, handler);
      expect(received).toEqual(['synth_pit', 'midtown_bowl']);
    });

    it('multiple setSelectedMap calls — only last value persists', () => {
      setSelectedMap('midtown_bowl');
      setSelectedMap('synth_pit');
      setSelectedMap('midtown_bowl');
      expect(getSelectedMap()).toBe('midtown_bowl');
      expect(localStorage.getItem('luminal-map')).toBe('midtown_bowl');
    });

    it('clearing localStorage restores defaults', () => {
      setSelectedMap('synth_pit');
      expect(getSelectedMap()).toBe('synth_pit');

      localStorage.clear();
      expect(getSelectedMap()).toBe(DEFAULT_MAP);
    });
  });
});

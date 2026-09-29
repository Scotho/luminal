import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showResultMapPanel, hideResultMapPanel, getResultMapSelection } from '../resultMapSelect';
import { getSelectedMap } from '../mapSelectUI';

describe('resultMapSelect', () => {
  let panel: HTMLDivElement;
  let carouselContainer: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();

    // Build the DOM structure that exists in gameplay.html
    // The panel needs to be inside a #result element
    const result = document.createElement('div');
    result.id = 'result';

    const content = document.createElement('div');
    content.className = 'content';

    const resultButtons = document.createElement('div');
    resultButtons.id = 'result-buttons';
    content.appendChild(resultButtons);

    result.appendChild(content);

    panel = document.createElement('div');
    panel.id = 'result-map-panel';
    panel.className = 'result-map-panel hidden';

    const label = document.createElement('div');
    label.className = 'result-map-panel-label';
    label.textContent = 'NEXT ARENA';
    panel.appendChild(label);

    carouselContainer = document.createElement('div');
    carouselContainer.id = 'result-map-carousel';
    panel.appendChild(carouselContainer);

    result.appendChild(panel);
    document.body.appendChild(result);
  });

  afterEach(() => {
    hideResultMapPanel();
    const result = document.getElementById('result');
    if (result) document.body.removeChild(result);
  });

  it('showResultMapPanel removes hidden class and adds visible class', async () => {
    showResultMapPanel({ mode: 'solo' });
    // hidden removed synchronously
    expect(panel.classList.contains('hidden')).toBe(false);
    // visible added on next frame — flush with a microtask wait
    await new Promise(r => requestAnimationFrame(r));
    expect(panel.classList.contains('result-map-panel--visible')).toBe(true);
  });

  it('hideResultMapPanel hides panel and cleans up carousel', () => {
    showResultMapPanel({ mode: 'solo' });
    hideResultMapPanel();
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(panel.classList.contains('result-map-panel--visible')).toBe(false);
    expect(carouselContainer.querySelector('.map-carousel')).toBeNull();
  });

  it('getResultMapSelection returns the currently selected map', () => {
    showResultMapPanel({ mode: 'solo' });
    expect(getResultMapSelection()).toBe(getSelectedMap());
  });

  it('persists current map when no selection is made (local persist)', () => {
    localStorage.setItem('luminal-map', 'synth_pit');
    showResultMapPanel({ mode: 'solo' });
    expect(getResultMapSelection()).toBe('synth_pit');
  });

  it('renders a carousel inside the container', () => {
    showResultMapPanel({ mode: 'solo' });
    expect(carouselContainer.querySelector('.map-carousel')).not.toBeNull();
  });

  it('hideResultMapPanel is safe to call when not shown', () => {
    // Should not throw
    hideResultMapPanel();
    hideResultMapPanel();
  });
});

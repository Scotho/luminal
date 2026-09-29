/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { updateAccountFlowDisplay } from '../accountFlowDisplay';

describe('updateAccountFlowDisplay', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="usm-banked-flow">—</span>
      <span id="usm-lifetime-flow">—</span>
    `;
  });

  it('updates both banked and lifetime values', () => {
    updateAccountFlowDisplay(1234, 5678);
    expect(document.getElementById('usm-banked-flow')!.textContent).toBe('1,234');
    expect(document.getElementById('usm-lifetime-flow')!.textContent).toBe('5,678');
  });

  it('handles zero values', () => {
    updateAccountFlowDisplay(0, 0);
    expect(document.getElementById('usm-banked-flow')!.textContent).toBe('0');
    expect(document.getElementById('usm-lifetime-flow')!.textContent).toBe('0');
  });

  it('handles missing DOM elements gracefully', () => {
    document.body.innerHTML = '';
    // Should not throw
    updateAccountFlowDisplay(100, 200);
  });
});
